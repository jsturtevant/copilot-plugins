# Copilot Plugins

Personal GitHub Copilot plugins maintained by jsturtevant.

## Available plugins

### fleet-review

Runs six parallel code-review agents across security, correctness, reliability, input boundaries,
sandbox isolation, and API consistency. It includes both a `/fleet-review` skill and an interactive
Fleet Review canvas.

The canvas selects configured repositories and open pull requests, launches local or cloud review
sessions, and keeps recent reports easy to reopen. Each finding presents the reviewed code beside a
red/green proposed diff. Local reviews can open an annotated worktree in VS Code; exact suggestions
are applied only through the explicit **Apply diff** action. The plugin never posts review comments
or performs other GitHub mutations.

See [`plugins/fleet-review/README.md`](plugins/fleet-review/README.md) for requirements, usage, and
the complete safety model.

## Install

Add this repository as a marketplace:

```console
copilot plugin marketplace add jsturtevant/copilot-plugins
```

Install the plugin:

```console
copilot plugin install fleet-review@jsturtevant-copilot-plugins
```

The plugin can also be installed directly from its repository subdirectory:

```console
copilot plugin install jsturtevant/copilot-plugins:plugins/fleet-review
```
