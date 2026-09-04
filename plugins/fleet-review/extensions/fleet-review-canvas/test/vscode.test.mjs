import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { resolveFindingTarget, vscodeExecutableCandidates } from "../vscode.mjs";

test("resolves repository-relative finding paths inside the review workspace", () => {
    const workspace = resolve("review-worktree");
    assert.equal(
        resolveFindingTarget(workspace, "src/example.js"),
        resolve(workspace, "src/example.js"),
    );
});

test("rejects finding paths outside the review workspace", () => {
    const workspace = resolve("review-worktree");
    assert.throws(() => resolveFindingTarget(workspace, "../secret.txt"), /outside/);
    assert.throws(() => resolveFindingTarget(workspace, workspace), /repository-relative/);
});

test("resolves the native Windows executable without a command shell", () => {
    const candidates = vscodeExecutableCandidates("win32", {
        PATH: "C:\\Tools\\Microsoft VS Code\\bin",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    });
    assert.equal(
        candidates[0],
        "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    );
    assert.ok(candidates.includes("C:\\Tools\\Microsoft VS Code\\Code.exe"));
});
