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

### 4.4 Agent Launch Requests and Grants

An agent calls MCP `request_agent_launch` (`src/mcp/tools/agentLaunch.ts`). The request lands as a foreign row (`source: 'agent'`, origin `request_agent_launch`, key prefix `agent-launch:`) with one `spawn-agent` button. It starts on a click, or on its own when Jennifer granted automatic starts for the goal's mission root in the goal panel (`MissionLaunchGrantSection`).

- **Grant rows.** `agent_launch_grants` (migration 7) in the app-global inbox database; every app instance reads the same rows. Save and revoke go through Tauri commands and return errors; the UI changes the switch only after the acknowledgement and follows changes from other instances (`notifications-changed`). A revoke stamps `revoked_at`, so a claim carrying an old grant id is refused. A revoke succeeds only for the grant id in force; a stale id (replaced from another instance, or already revoked) or an unknown one returns an error naming the grant really in force, and the UI shows the error next to the re-read state.
- **Claim.** `claim_launch_impl` takes only the request uid and the grant id. In one immediate transaction it checks: real, open launch request; grant row in force for the request's project; the goal is under the grant's root in `<project>/.auric/project.db` right now, every step of the chain an existing row, the root included (a deleted root authorises nothing, not even a request on itself); budget per grant; slot per root. Limits come from the row. Any other answer, or an error, means no spawn. Requests written before the grant start once it is given, capped by limit and budget.
- **Target folder.** The agent never names a path. The IDE passes each agent's own working directory as `AURIC_AGENT_CWD` into every MCP start path; a request runs there, or (`worktree: true`) in a new IDE worktree of the same repository (same git common dir). The native spawn re-checks the folder against the one stored with the request. The same rule holds for every other Start button an agent writes: `notify` and `schedule_create` stamp each `spawn-agent` action with the requesting agent's own folder and `placement: 'requester'` (`src/mcp/requesterFolder.ts`) and refuse any other `repoPath`; a schedule an agent created (id `mcp-…`) fires as an `agent` row. On click, an agent-written button never falls back to the open project, and the native spawn (`check_agent_notification_directory` in `agents/launch_dir.rs`) refuses any folder but the stamped one, and any agent-written button without the stamp. Reminders of such schedules that fired as `system` before this rule are marked `agent` by inbox migration 8; the trust check also reads the schedule id from the dedupe key (`schedule:mcp-…`), so a reminder an older build still fires as `system` is treated as agent-written too.
- **Retry.** Requests held back (slot taken, claim or grant read failed, goal outside the root) are tried again after `LAUNCH_RETRY_MS` without waiting for an unrelated event.
- **Changes from other processes** (`notifications/watch.rs`). The inbox announces `notifications-changed` from two signals: file events on its directory, and `PRAGMA data_version`, read every 500 ms on a connection of its own. The counter's starting point is read first, before the file watcher is installed, so no commit can fall between the two signals. File events alone are not enough: macOS reports a write to the WAL only when the writer closes the file, and a second instance and the MCP server keep their connections open. Both signals go through one coalescer (`coalesce.rs`, a queue of one event): the first change is announced at once, changes inside the next 300 ms are folded into one announcement at the window's end, never dropped. Grant reads that overlap are ordered: only the newest one sets the grants (`useScheduledConductorRuns`).
- **Run status** (`agents/launch_runs.rs`, `agent_launch_runs`). The backend alone sets it; the frontend adds the summary from the logs (`summaryOnly`, retried). `running` is recorded at the spawn, before the spawn returns, with the IDE process as owner (`owner_pid`, inbox migration 9); a start that cannot be recorded is ended and the spawn fails. `completed`/`failed` at the exit, `killed` on kill or discard. Every transition is bound to the run's owner: a verdict is final, a late write of the owner only fills in missing name, provider and model, and an `interrupted` run (nobody alive owns it) is taken over by the next `running` or verdict, which is how a resume continues it. Only the verdict that counts frees the slot. Whatever write gets lost, the next start of any instance marks runs of a dead owner `interrupted` (`reconcile_orphaned_launch_runs_impl`); a run is never left `running` without a live process behind it. The restart anchor (`active-agents.json`) is written atomically, and a change is saved before it becomes the in-memory state, so a failed save keeps the anchor in both; it is released after the verdict is stored, with retries; a discard records `killed` before it lets go, and a discard that could not record or save keeps the agent listed. At the next start, left-behind agents whose run already has its verdict leave the resume list at once, even while the file cannot be rewritten (it follows with the next save that works), and a resume of an agent whose run has its verdict, or whose run cannot be read, is refused. A resume keeps reporting to the request while it still exists and moves the goal run the old agent left running to the new one; a discard closes it as killed. A stop that reaches the store before the spawn or resume call has returned is kept while any such call is pending, with no cap, and replayed once the agent is registered.
- **Threat model** (decision Jennifer 2026-09-26, notes `2026-09-26-09-bedrohungsmodell-und-verzeichnis.md` and `2026-09-26-09-verzeichnis-regel-worktrees.md` in the goal-native mission). In scope: races, several app instances on one inbox file, failed writes, requests forged through MCP or `notify`, injected input. Out of scope, on purpose and tracked as its own topic: a started agent with shell access that writes to the SQLite files or app prefs directly (`AURIC_NOTIFICATIONS_DB` is in its environment). The same exclusion covers a shell agent that starts its own MCP server process with a forged environment, for example a second `auric-pm` process with `AURIC_AGENT_CWD` pointing at another existing repository (review r3, blocker 1; decision in `2026-09-26-09-antwort-nach-r3.md`): the folder is only as trustworthy as the environment the IDE set for the process it started.

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
