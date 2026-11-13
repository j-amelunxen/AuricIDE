# Notifications and schedules

[Developer guide index](README.md) · [Documentation index](../README.md)

Trust, launch behavior, Command Center and unattended conductor runs. See also the [module specification](../spec/modules/notifications-schedules.md) and [scheduled-run design](../design-scheduled-conductor-runs.md).

## From a notification to a running agent

A scheduled reminder is meant to cost one click: it arrives, you press Start,
the agent is already configured and works. Everything below exists to keep that
one click honest.

- **A banner is raised where the notification actually arrives.** A schedule
  fires in Rust, so `dispatchNotification` never sees it — only
  `drainNotifications` does, and that is where `osBannerForBatch` speaks. A
  reminder earns a banner despite being `info`: a reminder that only reaches
  someone already looking at the inbox has reminded nobody. `reloadNotifications`
  stays silent (it re-reads the whole table), and a batch becomes **one** counted
  banner, because a stack of them is a stack you dismiss unread.
- **Who wrote the payload decides what the payload may decide.**
  `notificationTrust` (`notifications/trust.ts`) reads the _dispatcher_, never
  the content: `system` (schedules) and `ui` are the user's own words, `agent`
  and `mcp` are a running model's. Only a user-authored payload may name a
  permission mode or ask to skip the spawn dialog; from an agent both fall back
  to the last launch and the dialog. An agent can still offer a Start button —
  it just cannot decide how much authority the button hands out. The MCP
  vocabulary is narrower again and rejects those fields outright, so the rule
  holds at two layers.
- **`launch` is how much of a click the reminder still needs.** `direct` is
  Start without a form. `auto` is the arrival itself. Absent means dialog for
  a skill (every schedule saved before this existed) and a click-start for a
  custom agent. The app learning a new trick must never re-arm an old
  reminder. Conductor `auto` still waits for an unattended IDE because it may
  switch projects. Custom-agent and skill `auto` do not: they spawn in the
  named folder, leave the open project alone, and do not steal the terminal,
  even while you are typing. `headless` on those two is a choice the reminder
  owns; a trusted payload's value beats the last-launch default.
- **Started means visible — on a click.** The spawn selects the agent, so the
  terminal is showing the run the click began. An automatic start does not:
  you may already be looking at something else.
- **One definition of how a pinned skill becomes an agent.**
  `agents/skillLaunch.ts` resolves provider, model and permission mode for every
  direct launch — a combo step and a notification's Start button both. Two
  copies would let one skill run under different permissions depending on which
  button was pressed, and nothing at the button would show it.
- **The reminder owns its launch, the pin only seeds it.** The schedule form
  offers agent, model and permission for a skill action, starting from whatever
  the skill is pinned to in Quick Access — a skill that was merely discovered is
  pinned to nothing and would otherwise run on whichever harness the machine
  lists first, with that harness's default model. Once chosen, the values belong
  to the reminder: the "pinned skill has changed" check compares only label,
  prompt and invocation, and taking a drifted prompt over keeps the launch. A
  stale flag on a deliberate choice would offer a fix that discards it.
- **The launch defaults are read for the project the agent will run in.** They
  are stored per working directory; reading them without the path yields
  whatever was last launched outside any project, which is usually nothing.

### The tray and the Command Center — one inbox, two sizes

The sidebar panel is a **tray**, not the inbox: unanswered questions pinned on
top, then the newest `TRAY_SIZE` (3) rows, then "N more" and one "Next:
<schedule>" line — every one of those opens the **Command Center**
(`CommandCenter.tsx`), a full-area overlay beside the Agent Console with a
project rail, each project's triggers (schedules) and its notifications, and an
upcoming strip across all projects. Rules that keep the two honest:

- **Counts describe the scope, never the truncation.** The tray badge is the
  whole inbox's unread; a project section's count is that project's unread
  regardless of the read filter. Hidden rows are announced ("N more").
- **A question never rotates out.** `selectTray` (`notifications/tray.ts`) pins
  `ask` rows until they are answered — a fresh info must not push a waiting
  agent's question out of sight.
- **One action path.** Tray and center both go through `useNotificationActions`
  — trust by dispatcher, ask settled before the effect, conductor
  project-switch confirm, spawn selects the agent. A second copy would let the
  same button do different things depending on where it was pressed.
- **The center is a projection.** No new state: `commandCenter.ts` groups the
  store's notifications and schedules by project, links a notification to its
  schedule only through the `dedupeKey` (`scheduleIdFromDedupeKey`), never by
  the schedule's name.
- **Bulk actions are scoped where they are offered.** Per-project "Mark all
  read"/"Clear" pass the project path; clear still spares open questions.
- **Same overlay layer as the console.** `IDEOverlays` mounts the center before
  the Agent Console and the terminal — DOM order decides who paints on top; the
  schedule editor and confirms live on higher layers and own Esc first.

### Scheduled conductor runs — a launch nobody clicked, with a project switch

A schedule may carry a `run-conductor` action ("open project A, work up to five
tickets, one at a time"), and with `launch: 'auto'` the run starts when the
notification arrives. Custom-agent and skill `auto` also start on arrival, but
they never switch the open project. Conductor auto may, so it is fenced —
full reasoning in [docs/design-scheduled-conductor-runs.md](../design-scheduled-conductor-runs.md):

- **The conductor stays bound to the open project.** A run for another project
  has to open it, and opening closes every tab. The button says so ("Open
  project & start") and asks first; the automatic path may switch only when the
  IDE is unattended: no agent or conductor running, no dirty tab, no input for
  `UNATTENDED_AFTER_MS`. One predicate, `scheduledRunGate`
  (`src/lib/conductor/scheduledRun.ts`); a refusal leaves the button and says
  why in a toast, nothing is queued.
- **Only a fresh occurrence starts by itself.** The occurrence time is in the
  dedupe key; a catch-up row from a closed app is older than
  `AUTO_START_FRESHNESS_MS` and stays a button.
- **A running conductor is never restarted.** `launchScheduledConductor` is
  the one launcher for click and auto alike; while a run is active it answers
  `busy` rather than calling `startConductor` — which would reset the run's
  bookkeeping under its live agents.
- **The ticket budget counts distinct tickets spawned**, not finished; a retry
  is the same ticket. `maxConcurrent`/`requireReview` from a schedule are
  per-run and restored in `halt()`. Provider and model are the project's — a
  schedule does not carry them, so a scheduled Tuesday and a clicked Thursday
  run identically.
