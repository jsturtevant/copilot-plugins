import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
    buildProposedSource,
    resolveFindingTarget,
    reviewedBlobSpec,
    vscodeExecutableCandidates,
} from "../vscode.mjs";

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

test("materializes a full proposed file from the reviewed line range", () => {
    const source = [
        "function parse(input) {",
        "    const value = input;",
        "    return value;",
        "}",
        "",
    ].join("\n");
    const proposed = buildProposedSource(source, {
        lineStart: 2,
        lineEnd: 3,
        currentCode: "const value = input;\n    return value;",
        suggestedCode: "const value = validate(input);\n    return value;",
    });
    assert.equal(
        proposed,
        [
            "function parse(input) {",
            "    const value = validate(input);",
            "    return value;",
            "}",
            "",
        ].join("\n"),
    );
});

test("refuses to diff stale source that no longer matches the finding", () => {
    assert.throws(
        () =>
            buildProposedSource("const value = changed();\n", {
                lineStart: 1,
                lineEnd: 1,
                currentCode: "const value = input;",
                suggestedCode: "const value = validate(input);",
            }),
        /no longer matches/,
    );
});

test("anchors reviewed source to an exact commit and repository-relative path", () => {
    const sha = "a".repeat(40);
    assert.equal(reviewedBlobSpec(sha, "src/example.js"), `${sha}:src/example.js`);
    assert.throws(() => reviewedBlobSpec("main", "src/example.js"), /valid head commit SHA/);
});
