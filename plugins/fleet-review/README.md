# Fleet Review

Fleet Review packages a six-agent review skill and an interactive pull request review canvas as one
Copilot CLI plugin. It consolidates high-confidence findings into durable Markdown and JSON reports
without posting to GitHub.

## Features

- Reviews the complete pull request diff through six complementary lenses.
- Uses diverse Claude, GPT, and Gemini models when available.
- Selects configured repositories and open pull requests in the canvas.
- Runs reviews in isolated local worktrees or cloud sessions.
- Reopens recent reports across repositories.
- Shows each finding with evidence and a line-level red/green proposed diff.
- Opens local review worktrees in VS Code with canonical source annotations.
- Applies only suggestions marked as exact, and only after **Apply diff** is selected.

## Install

Install from the marketplace:

```console
copilot plugin marketplace add jsturtevant/copilot-plugins
copilot plugin install fleet-review@jsturtevant-copilot-plugins
```

Or install the plugin directly:

```console
copilot plugin install jsturtevant/copilot-plugins:plugins/fleet-review
```

Restart or reload Copilot CLI after installation so the skill and canvas are discovered.

## Use

Ask Copilot to open the Fleet Review canvas, then:

1. Select a configured repository and an open pull request.
2. Choose a local or cloud execution location.
3. Start the review and follow its progress in the canvas.
4. Read the report or select a finding to inspect its evidence and proposed diff.
5. For local reviews, use **Open in VS Code** to inspect the annotated worktree.

Use `/fleet-review` when you want the same six-lens review workflow for the current branch without
the canvas.

## Requirements

- A current Copilot CLI or GitHub Copilot app build with plugin and canvas support.
- GitHub authentication capable of reading the selected repository and pull request.
- A configured local project for local worktree reviews.
- VS Code's `code` command on `PATH` to use **Open in VS Code**.

Cloud execution appears only when it is available for the selected project.

## Safety and artifacts

Review sessions are instructed not to modify source files, stage or commit changes, post pull
request comments, or perform GitHub mutations. Reports are bound to the exact reviewed base and head
commit SHAs, and partial agent failures remain visible.

For local reviews, **Open in VS Code** prepares report artifacts and comment-only source annotations
as uncommitted worktree changes. **Apply diff** is a separate explicit action and is enabled only for
an exact suggestion. Illustrative suggestions always require manual judgment.

Reports are written under `docs/review/` in the review worktree when possible. Canvas run history is
stored in the owning Copilot session workspace.
