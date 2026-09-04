import assert from "node:assert/strict";
import test from "node:test";
import { FleetReviewService } from "../service.mjs";

function serviceHarness(state) {
    const session = {
        on: () => () => {},
        log: () => {},
    };
    const store = {
        load: async () => structuredClone(state),
        update: async (mutate) => {
            await mutate(state);
            return structuredClone(state);
        },
    };
    return { service: new FleetReviewService(session, store), state, store };
}

function serviceForRun(run) {
    const state = { projects: [], pullRequests: {}, reviews: { [run.reviewKey]: [run] } };
    return serviceHarness(state).service;
}

function completedRun(executionLocation) {
    return {
        runId: "run-1",
        reviewKey: "owner/repo#1",
        projectSessionId: "session-1",
        executionLocation,
        report: {
            findings: [
                { id: "F-001", path: "src/example.js", lineStart: 10, fixKind: "exact" },
                {
                    id: "F-002",
                    path: "src/example.js",
                    lineStart: 20,
                    fixKind: "illustrative",
                },
            ],
        },
    };
}

test("rejects VS Code launch for cloud review sessions", async () => {
    const service = serviceForRun(completedRun("cloud"));
    await assert.rejects(
        () => service.openFindingInVscode("run-1", "F-001"),
        /Cloud review files cannot be opened/,
    );
});

test("requires a local workspace path before launching VS Code", async () => {
    const service = serviceForRun(completedRun("local"));
    service.bridge.resolveSessionWorkspace = async () => ({ workspacePath: "" });
    await assert.rejects(
        () => service.openFindingInVscode("run-1", "F-001"),
        /does not expose a local workspace path/,
    );
});

test("refuses to apply illustrative suggestions", async () => {
    const service = serviceForRun(completedRun("local"));
    await assert.rejects(
        () => service.applyFindingDiff("run-1", "F-002"),
        /require human judgment/,
    );
});

test("binds the created project session to the persisted review run", async () => {
    const state = {
        projects: [
            {
                id: "project-1",
                enabled: true,
                githubRepo: "owner/repo",
            },
        ],
        pullRequests: {
            "owner/repo": [
                {
                    number: 1,
                    headRefOid: "a".repeat(40),
                },
            ],
        },
        reviews: {},
    };
    const { service } = serviceHarness(state);
    service.bridge.createReviewSession = async () => ({
        projectSessionId: "session-1",
        executionLocation: "local",
    });

    const updated = await service.startReview({
        projectId: "project-1",
        repository: "owner/repo",
        prNumber: 1,
        executionLocation: "local",
    });
    const run = updated.reviews["owner/repo#1"][0];

    assert.equal(run.projectSessionId, "session-1");
    assert.equal(run.status, "running");
});

test("binds the project session without overwriting a result received during startup", async () => {
    const state = {
        projects: [
            {
                id: "project-1",
                enabled: true,
                githubRepo: "owner/repo",
            },
        ],
        pullRequests: {
            "owner/repo": [
                {
                    number: 1,
                    headRefOid: "a".repeat(40),
                },
            ],
        },
        reviews: {},
    };
    const { service, store } = serviceHarness(state);
    service.bridge.createReviewSession = async () => {
        await store.update((draft) => {
            const pending = draft.reviews["owner/repo#1"][0];
            pending.report = { findings: [] };
            pending.status = "complete";
            pending.error = "";
        });
        return {
            projectSessionId: "session-1",
            executionLocation: "local",
        };
    };

    const updated = await service.startReview({
        projectId: "project-1",
        repository: "owner/repo",
        prNumber: 1,
        executionLocation: "local",
    });
    const run = updated.reviews["owner/repo#1"][0];

    assert.equal(run.projectSessionId, "session-1");
    assert.equal(run.status, "complete");
    assert.deepEqual(run.report, { findings: [] });
});

test("does not inspect a review that already has a completed result", async () => {
    const run = { ...completedRun("local"), status: "complete", error: "" };
    const { service } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => {
        throw new Error("inspectSession should not be called");
    };

    const result = await service.reconcileReview(run.runId);

    assert.equal(result.reviews[run.reviewKey][0].status, "complete");
});

test("rejects reconciliation status for a different project session", async () => {
    const run = { ...completedRun("local"), report: null, status: "running", error: "" };
    const { service, state } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: "session-other",
        status: "error",
        summary: "Unrelated child failed.",
    });

    await assert.rejects(
        () => service.reconcileReview(run.runId),
        /session-other instead of session-1/,
    );
    assert.equal(state.reviews[run.reviewKey][0].status, "running");
    assert.equal(state.reviews[run.reviewKey][0].error, "");
});

test("records a confirmed error for the bound project session", async () => {
    const run = { ...completedRun("local"), report: null, status: "running", error: "" };
    const { service, state } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: "session-1",
        status: "error",
        summary: "The child process exited.",
    });

    await service.reconcileReview(run.runId);

    assert.equal(state.reviews[run.reviewKey][0].status, "failed");
    assert.equal(state.reviews[run.reviewKey][0].error, "The child process exited.");
});

test("ignores an older reconciliation result after a newer status check", async () => {
    const run = { ...completedRun("local"), report: null, status: "running", error: "" };
    const { service, state } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    const inspections = [];
    service.bridge.inspectSession = () =>
        new Promise((resolve) => {
            inspections.push(resolve);
        });

    const older = service.reconcileReview(run.runId);
    await new Promise((resolve) => setImmediate(resolve));
    const newer = service.reconcileReview(run.runId);
    await new Promise((resolve) => setImmediate(resolve));

    inspections[1]({
        projectSessionId: "session-1",
        status: "running",
        summary: "Review is running.",
    });
    await newer;
    inspections[0]({
        projectSessionId: "session-1",
        status: "error",
        summary: "Stale failure notification.",
    });
    await older;

    assert.equal(state.reviews[run.reviewKey][0].status, "running");
    assert.equal(state.reviews[run.reviewKey][0].error, "");
});

test("completed results win races with in-flight reconciliation", async () => {
    const run = { ...completedRun("local"), report: null, status: "running", error: "" };
    const { service, state, store } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    let resolveInspection;
    service.bridge.inspectSession = () =>
        new Promise((resolve) => {
            resolveInspection = resolve;
        });

    const reconciliation = service.reconcileReview(run.runId);
    await new Promise((resolve) => setImmediate(resolve));
    await store.update((draft) => {
        const current = draft.reviews[run.reviewKey][0];
        current.report = { findings: [] };
        current.status = "complete";
        current.error = "";
    });
    resolveInspection({
        projectSessionId: "session-1",
        status: "error",
        summary: "Late failure notification.",
    });
    await reconciliation;

    assert.equal(state.reviews[run.reviewKey][0].status, "complete");
    assert.deepEqual(state.reviews[run.reviewKey][0].report, { findings: [] });
    assert.equal(state.reviews[run.reviewKey][0].error, "");
});
