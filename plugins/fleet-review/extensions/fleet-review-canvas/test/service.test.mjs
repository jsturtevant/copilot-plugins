import assert from "node:assert/strict";
import test from "node:test";
import { FleetReviewService } from "../service.mjs";

function serviceHarness(state) {
    const handlers = new Map();
    const session = {
        on: (eventType, handler) => {
            handlers.set(eventType, handler);
            return () => handlers.delete(eventType);
        },
        log: () => {},
    };
    const store = {
        load: async () => structuredClone(state),
        update: async (mutate) => {
            await mutate(state);
            return structuredClone(state);
        },
    };
    return {
        service: new FleetReviewService(session, store),
        state,
        store,
        emitUserMessage: (content) => handlers.get("user.message")?.({ data: { content } }),
    };
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

test("automatically reconciles an error completion notification", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        report: null,
        status: "running",
        error: "",
    };
    const { service, state, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: run.projectSessionId,
        status: "error",
        summary: "The child process exited.",
    });

    await emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: error
</system_notification>`);

    assert.equal(state.reviews[run.reviewKey][0].status, "failed");
    assert.equal(state.reviews[run.reviewKey][0].error, "The child process exited.");
});

test("automatically records idle completion without a structured result", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        report: null,
        status: "running",
        error: "",
    };
    const { service, state, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: run.projectSessionId,
        status: "idle",
        summary: "Review is idle.",
    });

    await emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: idle
</system_notification>`);

    assert.equal(state.reviews[run.reviewKey][0].status, "awaiting_result");
    assert.equal(
        state.reviews[run.reviewKey][0].error,
        "The review session is idle, but its structured result has not arrived.",
    );
});

test("terminal notifications override a stale running inspection", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        report: null,
        status: "running",
        error: "",
    };
    const { service, state, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: run.projectSessionId,
        status: "running",
        summary: "The session status has not refreshed yet.",
    });

    await emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: error
</system_notification>`);

    assert.equal(state.reviews[run.reviewKey][0].status, "failed");
    assert.equal(state.reviews[run.reviewKey][0].error, "The child review session failed.");
});

test("structured results received before completion skip automatic reconciliation", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        status: "complete",
        error: "",
    };
    const { service, state, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => {
        throw new Error("inspectSession should not be called");
    };

    await emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: idle
</system_notification>`);

    assert.equal(state.reviews[run.reviewKey][0].status, "complete");
    assert.deepEqual(state.reviews[run.reviewKey][0].report, run.report);
});

test("reconciles a completion notification received before the child session is bound", async () => {
    const projectSessionId = "00000000-0000-0000-0000-000000000001";
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
    const { service, emitUserMessage } = serviceHarness(state);
    service.bridge.createReviewSession = async () => {
        await emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${projectSessionId}) has finished processing.
Final status: idle
</system_notification>`);
        return { projectSessionId, executionLocation: "local" };
    };
    service.bridge.inspectSession = async () => ({
        projectSessionId,
        status: "idle",
        summary: "Review is idle.",
    });

    const updated = await service.startReview({
        projectId: "project-1",
        repository: "owner/repo",
        prNumber: 1,
        executionLocation: "local",
    });
    const run = updated.reviews["owner/repo#1"][0];

    assert.equal(run.projectSessionId, projectSessionId);
    assert.equal(run.status, "awaiting_result");
});

test("bounds completion notifications that do not match a review run", async () => {
    const { service, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: {},
    });

    for (let index = 0; index < 101; index += 1) {
        const projectSessionId = `00000000-0000-0000-0000-${index.toString().padStart(12, "0")}`;
        await emitUserMessage(`<system_notification>
Session "Unrelated session" (id: ${projectSessionId}) has finished processing.
Final status: idle
</system_notification>`);
    }

    assert.equal(service.completedProjectSessions.size, 100);
    assert.equal(service.completedProjectSessions.has("00000000-0000-0000-0000-000000000000"), false);
});

test("coalesces duplicate completion notifications", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        report: null,
        status: "running",
        error: "",
    };
    const { service, state, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    let resolveInspection;
    let inspectionCount = 0;
    service.bridge.inspectSession = () => {
        inspectionCount += 1;
        return new Promise((resolve) => {
            resolveInspection = resolve;
        });
    };
    const notification = `<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: error
</system_notification>`;

    const first = emitUserMessage(notification);
    const duplicate = emitUserMessage(notification);
    await new Promise((resolve) => setImmediate(resolve));
    resolveInspection({
        projectSessionId: run.projectSessionId,
        status: "error",
        summary: "The child process exited.",
    });
    await Promise.all([first, duplicate]);

    assert.equal(inspectionCount, 1);
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

test("manual reconciliation does not regress a terminal lifecycle status", async () => {
    const run = {
        ...completedRun("local"),
        report: null,
        status: "failed",
        error: "The child review session failed.",
    };
    const { service, state } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    service.bridge.inspectSession = async () => ({
        projectSessionId: run.projectSessionId,
        status: "running",
        summary: "The session status has not refreshed yet.",
    });

    await service.reconcileReview(run.runId);

    assert.equal(state.reviews[run.reviewKey][0].status, "failed");
    assert.equal(state.reviews[run.reviewKey][0].error, "The child review session failed.");
});

test("structured results win races with automatic reconciliation", async () => {
    const run = {
        ...completedRun("local"),
        projectSessionId: "00000000-0000-0000-0000-000000000001",
        report: null,
        status: "running",
        error: "",
    };
    const { service, state, store, emitUserMessage } = serviceHarness({
        projects: [],
        pullRequests: {},
        reviews: { [run.reviewKey]: [run] },
    });
    let resolveInspection;
    service.bridge.inspectSession = () =>
        new Promise((resolve) => {
            resolveInspection = resolve;
        });

    const reconciliation = emitUserMessage(`<system_notification>
Session "Review owner/repo#1" (id: ${run.projectSessionId}) has finished processing.
Final status: error
</system_notification>`);
    await new Promise((resolve) => setImmediate(resolve));
    await store.update((draft) => {
        const current = draft.reviews[run.reviewKey][0];
        current.report = { findings: [] };
        current.status = "complete";
        current.error = "";
    });
    resolveInspection({
        projectSessionId: run.projectSessionId,
        status: "error",
        summary: "Late failure notification.",
    });
    await reconciliation;

    assert.equal(state.reviews[run.reviewKey][0].status, "complete");
    assert.deepEqual(state.reviews[run.reviewKey][0].report, { findings: [] });
    assert.equal(state.reviews[run.reviewKey][0].error, "");
});
