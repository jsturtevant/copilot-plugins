# Fleet Review JSON Schema

The companion JSON report and canvas completion message use schema version `1`.

```json
{
  "schemaVersion": 1,
  "runId": "canvas-provided run ID",
  "repository": "owner/repository",
  "pr": {
    "number": 42,
    "title": "Pull request title",
    "url": "https://github.com/owner/repository/pull/42",
    "isDraft": false,
    "author": "octocat",
    "baseRef": "main",
    "headRef": "feature",
    "baseSha": "reviewed base commit SHA",
    "headSha": "reviewed head commit SHA"
  },
  "status": "complete",
  "startedAt": "ISO-8601 timestamp",
  "completedAt": "ISO-8601 timestamp",
  "summary": "Concise review summary",
  "reportMarkdown": "# Complete Markdown report",
  "agents": [
    {
      "name": "Security & Permissions",
      "model": "model identifier",
      "lens": "Authentication, authorization, and trust boundaries",
      "status": "complete",
      "error": ""
    },
    {
      "name": "Logic & Correctness",
      "model": "model identifier",
      "lens": "Control flow, state transitions, and edge cases",
      "status": "complete",
      "error": ""
    },
    {
      "name": "Resource Safety & Reliability",
      "model": "model identifier",
      "lens": "Lifecycle, limits, and failure handling",
      "status": "complete",
      "error": ""
    },
    {
      "name": "Network & Input Boundaries",
      "model": "model identifier",
      "lens": "External input, URLs, validation, and timeouts",
      "status": "complete",
      "error": ""
    },
    {
      "name": "Sandbox Isolation",
      "model": "model identifier",
      "lens": "Guest and host boundaries and capability leaks",
      "status": "complete",
      "error": ""
    },
    {
      "name": "SDK/API Consistency & Maintainability",
      "model": "model identifier",
      "lens": "Cross-SDK parity, types, tests, and shared code",
      "status": "complete",
      "error": ""
    }
  ],
  "counts": {
    "critical": 0,
    "high": 1,
    "medium": 0,
    "low": 0,
    "confirmedTotal": 1
  },
  "findings": [
    {
      "id": "F-001",
      "severity": "high",
      "title": "Short title",
      "problem": "Why this is a defect introduced by the pull request.",
      "evidence": "Concrete evidence supporting the finding.",
      "path": "src/example.js",
      "lineStart": 10,
      "lineEnd": 14,
      "currentCode": "const current = true;",
      "suggestedCode": "const current = validate(input);",
      "fixKind": "exact",
      "judgmentNotes": "",
      "reportedBy": ["Security & Permissions / model identifier"]
    }
  ]
}
```

Allowed severities are `critical`, `high`, `medium`, and `low`. Allowed agent statuses are
`complete`, `failed`, and `timed_out`. A report is `partial` when any agent failed or timed out.
The array contains each of the six named Fleet Review lenses exactly once.
The severity counts and `counts.confirmedTotal` describe the complete deduplicated set before the
50-finding cap. The four severity counts must sum to `confirmedTotal`.

Use `fixKind: "illustrative"` when the suggested code is not a safe drop-in replacement, and
provide non-empty `judgmentNotes`. Include the smallest useful code hunk. The consolidator
deduplicates findings, orders them by severity, keeps at most 50, and records full and omitted
counts in the rendered report.
