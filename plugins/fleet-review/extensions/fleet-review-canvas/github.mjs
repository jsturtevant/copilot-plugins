import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validateRepository(repository) {
    if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
        throw new Error("Repository must use the owner/name format");
    }
    return repository;
}

export async function listOpenPullRequests(repository) {
    const repo = validateRepository(repository);
    const fields = [
        "number",
        "title",
        "isDraft",
        "author",
        "headRefName",
        "baseRefName",
        "headRefOid",
        "url",
        "updatedAt",
    ].join(",");
    const { stdout } = await execFileAsync(
        "gh",
        ["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", fields],
        {
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GH_PAGER: "cat", PAGER: "cat" },
        },
    );
    const pullRequests = JSON.parse(stdout);
    return pullRequests.map((pullRequest) => ({
        number: pullRequest.number,
        title: pullRequest.title,
        isDraft: Boolean(pullRequest.isDraft),
        author: pullRequest.author?.login ?? "unknown",
        headRefName: pullRequest.headRefName,
        baseRefName: pullRequest.baseRefName,
        headRefOid: pullRequest.headRefOid,
        url: pullRequest.url,
        updatedAt: pullRequest.updatedAt,
    }));
}

export async function getPullRequestSnapshot(repository, prNumber) {
    const repo = validateRepository(repository);
    if (!Number.isInteger(prNumber) || prNumber < 1) {
        throw new Error("Pull request number must be a positive integer");
    }
    const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", String(prNumber), "--repo", repo, "--json", "headRefOid,state"],
        {
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GH_PAGER: "cat", PAGER: "cat" },
        },
    );
    const pullRequest = JSON.parse(stdout);
    return {
        headRefOid: pullRequest.headRefOid,
        state: pullRequest.state,
    };
}
