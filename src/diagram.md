# AuricIDE – Component & Module Diagram

```mermaid
flowchart TD
    subgraph Frontend["Frontend — Next.js 16 / React 19"]
        UI["UI Components\nIDE Shell · Editor · Explorer\nTerminal · Agents · PM · Git · Canvas"]
        Store["Zustand Store\n14 state slices"]
        IPCWrappers["Tauri IPC Wrappers\nlib/tauri/*"]
        UI <--> Store
        UI --> IPCWrappers
    end

    subgraph RustBackend["Rust Backend — Tauri v2"]
        Commands["IPC Command Handlers\nfs · git · terminal · agents · db · providers · crashlog"]
        AgentMgr["Agent Manager\nPTY lifecycle & stdout routing"]
        DbLayer["Database Layer\nSQLite schema · migrations · CRUD"]
        ProviderReg["Provider Registry\nClaude Code · Gemini CLI · custom"]
    end

    subgraph ExternalProcs["External Processes"]
        LLMAgents["LLM Agent Processes\nClaude Code / Gemini CLI subprocesses"]
        PTYShells["PTY Shell Processes\nbash · zsh · cmd"]
    end

    subgraph Storage["Persistent Storage"]
        SQLiteDB[("SQLite\n.auric/project.db\nepics · tickets · kv_store")]
        FileSystem[("File System\nProject files · .auric/ config")]
    end

    IPCWrappers -- "invoke(cmd, args)\n→ Tauri IPC bridge" --> Commands
    Commands -- "emit events\n(file-event, terminal-out-{id})" --> IPCWrappers

    Commands --> AgentMgr
    Commands --> DbLayer
    Commands --> ProviderReg

    AgentMgr -- "spawn subprocess" --> LLMAgents
    AgentMgr -- "spawn PTY" --> PTYShells
    ProviderReg -- "CLI discovery & config" --> LLMAgents

    LLMAgents -- "stdout/stderr → agent events" --> AgentMgr
    PTYShells -- "terminal output events" --> Commands

    DbLayer <--> SQLiteDB
    Commands <--> FileSystem
```

## Key Boundaries

| Boundary           | Technology                                 |
| ------------------ | ------------------------------------------ |
| Frontend ↔ Rust    | Tauri v2 IPC (`invoke` + event emitter)    |
| Rust ↔ LLM Agents  | OS subprocess with PTY (stdout/stderr)     |
| Rust ↔ Shells      | `portable-pty` cross-platform PTY          |
| Rust ↔ SQLite      | `rusqlite` via `.auric/project.db`         |
| Rust ↔ File System | `std::fs` + `notify` watcher (500 ms poll) |

## Data Flow Summary

1. **User action** → UI Component → Zustand Store update or IPC call
2. **IPC call** → Tauri bridge → Rust command handler
3. **File/Git ops** → File System read/write
4. **Agent spawn** → Provider Registry selects CLI → Agent Manager forks subprocess → stdout events stream back to Frontend via Tauri events
5. **PM data** → `pm_save` / `pm_load` commands → SQLite epics/tickets tables
6. **Terminal I/O** → `shell_write` command → PTY Shell → `terminal-out-{id}` event → TerminalPanel (xterm.js)
