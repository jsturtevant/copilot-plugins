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

test("returns a review session bridge response without waiting for session idle", async () => {
    let listener;
    const session = {
        on(eventType, handler) {
            assert.equal(eventType, "assistant.message");
            listener = handler;
            return () => {
                listener = undefined;
            };
        },
        sendAndWait() {
            queueMicrotask(() => {
                listener?.({
                    data: {
                        content:
                            'FLEET_CANVAS_BRIDGE_START\n{"projectSessionId":"session-1","executionLocation":"local"}\nFLEET_CANVAS_BRIDGE_END',
                    },
                });
            });
            return new Promise(() => {});
        },
    };
    const bridge = new AgentBridge(session);

    const result = await Promise.race([
        bridge.createReviewSession({
            projectId: "project-1",
            repository: "owner/repo",
            pullRequest: {
                number: 1,
                title: "Fix",
                url: "https://example.test/pull/1",
                isDraft: false,
                author: "author",
                baseRefName: "main",
                headRefName: "fix",
                headRefOid: "a".repeat(40),
            },
            executionLocation: "local",
            runId: "run-1",
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("bridge response was not returned promptly")), 100),
        ),
    ]);

    assert.deepEqual(result, {
        projectSessionId: "session-1",
        executionLocation: "local",
    });
});

test("reports missing markers distinctly", async () => {
    const bridge = new AgentBridge(sessionThat({ emittedContent: "No structured payload" }));
    await assert.rejects(
        () => bridge.request("prompt"),
        /without the required bridge markers/,
    );
});
