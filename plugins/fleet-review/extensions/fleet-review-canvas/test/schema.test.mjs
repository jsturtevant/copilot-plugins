import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_FINDINGS,
    RESULT_END,
    RESULT_START,
    normalizeReviewReport,
    parseReviewResult,
} from "../schema.mjs";

function report(findings, overrides = {}) {
    return {
        schemaVersion: 1,
        runId: "run-1",
        repository: "Owner/Repo",
        pr: {
            number: 12,
            title: "Improve parser",
            url: "https://github.com/Owner/Repo/pull/12",
            isDraft: false,
            author: "octocat",
            baseRef: "main",
            headRef: "parser",
            baseSha: "a".repeat(40),
            headSha: "b".repeat(40),
        },
        status: "complete",
        startedAt: "2026-09-04T10:00:00.000Z",
        completedAt: "2026-09-04T10:05:00.000Z",
        summary: "Found issues.",
        reportMarkdown: "# Report",
        agents: completeAgents(),
        counts: {
            critical: findings.filter((finding) => finding.severity === "critical").length,
            high: findings.filter((finding) => finding.severity === "high").length,
            medium: findings.filter((finding) => finding.severity === "medium").length,
            low: findings.filter((finding) => finding.severity === "low").length,
            confirmedTotal: findings.length,
        },
        findings,
        ...overrides,
    };
}

function completeAgents() {
    return [
        ["Security & Permissions", "Trust boundaries"],
        ["Logic & Correctness", "Control flow"],
        ["Resource Safety & Reliability", "Lifecycle and limits"],
        ["Network & Input Boundaries", "External input"],
        ["Sandbox Isolation", "Guest and host boundaries"],
        ["SDK/API Consistency & Maintainability", "Cross-SDK parity"],
    ].map(([name, lens]) => ({
        name,
        model: "test-model",
        lens,
        status: "complete",
    }));
}

function finding(index, severity = "low") {
    return {
        id: `F-${index}`,
        severity,
        title: `Finding ${index}`,
        problem: "A real problem.",
        evidence: "Concrete evidence.",
        path: `src/file-${index}.js`,
        lineStart: index + 1,
        lineEnd: index + 2,
        currentCode: "unsafe(input);",
        suggestedCode: "safe(input);",
        fixKind: "exact",
        judgmentNotes: "",
        reportedBy: ["Security / test-model"],
    };
}

test("normalizes, severity-sorts, and caps findings", () => {
    const findings = Array.from({ length: 50 }, (_, index) =>
        finding(index, index === 49 ? "critical" : index === 48 ? "high" : "low"),
    );
    const normalized = normalizeReviewReport(
        report(findings, {
            counts: { critical: 1, high: 1, medium: 0, low: 50, confirmedTotal: 52 },
        }),
    );
    assert.equal(normalized.reviewKey, "owner/repo#12");
    assert.equal(normalized.findings.length, MAX_FINDINGS);
    assert.equal(normalized.findings[0].severity, "critical");
    assert.equal(normalized.findings[1].severity, "high");
    assert.equal(normalized.counts.confirmedTotal, 52);
    assert.equal(normalized.counts.omitted, 2);
});

test("requires judgment notes for illustrative fixes", () => {
    const illustrative = { ...finding(1), fixKind: "illustrative", judgmentNotes: "" };
    assert.throws(() => normalizeReviewReport(report([illustrative])), /judgmentNotes/);
});

test("rejects finding paths that can escape the review workspace", () => {
    for (const path of ["../secret.txt", "/etc/passwd", "C:\\secret.txt", "src/../secret.txt"]) {
        assert.throws(
            () => normalizeReviewReport(report([{ ...finding(1), path }])),
            /repository-relative path/,
        );
    }
});

test("parses a delimited child-session result", () => {
    const raw = report([finding(1)]);
    const parsed = parseReviewResult(`${RESULT_START}\n${JSON.stringify(raw)}\n${RESULT_END}`);
    assert.equal(parsed.runId, "run-1");
    assert.equal(parsed.findings[0].title, "Finding 1");
});

test("preserves the pre-cap confirmed finding count", () => {
    const findings = Array.from({ length: 50 }, (_, index) => finding(index));
    const normalized = normalizeReviewReport(
        report(findings, {
            counts: { critical: 0, high: 0, medium: 0, low: 63, confirmedTotal: 63 },
        }),
    );
    assert.equal(normalized.counts.confirmedTotal, 63);
    assert.equal(normalized.counts.omitted, 13);
});

test("rejects inconsistent full-review severity counts", () => {
    assert.throws(
        () =>
            normalizeReviewReport(
                report([finding(1)], {
                    counts: { critical: 0, high: 0, medium: 0, low: 2, confirmedTotal: 3 },
                }),
            ),
        /must equal the sum/,
    );
});

test("rejects complete reports with failed agents", () => {
    const failedAgent = {
        ...completeAgents()[0],
        model: "test-model",
        status: "failed",
        error: "Timed out",
    };
    assert.throws(
        () =>
            normalizeReviewReport(
                report([finding(1)], {
                    agents: [failedAgent, ...completeAgents().slice(1)],
                }),
            ),
        /if and only if/,
    );
});

test("requires all six review lenses", () => {
    assert.throws(
        () => normalizeReviewReport(report([finding(1)], { agents: completeAgents().slice(0, 5) })),
        /six Fleet Review lenses/,
    );
});

test("rejects underfilled capped finding payloads", () => {
    assert.throws(
        () =>
            normalizeReviewReport(
                report([finding(1)], {
                    counts: { critical: 0, high: 0, medium: 0, low: 51, confirmedTotal: 51 },
                }),
            ),
        /complete set/,
    );
});
