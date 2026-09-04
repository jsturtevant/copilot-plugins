import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";
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
    const files = new Map();
    for (const finding of exactFindings) {
        const target = resolveFindingTarget(workspace, finding.path);
        const source = files.has(target)
            ? files.get(target)
            : (
                  await git(workspace, [
                      "show",
                      `${report.pr.headSha}:${finding.path}`,
                  ])
              ).stdout;
        files.set(target, buildProposedSource(source, finding));
    }

    const changedPaths = (
        await git(workspace, ["diff", "--name-only", "--relative"])
    ).stdout
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter(Boolean);
    if (changedPaths.length) {
        const expectedPaths = new Set(exactFindings.map((finding) => finding.path));
        if (changedPaths.some((path) => !expectedPaths.has(path))) {
            throw new Error("The review workspace has unrelated tracked changes; refusing to overwrite them");
        }
        for (const [target, expected] of files) {
            const actual = await readFile(target, "utf8");
            if (actual.replace(/\r\n?/g, "\n") !== expected.replace(/\r\n?/g, "\n")) {
                throw new Error("The review workspace has edited source changes; refusing to overwrite them");
            }
        }
    }
    const reportDirectory = join(workspace, "docs", "review");
    const markdownPath = join(reportDirectory, "fleet-review.md");
    const jsonPath = join(reportDirectory, "fleet-review.json");
    await mkdir(reportDirectory, { recursive: true });
    await Promise.all([
        ...(changedPaths.length
            ? []
            : [...files].map(([target, source]) => writeFile(target, source, "utf8"))),
        writeFile(markdownPath, `${report.reportMarkdown.trimEnd()}\n`, "utf8"),
        writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    ]);

    return {
        workspace,
        markdownPath,
        jsonPath,
        appliedFindings: exactFindings.map((finding) => finding.id),
        illustrativeFindings: report.findings
            .filter((finding) => finding.fixKind === "illustrative")
            .map((finding) => finding.id),
    };
}

export async function openReviewProjectInVscode(workspacePath, report) {
    const prepared = await prepareReviewWorkspace(workspacePath, report);
    const executable = await findVscodeExecutable();
    await execFileAsync(executable, ["--new-window", prepared.workspace], { windowsHide: true });
    return prepared;
}
