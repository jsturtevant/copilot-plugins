# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers reviewing pull requests before merge across repositories configured in the GitHub Copilot app.

## Product Purpose

Fleet Review runs a multi-agent pull request review in an isolated Copilot session and makes the consolidated results easy to inspect. Success means a developer can select a repository and pull request, start a local or cloud review, understand every confirmed finding, and trace the result back to its review session without changing code or GitHub state.

## Positioning

Fleet Review combines diverse review lenses with a persistent, code-first canvas that compares the reviewed code and a proposed fix in context.

## Operating Context

The product is a GitHub Copilot CLI plugin and canvas. Developers work from configured Copilot projects, open pull requests, local worktree-backed sessions, cloud sessions, branch diffs, Markdown review reports, and structured finding data.

## Capabilities and Constraints

- Lists configured projects and open pull requests, including drafts.
- Runs six complementary review agents in a new local or cloud Copilot session.
- Keeps timestamped review history and binds each run to the reviewed commit SHA.
- Shows partial results when individual agents fail.
- Retains the 50 highest-severity deduplicated findings and discloses omissions.
- Is review-only: it never edits source, applies fixes, posts review comments, or performs GitHub mutations.
- Uses a visible current-chat bridge for app-native project, session, and navigation tools because extension canvases cannot invoke those APIs directly.

## Evidence on Hand

The existing `plugins/fleet-review/skills/fleet-review/` skill defines six review lenses and a Markdown report template. No testimonials, benchmarks, or external claims are available and none should be fabricated.

## Product Principles

1. Preserve review traceability from finding to reviewed commit and Copilot session.
2. Prefer explicit incomplete or stale states over success-shaped fallbacks.
3. Keep code and evidence central; visual styling must not obscure the review task.
4. Make all GitHub access read-only unless the user separately requests and authorizes a mutation.
5. Keep local and cloud review results behaviorally equivalent.

## Accessibility & Inclusion

The canvas must support keyboard navigation, visible focus, semantic status announcements, reduced motion, high-contrast severity treatment, and a narrow layout that stacks code comparisons without losing context.
