import { randomUUID } from "node:crypto";
import { AgentBridge } from "./bridge.mjs";
import { getPullRequestSnapshot, listOpenPullRequests, validateRepository } from "./github.mjs";
import { makeReviewKey, parseReviewResult } from "./schema.mjs";

function normalizeProjects(payload) {
    if (!payload || !Array.isArray(payload.projects)) {
        throw new Error("Project bridge response did not contain a projects array");
    }
    return payload.projects.map((project, index) => {
        if (!project || typeof project !== "object" || typeof project.id !== "string" || !project.id) {
            throw new Error(`projects[${index}] is invalid`);
        }
        const githubRepo = typeof project.githubRepo === "string" ? project.githubRepo : "";
        const enabled = githubRepo !== "";
        if (enabled) {
            validateRepository(githubRepo);
        }
        return {
            id: project.id,
            name: typeof project.name === "string" && project.name ? project.name : project.id,
            githubRepo,
            defaultBranch: typeof project.defaultBranch === "string" ? project.defaultBranch : "",
            remoteOnly: Boolean(project.remoteOnly),
            mainRepoPath: typeof project.mainRepoPath === "string" ? project.mainRepoPath : "",
            enabled,
            disabledReason: enabled ? "" : "No GitHub repository is configured for this project.",
        };
    });
}

function findRun(state, runId) {
    for (const history of Object.values(state.reviews)) {
        const run = history.find((candidate) => candidate.runId === runId);
        if (run) {
            return run;
        }
    }
    return undefined;
}

export class FleetReviewService {
    constructor(session, store) {
        this.session = session;
        this.store = store;
        this.bridge = new AgentBridge(session);
        this.unsubscribe = session.on("user.message", (event) => {
            if (
                typeof event?.data?.content !== "string" ||
                !event.data.content.includes("FLEET_REVIEW_RESULT_START") ||
                event.data.content.includes("FLEET_CANVAS_BRIDGE_START")
            ) {
                return;
            }
            void this.acceptResultMessage(event.data.content).catch((error) =>
                session.log(`Fleet Review could not accept a child result: ${error.message}`, { level: "error" }),
            );
        });
    }

    async close() {
        this.unsubscribe?.();
    }

    getState() {
        return this.store.load();
    }

    async refreshProjects() {
        const projects = normalizeProjects(await this.bridge.listProjects());
        return this.store.update((state) => {
            state.projects = projects;
        });
    }

    async loadPullRequests(repository) {
        const repo = validateRepository(repository);
        const pullRequests = await listOpenPullRequests(repo);
        return this.store.update((state) => {
            state.pullRequests[repo.toLowerCase()] = pullRequests;
            for (const pullRequest of pullRequests) {
                const key = makeReviewKey(repo, pullRequest.number);
                for (const run of state.reviews[key] ?? []) {
                    run.stale = Boolean(run.report?.pr?.headSha && run.report.pr.headSha !== pullRequest.headRefOid);
                    run.stalenessError = "";
                }
            }
        });
    }

    async startReview({ projectId, repository, prNumber, executionLocation }) {
        if (!["local", "cloud"].includes(executionLocation)) {
            throw new Error("executionLocation must be local or cloud");
        }
        const state = await this.store.load();
        const project = state.projects.find((candidate) => candidate.id === projectId);
        if (!project?.enabled || project.githubRepo.toLowerCase() !== repository.toLowerCase()) {
            throw new Error("The selected project is unavailable for pull request review");
        }
        const pullRequest = state.pullRequests[repository.toLowerCase()]?.find(
            (candidate) => candidate.number === prNumber,
        );
        if (!pullRequest) {
            throw new Error("The selected pull request is not in the current open pull request list");
        }

        const runId = randomUUID();
        const reviewKey = makeReviewKey(repository, prNumber);
        const run = {
            runId,
            reviewKey,
            repository,
            prNumber,
            executionLocation,
            projectSessionId: "",
            status: "starting",
            stale: false,
            requestedHeadSha: pullRequest.headRefOid,
            createdAt: new Date().toISOString(),
            error: "",
            report: null,
        };
        await this.store.update((draft) => {
            draft.reviews[reviewKey] ??= [];
            draft.reviews[reviewKey].unshift(run);
        });

        try {
            const result = await this.bridge.createReviewSession({
                projectId,
                repository,
                pullRequest,
                executionLocation,
                runId,
            });
            if (typeof result.projectSessionId !== "string" || !result.projectSessionId) {
                throw new Error("Session creation response did not include a projectSessionId");
            }
            return this.store.update((draft) => {
                const pending = findRun(draft, runId);
                if (!pending) {
                    throw new Error(`Review run ${runId} disappeared from state`);
                }
                pending.projectSessionId = result.projectSessionId;
                if (!pending.report) {
                    pending.status = "running";
                }
            });
        } catch (error) {
            await this.store.update((draft) => {
                const pending = findRun(draft, runId);
                if (pending && !pending.report) {
                    pending.status = "failed";
                    pending.error = error.message;
                }
            });
            throw error;
        }
    }

    async acceptResultMessage(content) {
        const report = parseReviewResult(content);
        let currentPullRequest;
        let stalenessError = "";
        try {
            currentPullRequest = await getPullRequestSnapshot(report.repository, report.pr.number);
        } catch (error) {
            stalenessError = `Could not verify the current pull request head: ${error.message}`;
        }
        return this.store.update((state) => {
            const run = findRun(state, report.runId);
            if (!run) {
                throw new Error(`Ignoring result for unknown run ${report.runId}`);
            }
            if (run.reviewKey !== report.reviewKey) {
                throw new Error(`Result review key ${report.reviewKey} does not match ${run.reviewKey}`);
            }
            run.report = report;
            run.status = report.status;
            run.completedAt = report.completedAt;
            run.error = "";
            const reviewedUnexpectedSha = run.requestedHeadSha !== report.pr.headSha;
            run.stale = Boolean(
                reviewedUnexpectedSha ||
                    (currentPullRequest?.headRefOid && currentPullRequest.headRefOid !== report.pr.headSha),
            );
            run.stalenessError = reviewedUnexpectedSha
                ? `The child session reported head ${report.pr.headSha}, but this run requested ${run.requestedHeadSha}.`
                : stalenessError;
        });
    }

    async reconcileReview(runId) {
        const state = await this.store.load();
        const run = findRun(state, runId);
        if (!run) {
            throw new Error(`Unknown review run ${runId}`);
        }
        if (!run.projectSessionId) {
            throw new Error("The review session has not been created");
        }
        const result = await this.bridge.inspectSession(run.projectSessionId);
        return this.store.update((draft) => {
            const current = findRun(draft, runId);
            if (!current || current.report) {
                return;
            }
            if (result.status === "error") {
                current.status = "failed";
                current.error = result.summary || "The child review session failed.";
            } else if (result.status === "idle") {
                current.status = "awaiting_result";
                current.error = "The review session is idle, but its structured result has not arrived.";
            }
        });
    }

    async openReviewSession(runId) {
        const state = await this.store.load();
        const run = findRun(state, runId);
        if (!run?.projectSessionId) {
            throw new Error("This review does not have a child session");
        }
        await this.bridge.openSession(run.projectSessionId);
        return { projectSessionId: run.projectSessionId, navigated: true };
    }
}
