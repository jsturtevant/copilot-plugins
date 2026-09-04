import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startCanvasServer } from "../server.mjs";
import { launchVscode } from "../vscode.mjs";

test("serves the canvas and protects state with a capability token", async () => {
    const state = { version: 1 };
    const store = { subscribe: () => () => {} };
    const service = { getState: async () => state };
    const entry = await startCanvasServer(service, store);
    try {
        const url = new URL(entry.url);
        const page = await fetch(url);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Fleet Review/);

        const styles = await fetch(new URL("/styles.css", url));
        assert.equal(styles.status, 200);
        assert.match(await styles.text(), /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);

        const recent = await fetch(new URL("/recent.js", url));
        assert.equal(recent.status, 200);
        assert.match(await recent.text(), /recentReviewRuns/);

        const denied = await fetch(new URL("/api/state", url));
        assert.equal(denied.status, 403);

        const allowed = await fetch(new URL(`/api/state${url.search}`, url));
        assert.equal(allowed.status, 200);
        assert.deepEqual(await allowed.json(), state);
    } finally {
        await entry.close();
    }
});

test("serves the diff module and routes authenticated VS Code launches", async () => {
    const calls = [];
    let exitTimer;
    let launchedProcess;
    let launchedProcessExited = false;
    const store = { subscribe: () => () => {} };
    const service = {
        getState: async () => ({}),
        openFindingInVscode: async (...args) => {
            calls.push(args);
            await launchVscode("Code.exe", "C:\\review-worktree", () => {
                launchedProcess = new EventEmitter();
                launchedProcess.unref = () => {};
                queueMicrotask(() => launchedProcess.emit("spawn"));
                exitTimer = setTimeout(() => {
                    launchedProcessExited = true;
                    launchedProcess.emit("exit", 0);
                    launchedProcess.emit("close", 0);
                }, 2_000);
                return launchedProcess;
            });
            return { opened: true };
        },
        applyFindingDiff: async (...args) => {
            calls.push(["apply", ...args]);
            return { applied: true };
        },
    };
    const entry = await startCanvasServer(service, store);
    try {
        const url = new URL(entry.url);
        const diff = await fetch(new URL("/diff.js", url));
        assert.equal(diff.status, 200);
        assert.match(await diff.text(), /buildLineDiff/);

        const response = await fetch(new URL(`/api/open-vscode${url.search}`, url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: "run-1", findingId: "F-001" }),
        });
        clearTimeout(exitTimer);
        assert.equal(response.status, 200);
        assert.equal(launchedProcessExited, false);
        assert.deepEqual(calls, [["run-1", "F-001"]]);

        const applyResponse = await fetch(new URL(`/api/apply-diff${url.search}`, url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: "run-1", findingId: "F-001" }),
        });
        assert.equal(applyResponse.status, 200);
        assert.deepEqual(calls[1], ["apply", "run-1", "F-001"]);
    } finally {
        clearTimeout(exitTimer);
        await entry.close();
    }
});
