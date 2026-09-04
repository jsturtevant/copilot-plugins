import assert from "node:assert/strict";
import test from "node:test";
import { FleetReviewService } from "../service.mjs";

function serviceForRun(run) {
    const state = { projects: [], pullRequests: {}, reviews: { [run.reviewKey]: [run] } };
    const session = {
        on: () => () => {},
        log: () => {},
    };
    const store = {
        load: async () => state,
        update: async (mutate) => {
            mutate(state);
            return state;
        },
    };
    return new FleetReviewService(session, store);
}

function completedRun(executionLocation) {
    return {
        runId: "run-1",
        reviewKey: "owner/repo#1",
        projectSessionId: "session-1",
        executionLocation,
        report: {
            findings: [{ id: "F-001", path: "src/example.js", lineStart: 10 }],
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
