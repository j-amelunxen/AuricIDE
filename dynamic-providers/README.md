# Dynamic Providers

This directory is how you configure external command-line agent tools (Claude Code,
Gemini CLI, Codex, OpenCode, Aider, …) without recompiling AuricIDE.

> **You have to bring your own.** Only one provider, `crush`, is compiled into the
> binary. Every other provider is a JSON file you write here, and these files are
> **not tracked in git** (`.gitignore`) — they describe CLIs installed on your
> machine, not repository content. So a fresh clone, and a downloaded build, start
> with Crush only. Copy the example below to add the agent you actually use.

## Where the files are read from

At startup AuricIDE scans **five** directories, in this order, and a later one wins
over an earlier one for the same provider `id`:

1. `dynamic-providers/` (relative to the working directory)
2. `../dynamic-providers/`
3. `<app data dir>/dynamic-providers/`
4. `<bundle resource dir>/dynamic-providers/`
5. `<executable dir>/dynamic-providers/`

Running from the repo (`pnpm tauri:dev`) picks up #1/#2 — this folder. The installed
`/Applications` build does not; for that, use **Settings → Agent → Import provider**,
which validates the JSON, registers it immediately (no restart) and saves it to
`<app data dir>/dynamic-providers/`.

`crush` is a reserved `id`. Both the import path and the startup scan refuse a
config that claims it, so the built-in fallback cannot be replaced by a file.

## How to add a Custom Provider

1. Create a new `.json` file in this directory, e.g., `my-custom-agent.json`.
2. Provide the configuration schema. AuricIDE maps the AI model, permission mode (like autonomous or interactive), and task string into a CLI command.
3. Save the file. The provider appears on the next application startup — or
   immediately, if you use Settings → Agent → Import provider instead.

## When a file is rejected

Every field below is **required** unless marked optional, and the config is parsed
strictly: one missing field fails the **whole file**, so the provider simply never
appears in the picker. There is no toast for this — the reason is printed to stderr
as `Failed to parse provider config <path>: <error>`. If a provider you wrote is
missing, run from a terminal and read that line.

### Configuration Schema Example

Here is an example structure of a provider definition:

```json
{
  "id": "my-agent-id",
  "name": "My Agent CLI",
  "executable": "agent-cli",
  "arguments": [
    {
      "type": "model",
      "flag": "--use-model",
      "ignoreIfAuto": true
    },
    {
      "type": "headless",
      "flag": "--non-interactive",
      "interactiveFlag": "-i"
    },
    {
      "type": "task",
      "quote": true
    },
    {
      "type": "permission",
      "map": {
        "bypassPermissions": "--yolo",
        "acceptEdits": "--auto-accept",
        "plan": "--dry-run",
        "default": "--interactive"
      },
      "fallback": "--interactive"
    }
  ],
  "info": {
    "models": [
      { "value": "auto", "label": "Auto Model" },
      { "value": "model-XYZ", "label": "Model XYZ" }
    ],
    "permissionModes": [
      {
        "value": "bypassPermissions",
        "label": "Autonomous",
        "description": "Skip all permission prompts"
      },
      {
        "value": "default",
        "label": "Interactive",
        "description": "Ask for every permission"
      }
    ],
    "defaultModel": "auto",
    "defaultPermissionMode": "default"
  },
  "versionCheck": {
    "command": "agent-cli",
    "args": ["--version"]
  },
  "promptTemplate": "agent-cli --use-model model-xyz -i \""
}
```

### Argument Types

`arguments` is an ordered list; each entry is tagged by `type` and becomes part of
the command line in that order.

| `type`       | Field             | Required | Meaning                                                                    |
| ------------ | ----------------- | -------- | -------------------------------------------------------------------------- |
| `literal`    | `value`           | yes      | A fixed token — a sub-command or a flag that never varies (e.g. `run`)     |
| `model`      | `flag`            | yes      | Flag carrying the model selected in the UI                                 |
|              | `ignoreIfAuto`    | yes      | `true` = omit the flag entirely when the model is `auto`                   |
| `task`       | `quote`           | yes      | `true` = wrap the task text in double quotes (almost always what you want) |
| `headless`   | `flag`            | yes      | Flag used when the agent runs unattended                                   |
|              | `interactiveFlag` | optional | Flag used instead when a terminal is attached                              |
| `permission` | `map`             | yes      | Permission mode → CLI flag                                                 |
|              | `fallback`        | optional | Flag for modes missing from `map`. Without it, unmapped modes add nothing  |

**`ignoreIfAuto` and `quote` are required, not opt-in.** Writing
`{ "type": "task" }` fails the file with `missing field 'quote'`.

### Permission modes

`map` is keyed by AuricIDE's permission modes. There are **six**:

`bypassPermissions` · `acceptEdits` · `plan` · `auto` · `default` · `yolo`

A mode absent from `map` falls through to `fallback`; with no `fallback`, no flag is
emitted at all — so an agent launched in, say, `yolo` against a map that only knows
four modes runs with no permission flag. Map every mode your CLI can express, or set
a `fallback`.

### Default Permission Mode

`info.defaultPermissionMode` is the single source of truth for the provider's
permission level whenever no explicit mode is chosen:

- The "Start agent" and "Import Project Spec" dialogs preselect it.
- Automated spawn paths (goal launches, the conductor, diagram generation)
  pass no mode at all — the backend resolves it from this field.

Pick a value that can run unattended (e.g. Claude Code's classifier-guarded
`auto`); a prompting mode like `default` will stall agents that nobody is
watching.
