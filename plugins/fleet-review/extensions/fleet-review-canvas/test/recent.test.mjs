import assert from "node:assert/strict";
import test from "node:test";
import { recentReviewRuns } from "../web/recent.js";

test("returns the newest review runs across repositories", () => {
    const reviews = {
        "owner/one#1": [
            { runId: "older", createdAt: "2026-09-01T10:00:00Z" },
            { runId: "newest", completedAt: "2026-09-03T10:00:00Z" },
        ],
        "owner/two#2": [{ runId: "middle", createdAt: "2026-09-02T10:00:00Z" }],
    };

    assert.deepEqual(
        recentReviewRuns(reviews).map((run) => run.runId),
        ["newest", "middle", "older"],
    );
});

test("limits the recent review ledger", () => {
    const runs = Array.from({ length: 12 }, (_, index) => ({
        runId: String(index),
        createdAt: new Date(2026, 8, index + 1).toISOString(),
    }));
    assert.equal(recentReviewRuns({ history: runs }).length, 8);
});
