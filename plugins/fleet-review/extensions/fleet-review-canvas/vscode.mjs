import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_OPTIONS = {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
};

export function vscodeExecutableCandidates(platform = process.platform, environment = process.env) {
    if (platform !== "win32") {
        return ["code"];
    }
    const paths = (environment.PATH ?? "").split(";").filter(Boolean);
    return [
        environment.LOCALAPPDATA &&
            win32.join(environment.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
        environment.ProgramFiles &&
            win32.join(environment.ProgramFiles, "Microsoft VS Code", "Code.exe"),
        environment["ProgramFiles(x86)"] &&
            win32.join(environment["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
        ...paths.flatMap((entry) => [
            win32.join(entry, "Code.exe"),
            win32.resolve(entry, "..", "Code.exe"),
            win32.resolve(entry, "..", "Code - Insiders.exe"),
        ]),
    ].filter(Boolean);
}

async function findVscodeExecutable() {
    const candidates = vscodeExecutableCandidates();
    if (process.platform !== "win32") {
        return candidates[0];
    }
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Continue through known executable locations without invoking a shell.
        }
    }
    throw new Error("VS Code could not be found. Install it or add its launcher to PATH");
}

export function resolveFindingTarget(workspacePath, findingPath) {
    if (typeof workspacePath !== "string" || !isAbsolute(workspacePath)) {
        throw new Error("The review session did not provide an absolute workspace path");
    }
    if (typeof findingPath !== "string" || !findingPath || isAbsolute(findingPath)) {
        throw new Error("The finding path must be repository-relative");
    }
    const workspace = resolve(workspacePath);
    const target = resolve(workspace, findingPath);
    const relativeTarget = relative(workspace, target);
    if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
        throw new Error("The finding path resolves outside the review workspace");
    }
    return target;
}

function normalizedLines(value) {
    return value.replace(/\r\n?/g, "\n").split("\n");
}

function dedentLines(lines) {
    const indents = lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
    const commonIndent = indents.length ? Math.min(...indents) : 0;
    return lines.map((line) => (line.trim() ? line.slice(commonIndent) : ""));
}

function comparableHunk(lines) {
    return dedentLines(lines).join("\n").trim();
}

export function buildProposedSource(source, finding) {
    const lines = normalizedLines(source);
    const reviewedFinding = normalizedLines(finding.currentCode);
    let startIndex = finding.lineStart - 1;
    let endIndex = startIndex + reviewedFinding.length;
    if (
        !Number.isInteger(startIndex) ||
        startIndex < 0 ||
        endIndex > lines.length
    ) {
        throw new Error(`${finding.id}: line range is outside ${finding.path}`);
    }

    let reviewedLines = lines.slice(startIndex, endIndex);
    const reviewedText = comparableHunk(reviewedFinding);
    if (comparableHunk(reviewedLines) !== reviewedText) {
        const matches = [];
        for (let index = 0; index <= lines.length - reviewedFinding.length; index += 1) {
            if (comparableHunk(lines.slice(index, index + reviewedFinding.length)) === reviewedText) {
                matches.push(index);
            }
        }
        if (matches.length === 1) {
            startIndex = matches[0];
            endIndex = startIndex + reviewedFinding.length;
            reviewedLines = lines.slice(startIndex, endIndex);
        } else if (
            comparableHunk(reviewedLines) === comparableHunk(normalizedLines(finding.suggestedCode))
        ) {
            return source;
        } else {
            throw new Error(
                `${finding.id}: reviewed code ${matches.length ? "is ambiguous in" : "no longer matches"} ${finding.path}`,
            );
        }
    }

    const firstLineIndent = reviewedLines[0].match(/^\s*/)?.[0] ?? "";
    const suggestedLines = dedentLines(normalizedLines(finding.suggestedCode)).map((line) =>
        line ? `${firstLineIndent}${line}` : "",
    );
    lines.splice(startIndex, endIndex - startIndex, ...suggestedLines);
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    return lines.join(lineEnding);
}

function commentStyle(path) {
    const extension = extname(path).toLowerCase();
    if (
        [
            ".c",
            ".cc",
            ".cpp",
            ".cs",
            ".go",
            ".java",
            ".js",
            ".jsx",
            ".kt",
            ".kts",
            ".m",
            ".mm",
            ".php",
            ".rs",
            ".swift",
            ".ts",
            ".tsx",
        ].includes(extension)
    ) {
        return { prefix: "// " };
    }
    if (
        [
            ".bash",
            ".ini",
            ".pl",
            ".ps1",
            ".py",
            ".rb",
            ".sh",
            ".toml",
            ".yaml",
            ".yml",
        ].includes(extension)
    ) {
        return { prefix: "# " };
    }
    if ([".html", ".md", ".xml"].includes(extension)) {
        return { prefix: "<!-- ", suffix: " -->" };
    }
    if ([".lua", ".sql"].includes(extension)) {
        return { prefix: "-- " };
    }
    throw new Error(`Inline review comments are not supported for ${extension || "extensionless files"}`);
}

function annotationLines(finding, indentation, blankLineLabel) {
    const style = commentStyle(finding.path);
    const line = (text) => `${indentation}${style.prefix}${text}${style.suffix ?? ""}`;
    const details = [
        `FLEET REVIEW ${finding.id} [${finding.severity.toUpperCase()}]: ${finding.title}`,
        `Problem: ${finding.problem.replace(/\s+/g, " ").trim()}`,
        `Evidence: ${finding.evidence.replace(/\s+/g, " ").trim()}`,
        `Suggestion (${finding.fixKind}):`,
        ...normalizedLines(finding.suggestedCode).map((code) =>
            code ? `  ${code}` : `  ${blankLineLabel}`,
        ),
    ];
    if (finding.judgmentNotes) {
        details.push(`Judgment: ${finding.judgmentNotes.replace(/\s+/g, " ").trim()}`);
    }
    return details.map(line);
}

export function buildAnnotatedSource(source, findings, blankLineLabel = "[blank line]") {
    const lines = normalizedLines(source);
    const ordered = [...findings].sort((left, right) => right.lineStart - left.lineStart);
    for (const finding of ordered) {
        const startIndex = finding.lineStart - 1;
        if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= lines.length) {
            throw new Error(`${finding.id}: annotation line is outside ${finding.path}`);
        }
        const indentation = lines[startIndex].match(/^\s*/)?.[0] ?? "";
        lines.splice(startIndex, 0, ...annotationLines(finding, indentation, blankLineLabel));
    }
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    return lines.join(lineEnding);
}

async function git(workspace, args) {
    return execFileAsync("git", ["-C", workspace, ...args], GIT_OPTIONS);
}

export async function prepareReviewWorkspace(workspacePath, report) {
    const workspace = await realpath(workspacePath);
    if (!(await stat(workspace)).isDirectory()) {
        throw new Error("The review workspace is not a directory");
    }

    const currentHead = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim();
    if (currentHead !== report.pr.headSha) {
        const trackedStatus = await git(workspace, ["status", "--porcelain", "--untracked-files=no"]);
        if (trackedStatus.stdout.trim()) {
            throw new Error("The review workspace already has tracked changes; refusing to overwrite them");
        }
        await git(workspace, ["switch", "--detach", report.pr.headSha]);
    }

    const exactFindings = report.findings
        .filter((finding) => finding.fixKind === "exact")
        .sort(
            (left, right) =>
                left.path.localeCompare(right.path) || right.lineStart - left.lineStart,
        );
    const baselineFiles = new Map();
    const priorFixFiles = new Map();
    for (const finding of exactFindings) {
        const target = resolveFindingTarget(workspace, finding.path);
        const source = priorFixFiles.has(target)
            ? priorFixFiles.get(target)
            : (
                  await git(workspace, [
                      "show",
                      `${report.pr.headSha}:${finding.path}`,
                  ])
              ).stdout;
        baselineFiles.set(
            target,
            baselineFiles.get(target) ??
                (
                    await git(workspace, [
                        "show",
                        `${report.pr.headSha}:${finding.path}`,
                    ])
                ).stdout,
        );
        priorFixFiles.set(target, buildProposedSource(source, finding));
    }
    for (const finding of report.findings.filter((candidate) => candidate.fixKind !== "exact")) {
        const target = resolveFindingTarget(workspace, finding.path);
        if (!baselineFiles.has(target)) {
            baselineFiles.set(
                target,
                (
                    await git(workspace, [
                        "show",
                        `${report.pr.headSha}:${finding.path}`,
                    ])
                ).stdout,
            );
        }
    }
    const findingsByTarget = new Map();
    for (const finding of report.findings) {
        const target = resolveFindingTarget(workspace, finding.path);
        findingsByTarget.set(target, [...(findingsByTarget.get(target) ?? []), finding]);
    }
    const annotatedFiles = new Map(
        [...findingsByTarget].map(([target, findings]) => [
            target,
            buildAnnotatedSource(baselineFiles.get(target), findings),
        ]),
    );
    const legacyAnnotatedFiles = new Map(
        [...findingsByTarget].map(([target, findings]) => [
            target,
            buildAnnotatedSource(baselineFiles.get(target), findings, ""),
        ]),
    );

    const changedPaths = (
        await git(workspace, ["diff", "--name-only", "--relative"])
    ).stdout
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter(Boolean);
    if (changedPaths.length) {
        const expectedPaths = new Set(report.findings.map((finding) => finding.path));
        if (changedPaths.some((path) => !expectedPaths.has(path))) {
            throw new Error("The review workspace has unrelated tracked changes; refusing to overwrite them");
        }
        const changedTargets = new Set(
            changedPaths.map((path) => resolveFindingTarget(workspace, path)),
        );
        for (const [target, expected] of annotatedFiles) {
            if (!changedTargets.has(target)) {
                continue;
            }
            const actual = await readFile(target, "utf8");
            const normalizedActual = actual.replace(/\r\n?/g, "\n");
            const matchesAnnotation =
                normalizedActual === expected.replace(/\r\n?/g, "\n");
            const matchesPriorFix =
                priorFixFiles.has(target) &&
                normalizedActual === priorFixFiles.get(target).replace(/\r\n?/g, "\n");
            const matchesLegacyAnnotation =
                normalizedActual === legacyAnnotatedFiles.get(target).replace(/\r\n?/g, "\n");
            if (!matchesAnnotation && !matchesPriorFix && !matchesLegacyAnnotation) {
                throw new Error("The review workspace has edited source changes; refusing to overwrite them");
            }
        }
    }
    const reportDirectory = join(workspace, "docs", "review");
    const markdownPath = join(reportDirectory, "fleet-review.md");
    const jsonPath = join(reportDirectory, "fleet-review.json");
    await mkdir(reportDirectory, { recursive: true });
    await Promise.all([
        ...[...annotatedFiles].map(([target, source]) => writeFile(target, source, "utf8")),
        writeFile(markdownPath, `${report.reportMarkdown.trimEnd()}\n`, "utf8"),
        writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    ]);

    return {
        workspace,
        markdownPath,
        jsonPath,
        annotatedFindings: report.findings.map((finding) => finding.id),
    };
}

export async function openReviewProjectInVscode(workspacePath, report) {
    const prepared = await prepareReviewWorkspace(workspacePath, report);
    const executable = await findVscodeExecutable();
    await execFileAsync(executable, ["--new-window", prepared.workspace], { windowsHide: true });
    return prepared;
}
