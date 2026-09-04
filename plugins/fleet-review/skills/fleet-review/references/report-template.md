# Code Review: PR #{pr.number} - {title}

**PR:** {link}
**Branch:** `{head}` -> `{base}`
**Author:** @{author}
**Review Date:** {date}
**Reviewed Commits:** `{baseSha}` -> `{headSha}`
**Completeness:** {Complete, or partial with failed-agent details}

## Summary

{Overview of the changes and their purpose}

## Issues Summary

| Severity | Count | Reported By |
|----------|-------|-------------|

## Critical Issues

### {N}. {Short description}

**File:** `{path}:{line}`
**Reported By:** {models that found this issue}
**Problem:** {description of the issue}
**Evidence:** {code snippet or reasoning}
**Suggested Fix:** {suggestion for how to fix}
**Fix Confidence:** {Exact replacement or illustrative}
**Human Judgment:** {What remains to decide, or N/A}

```diff
- {smallest current-code hunk}
+ {corresponding suggested-code hunk}
```

## High Issues

Use the same format as Critical Issues.

## Medium Issues

Use the same format as Critical Issues.

## Low Issues

Use the same format as Critical Issues.

## Reviewer Agreement Matrix

| Issue | Claude Opus 5 | GPT-5.6 Sol | Gemini 3.1 Pro |
|-------|---------------|-------------|----------------|

## Recommendations

1. **Must Fix Before Merge:** Critical issues.
2. **Should Fix:** High issues.
3. **Consider Fixing:** Medium and Low issues.

## Files Changed

| File | Additions | Deletions |
|------|-----------|-----------|

**Total:** +N / -N lines across M files

## Review Coverage

| Agent | Model | Lens | Status | Error |
|-------|-------|------|--------|-------|

If more than 50 confirmed findings remain after deduplication, note the total and the number of
lower-priority findings omitted from the structured canvas payload.

## Issue Index

| Issue # | Severity | File | Comment Location | Found By |
|---------|----------|------|------------------|----------|
