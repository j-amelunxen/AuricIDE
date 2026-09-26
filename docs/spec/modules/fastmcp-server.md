# FastMCP Server

The FastMCP Server module exposes AuricIDE project data, ticket tracking, goal hierarchies, canvas documents, and notification dispatching to external AI agent tools via the Model Context Protocol (MCP).

---

## 1. Purpose

AI agents working in AuricIDE require programmatic, structured access to project context and project management artifacts. The FastMCP Server provides:

- A standardized JSON-RPC stdio interface conforming to the Model Context Protocol.
- 15 distinct tool domains providing complete CRUD and workflow operations.
- Direct read/write access to project SQLite (`.auric/project.db`) and the global notification bus (`notifications.db`).

---

## 2. Boundaries

- **Process Supervision**: Does not launch itself; the subprocess lifecycle is managed by [Tauri Backend Core](./tauri-backend-core.md).
- **Notification Action Execution**: Can dispatch notifications to the inbox, but cannot directly execute autonomous actions or bypass permission dialogs; see [Notifications & Schedules](./notifications-schedules.md).
- **Editor NLP / Highlighting**: Does not interact with editor text buffers; see [Semantic Highlighting](../../semantic-markdown-highlighting.md).

---

## 3. Public Contracts

### MCP Transport & Process Interface

- **Transport**: `stdio` JSON-RPC.
- **Entry point**: `src/mcp/server.ts <path-to-project.db>`.
- **Environment Configuration**:
  - `AURIC_PROJECT_ROOT`: Absolute path to workspace repository root.
  - `AURIC_NOTIFICATIONS_DB`: Path to `<app_data_dir>/notifications.db` (omitting this safely disables notification tools).

### 16 Tool Domains (`src/mcp/tools/`)

| Domain            | Key Tools                                                                                              | Data Source                |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| **epics**         | `list_epics`, `get_epic`, `create_epic`, `update_epic`, `delete_epic`                                  | SQLite `pm_epics`          |
| **tickets**       | `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `delete_ticket`, `link_ticket_to_goal` | SQLite `pm_tickets`        |
| **tasks**         | `list_tasks`, `create_task`, `update_task`, `delete_task`                                              | SQLite `pm_tasks`          |
| **dependencies**  | `list_dependencies`, `add_dependency`, `remove_dependency`, `fetch_next_unblocked_task`                | SQLite `pm_dependencies`   |
| **testcases**     | `list_testcases`, `create_testcase`, `update_testcase`, `delete_testcase`                              | SQLite `pm_test_cases`     |
| **history**       | `get_ticket_history`, `get_project_summary`                                                            | SQLite PM tables           |
| **blueprints**    | `list_blueprints`, `get_blueprint`, `save_blueprint`                                                   | SQLite `pm_blueprints`     |
| **context**       | `get_file_context`, `search_project_context`                                                           | Project filesystem & DB    |
| **canvas**        | `list_canvases`, `read_canvas`, `write_canvas`                                                         | Project `.canvas` files    |
| **requirements**  | `list_requirements`, `get_requirement`, `create_requirement`, `verify_requirement`                     | SQLite `pm_requirements`   |
| **goals**         | `list_goals`, `get_goal`, `create_goal`, `evaluate_goal`, `decompose_goal`                             | SQLite `pm_goals`          |
| **stations**      | `list_stations`, `create_station`, `advance_station`, `verify_station`                                 | SQLite `pm_goal_stations`  |
| **knowledge**     | `query_knowledge_graph`, `index_knowledge`                                                             | Project markdown notes     |
| **reviews**       | `record_ticket_review`, `get_latest_review`                                                            | SQLite `pm_ticket_reviews` |
| **notifications** | `notify`, `notify_ask`, `schedule_create`                                                              | Global `notifications.db`  |
| **agentLaunch**   | `request_agent_launch`, `list_agent_providers`, `get_agent_run`                                        | `notifications.db` + PM DB |

---

## 4. Key Flows

### 4.1 Server Initialization

1. Rust backend (`src-tauri/src/mcp.rs`) forks a Node subprocess running `src/mcp/server.ts` with arguments pointing to `<project>/.auric/project.db`.
2. `server.ts` connects via `better-sqlite3`.
3. Checks `AURIC_NOTIFICATIONS_DB`:
   - If present, attaches `registerNotificationTools`.
   - If absent, logs a warning and proceeds without notification tools (failing cleanly rather than writing to void).
4. Connects stdio streams to `FastMCP` engine.

### 4.2 Autonomous Ticket Resolution Flow

1. An agent queries `fetch_next_unblocked_task` to find priority-sorted executable work.
2. The agent reads linked requirements (`list_requirements`) and goal context (`get_goal`).
3. Upon completing code changes, the agent records tests (`create_testcase`), updates ticket status to `implemented` or `done`, and marks station evidence (`advance_station`).

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite schema migrations, MCP child process spawning, and project DB path provisioning.
- **[Goals & Conductor Loop](./goals-conductor-loop.md)**: Shared database tables and goal satisfaction semantics (`evaluate_goal` mirrors `getGoalSatisfaction`).
- **[Notifications & Schedules](./notifications-schedules.md)**: Cross-project inbox database access.

---

## 6. Relevant Source Paths

- `src/mcp/server.ts` — FastMCP server entry point and tool registry.
- `src/mcp/db.ts` — Database connection wrapper (`better-sqlite3`).
- `src/mcp/notificationsDb.ts` — Notifications database connection.
- `src/mcp/tools/` — Tool implementations across 16 domains.
- `src/mcp/tools/agentLaunch.ts` — Launch requests: an agent asks the IDE to start an agent for a goal. The row is agent-written (foreign); it starts on a click, or on its own only under a launch grant Jennifer set for the mission root in the UI. Grants are rows in the app-global inbox database (`agent_launch_grants`, notifications migration 7), written only through the IDE's Tauri commands; no MCP tool reads or writes them. The target folder is never chosen by the agent: the IDE passes each agent's own working directory as `AURIC_AGENT_CWD` in every MCP start path (standard config, Codex override, Crush config); the request runs there, or with `worktree: true` in a new IDE worktree of the same repository (same git common dir). The spawn re-checks that folder against the one stored with the request. `notify` and `schedule_create` place every `spawn-agent` button in the same folder (`src/mcp/requesterFolder.ts`); a button naming another folder is refused, and a button without `AURIC_AGENT_CWD` is not written. Provider is checked against `AURIC_AGENT_PROVIDERS` (only providers that support an isolated MCP project binding) and the project policy; `get_agent_run` reads `agent_launch_runs` (notifications migration 5). See [Notifications & Schedules](./notifications-schedules.md#44-agent-launch-requests-and-grants) for the threat model.
- `src-tauri/src/mcp.rs` — Backend process supervisor starting and stopping the server.
- `docs/automation-surface.md` — Machine-generated catalog of all exposed MCP tools and IPC commands.
