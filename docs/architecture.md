# Architecture

One screen of how AuricIDE fits together. For the working rules that go with it —
state slices, the goal/conductor loop, the agent-fleet invariants — see
[`CLAUDE.md`](../CLAUDE.md).

```mermaid
flowchart TD
    subgraph Frontend["Frontend — Next.js 16 / React 19"]
        UI["UI Components\nIDE Shell · Editor · Explorer\nTerminal · Agents · PM · Git · Canvas"]
        Store["Zustand Store\nslices composed in lib/store/index.ts"]
        IPCWrappers["Tauri IPC Wrappers\nlib/tauri/* → shared invoke()"]
        UI <--> Store
        UI --> IPCWrappers
    end

    subgraph RustBackend["Rust Backend — Tauri v2"]
        Commands["IPC Command Handlers\nlib.rs registers; modules implement"]
        GitLayer["Git\ngit.rs (git2-rs)"]
        AgentMgr["Agent Manager\nPTY lifecycle & stdout routing"]
        DbLayer["Database Layer\nSQLite schema · migrations · CRUD"]
        ProviderReg["Provider Registry\nCrush built in · others via dynamic-providers/"]
    end

    subgraph ExternalProcs["External Processes"]
        LLMAgents["LLM Agent Processes\nagent CLI subprocesses"]
        PTYShells["PTY Shell Processes\nbash · zsh · cmd"]
    end

    subgraph Storage["Persistent Storage"]
        SQLiteDB[("SQLite\n.auric/project.db\nepics · tickets · goals · kv_store")]
        FileSystem[("File System\nProject files · .auric/ config")]
    end

    IPCWrappers -- "invoke(cmd, args)\n→ Tauri IPC bridge" --> Commands
    Commands -- "emit events\n(file-event, terminal-out-{id})" --> IPCWrappers

    Commands --> GitLayer
    Commands --> AgentMgr
    Commands --> DbLayer
    Commands --> ProviderReg

    AgentMgr -- "spawn subprocess" --> LLMAgents
    AgentMgr -- "spawn PTY" --> PTYShells
    ProviderReg -- "CLI discovery & config" --> LLMAgents

    LLMAgents -- "stdout/stderr → agent events" --> AgentMgr
    PTYShells -- "terminal output events" --> Commands

    DbLayer <--> SQLiteDB
    GitLayer <--> FileSystem
    Commands <--> FileSystem
```

## Key Boundaries

| Boundary           | Technology                                 |
| ------------------ | ------------------------------------------ |
| Frontend ↔ Rust    | Tauri v2 IPC (`invoke` + event emitter)    |
| Rust ↔ LLM Agents  | OS subprocess with PTY (stdout/stderr)     |
| Rust ↔ Shells      | `portable-pty` cross-platform PTY          |
| Rust ↔ SQLite      | `rusqlite` via `.auric/project.db`         |
| Rust ↔ Git         | `git2` (libgit2) in `git.rs`               |
| Rust ↔ File System | `std::fs` + `notify` watcher (500 ms poll) |

## Data Flow Summary

1. **User action** → UI Component → Zustand Store update or IPC call
2. **IPC call** → Tauri bridge → Rust command handler
3. **File/Git ops** → `git.rs` / File System read/write
4. **Agent spawn** → Provider Registry selects CLI → Agent Manager forks subprocess → stdout events stream back to Frontend via Tauri events
5. **PM data** → `pm_save` / `pm_load` commands → SQLite epics/tickets tables
6. **Terminal I/O** → `shell_write` command → PTY Shell → `terminal-out-{id}` event → TerminalPanel (xterm.js)

## A note on agent providers

Only `crush` is compiled into the binary. Claude Code, Gemini CLI, Codex, OpenCode
and friends are JSON configs the user supplies under `dynamic-providers/`, which is
gitignored — so a fresh clone runs Crush and nothing else until you add one. See
[`dynamic-providers/README.md`](../dynamic-providers/README.md).
