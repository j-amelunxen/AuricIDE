# Notifications & Schedules

The Notifications & Schedules module provides a persistent cross-project notification bus, a background schedule engine (cron and one-shot timers), and secure payload trust boundaries in AuricIDE.

---

## 1. Purpose

Developers run multiple projects, background tasks, and scheduled workflows. This module ensures:

- **Centralized Inbox**: Cross-project notification storage in `<app_data_dir>/notifications.db`.
- **Reliable Schedule Runner**: A native Rust cron and one-shot timer thread that fires even when project windows are closed.
- **Safety Invariant**: Schedules only ever insert a notification row; they never spawn processes directly in background threads.
- **Payload Trust Architecture**: Strict distinction between human-authored templates and model-authored payloads to prevent permission escalation.

---

## 2. Boundaries

- **Conductor Run Logic**: Does not manage ticket selection or conductor state; triggers conductor runs via [Goals & Conductor Loop](./goals-conductor-loop.md) and [Scheduled Conductor Runs](../../design-scheduled-conductor-runs.md).
- **Skill Combo Execution**: Does not execute multi-step combo state chains; delegates to `skillComboSlice` as specified in [Scheduled Skill Combos](../../design-scheduled-skill-combo-notifications.md).

---

## 3. Public Contracts

### Notification Schema (`src/lib/notifications/types.ts`)

- `Notification`:
  - `id`: UUID string.
  - `source`: `'system'` (schedules) | `'ui'` | `'agent'` | `'mcp'`.
  - `kind`: `'info'` | `'ask'` | `'alert'`.
  - `repoPath`: Project path or null.
  - `actions`: Closed vocabulary of parsed actions (`answer`, `spawn-agent`, `run-skill`, `run-combo`, `run-conductor`, `open`, `command`).
  - `readAt`, `answeredAt`: Timestamps tracking user engagement.

### Payload Trust Boundary (`notificationTrust`)

- `source === 'system' || source === 'ui'` → `'user'` trust:
  - May configure autonomous permission modes (`bypassPermissions`).
  - May request `launch: 'direct'` (one-click start) or `launch: 'auto'` (gated zero-click).
- `source === 'agent' || source === 'mcp'` → `'foreign'` trust:
  - Model-authored payloads cannot dictate permission level or bypass the user spawn dialog.
  - Degrades automatically to interactive pre-filled dialogs.

### Schedule Data Model (`src/lib/tauri/schedules.ts`)

- `Schedule`:
  - `id`: UUID string.
  - `name`: Human-readable label.
  - `cron`: 5-field cron expression or null for one-shot.
  - `runAt`: Unix timestamp for one-shot timers.
  - `payload`: Template JSON for the notification to generate upon firing.
  - `enabled`: Boolean toggle.

### Tray vs Command Center (`selectTray`)

- **Sidebar Tray**:
  - Unanswered `ask` questions are pinned and never rotate out.
  - Displays the newest 3 ordinary rows (`TRAY_SIZE = 3`).
  - Explicitly announces truncated/hidden item counts (`hidden` and `hiddenUnread`).
- **Command Center**:
  - Full-screen overlay organizing triggers and inbox rows partitioned by project.

---

## 4. Key Flows

### 4.1 Background Schedule Firing

1. Rust background thread in `src-tauri/src/schedules.rs` checks due schedules every second.
2. When a schedule triggers:
   - Evaluates next cron occurrence or disables one-shot schedule.
   - Inserts notification into SQLite with `source = 'system'` and `origin = schedule.name`.
   - Emits system event to active frontend webview.

### 4.2 Inbox Ingestion & Native OS Banner

1. Frontend calls `drainNotifications` upon receiving the event.
2. `osBannerForBatch` displays a single aggregated macOS desktop notification banner (preventing notification spam storms).
3. If an action carries `launch: 'auto'`, it passes through safety gates (such as `scheduledRunGate`) before executing.

### 4.3 Interactive Notification Action Execution

1. User clicks an action button in the tray or Command Center.
2. `useNotificationActions` validates trust and checks for project mismatches.
3. If project switch is required, user confirmation is requested before closing active tabs.
4. Action delegates to the appropriate subsystem (`openSkillSpawnDialog`, `startSkillCombo`, or `startConductor`).

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite storage for `<app_data_dir>/notifications.db`, native notifications plugin, and background timer threads.
- **[Configuration & Credentials](./configuration-credentials.md)**: Resolution of project paths and provider defaults.

---

## 6. Relevant Source Paths

- `src-tauri/src/notifications.rs` — Cross-project notification database operations.
- `src-tauri/src/schedules.rs` — Cron evaluation and schedule runner thread.
- `src/lib/notifications/trust.ts` — Trust classification (`user` vs `foreign`).
- `src/lib/notifications/tray.ts` — Pure tray selection and pinning logic.
- `src/lib/notifications/commandCenter.ts` — Project grouping for the Command Center.
- `src/lib/store/notificationsSlice.ts` & `schedulesSlice.ts` — Zustand store slices.
