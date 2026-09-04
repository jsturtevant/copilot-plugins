import assert from "node:assert/strict";
import test from "node:test";
import { AgentBridge } from "../bridge.mjs";

const response =
    'FLEET_CANVAS_BRIDGE_START\n{"projects":[{"id":"one"}]}\nFLEET_CANVAS_BRIDGE_END';

function sessionThat({ returnedContent, emittedContent, error }) {
    let listener;
    return {
        on(eventType, handler) {
            assert.equal(eventType, "assistant.message");
            listener = handler;
            return () => {
                listener = undefined;
            };
        },
        async sendAndWait() {
            if (emittedContent) {
                listener?.({ data: { content: emittedContent } });
            }
            if (error) {
                throw error;
            }
            return returnedContent ? { data: { content: returnedContent } } : undefined;
        },
    };
}

test("uses the sendAndWait result when available", async () => {
    const bridge = new AgentBridge(sessionThat({ returnedContent: response }));
    assert.deepEqual(await bridge.request("prompt"), { projects: [{ id: "one" }] });
});

test("captures assistant events when sendAndWait returns undefined", async () => {
    const bridge = new AgentBridge(sessionThat({ emittedContent: response }));
    assert.deepEqual(await bridge.request("prompt"), { projects: [{ id: "one" }] });
});

test("uses a captured response even if idle waiting fails afterward", async () => {
    const bridge = new AgentBridge(
        sessionThat({ emittedContent: response, error: new Error("idle timeout") }),
    );
    assert.deepEqual(await bridge.request("prompt"), { projects: [{ id: "one" }] });
});

test("reports missing markers distinctly", async () => {
    const bridge = new AgentBridge(sessionThat({ emittedContent: "No structured payload" }));
    await assert.rejects(
        () => bridge.request("prompt"),
        /without the required bridge markers/,
    );
});
