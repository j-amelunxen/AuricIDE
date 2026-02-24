# Dynamic Providers

This directory allows you to configure external command-line agent tools (like OpenCode, Aider, etc.) without having to recompile AuricIDE.

AuricIDE scans this folder at startup for `.json` files and registers them as usable agent providers in the UI (e.g. within the "Deploy New Agent" dialog).

## How to add a Custom Provider

1. Create a new `.json` file in this directory, e.g., `my-custom-agent.json`.
2. Provide the configuration schema. AuricIDE maps the AI model, permission mode (like autonomous or interactive), and task string into a CLI command.
3. Save the file. The provider will be available on the next application startup.

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

- **`model`**: Automatically injects the selected model from the UI into the CLI command.
- **`headless`**: Used if AuricIDE runs the agent unattended (background task without an interactive terminal).
- **`task`**: Injects the markdown task instruction provided by the user. `quote: true` ensures the task is properly enclosed in quotes.
- **`permission`**: Maps AuricIDE's permission modes (`bypassPermissions`, `acceptEdits`, `plan`, `default`) into the chosen CLI flags for that mode.
