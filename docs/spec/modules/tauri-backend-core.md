# Tauri Backend Core

The Tauri Backend Core module forms the native foundation of AuricIDE, providing the IPC bridge between Next.js and Rust, terminal PTY processes, SQLite persistence, native menu integration, and file system monitoring.

---

## 1. Purpose

AuricIDE is a desktop application running on macOS. The Tauri Backend Core provides:

- **Tauri v2 IPC Bridge**: Type-safe command invocation (`invoke.ts`) and bidirectional event streaming.
- **PTY Terminal Shells**: Interactive terminal sessions (`portable-pty`) for developer shells.
- **SQLite Database Layer**: Embedded database schema migrations, transactions, and PM storage (`.auric/project.db`).
- **File System Watching**: Native recursive change detection with debounced event emissions.
- **Workspace Services**: Project discovery, icon ranking, skill discovery, and crash reporting.

---

## 2. Boundaries

- **Git Version Control**: Delegates Git operations to [Git Multi-Repo](./git-multirepo.md).
- **Agent Subprocesses**: Delegates AI agent execution and terminal chunk reassembly to [Agent Fleet](./agent-fleet.md).
- **Cross-Project Notifications**: Storage and background scheduling are managed by [Notifications & Schedules](./notifications-schedules.md).

---

## 3. Public Contracts

### Frontend IPC Helper (`src/lib/tauri/invoke.ts`)

- `invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>`:
  - Dynamically imports `@tauri-apps/api/core`.
  - Normalizes bundler differences via `resolveTauriInvoke` (`mod.invoke ?? mod.default?.invoke`).
  - Throws explicit descriptive error `Tauri IPC is unavailable (<cmd>)` in non-Tauri browser environments.

### Core Rust Commands (`src-tauri/src/lib.rs`)

- **Terminal Shells**:
  - `shell_spawn(cwd: Option<String>, shell: Option<String>) -> Result<String, String>`: Allocates a new PTY session.
  - `shell_write(id: String, data: String) -> Result<(), String>`: Writes stdin characters to the PTY.
  - `shell_resize(id: String, cols: u16, rows: u16) -> Result<(), String>`: Adjusts terminal viewport dimensions.
  - `shell_kill(id: String) -> Result<(), String>`: Terminates the shell process.
- **Project Database**:
  - `init_project_db(path: String) -> Result<(), String>`: Opens `<project>/.auric/project.db` and runs schema migrations.
  - `close_project_db(path: String) -> Result<(), String>`: Flushes SQLite WAL and closes open connection.
- **File System Watching**:
  - `watch_directory(path: String) -> Result<(), String>`: Attaches `notify` watcher; emits `file-event` on disk mutations.
  - `read_directory(path: String) -> Result<Vec<FileEntry>, String>`: Lists directory entries leveraging `recent_creations` caching.

---

## 4. Key Flows

### 4.1 Application Initialization & Crash Protection

1. `src-tauri/src/main.rs` starts the Tauri runtime.
2. `crashlog::setup_panic_hook()` installs a global panic handler capturing backtraces to `<app_data_dir>/crashlogs/`.
3. Native macOS application menus are built (`menu.rs`).
4. System memory reporting thread is spawned (`memory_report.rs`).

### 4.2 Terminal PTY Session

1. User opens a terminal tab in the IDE shell.
2. Frontend calls `shell_spawn(cwd)`.
3. Rust creates a `portable-pty` pair running user shell (`$SHELL` or `/bin/zsh`), spawning a reader thread.
4. Reader thread captures output chunks and emits `terminal-out-{id}` events to xterm.js in the frontend.
5. Frontend keyboard strokes call `shell_write(id, data)` directly into the PTY master.

### 4.3 SQLite Migrations & Project Database

1. When a user opens a folder, `init_project_db` checks for `.auric/project.db`.
2. Runs versioned schema migrations creating tables: `pm_epics`, `pm_tickets`, `pm_tasks`, `pm_dependencies`, `pm_test_cases`, `pm_goals`, `pm_requirements`, `pm_goal_stations`, `kv_store`.
3. WAL journal mode and busy timeouts are configured for concurrent access.

---

## 5. Dependencies

- **[Configuration & Credentials](./configuration-credentials.md)**: Reads machine credentials from `<app_data_dir>/app-credentials.json`.
- **[Agent Fleet](./agent-fleet.md)**: Agent processes share PTY shell infrastructure.
- **[FastMCP Server](./fastmcp-server.md)**: Spawns FastMCP subprocess pointing to the opened SQLite database.

---

## 6. Relevant Source Paths

- `src-tauri/src/lib.rs` — Main Tauri command registration and event loop.
- `src-tauri/src/database.rs` — SQLite connection lifecycle, migrations, and CRUD implementations.
- `src-tauri/src/recent_projects.rs` — Recents, pinned projects, and skills storage.
- `src-tauri/src/recent_creations.rs` — Directory birth-time tracking cache.
- `src-tauri/src/project_icons.rs` & `project_skills.rs` — Project icon heuristics and skill discovery.
- `src-tauri/src/crashlog.rs` — Rust panic hook and diagnostic logging.
- `src/lib/tauri/invoke.ts` — Unified lazy IPC caller.
