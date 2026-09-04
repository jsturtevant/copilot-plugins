import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { FleetReviewService } from "./service.mjs";
import { ReviewStateStore } from "./state.mjs";
import { startCanvasServer } from "./server.mjs";

const servers = new Map();
let service;
let store;

function requireService() {
    if (!service || !store) {
        throw new CanvasError("fleet_review_not_ready", "Fleet Review is still initializing");
    }
    return service;
}

function action(name, description, inputSchema, handler) {
    return {
        name,
        description,
        inputSchema,
        handler: async (ctx) => {
            try {
                return await handler(requireService(), ctx.input ?? {});
            } catch (error) {
                if (error instanceof CanvasError) {
                    throw error;
                }
                throw new CanvasError("fleet_review_action_failed", error.message);
            }
        },
    };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "fleet-review",
            displayName: "Fleet Review",
            description: "Run multi-agent pull request reviews and inspect code-level findings.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
                    prNumber: { type: "integer", minimum: 1 },
                },
            },
            actions: [
                action("get_state", "Read the current Fleet Review canvas state.", {
                    type: "object",
                    additionalProperties: false,
                }, (current) => current.getState()),
                action("refresh_projects", "Refresh repositories configured in the Copilot app.", {
                    type: "object",
                    additionalProperties: false,
                }, (current) => current.refreshProjects()),
                action("load_pull_requests", "Load open pull requests for a configured repository.", {
                    type: "object",
                    additionalProperties: false,
                    required: ["repository"],
                    properties: {
                        repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
                    },
                }, (current, input) => current.loadPullRequests(input.repository)),
                action("start_review", "Start a local or cloud review session for an open pull request.", {
                    type: "object",
                    additionalProperties: false,
                    required: ["projectId", "repository", "prNumber", "executionLocation"],
                    properties: {
                        projectId: { type: "string", minLength: 1 },
                        repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
                        prNumber: { type: "integer", minimum: 1 },
                        executionLocation: { type: "string", enum: ["local", "cloud"] },
                    },
                }, (current, input) => current.startReview(input)),
                action("reconcile_review", "Refresh the status of a child review session.", {
                    type: "object",
                    additionalProperties: false,
                    required: ["runId"],
                    properties: { runId: { type: "string", minLength: 1 } },
                }, (current, input) => current.reconcileReview(input.runId)),
                action("open_review_session", "Open the Copilot session that produced a review.", {
                    type: "object",
                    additionalProperties: false,
                    required: ["runId"],
                    properties: { runId: { type: "string", minLength: 1 } },
                }, (current, input) => current.openReviewSession(input.runId)),
                action("open_in_vscode", "Open the local review project with inline finding comments.", {
                    type: "object",
                    additionalProperties: false,
                    required: ["runId", "findingId"],
                    properties: {
                        runId: { type: "string", minLength: 1 },
                        findingId: { type: "string", minLength: 1 },
                    },
                }, (current, input) => current.openFindingInVscode(input.runId, input.findingId)),
            ],
            open: async (ctx) => {
                requireService();
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startCanvasServer(service, store);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Fleet Review",
                    status: "Review-only",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        }),
    ],
});

store = new ReviewStateStore(session.workspacePath);
await store.load();
service = new FleetReviewService(session, store);
