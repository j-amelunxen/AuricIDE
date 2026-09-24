# ADR 0002: Agent-owned, immutable MCP project sessions

## Status

Accepted

## Context

AuricIDE previously exposed an app-global child process as “the MCP server”.
That process was launched with the currently open workspace's database and was
restarted or rebound when the UI workspace changed. Actual coding agents use
their own stdio MCP connection, so the global process was both misleading and
incapable of safely serving several projects at once.

## Decision

- The installed application owns one versioned MCP runtime, not one mutable
  project connection.
- Every agent session receives an immutable, canonical project binding at
  spawn time. The binding contains exactly one project root and its derived
  `.auric/project.db`.
- `cwd` is only the execution directory. Worktrees may change `cwd` without
  changing the logical project binding.
- A missing project binding means an explicitly general agent with no Auric
  project database access. It never falls back to the active UI workspace.
- Switching or closing the UI workspace cannot mutate a running session.
- Invalid paths, uninitialized projects, and providers without a verified
  session-scoped MCP injection fail before the agent process is spawned.
- Claude, Codex, and Crush receive provider-specific, agent-private launch
  configuration. External clients receive a project-local `.mcp.json` that
  references the installed runtime rather than project source code.

## Consequences

- Five agents may work in five projects concurrently without sharing a mutable
  “current project”.
- AuricIDE may have no project open while already-running project sessions keep
  working.
- Starting a new agent requires an explicit project path or explicit general
  scope.
- Supporting another provider requires a tested session-scoped configuration
  adapter. Merely exporting a database path is not considered support.
- The old UI-global process controls are removed from the settings surface.

## Verification boundary

Lean proves that UI workspace changes cannot affect session routing in the
abstract coordinator model. Runtime packaging, path canonicalization, provider
CLI behavior, SQLite concurrency, and process isolation remain executable test
obligations.
