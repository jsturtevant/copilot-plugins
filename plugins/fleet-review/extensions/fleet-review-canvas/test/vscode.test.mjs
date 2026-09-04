import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
    buildProposedSource,
    prepareReviewWorkspace,
    resolveFindingTarget,
    vscodeExecutableCandidates,
} from "../vscode.mjs";

const execFileAsync = promisify(execFile);

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
        currentCode: "const value = input;\nreturn value;",
        suggestedCode: "const value = validate(input);\nreturn value;",
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

test("uses the reviewed hunk length when the reported end line is short", () => {
    const proposed = buildProposedSource("one\ntwo\nthree\n", {
        id: "F-001",
        path: "example.txt",
        lineStart: 1,
        lineEnd: 2,
        currentCode: "one\ntwo\nthree",
        suggestedCode: "replacement",
    });
    assert.equal(proposed, "replacement\n");
});

test("matches dedented annotations and restores source indentation", () => {
    const proposed = buildProposedSource(
        "impl Queue {\n    fn reclaim() {\n        old();\n    }\n}\n",
        {
            id: "F-001",
            path: "queue.rs",
            lineStart: 2,
            lineEnd: 4,
            currentCode: "fn reclaim() {\n    old();\n}",
            suggestedCode: "fn reclaim() {\n    fixed();\n}",
        },
    );
    assert.equal(proposed, "impl Queue {\n    fn reclaim() {\n        fixed();\n    }\n}\n");
});

test("prepares the reviewed commit with exact fixes and report artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "fleet-review-workspace-"));
    try {
        await execFileAsync("git", ["-C", workspace, "init", "--quiet"]);
        await execFileAsync("git", ["-C", workspace, "config", "user.name", "Fleet Test"]);
        await execFileAsync("git", ["-C", workspace, "config", "user.email", "fleet@example.com"]);
        await writeFile(join(workspace, "example.js"), "const value = base;\n", "utf8");
        await execFileAsync("git", ["-C", workspace, "add", "example.js"]);
        await execFileAsync("git", ["-C", workspace, "commit", "--quiet", "-m", "base"]);
        const baseSha = (await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"])).stdout.trim();

        await writeFile(join(workspace, "example.js"), "const value = input;\n", "utf8");
        await execFileAsync("git", ["-C", workspace, "add", "example.js"]);
        await execFileAsync("git", ["-C", workspace, "commit", "--quiet", "-m", "reviewed"]);
        const headSha = (await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"])).stdout.trim();
        await execFileAsync("git", ["-C", workspace, "switch", "--detach", "--quiet", baseSha]);

        const report = {
            runId: "run-1",
            reportMarkdown: "# Review",
            pr: { headSha },
            findings: [
                {
                    id: "F-001",
                    path: "example.js",
                    lineStart: 1,
                    lineEnd: 1,
                    currentCode: "const value = input;",
                    suggestedCode: "const value = validate(input);",
                    fixKind: "exact",
                },
                {
                    id: "F-002",
                    path: "example.js",
                    lineStart: 1,
                    lineEnd: 1,
                    currentCode: "const value = input;",
                    suggestedCode: "choose a validation strategy",
                    fixKind: "illustrative",
                },
            ],
        };
        const prepared = await prepareReviewWorkspace(workspace, report);

        assert.equal(
            (await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"])).stdout.trim(),
            headSha,
        );
        assert.equal(
            (await readFile(join(workspace, "example.js"), "utf8")).replace(/\r\n/g, "\n"),
            "const value = validate(input);\n",
        );
        assert.equal(await readFile(prepared.markdownPath, "utf8"), "# Review\n");
        assert.equal(JSON.parse(await readFile(prepared.jsonPath, "utf8")).runId, "run-1");
        assert.deepEqual(prepared.appliedFindings, ["F-001"]);
        assert.deepEqual(prepared.illustrativeFindings, ["F-002"]);

        const reopened = await prepareReviewWorkspace(workspace, report);
        assert.deepEqual(reopened.appliedFindings, ["F-001"]);
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});
