import { extractDelimitedJson, reviewResultExample } from "./schema.mjs";

const BRIDGE_START = "FLEET_CANVAS_BRIDGE_START";
const BRIDGE_END = "FLEET_CANVAS_BRIDGE_END";

class SerialQueue {
    constructor() {
        this.tail = Promise.resolve();
    }

    run(operation) {
        const next = this.tail.then(operation, operation);
        this.tail = next.catch(() => {});
        return next;
    }
}

function bridgeReplyInstruction(shape) {
    return [
        "Reply with no prose outside these markers:",
        BRIDGE_START,
        JSON.stringify(shape),
        BRIDGE_END,
    ].join("\n");
}

function reviewKickoff({ runId, repository, pullRequest }) {
    const example = {
        ...reviewResultExample,
        runId,
        repository,
        pr: {
            ...reviewResultExample.pr,
            number: pullRequest.number,
            title: pullRequest.title,
            url: pullRequest.url,
            isDraft: pullRequest.isDraft,
            author: pullRequest.author,
            baseRef: pullRequest.baseRefName,
            headRef: pullRequest.headRefName,
            headSha: pullRequest.headRefOid,
        },
    };
    return `Review ${repository} pull request #${pullRequest.number} at head SHA ${pullRequest.headRefOid}.

Run six code-review agents in parallel over the complete PR diff, using these lenses:
1. Security and permissions.
2. Logic and correctness.
3. Resource safety and reliability.
4. Network and input boundaries.
5. Sandbox isolation.
6. SDK/API consistency and maintainability.

Use diverse current Claude, GPT, and Gemini models where available. Report only high-confidence defects introduced by this PR. Every finding needs severity, evidence, exact reviewed file and line range, the smallest proving current-code hunk, and a suggested-code hunk. Mark a suggestion "exact" only when it is a safe replacement; otherwise mark it "illustrative" and explain the remaining human judgment.

Do not modify source files, apply fixes, stage or commit changes, post PR comments, or perform any GitHub mutation. Write Markdown and JSON reports under docs/review/ when the environment permits, but always return the complete structured result to the creator. Deduplicate findings, sort critical/high/medium/low, and keep the 50 highest-severity findings. Set counts.critical, counts.high, counts.medium, counts.low, and counts.confirmedTotal from the complete deduplicated set before capping; the four severity counts must sum to confirmedTotal. If an agent fails or times out, preserve successful findings and return status "partial" with the failure.

Resolve and record the exact base and head commit SHAs before reviewing. Do not substitute branch names for SHA fields.

The result must match this example shape:
${JSON.stringify(example, null, 2)}

When complete, send the creator one message containing the full JSON between exactly:
FLEET_REVIEW_RESULT_START
{...}
FLEET_REVIEW_RESULT_END`;
}

export class AgentBridge {
    constructor(session) {
        this.session = session;
        this.queue = new SerialQueue();
    }

    async request(prompt) {
        return this.queue.run(async () => {
            const assistantMessages = [];
            let resolveBridgeReply;
            const bridgeReply = new Promise((resolve) => {
                resolveBridgeReply = resolve;
            });
            const unsubscribe = this.session.on("assistant.message", (event) => {
                if (typeof event?.data?.content === "string") {
                    assistantMessages.push(event.data.content);
                    if (
                        event.data.content.includes(BRIDGE_START) &&
                        event.data.content.includes(BRIDGE_END)
                    ) {
                        resolveBridgeReply(event.data.content);
                    }
                }
            });
            const waitForTurn = Promise.resolve()
                .then(() => this.session.sendAndWait({ prompt }, 180_000))
                .then(
                    (response) => ({ response }),
                    (waitError) => ({ waitError }),
                );
            let outcome;
            try {
                outcome = await Promise.race([
                    waitForTurn,
                    bridgeReply.then((content) => ({ bridgeReply: content })),
                ]);
            } finally {
                unsubscribe();
            }
            if (outcome.bridgeReply) {
                return extractDelimitedJson(outcome.bridgeReply, BRIDGE_START, BRIDGE_END);
            }

            const responseContent =
                typeof outcome.response?.data?.content === "string"
                    ? outcome.response.data.content
                    : "";
            const candidates = [
                responseContent,
                ...[...assistantMessages].reverse(),
                assistantMessages.join("\n"),
            ].filter((content, index, values) => content && values.indexOf(content) === index);

            for (const content of candidates) {
                if (content.includes(BRIDGE_START) && content.includes(BRIDGE_END)) {
                    return extractDelimitedJson(content, BRIDGE_START, BRIDGE_END);
                }
            }

            if (outcome.waitError) {
                throw new Error(`Copilot bridge request failed: ${outcome.waitError.message}`);
            }
            throw new Error(
                assistantMessages.length > 0
                    ? "Copilot responded without the required bridge markers"
                    : "Copilot completed the turn without emitting an assistant response",
            );
        });
    }

    listProjects() {
        return this.request(`Use the app-native list_projects tool exactly once. This is read-only. Return every configured project, including folder projects and projects without a GitHub remote. Do not ask the user a question.

${bridgeReplyInstruction({
    projects: [
        {
            id: "project id",
            name: "project name",
            githubRepo: "owner/repository or empty string",
            defaultBranch: "branch or empty string",
            remoteOnly: false,
            mainRepoPath: "local path or empty string",
        },
    ],
})}`);
    }

    createReviewSession({ projectId, repository, pullRequest, executionLocation, runId }) {
        const kickoff = reviewKickoff({ runId, repository, pullRequest });
        return this.request(`Use the app-native create_session tool exactly once to start a pull request review. Do not perform the review in this session.

Call it with:
- project_id: ${JSON.stringify(projectId)}
- execution_location: ${JSON.stringify(executionLocation)}
- coordinate_with_creator: true
- notify_on_idle: "always"
- name: ${JSON.stringify(`Review ${repository}#${pullRequest.number}`)}
- kickoff.mode: "interactive"
- kickoff.prompt: the exact string in the JSON below
${executionLocation === "local" ? '- workspace_type: "worktree"' : "- omit workspace_type"}

${JSON.stringify({ kickoff: { mode: "interactive", prompt: kickoff } }, null, 2)}

Do not set base_branch. If creation fails, return the real error rather than inventing an ID.

${bridgeReplyInstruction({
    projectSessionId: "created project session id",
    executionLocation,
})}`);
    }

    inspectSession(projectSessionId) {
        return this.request(`Use the app-native get_session tool exactly once for project session ${JSON.stringify(projectSessionId)}. Do not mutate or navigate.

${bridgeReplyInstruction({
    projectSessionId,
    status: "running, idle, error, or unknown",
    summary: "short status summary",
})}`);
    }

    resolveSessionWorkspace(projectSessionId) {
        return this.request(`Use the app-native get_session tool exactly once for project session ${JSON.stringify(projectSessionId)}. This is read-only. Return its absolute filesystem workspace path. If the session has no local workspace, return an empty string. Do not mutate or navigate.

${bridgeReplyInstruction({
    projectSessionId,
    workspacePath: "absolute local workspace path or empty string",
})}`);
    }

    openSession(projectSessionId) {
        return this.request(`Use the app-native navigate_to tool exactly once with id ${JSON.stringify(projectSessionId)}. Do not perform any other action.

${bridgeReplyInstruction({
    projectSessionId,
    navigated: true,
})}`);
    }
}
