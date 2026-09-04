import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ReviewStateStore } from "../state.mjs";

test("serializes concurrent updates without losing state", async () => {
    const root = await mkdtemp(join(tmpdir(), "fleet-review-state-"));
    try {
        const store = new ReviewStateStore(root);
        await Promise.all([
            store.update((state) => {
                state.projects.push({ id: "one" });
            }),
            store.update((state) => {
                state.projects.push({ id: "two" });
            }),
        ]);
        assert.deepEqual(
            (await store.load()).projects.map((project) => project.id),
            ["one", "two"],
        );
        const persisted = JSON.parse(
            await readFile(join(root, "files", "fleet-review-canvas", "state.json"), "utf8"),
        );
        assert.equal(persisted.projects.length, 2);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
