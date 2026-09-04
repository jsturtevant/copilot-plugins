import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, win32 } from "node:path";
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

export async function openFindingInVscode(workspacePath, finding) {
    const lexicalTarget = resolveFindingTarget(workspacePath, finding.path);
    const [workspace, target] = await Promise.all([realpath(workspacePath), realpath(lexicalTarget)]);
    resolveFindingTarget(workspace, relative(workspace, target));
    const [workspaceMetadata, targetMetadata] = await Promise.all([stat(workspace), stat(target)]);
    if (!workspaceMetadata.isDirectory()) {
        throw new Error("The review workspace is not a directory");
    }
    if (!targetMetadata.isFile()) {
        throw new Error("The finding target is not a file");
    }
    const executable = await findVscodeExecutable();
    await execFileAsync(
        executable,
        ["--new-window", workspace, "--goto", `${target}:${finding.lineStart}`],
        { windowsHide: true },
    );
    return target;
}
