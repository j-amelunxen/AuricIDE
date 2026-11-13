# Supervisors and project managers

[Developer guide index](README.md) · [Documentation index](../README.md)

Supervisor admission, policy, tools, run identity and persistent manager memory. See also [supervisor scope](../adr/0004-supervisor-agent-scope.md) and the [control contract](../design-agent-control.md).

## The supervisor — the one agent the socket answers

A supervisor (Quick Access tile "Supervisor", or an external
`spawn { role: "supervisor" }`) is an interactive Claude agent that starts
agents in other projects through `auric-mcp --supervisor`. The contract is the
"Supervisor scope" section of [docs/design-agent-control.md](../design-agent-control.md), the reasoning
ADR 0004.

- **Identity comes from the kernel, not from a token.** The PID walk returns
  the matched agent and its role; a supervisor is admitted with its own scope,
  a worker still gets `forbidden_agent_caller`. A walk that cannot finish
  (unreadable parent, a loop) is refused too, never treated as external.
- **A clean report and explicit questions.** `read_agent_report` gives a
  child's last finished turn as text, also while it runs, from the CLI's transcript
  (Claude always; Codex where it printed its session id; `available: false` with a
  reason otherwise, never console text). A child raises a question with
  `ask_supervisor`; `await_agent_result` delivers each one once per `sinceQuestion`
  cursor, and a typed notice tells a supervisor that is not waiting. Contract:
  [docs/design-agent-control.md](../design-agent-control.md) ("`read_report`", "Questions"); proofs:
  `AgentReport.lean`, `AgentQuestions.lean`.
- **Its scope is its own children.** List, read, await, kill and type into
  only what it spawned. `await_result` with `untilInput` wakes it when a child
  waits on a question (`awaitingInput.fixtures.json`, shared with the attention
  model); the launch prompt says which questions it answers itself and which go
  to the human, whose answer it then types in (ADR 0004, amendment
  2026-10-17). Children keep running when the supervisor is killed; their
  results (`agents/run_results.rs`) stay until its card is cleared.
- **The supervisor itself has a shell for timers and approved skills or tools.** Rust
  forces its launch: a fresh cwd `~/.auric/supervisors/<start time>/`, file
  tools + `Skill` under `--restricted` (they reach only that folder), one MCP
  server, `--permission-mode dontAsk` (unlisted is refused, never asked).
  Settings → Supervisor → Skills approves skill folders and the `Bash(...)`
  patterns each may run; Rust links them into a per-run `--plugin-dir` under
  `<app_data_dir>/supervisor-skills/`, and the timer grant `Bash(sleep *)` is always present; other shell commands
  need an approved pattern; a skill's `dirs` become `--add-dir`. Settings → Supervisor
  → Tools approves single CLI tools, by name or absolute path, each as
  `Bash(<tool>)` and `Bash(<tool> *)` (`policy.tools`, `apply_tool_grants`). Claude in
  Chrome is the `supervisor.chrome` switch (`--chrome`, else explicitly `--no-chrome`).
- **PM tools come through one door, not a server per project.** `pm_tools` and
  `pm_call` (`src/mcp/supervisorPm.ts`) replace the 27 × 78 tool names and 27 Node
  processes a start used to carry. Each call first asks Rust (`pm_target`,
  `supervisor/pm_target.rs`), which reads the current policy: a revoked project is
  refused at once even with its child still cached, and a name two projects share is
  refused with both paths, never guessed. An old name `auric-pm-<folder>` (fixture
  `pmServerNames`, Rust only now) still means that project. The child is the unchanged
  `--project-root` server, started on first use, at most 8 at once, environment via
  `AURIC_PM_CHILD_ENV` with no `AURIC_AGENT_CWD`, so spawning stays with the policy.
  `PmScope.lean` proves the order over every trace of policy changes and calls;
  Rust and TypeScript replay its corpus. Agents inside a project keep `auric-pm`.
- **An earlier run can be resumed.** The run folders are browsable in the
  rail (Supervisor Runs, `SupervisorRunsPanel`, most recently changed first,
  newest file on top) and the tile's right-click menu offers the last five.
  Resuming starts a new supervisor with `resumeRunDir`; Rust
  (`supervisor/runs.rs`, `resolve_run_dir`) accepts only one run folder itself
  after symlinks are resolved, never the root or anything below a run,
  because that folder is all its `--restricted` file tools reach. The launch
  prompt tells it to read the folder newest first, summarise where the run
  stopped and wait before starting agents. The old run's children are
  adopted: Rust rewrites their `spawnedByAgentId` (live, persisted, run
  results) to the new id and emits `supervisor-children-adopted`. A
  supervisor restored after an app restart resumes its own folder the same
  way. A run folder is live in one supervisor at most (`run_dir_in_use`).
- **Several run side by side.** Each has its own scope, run folder and limits
  (`max_running*` count per supervisor, so N supervisors may run N times as
  many children). A plain tile click opens the newest running one; a skill,
  a resume or "Start new Supervisor" always starts another. An optional
  `supervisorKey` (`^[a-z0-9][a-z0-9-]{0,47}$`, not `agent-<digits>` or `agent-<yyMMdd>-<digits>`, unique
  among live supervisors, kept in the run's `supervisor.json`) is the stable
  address external clients use, because the agent id changes on every resume.
  In the agent tabs a supervisor and its descendants form one group with one
  colour on the left edge (`supervisorFamilyColors`, `groupAgentTabs`); a
  marker still wins, Alt shows per-agent colours.
- **What it may start is `<app_data_dir>/supervisor-policy.json`**, Rust-owned,
  0600, fail closed: an unlisted project allows nothing. It is intersected with
  the project's provider policy, and a mode that runs unattended is refused
  (`permission_mode_unattended`). Twin: `src/lib/config/supervisorPolicy.ts` ↔
  `src-tauri/src/supervisor/policy.rs`, both on
  `supervisorPolicy.fixtures.json` — change the fixtures first. Settings →
  Supervisor edits it.
- **A provider that ran out of quota is blocked for a while, for supervisors.**
  `quota_blocks/` keeps blocks on a provider, a model family or a model in
  `<app_data_dir>/quota-blocks.json`. Written when any agent ends with a matching
  line in the last 8 KiB of its console (`agents/quota_detection.rs`, on the exit
  path, before the run result is booked), or by `set_quota_block` (socket and MCP).
  Only a supervisor's spawn is refused (`quota_blocked`,
  `check_child_config_with_blocks`); `list_projects` marks the model and
  `balancing.next` skips a provider with nothing left. The UI, the conductor,
  outside clients and link jobs do not consult blocks, and no screen shows them.
  `src/lib/config/quotaBlocks.ts` is the rule twin, fixture-tested only.
- **Load balancing per project is a hint, not a gate.** `providerWeights`
  (Settings → Supervisor, "Load-balancing share") becomes `balancing` in a
  supervisor's `list_projects`: target vs. actual share of agents started
  there in 7 days, and `next`, the provider that is behind. Spawns are never
  refused over it; a task that needs another provider's model may deviate.
  Beside each share sits an optional note (`providerNotes`, at most 300
  characters), the human's routing rule ("source changes only, no database
  access"). It reaches the supervisor as `providers[].note` and in the launch
  prompt, ranks above `next`, and is not enforced on a supervisor's spawns:
  Rust cannot judge a task. Link jobs pick their provider without a model, so they skip every
  provider with a note (`policy::job_providers`) and refuse with
  `provider_note_restricted` when all of them have one.
- **Your own words go into its prompt, not its policy.** Settings → Supervisor
  → Instructions is the app pref `auric.supervisor.instructions`
  (`readSupervisorInstructions`), added to the launch prompt after the built-in
  rules and before a skill's first task. It steers; it grants nothing, so it
  stays out of `supervisor-policy.json` and Rust never reads it. A running
  supervisor keeps the text it started with.
- **A child may get a worktree, and the supervisor cleans it up.**
  `spawn { worktree: true }` runs the child on its own branch and folder (the
  bridge also tells it to commit there). `remove_worktree` removes it only
  when it holds no uncommitted change and no unmerged commit; otherwise it
  answers `removed: false` and the work is handed to the human. The
  supervisor never merges and never forces; its prompt makes the cleanup its
  duty ([docs/design-agent-control.md](../design-agent-control.md), "Worktrees").
- **Model size is a `rank`** on `info.models` entries in
  `dynamic-providers/*.json` (higher is bigger), next to optional `useFor`
  (one sentence) and `relativeCost` (1 = the provider's cheapest). The launch
  prompt (`supervisorLaunchPrompt.ts`) picks by the kind of task: rank 1
  lookups, rank 2 the default (browser, reading, normal coding), rank 3
  architecture or tricky debugging, rank 4 only with a reason. Rust enforces
  the part that matters: a spawn without `model` gets the smallest ranked
  allowed one (`policy::smallest_ranked_model`, shared with link jobs; unranked
  models are never picked), and a model of rank 3 or more without
  `modelReason` is refused (`model_reason_required`). Fixture
  `modelChoice` in `supervisorPolicy.fixtures.json`; every spawn that goes
  ahead lands in `<app_data_dir>/supervisor-spawns.jsonl` with its reason.
- **A supervisor's `list_projects` is built to fit.** `project` narrows it to
  one entry (the prompt says to call it so before each spawn); models are ids
  per project (or `"all"`) plus one top-level `catalog`, and the MCP server
  sends compact JSON. Fifteen projects × six providers × ten models stay under
  16 KB; the old shape reached 64 KB and was cut off before `balancing`.
- **Its tile is a Quick Access tile.** Hover or hold opens a skill wheel,
  right-click lists its skills, "Quick Access Settings" edits them
  (`useLaunchWheel` is shared with project tiles). The skills are
  application-wide (`supervisorPresets.ts`, app pref
  `auric.supervisor.quick-access`) and are prompts; a `/skill` call works only
  for a skill approved in Settings → Supervisor, because `--restricted` loads
  no skills from disk otherwise. A skill always becomes the first task of
  a new supervisor, never a message to a running one. Model is the only
  launch option; there are no combos.
- **It also lives in the macOS menu bar.** Settings → Supervisor → Menu bar
  switches on an icon (`menu_bar.rs`) listing the same skills as the tile's
  right-click menu, and global shortcuts per pinned skill (recorded under the
  skill's Launch options, field `shortcut`). The frontend sends the finished
  list through `menu_bar_sync` (`useSupervisorMenuBar`, main window only);
  Rust draws, registers and emits `menu-bar-launch` back, which runs the
  tile's own path (`openSupervisor`). "Start Supervisor" always starts a new
  one (`{newSupervisor}`), "Open Supervisor (N)" appears while N run
  (`running` is a count). Both switches are off by default.
- **Wheels offer the Settings → Skills library too**, as the right-click menu
  does. Putting a library skill on a slot pins it under its `auric:<id>`
  (`pinSlottedLibrarySkills`) — for project tiles inside
  `setStarredProjectWheelSlots`, so no caller can forget it.
- Real-app check: `node scripts/probe-supervisor.mjs`.

## Project Managers — supervisors with a name and a memory

A supervisor run the human chose to keep: "Promote to Project Manager…" on a
row of the Supervisor Runs rail gives it a name, a pinned place in the rail,
a Quick Access tile, a menu-bar entry, an `INSTRUCTIONS.md` and an organised
memory in its folder. Underneath it is still a supervisor: same scope, same
policy, same socket. The contract is
`src/lib/agents/supervisorManagers.fixtures.json` (read
by Rust and TS — change it first). In code it is **manager**
(`supervisor/managers.rs`, `supervisorManagers.ts`, `managerKey`), never `pm`
or `ProjectManager*`: both already mean the tickets.

- **The registry is the truth, not the folder.**
  `<app_data_dir>/supervisor-managers.json`, Rust-owned, 0600, temp file +
  rename. The manager's own file tools reach its whole run folder,
  `supervisor.json` included, so identity cannot live there; Rust writes the
  key into `supervisor.json` on each launch and never reads it back for a
  manager. `runDir` is a folder name, resolved under the runs root with
  `resolve_run_dir` on every use. An unreadable or unknown-version registry is
  never overwritten: the UI shows the error and offers no promote, rename or
  archive until it is fixed, and a launch that needs it is refused.
- **The key is the identity and never moves.** Promotion keeps the run's live
  key, else the one in its `supervisor.json`, else `keyFromName` (fixture
  `promotionKey`). Rename changes `name` only; the key stays reserved through
  archive. Names are unique ignoring case among non-archived managers, because
  the menu bar lists them by name.
- **Rust binds folder and key at launch** (`several::manager_launch`, inside
  `admit_supervisor`, fixture `launchKey`). Resuming a manager folder runs
  under its key, another key there is `manager_key_mismatch`, the key on a
  foreign folder is `manager_key_foreign_folder`, an archived manager is
  `manager_archived`. A **new** supervisor under a manager's key becomes a
  resume of its folder, which is what makes
  `supervisors.spawn { key, if: "existing" }` answer the live manager or a
  resumed one, never a stranger under its name. One live instance per manager
  is the existing `run_dir_in_use` / `supervisor_key_in_use`. Open is the one
  verb on every surface: bring a live one forward, else resume the folder.
  A manager promoted while it runs keeps its process and prompt and becomes
  one from its next start ("Restart Now" in the inspector).
- **`INSTRUCTIONS.md` steers, it grants nothing.** The frontend reads it
  through `manager_instructions` (16 KiB at most, larger refuses the launch
  with `instructions_too_large`) and `buildSupervisorLaunchPrompt` adds it
  after the global instructions; no spawn check or policy ever reads it. The
  launch books `lastLaunch.instructionsSha256`; the inspector compares it with
  the file and offers Restart rather than letting an edit look live. For
  Claude, `supervisor_claude_arguments` adds
  `--disallowedTools "Edit(./INSTRUCTIONS.md)" "Write(./INSTRUCTIONS.md)"` on
  manager launches only (a plain supervisor's arguments are byte-identical to
  before). The prompt rule alone is not evidence; the ignored test below runs
  the real CLI in its TUI with those exact arguments.
- **Memory is an OKF bundle in `knowledge/`, plain files.** The manager writes
  concepts with its own file tools; it gets no `okf mcp` server and no `okf`
  grant. Rust checks it after every manager session ends (`memory::start`,
  subscribed to run-result session ends) and on demand
  (`manager_validate`): our **layout check** always (front matter, required
  fields, type per section, dangling `superseded_by`, section index; okf
  reports neither of the first two), **`okf validate --json`** only when okf is
  on the machine, 10 s bounded. The result is
  `<app_data_dir>/managers/<key>/validation.json`; at most 20 findings go into
  the next start prompt under "Memory check". Deprecate, never delete: the one
  rule the prompt repeats, because only `superseded_by` kept stale facts out.
- **okf is a machine dependency, never pinned.** `src-tauri/src/machine/` is
  the seam video import and managers share: a declared table (`ffmpeg`,
  `ffprobe`, `go`, `okf`), resolution through the login shell's PATH plus extra
  folders (`~/go/bin`, where `go install` lands and PATH usually does not
  reach), a version cache keyed by path + mtime, and "Check Again" re-harvesting
  the login-shell env (`refresh_login_shell_env`). Settings → Machine
  (`machine_dependencies`) lists every row with its fix command. Nothing is
  said at app start; one inbox note only when okf worked and then broke
  (`machine:okf:<state>`). Without okf a manager works as before and loses
  only the okf half of the check.
- **The working loop: Ask, hear back, see where it stands.** "Ask <name>…"
  hands a manager work: a running one gets it as one message
  (`sendAgentInput`), a stopped one is resumed with it as the first task.
  In the runs rail an unfolded manager carries the same Ask inline
  (`ManagerAskComposer`, sent through `useAskManager().send`, the path the
  sheet uses), and the most recent manager unfolds on first show.
  `openManager` serialises per key, so every door (tile, rail, menu bar,
  notification, Ask) ends in one start and no task is dropped. A schedule
  action `open-manager` does the same on a timer, trust and freshness as
  `run-skill`; MCP `notify` rejects it. Automatic delivery sends with
  `automatic: true` and Rust refuses it while the human has unsent text in
  that terminal (`human_drafting`): the notification then stays a button.
  Every ended session drops one inbox note with the manager's own newest
  session concept (`lastSession`, decided by file time, never by
  `generated.at`); quit, crash and power loss are caught up on the next start
  through the registry's `session { startedAt, notedAt }`.
  `manager_create` makes a manager without an earlier run. Fixture blocks
  `ask`, `openManagerAction`, `sessionEnd`, `lastSession`, `create`,
  `runMissing`, `presentation`.
- **Presentation is an app pref, identity is Rust's.**
  `auric.supervisor.managers` (Quick Access, menu bar, shortcut) is keyed by
  manager key; a key the registry no longer has is ignored.
- Real-app checks: `node scripts/probe-project-manager.mjs --app-data <dir>
--project <path> [--argv-log <dir>]` against an **isolated** instance (it
  promotes, archives and removes in that registry; the recipe is in its
  header), and
  `cargo test --lib manager_deny_rule_holds_in_the_interactive_tui -- --ignored --nocapture`
  (`AURIC_DENY_CONTROL=1` runs it without the rules and expects the edit to
  land).
