import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function initialState() {
    return {
        version: 1,
        projects: [],
        pullRequests: {},
        reviews: {},
        updatedAt: new Date().toISOString(),
    };
}

function clone(value) {
    return structuredClone(value);
}

export class ReviewStateStore {
    constructor(workspacePath) {
        if (!workspacePath) {
            throw new Error("The current session does not expose a workspace path");
        }
        this.path = join(workspacePath, "files", "fleet-review-canvas", "state.json");
        this.state = initialState();
        this.loaded = false;
        this.mutationTail = Promise.resolve();
        this.listeners = new Set();
    }

    async load() {
        if (this.loaded) {
            return this.snapshot();
        }
        try {
            const parsed = JSON.parse(await readFile(this.path, "utf8"));
            this.state = { ...initialState(), ...parsed };
        } catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
        }
        this.loaded = true;
        return this.snapshot();
    }

    snapshot() {
        return clone(this.state);
    }

    async update(mutator) {
        const operation = async () => {
            await this.load();
            const next = clone(this.state);
            await mutator(next);
            next.updatedAt = new Date().toISOString();
            await mkdir(dirname(this.path), { recursive: true });
            const temporaryPath = `${this.path}.${process.pid}.tmp`;
            await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
            await rename(temporaryPath, this.path);
            this.state = next;
            const snapshot = this.snapshot();
            for (const listener of this.listeners) {
                listener(snapshot);
            }
            return snapshot;
        };
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.catch(() => {});
        return result;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
