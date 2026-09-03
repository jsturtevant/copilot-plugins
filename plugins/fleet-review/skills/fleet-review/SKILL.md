---
name: fleet-review
description: >-
  Launch a fleet of parallel code-review agents to perform a comprehensive codebase review.
  Use when the user says "fleet review", "fleet deployed", "fleet: review", or asks for a
  full codebase security or quality review across multiple areas simultaneously. The review
  covers security issues, memory safety, network permissions, sandbox isolation, SDK
  consistency, and code quality. Results are written to docs/review/ as a Markdown file.
---

# Fleet Review

Launch six parallel code-review agents, consolidate their findings, and write the report to
`docs/review/` in the repository. Use different models for each agent, preferring the latest
versions of GPT Sol, Gemini Pro, and Claude Opus. Review only commits not merged into the main
branch, and make sure the local main branch is current with upstream. Leave inline comments at
each source line where an issue arises.

Do not commit or stage any changes. Leave all review artifacts for the developer to inspect.

## Workflow

### 1. Partition the codebase into six review areas

| Agent | Focus Area | What to look for |
| --- | --- | --- |
| 1 - Security & Permissions | Auth, access control, permission checks | Missing permission checks, privilege escalation, fail-open patterns |
| 2 - Memory & Resource Safety | Allocations, buffers, resource limits | Uncapped allocations, OOM vectors, buffer overflows, resource exhaustion |
| 3 - Network & HTTP | HTTP clients, domain allowlists, timeouts | Permission bypasses, missing timeouts, scheme, port, or path gaps |
| 4 - Sandbox Isolation | Guest/host boundaries, eval, globals | Sandbox escapes, global pollution, silently ignored configuration |
| 5 - SDK Consistency | Cross-SDK API parity, error handling | Missing features in some SDKs, inconsistent error models, type mismatches |
| 6 - Code Quality & DRY | Duplication, shared types, build/CI | Duplicated code, missing shared abstractions, stale declarations, test gaps |

If the user specifies custom focus areas, adapt the partitioning accordingly.

### 2. Launch agents in parallel

Use the `task` tool with `agent_type: "code-review"` and `mode: "background"` for all six
agents simultaneously.

Use different models for diverse perspectives:

- Claude Opus 5
- GPT-5.6 Sol
- Gemini 3.1 Pro

Each agent prompt must:

- State its focus area clearly.
- Instruct it to explore the full codebase relevant to its area.
- Request findings in structured tables with severity, file and line, and description.
- Group findings by severity: Critical, High, Medium, and Low.
- Provide evidence for every issue.
- Provide a possible fix for every issue.

### 3. Consolidate results

After all agents complete, merge their findings into one report using
`references/report-template.md`. Deduplicate overlapping findings. Identify issues reported by
multiple agents and unique findings.

- Report every confirmed issue and include line numbers.
- Report only issues introduced by the branch changes, not pre-existing problems.
- Note which agents and models reported each issue.
- Categorize every issue as Critical, High, Medium, or Low.
- Include a summary table with issue counts by severity and reporting agents.

### 4. Write the report

- Ensure `docs/review/` exists.
- Write the report to `docs/review/YYYY-MM-DD-review.md` using the current date.
- If that file exists, append a counter such as `YYYY-MM-DD-review-2.md`.
- Tell the user where the report was written and summarize finding counts by severity.
- For every issue, place a comment at the relevant source line using the repository's comment
  syntax: `# REVIEW ISSUE #N [SEVERITY]: Brief description`. Replace `#` with the appropriate
  comment marker for that file type.
- Leave source comments and the report unstaged.

Do not present the full report in the conversation. Only provide a summary such as:

> Review written to `docs/review/2026-03-29-review.md` - 3 critical, 7 high, and 11 medium
> findings across 6 areas.
