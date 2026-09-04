import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export function buildProposedSource(source, finding) {
    const lines = normalizedLines(source);
    const startIndex = finding.lineStart - 1;
    const endIndex = finding.lineEnd;
    if (
        !Number.isInteger(startIndex) ||
        !Number.isInteger(endIndex) ||
        startIndex < 0 ||
        endIndex <= startIndex ||
        endIndex > lines.length
    ) {
        throw new Error("The finding line range is outside the reviewed source file");
    }

    const reviewedLines = lines.slice(startIndex, endIndex);
    const reviewedFinding = normalizedLines(finding.currentCode).join("\n");
    if (reviewedLines.join("\n").trim() !== reviewedFinding.trim()) {
        throw new Error("The reviewed source no longer matches this finding");
    }

    const suggestedLines = normalizedLines(finding.suggestedCode);
    const firstLineIndent = reviewedLines[0].match(/^\s*/)?.[0] ?? "";
    if (firstLineIndent && suggestedLines[0] && !/^\s/.test(suggestedLines[0])) {
        suggestedLines[0] = `${firstLineIndent}${suggestedLines[0]}`;
    }
    lines.splice(startIndex, endIndex - startIndex, ...suggestedLines);
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    return lines.join(lineEnding);
}

export function reviewedBlobSpec(headSha, findingPath) {
    if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/i.test(headSha)) {
        throw new Error("The review did not provide a valid head commit SHA");
    }
    return `${headSha}:${findingPath}`;
}

export async function openFindingInVscode(
    workspacePath,
    artifactRoot,
    artifactKey,
    headSha,
    finding,
) {
    resolveFindingTarget(workspacePath, finding.path);
    const workspace = await realpath(workspacePath);
    const workspaceMetadata = await stat(workspace);
    if (!workspaceMetadata.isDirectory()) {
        throw new Error("The review workspace is not a directory");
    }

    const { stdout: source } = await execFileAsync(
        "git",
        ["-C", workspace, "show", reviewedBlobSpec(headSha, finding.path)],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    const proposedSource = buildProposedSource(source, finding);
    const artifactId = createHash("sha256")
        .update(`${workspace}\0${artifactKey}\0${headSha}`)
        .digest("hex");
    const reviewedDirectory = join(artifactRoot, artifactId, "reviewed");
    const proposedDirectory = join(artifactRoot, artifactId, "proposed");
    const reviewedTarget = join(reviewedDirectory, basename(finding.path));
    const proposedTarget = join(proposedDirectory, basename(finding.path));
    await Promise.all([
        mkdir(reviewedDirectory, { recursive: true }),
        mkdir(proposedDirectory, { recursive: true }),
    ]);
    await Promise.all([
        writeFile(reviewedTarget, source, "utf8"),
        writeFile(proposedTarget, proposedSource, "utf8"),
    ]);

    const executable = await findVscodeExecutable();
    await execFileAsync(
        executable,
        ["--new-window", "--diff", reviewedTarget, proposedTarget],
        { windowsHide: true },
    );
    return { reviewedTarget, proposedTarget };
}
