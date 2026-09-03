# GTD Inbox

The GTD Inbox module provides a quick-capture task intake mechanism in AuricIDE that operates across workspaces and converts unstructured thoughts into project-specific tickets.

---

## 1. Purpose

Developers encounter ideas, bugs, and tasks before deciding which project they belong to. The GTD Inbox provides:

- **Global Rapid Capture**: Immediate task entry without requiring an active project or open repository.
- **Machine-Level Storage**: Stored globally in `<app_data_dir>/inbox.db`.
- **Project Assignment**: Converts captured thoughts into real, durable tickets inside the chosen target project's `.auric/project.db`.
- **Cross-Project PM Overview**: Aggregates ticket and milestone statuses across multiple recent repositories.

---

## 2. Boundaries

- **Project Ticket Storage**: Does not store project tickets; it writes them into `<project>/.auric/project.db` upon assignment. See [Goals & Conductor Loop](./goals-conductor-loop.md).
- **Notifications Bus**: Does not dispatch user notifications or alarms; see [Notifications & Schedules](./notifications-schedules.md).

---

## 3. Public Contracts

### Data Model (`src-tauri/src/inbox.rs`)

- `InboxItem`:
  - `id`: UUID string.
  - `title`: Short task description.
  - `notes`: Detailed markdown text.
  - `project_path`: Target workspace path once assigned (or null).
  - `ticket_id`: Target ticket UUID in project database (or null).
  - `priority`: `'low'` | `'normal'` | `'high'` | `'critical'`.
  - `due_date`: ISO timestamp or null.
  - `attachments`: File attachments stored in `<app_data_dir>/inbox_attachments/`.
  - `assigned_at`, `dismissed_at`: Lifecycle timestamps.

### Rust IPC Commands

- `inbox_list(filter: InboxFilter) -> Result<Vec<InboxItem>, String>`: Lists inbox items (all, pending, assigned, dismissed).
- `inbox_create(item: CreateInboxItemInput) -> Result<InboxItem, String>`: Fast-captures a new item.
- `inbox_update(item: UpdateInboxItemInput) -> Result<InboxItem, String>`: Updates title, notes, priority, or due date.
- `inbox_assign(inbox_id: String, project_path: String, epic_id: String, goal_id: Option<String>) -> Result<InboxAssignResult, String>`: Writes ticket to project DB, then links it in `inbox.db`.
- `inbox_dismiss(id: String) -> Result<(), String>`: Archives an item without ticket creation.
- `inbox_pm_overview() -> Result<Vec<ProjectPmOverview>, String>`: Read-only cross-project PM statistics.

---

## 4. Key Flows

### 4.1 Fast Capture

1. User presses the global capture shortcut or opens the Inbox panel.
2. Enters task title and optional notes.
3. Record is written immediately to `<app_data_dir>/inbox.db` (unassigned).

### 4.2 Project Assignment

1. User reviews pending items in the Inbox triage view.
2. Selects a target project, epic, and optional goal.
3. Backend executes `assign_impl`:
   - Connects to `<project>/.auric/project.db`.
   - Inserts a new `pm_tickets` row with title and notes from the inbox item.
   - Updates `inbox.db` linking `ticket_id` and setting `assigned_at`.
   - The durable record of work now lives in the project database; the inbox row serves as a permanent reference.

### 4.3 Cross-Project Overview

1. `inbox_pm_overview` iterates through starred and recent projects (`recent_projects.rs`).
2. Opens each `<project>/.auric/project.db` in read-only WAL mode.
3. Returns open tickets, completed milestones, and pending conductor runs without initiating schema migrations.

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite storage in `<app_data_dir>/inbox.db` and attachment file storage.
- **[Goals & Conductor Loop](./goals-conductor-loop.md)**: Target ticket and epic tables in the project SQLite database.

---

## 6. Relevant Source Paths

- `src-tauri/src/inbox.rs` — Backend database schema, assignment logic, and cross-project PM reader.
- `src/lib/inbox/` — Frontend helpers and ticket conversion logic.
- `src/lib/store/inboxSlice.ts` — Zustand store slice for inbox state.
- `src/app/components/inbox/` — Inbox UI and assignment dialogs.
