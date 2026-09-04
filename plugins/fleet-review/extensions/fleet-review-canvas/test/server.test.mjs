import assert from "node:assert/strict";
import test from "node:test";
import { startCanvasServer } from "../server.mjs";

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

        const denied = await fetch(new URL("/api/state", url));
        assert.equal(denied.status, 403);

        const allowed = await fetch(new URL(`/api/state${url.search}`, url));
        assert.equal(allowed.status, 200);
        assert.deepEqual(await allowed.json(), state);
    } finally {
        await entry.close();
    }
});
