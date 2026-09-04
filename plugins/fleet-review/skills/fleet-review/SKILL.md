---
name: fleet-review
description: >-
  Launch a fleet of parallel code-review agents to perform a comprehensive codebase review.
  Use when the user says "fleet review", "fleet deployed", "fleet: review", or asks for a
  full codebase security or quality review across multiple areas simultaneously. The review
  covers security, logic and correctness, resource safety, network and input boundaries,
  sandbox isolation, and SDK/API consistency. Results are written to docs/review/ as Markdown
  and structured JSON files.
---

# Fleet Review

Launch six parallel code-review agents, consolidate their findings, and write the report to
`docs/review/` in the repository. Use different models for each agent, preferring the latest
versions of GPT Sol, Gemini Pro, and Claude Opus. Review only commits not merged into the main
branch, and make sure the local main branch is current with upstream.

Do not modify source files, post pull request comments, commit, or stage changes. Leave only the
review artifacts for the developer to inspect.

## Workflow

### 1. Review branch changes through six complementary lenses

| Agent | Review lens | What to look for |
| --- | --- | --- |
| 1 - Security & Permissions | Authentication, authorization, trust boundaries | Missing checks, privilege escalation, fail-open behavior |
| 2 - Logic & Correctness | Control flow, state transitions, edge cases | Incorrect assumptions, unreachable states, race conditions, data corruption |
| 3 - Resource Safety & Reliability | Memory, lifecycle, limits, failure handling | Leaks, uncapped work, exhaustion, partial failures, unsafe retries |
| 4 - Network & Input Boundaries | HTTP, URLs, external input, allowlists | Validation gaps, bypasses, missing timeouts, unsafe schemes, ports, or paths |
| 5 - Sandbox Isolation | Guest/host boundaries, evaluation, globals | Escapes, global pollution, capability leaks, ignored configuration |
| 6 - SDK/API Consistency & Maintainability | Cross-SDK parity, types, tests, shared code | Behavioral mismatches, stale declarations, duplication, missing regression tests |

Each agent reviews the full branch diff through its assigned lens; areas may overlap. If the user
specifies custom focus areas, adapt the review lenses accordingly.

### 2. Launch agents in parallel

Use the `task` tool with `agent_type: "code-review"` and `mode: "background"` for all six
agents simultaneously.

Use different models for diverse perspectives:

- Claude Opus 5
- GPT-5.6 Sol
- Gemini 3.1 Pro

Each agent prompt must:

- State its review lens clearly.
- Instruct it to review the full branch diff through that lens.
- Request findings in structured tables with severity, file and line, and description.
- Group findings by severity: Critical, High, Medium, and Low.
- Provide evidence for every issue.
- Provide a possible fix for every issue.
- Include the smallest current-code hunk that proves the issue and a corresponding suggested-code
  hunk. Mark the suggestion as `exact` only when it is a safe replacement; otherwise mark it
  `illustrative` and state what still requires human judgment.

### 3. Consolidate results

After all agents complete, merge their findings into one report using
`references/report-template.md`. Deduplicate overlapping findings. Identify issues reported by
multiple agents and unique findings.

- Report every confirmed issue and include line numbers.
- Report only issues introduced by the branch changes, not pre-existing problems.
- Note which agents and models reported each issue.
- Categorize every issue as Critical, High, Medium, or Low.
- Include a summary table with issue counts by severity and reporting agents.

### 4. Write the reports

- Ensure `docs/review/` exists.
- Write the report to `docs/review/YYYY-MM-DD-review.md` using the current date.
- If that file exists, append a counter such as `YYYY-MM-DD-review-2.md`.
- Write a companion JSON file with the same stem using the schema documented in
  `references/review-schema.md`.
- Bind the report to the exact reviewed base and head commit SHAs.
- After deduplication, order findings by severity and retain at most the 50 highest-severity
  findings in the structured payload. Record the total confirmed and omitted counts.
- If one or more agents fail or time out, preserve findings from successful agents, mark the
  report `partial`, and record the failed agent and error.
- Tell the user where the report was written and summarize finding counts by severity.
- Leave both report files unstaged.

When the review was started by the Fleet Review canvas, the kickoff prompt provides a `runId` and
asks for a delimited result. Return the complete JSON payload between these exact markers:

```text
FLEET_REVIEW_RESULT_START
{...valid JSON...}
FLEET_REVIEW_RESULT_END
```

The canvas result message is the transport for both local and cloud reviews. Do not replace it with
a filesystem path or a prose summary.

Do not present the full report in the conversation. Only provide a summary such as:

> Review written to `docs/review/2026-03-29-review.md` and
> `docs/review/2026-03-29-review.json` - 3 critical, 7 high, and 11 medium findings across 6
> areas.
