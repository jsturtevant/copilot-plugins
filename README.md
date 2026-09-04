# Copilot Plugins

Personal GitHub Copilot plugins maintained by jsturtevant.

## Available plugins

### fleet-review

Runs parallel code-review agents across six focus areas, consolidates confirmed findings into a
Markdown and JSON report without modifying source files or GitHub state.

The Fleet Review canvas adds a repository and open-PR selector, local or cloud Copilot review
sessions, timestamped review history, and a report workspace with one searchable tab per finding.
Each finding keeps the reviewed code and proposed fix side by side. Reviews are pinned to the
reviewed commit and marked stale when the pull request advances; partial agent results remain
available with an explicit warning. Child sessions run in interactive mode and are instructed to
use read-only review agents; the canvas exposes no source-edit, fix-apply, or GitHub-write action.

## Install

Add this repository as a marketplace:

```console
copilot plugin marketplace add jsturtevant/copilot-plugins
```

Install the plugin:

```console
copilot plugin install fleet-review@jsturtevant-copilot-plugins
```
