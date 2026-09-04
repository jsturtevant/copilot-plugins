import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const BODY_LIMIT = 64 * 1024;
const contentTypes = {
    "/": "text/html; charset=utf-8",
    "/app.js": "text/javascript; charset=utf-8",
    "/styles.css": "text/css; charset=utf-8",
};

function sendJson(response, status, body) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > BODY_LIMIT) {
            throw new Error("Request body is too large");
        }
        chunks.push(chunk);
    }
    if (chunks.length === 0) {
        return {};
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(url, token) {
    return url.searchParams.get("token") === token;
}

export async function startCanvasServer(service, store) {
    const token = randomBytes(24).toString("hex");
    const assets = new Map(
        await Promise.all(
            Object.keys(contentTypes).map(async (route) => {
                const fileName = route === "/" ? "index.html" : route.slice(1);
                return [route, await readFile(new URL(`./web/${fileName}`, import.meta.url))];
            }),
        ),
    );
    const streams = new Set();
    const publish = (state) => {
        const event = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
        for (const response of streams) {
            response.write(event);
        }
    };
    const unsubscribe = store.subscribe(publish);

    const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const staticAsset = assets.get(url.pathname);
        if (request.method === "GET" && staticAsset) {
            response.writeHead(200, {
                "Content-Type": contentTypes[url.pathname],
                "Content-Security-Policy":
                    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            });
            response.end(staticAsset);
            return;
        }

        if (!authorized(url, token)) {
            sendJson(response, 403, { error: "Invalid canvas capability token" });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/state") {
            sendJson(response, 200, await service.getState());
            return;
        }
        if (request.method === "GET" && url.pathname === "/events") {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });
            streams.add(response);
            response.write(`event: state\ndata: ${JSON.stringify(await service.getState())}\n\n`);
            request.on("close", () => streams.delete(response));
            return;
        }

        if (request.method !== "POST") {
            sendJson(response, 404, { error: "Not found" });
            return;
        }

        try {
            if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
                throw new Error("POST requests must use application/json");
            }
            const body = await readJson(request);
            let result;
            switch (url.pathname) {
                case "/api/projects":
                    result = await service.refreshProjects();
                    break;
                case "/api/pull-requests":
                    result = await service.loadPullRequests(body.repository);
                    break;
                case "/api/reviews":
                    result = await service.startReview(body);
                    break;
                case "/api/reconcile":
                    result = await service.reconcileReview(body.runId);
                    break;
                case "/api/open-session":
                    result = await service.openReviewSession(body.runId);
                    break;
                default:
                    sendJson(response, 404, { error: "Not found" });
                    return;
            }
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    return {
        server,
        url: `http://127.0.0.1:${port}/?token=${token}`,
        async close() {
            unsubscribe();
            for (const response of streams) {
                response.end();
            }
            streams.clear();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
