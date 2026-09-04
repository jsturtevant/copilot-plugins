import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
    buildAnnotatedSource,
    buildProposedSource,
    launchVscode,
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

test("sanitizes Electron mode while preserving the VS Code handoff environment", async () => {
    const child = new EventEmitter();
    let invocation;
    let unrefCalled = false;
    child.unref = () => {
        unrefCalled = true;
    };

    const launched = launchVscode(
        "Code.exe",
        "C:\\review-worktree",
        (...args) => {
            invocation = args;
            queueMicrotask(() => child.emit("spawn"));
            return child;
        },
        5,
        {
            ELECTRON_RUN_AS_NODE: "1",
            NORMAL_SETTING: "preserved",
            PATH: "C:\\Tools",
        },
    );
    await launched;

    assert.deepEqual(invocation, [
        "Code.exe",
        ["--new-window", "C:\\review-worktree"],
        {
            detached: false,
            env: {
                NORMAL_SETTING: "preserved",
                PATH: "C:\\Tools",
            },
            stdio: "ignore",
            windowsHide: false,
        },
    ]);
    assert.equal(unrefCalled, true);
});

test("reports a VS Code process launch failure", async () => {
    const child = new EventEmitter();
    child.unref = () => {};

    const launched = launchVscode("Code.exe", "C:\\review-worktree", () => {
        queueMicrotask(() => child.emit("error", new Error("spawn failed")));
        return child;
    });

    await assert.rejects(() => launched, /spawn failed/);
});

test("reports an early nonzero VS Code exit", async () => {
    const child = new EventEmitter();
    child.unref = () => {};

    const launched = launchVscode(
        "Code.exe",
        "C:\\review-worktree",
        () => {
            queueMicrotask(() => {
                child.emit("spawn");
                child.emit("exit", 1, null);
            });
            return child;
        },
        50,
    );

    await assert.rejects(
        () => launched,
        /VS Code exited before opening the workspace with code 1/,
    );
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

test("inserts language-aware review comments without changing executable code", () => {
    const annotated = buildAnnotatedSource("fn main() {\n    run();\n}\n", [
        {
            id: "F-001",
            severity: "high",
            title: "Validate input",
            problem: "Input is trusted.",
            evidence: "The call receives external data.",
            path: "src/main.rs",
            lineStart: 2,
            suggestedCode: "validate();\nrun();",
            fixKind: "exact",
            judgmentNotes: "",
        },
    ]);
    assert.match(annotated, /    \/\/ REVIEW ISSUE #1 \[HIGH\]: Validate input/);
    assert.doesNotMatch(annotated, /Problem:|Evidence:|Suggestion:/);
    assert.match(annotated, /\n    run\(\);\n/);
});

test("keeps suggestion details out of the canonical source marker", () => {
    const annotated = buildAnnotatedSource("fn run() {}\n", [
        {
            id: "F-001",
            severity: "medium",
            title: "Add separation",
            problem: "Statements run together.",
            evidence: "The hunk is difficult to read.",
            path: "src/main.rs",
            lineStart: 1,
            suggestedCode: "first();\n\nsecond();",
            fixKind: "illustrative",
            judgmentNotes: "Choose the final layout.",
        },
    ]);
    assert.equal(
        annotated.split("\n")[0],
        "// REVIEW ISSUE #1 [MEDIUM]: Add separation",
    );
    assert.doesNotMatch(annotated, / +$/m);
});

test("prepares canonical annotations, applied diffs, and report artifacts", async () => {
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
                    severity: "high",
                    title: "Validate input",
                    problem: "Input is trusted.",
                    evidence: "The value reaches a sensitive operation.",
                    path: "example.js",
                    lineStart: 1,
                    lineEnd: 1,
                    currentCode: "const value = input;",
                    suggestedCode: "const value = validate(input);",
                    fixKind: "exact",
                    judgmentNotes: "",
                },
                {
                    id: "F-002",
                    severity: "medium",
                    title: "Choose validation",
                    problem: "The policy is undecided.",
                    evidence: "Multiple validation strategies are possible.",
                    path: "example.js",
                    lineStart: 1,
                    lineEnd: 1,
                    currentCode: "const value = input;",
                    suggestedCode: "choose a validation strategy",
                    fixKind: "illustrative",
                    judgmentNotes: "Select the correct policy for this input.",
                },
            ],
        };
        const prepared = await prepareReviewWorkspace(workspace, report);

        assert.equal(
            (await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"])).stdout.trim(),
            headSha,
        );
        const annotatedSource = (await readFile(join(workspace, "example.js"), "utf8")).replace(
            /\r\n/g,
            "\n",
        );
        assert.match(annotatedSource, /\/\/ REVIEW ISSUE #1 \[HIGH\]: Validate input/);
        assert.match(annotatedSource, /\nconst value = input;\n/);
        assert.doesNotMatch(annotatedSource, /^const value = validate\(input\);$/m);
        assert.equal(await readFile(prepared.markdownPath, "utf8"), "# Review\n");
        assert.equal(JSON.parse(await readFile(prepared.jsonPath, "utf8")).runId, "run-1");
        assert.deepEqual(prepared.annotatedFindings, ["F-001", "F-002"]);

        const reopened = await prepareReviewWorkspace(workspace, report);
        assert.deepEqual(reopened.annotatedFindings, ["F-001", "F-002"]);

        const applied = await prepareReviewWorkspace(workspace, report, ["F-001"], []);
        const appliedSource = (await readFile(join(workspace, "example.js"), "utf8")).replace(
            /\r\n/g,
            "\n",
        );
        assert.doesNotMatch(appliedSource, /REVIEW ISSUE #1/);
        assert.match(appliedSource, /REVIEW ISSUE #2 \[MEDIUM\]/);
        assert.match(appliedSource, /const value = validate\(input\);/);
        assert.deepEqual(applied.appliedFindings, ["F-001"]);
        assert.deepEqual(applied.annotatedFindings, ["F-002"]);

        const reopenedApplied = await prepareReviewWorkspace(
            workspace,
            report,
            ["F-001"],
        );
        assert.deepEqual(reopenedApplied.appliedFindings, ["F-001"]);
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});

test("annotates an abbreviated exact finding but rejects applying it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "fleet-review-abbreviated-"));
    try {
        await execFileAsync("git", ["-C", workspace, "init", "--quiet"]);
        await execFileAsync("git", ["-C", workspace, "config", "user.name", "Fleet Test"]);
        await execFileAsync("git", ["-C", workspace, "config", "user.email", "fleet@example.com"]);
        const source = [
            "fn count_items() {",
            "    let count = items.len();",
            "    process_items();",
            "    let upper_count = count.to_string();",
            "}",
            "",
        ].join("\n");
        await writeFile(join(workspace, "context.rs"), source, "utf8");
        await execFileAsync("git", ["-C", workspace, "add", "context.rs"]);
        await execFileAsync("git", ["-C", workspace, "commit", "--quiet", "-m", "reviewed"]);
        const headSha = (
            await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"])
        ).stdout.trim();
        const report = {
            runId: "run-abbreviated",
            reportMarkdown: "# Review",
            pr: { headSha },
            findings: [
                {
                    id: "F-002",
                    severity: "high",
                    title: "Handle count safely",
                    problem: "The count needs additional validation.",
                    evidence: "The abbreviated hunk omits reviewed statements.",
                    path: "context.rs",
                    lineStart: 2,
                    lineEnd: 4,
                    currentCode:
                        "let count = items.len();\n...\nlet upper_count = count.to_string();",
                    suggestedCode:
                        "let count = checked_count(items)?;\nlet upper_count = count.to_string();",
                    fixKind: "exact",
                    judgmentNotes: "",
                },
            ],
        };

        const prepared = await prepareReviewWorkspace(workspace, report);
        assert.deepEqual(prepared.annotatedFindings, ["F-002"]);
        const annotatedSource = await readFile(join(workspace, "context.rs"), "utf8");
        assert.match(annotatedSource, /REVIEW ISSUE #2 \[HIGH\]: Handle count safely/);
        assert.match(annotatedSource, /process_items\(\);/);

        const reopened = await prepareReviewWorkspace(workspace, report);
        assert.deepEqual(reopened.annotatedFindings, ["F-002"]);
        assert.equal(await readFile(join(workspace, "context.rs"), "utf8"), annotatedSource);

        await assert.rejects(
            () => prepareReviewWorkspace(workspace, report, ["F-002"], []),
            /F-002: reviewed code no longer matches context\.rs/,
        );
        assert.equal(await readFile(join(workspace, "context.rs"), "utf8"), annotatedSource);
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});
