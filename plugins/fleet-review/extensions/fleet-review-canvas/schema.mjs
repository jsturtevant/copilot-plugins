export const REVIEW_SCHEMA_VERSION = 1;
export const MAX_FINDINGS = 50;
export const RESULT_START = "FLEET_REVIEW_RESULT_START";
export const RESULT_END = "FLEET_REVIEW_RESULT_END";

const SEVERITIES = ["critical", "high", "medium", "low"];
const SEVERITY_RANK = new Map(SEVERITIES.map((severity, index) => [severity, index]));
const EXPECTED_AGENT_NAMES = new Set([
    "Security & Permissions",
    "Logic & Correctness",
    "Resource Safety & Reliability",
    "Network & Input Boundaries",
    "Sandbox Isolation",
    "SDK/API Consistency & Maintainability",
]);

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value.trim();
}

function optionalString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

function integer(value, field, minimum = 0) {
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`${field} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
}

function normalizeSeverity(value) {
    const severity = optionalString(value).toLowerCase();
    if (!SEVERITY_RANK.has(severity)) {
        throw new Error(`Unsupported finding severity: ${String(value)}`);
    }
    return severity;
}

function normalizeAgent(agent, index) {
    if (!isObject(agent)) {
        throw new Error(`agents[${index}] must be an object`);
    }
    const status = optionalString(agent.status).toLowerCase();
    if (!["complete", "failed", "timed_out"].includes(status)) {
        throw new Error(`agents[${index}].status is invalid`);
    }
    return {
        name: requiredString(agent.name, `agents[${index}].name`),
        model: requiredString(agent.model, `agents[${index}].model`),
        lens: requiredString(agent.lens, `agents[${index}].lens`),
        status,
        error: status === "complete" ? "" : requiredString(agent.error, `agents[${index}].error`),
    };
}

function normalizeFinding(finding, index) {
    if (!isObject(finding)) {
        throw new Error(`findings[${index}] must be an object`);
    }
    const fixKind = optionalString(finding.fixKind, "illustrative").toLowerCase();
    if (!["exact", "illustrative"].includes(fixKind)) {
        throw new Error(`findings[${index}].fixKind must be exact or illustrative`);
    }
    const lineStart = integer(finding.lineStart, `findings[${index}].lineStart`, 1);
    const lineEnd = integer(finding.lineEnd ?? lineStart, `findings[${index}].lineEnd`, lineStart);
    return {
        id: optionalString(finding.id, `F-${String(index + 1).padStart(3, "0")}`),
        severity: normalizeSeverity(finding.severity),
        title: requiredString(finding.title, `findings[${index}].title`),
        problem: requiredString(finding.problem, `findings[${index}].problem`),
        evidence: requiredString(finding.evidence, `findings[${index}].evidence`),
        path: requiredString(finding.path, `findings[${index}].path`),
        lineStart,
        lineEnd,
        currentCode: requiredString(finding.currentCode, `findings[${index}].currentCode`),
        suggestedCode: requiredString(finding.suggestedCode, `findings[${index}].suggestedCode`),
        fixKind,
        judgmentNotes:
            fixKind === "illustrative"
                ? requiredString(finding.judgmentNotes, `findings[${index}].judgmentNotes`)
                : optionalString(finding.judgmentNotes),
        reportedBy: Array.isArray(finding.reportedBy)
            ? finding.reportedBy.map((value, reporterIndex) =>
                  requiredString(value, `findings[${index}].reportedBy[${reporterIndex}]`),
              )
            : [],
    };
}

function compareFindings(left, right) {
    const severityDelta = SEVERITY_RANK.get(left.severity) - SEVERITY_RANK.get(right.severity);
    if (severityDelta !== 0) {
        return severityDelta;
    }
    return left.path.localeCompare(right.path) || left.lineStart - right.lineStart || left.title.localeCompare(right.title);
}

export function makeReviewKey(repository, prNumber) {
    const repo = requiredString(repository, "repository").toLowerCase();
    integer(prNumber, "prNumber", 1);
    return `${repo}#${prNumber}`;
}

export function normalizeReviewReport(raw) {
    if (!isObject(raw)) {
        throw new Error("Review report must be an object");
    }
    if (raw.schemaVersion !== REVIEW_SCHEMA_VERSION) {
        throw new Error(`Unsupported review schema version: ${String(raw.schemaVersion)}`);
    }
    if (!isObject(raw.pr)) {
        throw new Error("pr must be an object");
    }

    const repository = requiredString(raw.repository, "repository");
    const prNumber = integer(raw.pr.number, "pr.number", 1);
    const findings = (Array.isArray(raw.findings) ? raw.findings : [])
        .map(normalizeFinding)
        .sort(compareFindings);
    const retainedFindings = findings.slice(0, MAX_FINDINGS);
    const status = optionalString(raw.status).toLowerCase();
    if (!["complete", "partial"].includes(status)) {
        throw new Error("status must be complete or partial");
    }
    const agents = (Array.isArray(raw.agents) ? raw.agents : []).map(normalizeAgent);
    if (
        agents.length !== EXPECTED_AGENT_NAMES.size ||
        agents.some((agent) => !EXPECTED_AGENT_NAMES.has(agent.name)) ||
        new Set(agents.map((agent) => agent.name)).size !== EXPECTED_AGENT_NAMES.size
    ) {
        throw new Error("agents must contain each of the six Fleet Review lenses exactly once");
    }
    const hasIncompleteAgent = agents.some((agent) => agent.status !== "complete");
    if ((status === "partial") !== hasIncompleteAgent) {
        throw new Error("status must be partial if and only if an agent failed or timed out");
    }

    const retainedCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
    for (const finding of findings) {
        retainedCounts[finding.severity] += 1;
    }
    const counts =
        raw.counts === undefined
            ? retainedCounts
            : Object.fromEntries(
                  SEVERITIES.map((severity) => [
                      severity,
                      integer(raw.counts?.[severity], `counts.${severity}`, retainedCounts[severity]),
                  ]),
              );
    const confirmedTotal =
        raw.counts === undefined
            ? findings.length
            : integer(raw.counts?.confirmedTotal, "counts.confirmedTotal", findings.length);
    const severityTotal = Object.values(counts).reduce((total, count) => total + count, 0);
    if (severityTotal !== confirmedTotal) {
        throw new Error("counts.confirmedTotal must equal the sum of severity counts");
    }
    if (findings.length !== Math.min(confirmedTotal, MAX_FINDINGS)) {
        throw new Error("findings must contain the complete set up to the 50-finding cap");
    }

    return {
        schemaVersion: REVIEW_SCHEMA_VERSION,
        runId: requiredString(raw.runId, "runId"),
        reviewKey: makeReviewKey(repository, prNumber),
        repository,
        pr: {
            number: prNumber,
            title: requiredString(raw.pr.title, "pr.title"),
            url: requiredString(raw.pr.url, "pr.url"),
            isDraft: Boolean(raw.pr.isDraft),
            author: requiredString(raw.pr.author, "pr.author"),
            baseRef: requiredString(raw.pr.baseRef, "pr.baseRef"),
            headRef: requiredString(raw.pr.headRef, "pr.headRef"),
            baseSha: requiredString(raw.pr.baseSha, "pr.baseSha"),
            headSha: requiredString(raw.pr.headSha, "pr.headSha"),
        },
        status,
        startedAt: requiredString(raw.startedAt, "startedAt"),
        completedAt: requiredString(raw.completedAt, "completedAt"),
        summary: requiredString(raw.summary, "summary"),
        reportMarkdown: requiredString(raw.reportMarkdown, "reportMarkdown"),
        agents,
        counts: {
            ...counts,
            confirmedTotal,
            retained: retainedFindings.length,
            omitted: Math.max(0, confirmedTotal - retainedFindings.length),
        },
        findings: retainedFindings,
    };
}

export function extractDelimitedJson(content, startMarker = RESULT_START, endMarker = RESULT_END) {
    const text = requiredString(content, "content");
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) {
        throw new Error(`Missing ${startMarker}/${endMarker} result markers`);
    }
    const payload = text.slice(start + startMarker.length, end).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    return JSON.parse(payload);
}

export function parseReviewResult(content) {
    return normalizeReviewReport(extractDelimitedJson(content));
}

export const reviewResultExample = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    runId: "provided-run-id",
    repository: "owner/repository",
    pr: {
        number: 42,
        title: "Pull request title",
        url: "https://github.com/owner/repository/pull/42",
        isDraft: false,
        author: "octocat",
        baseRef: "main",
        headRef: "feature",
        baseSha: "base commit SHA",
        headSha: "reviewed head commit SHA",
    },
    status: "complete",
    startedAt: "ISO-8601 timestamp",
    completedAt: "ISO-8601 timestamp",
    summary: "Concise review summary.",
    reportMarkdown: "# Full Markdown report",
    agents: [
        {
            name: "Security & Permissions",
            model: "model identifier",
            lens: "Authentication, authorization, and trust boundaries",
            status: "complete",
        },
        {
            name: "Logic & Correctness",
            model: "model identifier",
            lens: "Control flow, state transitions, and edge cases",
            status: "complete",
        },
        {
            name: "Resource Safety & Reliability",
            model: "model identifier",
            lens: "Lifecycle, limits, and failure handling",
            status: "complete",
        },
        {
            name: "Network & Input Boundaries",
            model: "model identifier",
            lens: "External input, URLs, validation, and timeouts",
            status: "complete",
        },
        {
            name: "Sandbox Isolation",
            model: "model identifier",
            lens: "Guest and host boundaries and capability leaks",
            status: "complete",
        },
        {
            name: "SDK/API Consistency & Maintainability",
            model: "model identifier",
            lens: "Cross-SDK parity, types, tests, and shared code",
            status: "complete",
        },
    ],
    counts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        confirmedTotal: 1,
    },
    findings: [
        {
            id: "F-001",
            severity: "high",
            title: "Short title",
            problem: "Why this is a defect introduced by the pull request.",
            evidence: "Concrete evidence supporting the finding.",
            path: "src/example.js",
            lineStart: 10,
            lineEnd: 14,
            currentCode: "const current = true;",
            suggestedCode: "const current = validate(input);",
            fixKind: "exact",
            judgmentNotes: "",
            reportedBy: ["Security & Permissions / model identifier"],
        },
    ],
};
