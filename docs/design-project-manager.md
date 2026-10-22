# Project Managers: supervisors with a name and a memory

Status: design approved 2026-10-22; slice 0 (the contract) done, nothing
else built yet. The requirements come from a narrated recording plus three
decisions taken afterwards (listed under "Settled before this design"). The
machine-checkable half is `src/lib/agents/supervisorManagers.fixtures.json`.
**Change the fixtures first**, then this file and the code.

A supervisor run today is disposable. It starts in a fresh folder under
`~/.auric/supervisors/<start time>/`, writes some notes, and sinks down the
Supervisor Runs rail as newer runs appear. Resuming one works, but it reads
whatever the last run left lying around and has no idea what mattered.

A **Project Manager** is one of those runs that the human chose to keep. It
gets a name, stays at the top of the rail, has a tile in Quick Access and an
entry in the menu bar, carries its own standing instructions in a file, and
keeps an organised memory in its folder. Underneath it is still a supervisor:
same scope, same policy, same tools, same socket.

## Settled before this design

- **Entry point is the runs history, not Settings.** A run becomes a Project
  Manager through "Promote to Project Manager…" on its row in the Supervisor
  Runs rail.
- **Several projects.** A Project Manager is a supervisor with memory. It may
  work in every project the supervisor policy allows, like any supervisor.
- **The run folder stays.** The existing `~/.auric/supervisors/<run>/` becomes
  the Project Manager's permanent folder. Nothing in it moves; resume works as
  today.
- **Instructions are a file in that folder** (`INSTRUCTIONS.md`), editable in
  the IDE, readable by the Project Manager. It steers, it grants nothing.

## Naming in code

"PM" already means project management throughout the code base: `pmSlice`,
the `auric-pm` MCP server, `pm_server_names`, and `ProjectManagerModal.tsx`,
which is the tickets modal. Reusing either word for this feature would make
every grep ambiguous. So:

- The UI says **Project Manager**. Nothing in the UI uses that label today.
- The code says **manager**: `supervisor/managers.rs`, `SupervisorManager`,
  `supervisorManagers.ts`, `managerKey`. Never `pm` and never
  `ProjectManager*`.

## The model

```
<app_data_dir>/supervisor-managers.json     identity and lifecycle (Rust-owned, 0600)
<app_data_dir>/managers/<key>/validation.json  last memory check (Rust-owned)

~/.auric/supervisors/2026-10-21_090000/     the run folder, unchanged location
  supervisor.json      { "key": … } as today, written from the registry on each launch
  INSTRUCTIONS.md      the human's steering text; injected; the manager may not edit it
  knowledge/           OKF bundle the manager owns and keeps tidy
  …                    everything the run wrote before promotion, left where it is
```

### The registry is the truth, not the folder

The manager's own file tools reach its whole run folder (`--restricted` scopes
them to the cwd). Anything in that folder can be rewritten by the agent,
`supervisor.json` included. Identity therefore lives in
`<app_data_dir>/supervisor-managers.json`, owned by Rust like
`supervisor-policy.json`:

```json
{
  "version": 1,
  "managers": [
    {
      "key": "release-desk",
      "name": "Release Desk",
      "runDir": "2026-10-21_090000",
      "promotedAt": "2026-10-22T10:15:00Z",
      "archivedAt": null,
      "lastLaunch": { "at": "2026-10-22T10:16:02Z", "instructionsSha256": "9f2c…" }
    }
  ]
}
```

- **`key` is the identity.** It is a supervisor key (same grammar, fixture
  `supervisorKeys`), unique across the registry including archived entries.
  It never changes after promotion: external clients address supervisors by
  key, and a key that moves breaks them. A rename changes `name` only.
- **`runDir` is a folder name, not a path.** It is resolved under the runs
  root with `runs::resolve_run_dir` on every use, so a moved home directory
  still works and the file cannot point anywhere else.
- **Created at** is not stored: it is the run folder's start time.
- **`lastLaunch.instructionsSha256`** is what the last start injected. The
  inspector compares it with the file today and says "Instructions changed
  since this session started" with a Restart button, instead of letting the
  human believe an edit is already in effect.
- **Write path** is temp file + rename at 0600, as `write_policy_atomic`.
- **An unreadable or unknown-version file is never overwritten.** The UI shows
  the error and offers no promote/rename/archive until it is fixed. Writing an
  empty registry over a file we could not parse would forget every manager.

`supervisor.json` keeps its role for ordinary runs. For a manager folder Rust
writes the registry key into it on each launch and never reads it back.

### Promotion

`manager_promote { runDir, name }` in Rust:

1. Resolves `runDir` (`resolve_run_dir`); a missing folder is
   `manager_run_missing`.
2. Refuses a folder that already belongs to a manager (`manager_run_taken`).
3. Validates the name: 1 to 40 characters after trimming, no line breaks,
   unique among non-archived managers ignoring case (`manager_name_invalid`,
   `manager_name_taken`). The menu bar lists managers by name, so two with one
   name would be indistinguishable there.
4. Picks the key. The run's live supervisor key wins, else the key in its
   `supervisor.json`, else one derived from the name (`keyFromName`: fold to
   ASCII, lowercase, runs of anything else become `-`, trim dashes, cut to 48,
   append `-2`, `-3`, … when reserved or taken). A run that already has an
   address keeps it.
5. Writes `INSTRUCTIONS.md` from a short template **only if the file does not
   exist**, and creates `knowledge/` with its root `index.md` the same way.
6. Appends the record and returns it.

**A running supervisor stays as it is.** Its process, children and terminal do
not change. If it had no key, Rust sets the new key on the live agent (same
uniqueness check as `check_key`), so it is addressable at once. Its prompt does
not change: the manager rules and the instructions apply from its next start.
The inspector shows "Works as a Project Manager from its next start" with
**Restart Now**, which kills it and resumes the folder; children keep running
and are adopted by the new process as with any resume. Pasting the rules into a
live session was considered and rejected: it mixes a launch prompt into a
conversation, and the agent cannot tell which of its two instruction sets wins.

### Archive, restore, remove

- **Archive** sets `archivedAt`. The manager leaves Quick Access and the menu
  bar and moves to "Archived" at the bottom of the managers section. Folder,
  instructions and memory stay. A running one keeps running until stopped.
  The key stays reserved.
- **Restore** clears `archivedAt` (name uniqueness checked again).
- **Remove** exists only for archived managers. It deletes the record; the
  folder becomes an ordinary run again and sinks by age. Nothing on disk is
  deleted. There is no delete-folder action, as there is none for runs today.

## Lifecycle

**Open** is the one verb, from every surface (rail, tile, menu bar, shortcut,
Settings): if a supervisor works in the manager's folder, bring its terminal
forward; otherwise resume the folder. That is today's `resumeSupervisor` plus
the existing `run_dir_in_use` rule, so one live instance per manager is already
enforced in Rust (`admit_supervisor`, `several::recheck`) and pre-checked in
the store (`supervisorUsingRunDir`).

Rust makes the folder and the key one thing at launch (`admit_supervisor`):

| Launch                                                       | Result                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| Resume of a manager folder, no key given                     | key = the manager's key                                      |
| Resume of a manager folder, the manager's key                | as above                                                     |
| Resume of a manager folder, another key                      | refused, `manager_key_mismatch`                              |
| New supervisor with a manager's key, no resume               | becomes a resume of that manager's folder                    |
| Either, while the folder or key is held by a live supervisor | existing refusals: `run_dir_in_use`, `supervisor_key_in_use` |
| New supervisor with an archived manager's key                | refused, `manager_archived`                                  |

The fourth row is what makes a manager addressable from outside: a link client
calling `supervisors.spawn { key: "release-desk", if: "existing" }` gets the
live manager or a resumed one, never a stranger under its name.
`docs/design-supervisor-link.md` and `docs/design-agent-control.md`
("Several supervisors") gain one paragraph each.

**After an app restart** a manager comes back through `resume_interrupted_agent`
with its persisted launch, not a rebuilt prompt. If the instructions changed in
between, `lastLaunch.instructionsSha256` no longer matches and the inspector
offers Restart, as above. Rebuilding the prompt on restore was rejected: the
restored session continues a conversation, and swapping its system prompt
under it is the same mixing problem as live promotion.

**The card and tab** use the manager's name as the agent name instead of
"Supervisor". Family colour, adoption and run results work unchanged.

## Instructions

`INSTRUCTIONS.md` in the run folder, plain Markdown. On promotion it starts as:

```markdown
# Instructions for Release Desk

<!-- Standing instructions for this Project Manager. They are added to its
     start prompt every time it opens. They steer; they grant nothing: what it
     may start, where and with which model stays in Settings → Supervisor. -->

Examples:

- Write every ticket in Spanish.
- Halve the estimated hours on anything billed to the customer.
```

- **Injection.** `supervisorConfigFor` (`agentLifecycle.ts`), the single
  builder for every supervisor launch, asks Rust whether `resumeRunDir` is a
  manager folder. If it is, it reads the instructions through
  `manager_instructions(key)` and passes a `manager` block to
  `buildSupervisorLaunchPrompt`. Sections are added after the global
  "Instructions from the human", in this order:
  1. `## You are the Project Manager "<name>"` with the memory rules below,
  2. `## Instructions for <name>`: preamble + file content,
  3. `## Memory check`: only when the last validation found problems,
  4. `## Picking up where you left off`: replaces the generic "resumed run"
     text for managers (read the memory index first, not the newest files).
     Specific comes after general, so the manager's file wins over the global
     instructions where they differ. Both say they change nothing about what the
     tools allow.
- **Limit.** Rust reads at most 16 KiB (fixture `instructions.maxBytes`). A
  larger file refuses the launch with `instructions_too_large` and the size.
  Starting a manager without the instructions the human wrote would be wrong
  in a way nobody notices. A missing file is fine: no section.
- **It grants nothing.** The file is never read by Rust's spawn checks or the
  policy. It stays out of `supervisor-policy.json`, like
  `auric.supervisor.instructions`.
- **The manager may not edit it.** For Claude supervisors, Rust adds deny
  rules for `Edit` and `Write` on `INSTRUCTIONS.md` to the forced launch
  arguments (`supervisor_claude_arguments`, manager launches only); the prompt
  says the file belongs to the human. A provider without deny rules gets only
  the prompt rule, and the hash comparison above makes a change visible.
  Checked on Claude Code 2.1.308 with the supervisor's flags (`--restricted`,
  `dontAsk`, `Bash(sleep *)`): `--disallowedTools "Edit(./INSTRUCTIONS.md)"
"Write(./INSTRUCTIONS.md)"` refused an Edit by relative path, a Write by
  absolute path, a Write through `sub/../INSTRUCTIONS.md` and
  `sleep 1 && echo … > INSTRUCTIONS.md`; without the rules the same Edit
  went through. The rule matches the file name at any depth, so a
  `sub/INSTRUCTIONS.md` is refused too, which costs nothing here. Only print
  mode was run; the interactive TUI uses the same rules, and the ignored
  real-CLI test in slice 7 runs it that way.
- **Editing.** "Edit Instructions…" opens the file in an ordinary editor tab,
  the same path the runs rail already uses to open run files. No custom
  editor: the file is meant to be diffable and editable anywhere.

## Memory

### Why files plus `okf validate`, not `okf mcp`

The manager writes OKF concept files with its own file tools and Rust checks
them with `okf validate`. It does not get the `okf mcp` server.

- **The format is the value.** Markdown with front matter is readable,
  diffable and editable by the human. The spike confirmed `okf validate`
  accepts such a bundle and keeps extra fields.
- **The server is the cost.** It re-reads the whole bundle on every call:
  p90 270 ms at 5 000 concepts, growing linearly (Monday spike,
  `results/scale.json`).
- **A manager does not need a hot recall path.** It reads its memory at the
  start of a session and looks things up now and then, not on every turn.
  Glob and Grep over a few thousand Markdown files are fast and need nothing
  installed.
- **No new grant.** A second MCP server in a `--strict-mcp-config` launch is a
  policy surface and a process to supervise. Validation run by Rust needs
  neither.

Revisit if a manager passes about 2 000 concepts and Grep stops finding things.

### Layout

The bundle is `knowledge/` inside the run folder, not the folder root. The
root holds whatever the run wrote before promotion (transcripts, task lists,
reports). Making the root the bundle would turn every one of those into a
validation finding, or force moving them, which the "folder stays" decision
rules out. The manager may file old notes into the bundle over time; it copies
and links, it does not move the originals. (Open question 1.)

```
knowledge/
  index.md          okf_version, one line per section
  log.md            okf's change log: '## YYYY-MM-DD', then '* **Kind**: sentence'
  projects/         one concept per AuricIDE project it works in (type Project)
  decisions/        what was decided, by whom, why (type Decision)
  preferences/      how the human likes things done, learned (type Preference)
  people/           who is who, roles, not private details (type Person)
  facts/            anything else worth knowing later (type Fact)
  lessons/          what went wrong and what to do instead (type Lesson)
  sessions/         one concept per session: goal, outcome, open loops (type Session)
  <section>/index.md  one line per concept
```

Concept front matter, as `okf create` v0.7.0 writes it: `type`, `title`,
`description` (one sentence, the fact itself), `tags`, `generated { by, at }`,
`status` (`draft` | `stable` | `deprecated`), plus `superseded_by` and
`source` where they apply. The root `index.md` carries
`okf_version: "0.2"`; section `index.md` files have no front matter and one
`* [title](file.md) - description` line per concept. Promotion writes the
root `index.md` and `log.md` itself in the shape `okf init` produces, so it
needs no okf. All of this is in the fixture's `memory` block.

### The rules in the prompt

Draft of the section the launch prompt adds for a manager:

> You are a long-lived Project Manager. Your memory is `knowledge/`, an OKF
> bundle (see the layout above, restated in the prompt). Keep it as you go,
> not at the end: after a decision, an outcome, a correction from the human
> or a lesson, write or update one concept. One concept per file, the fact
> in `description`, details in the body. Never delete a concept that turned
> out wrong or outdated: set `status: deprecated` and `superseded_by` to its
> replacement, so an old fact cannot come back as current. Keep each section's
> `index.md` in step with its files. Add an entry to `log.md` for each change
> (a `## YYYY-MM-DD` heading per day, entries as `* **Kind**: sentence`).
> Write nothing about a person that the work does not need. Do not store
> secrets, keys or tokens. `INSTRUCTIONS.md` belongs to the human; read it,
> never change it. At the start of a session read `knowledge/index.md`, the
> section indexes and the newest session, then say in a few sentences where
> things stand and wait for the go-ahead before starting agents.

The deprecate-don't-delete rule comes straight from the spike: no search
tested there knew that newer wins; only the `superseded` marking kept stale
facts out, in 6 of 6 cases.

### Validation and what the IDE shows

Two checks with different owners:

- **Layout check (ours, always runs).** The summary walk already reads every
  concept's front matter. It also reports what breaks _our_ contract: a file
  in a section without front matter, a missing `type`/`title`/`description`/
  `status`, front matter that does not parse, a `type` that does not match
  its section, a `superseded_by` pointing at nothing, a concept missing from
  its section index. okf v0.7.0 reports neither broken front matter (a file
  with an unterminated quote passed as a concept) nor a dangling
  `superseded_by`, so this check is required, not a convenience. These rules come from the fixture's `memory` block,
  not from okf's spec, so there is nothing to drift from. It needs no tool
  and works on every machine.
- **okf check (theirs, when okf is there).** `okf validate` on the bundle,
  for everything the OKF spec says beyond our layout (links, orphans,
  `okf_version`). Run by Rust, never the agent, after each manager session
  ends (where run results are booked) and on demand from the inspector.
  How okf is found, versioned, parsed and reported is "Machine dependencies"
  below.

- **Bounded.** 10 s timeout for okf. The result of both checks is stored in
  `<app_data_dir>/managers/<key>/validation.json`.
- **Back to the manager.** Findings of both checks (at most 20 lines) go into
  the next start prompt under "Memory check", with the rule to fix them
  first. The manager needs no `okf` grant for this. A human who wants it to
  self-check can still approve `okf` under Settings → Supervisor → Tools, like
  any tool.
- **The summary.** `manager_memory(key)` returns concepts per type,
  deprecated count, newest change, the layout findings and the okf state
  (`ok`, `findings`, `missing`, `outdated`, `unrecognised`, `failed`,
  `never`).

## Machine dependencies

okf is the first tool a supervisor feature needs from the machine. Video
import already has three (`uv` with a Python, `ffmpeg`, `ffprobe`) and the
rules for them ("Depending on tools that come from the machine" in
`CLAUDE.md`): probe before running, resolve by absolute path through the
login shell's PATH, report each dependency as one line (requirement, found,
the one command that fixes it), and never let tool output become the
message. This section keeps those rules and settles what changes now that a
second feature needs them.

The standing rule stays as it is: **no pinned third-party runtimes.** We
check, we say what is missing and how to fix it, and we degrade honestly. We
do not ship okf and we do not take over its upgrades.

### One seam, not one per feature

`video_import/preflight.rs` mixes two things: a mechanism (the check shape,
`resolve_in_path`, the login-shell PATH, running a probe with a timeout,
version parsing) and video-specific checks (platform, `uv python find`, the
runtime folder). With okf, and `go` behind it, the mechanism has a second
user, so it moves into a shared module, `src-tauri/src/machine/`:

- **Mechanism**, shared: `Check` (today's `PreflightCheck`, unchanged on the
  wire), `resolve_executable`, `run_probe` with timeout and the login-shell
  env, `parse_version` with per-tool extractors, `meets_minimum`, and the
  cache below.
- **A declared table for simple tools**: tool name, how to read its version
  (arguments + extractor), minimum version, extra folders to look in, the
  fix command, and which features need it. `ffmpeg`, `ffprobe`, `okf` and
  `go` are rows. Adding the next tool is a row plus a captured `--version`
  sample.
- **Code for the checks that are not simple.** The platform check, `uv` +
  Python and the parakeet runtime folder stay functions in `video_import`;
  they use the mechanism and return the same `Check`.
  `video_import_preflight` keeps its shape, so the Video Import settings do
  not change.

Cost, honestly: one refactor of a tested module (its tests move along, its
`inspects_this_machine` test stays), one new module, and a contract test
that the video preflight answers byte-identically before and after. Keeping
okf's check local would be a copy of `resolve_executable`, the timeout runner
and the version parser in `supervisor/memory.rs`: small today, but every
further tool would copy it again, and `jscpd` would flag the second copy
anyway. The declared table is not a plugin system: no JSON, no user-editable
list, just a Rust slice next to the code that uses it.

### When it is checked

| Moment                              | Checked?      | Why                                                                                                                 |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| App start                           | No            | Most sessions never touch managers. A probe here costs start time and produces a state nobody asked about.          |
| Opening the runs rail or Settings   | Cached answer | Shows the state where it matters, at the cost of a map lookup.                                                      |
| Promote sheet                       | Cached answer | One quiet line if okf is missing, so the human is not surprised later.                                              |
| Before each manager launch          | Cached answer | The prompt says whether an okf check exists on this machine.                                                        |
| After a session (validation)        | Fresh resolve | This is where okf acts, so this is where the check must be true. A missing binary here is the authoritative answer. |
| "Check Again" (inspector, Settings) | Fresh, full   | The human just installed something.                                                                                 |

What a probe costs:

- **The login-shell environment** (`agents::cached_login_shell_env`) is an
  interactive `zsh -ilc` run, up to 8 s in the worst case, and is already
  harvested once per process for agent spawns. Probes reuse it; they never
  start their own shell.
- **Resolving** is a `stat` per PATH entry plus the extra folders: well under
  a millisecond. It is never cached; it runs every time.
- **The version probe** starts the tool once (`okf --version`, which prints
  `okf version v0.7.0 (OKF v0.2 specification)`), tens of milliseconds. It is cached by **(absolute path, file
  modification time)**: same binary, same answer; a reinstall or upgrade
  changes the mtime and the next check probes again.

So installing okf while the app runs is picked up by the next check without
anything special, **if it lands in a folder the harvested PATH already
holds**. The case that does not work today: the install also adds a new PATH
line to `.zshrc`. The env cache is a `OnceCell` and never refreshes. "Check
Again" therefore re-harvests the login-shell environment, which needs
`shell_env.rs` to offer an explicit `refresh_login_shell_env()` (an
`RwLock` instead of the `OnceCell`). Agents spawned afterwards get the new
environment too, which is the consistent outcome. Because this is a shared
foundation, the slice that changes it runs the full Rust suite, not only the
new tests.

`go install` puts binaries in `$GOBIN` or `$(go env GOPATH)/bin`, usually
`~/go/bin`, which is often **not** on PATH: the same trap `uv tool install`
set for parakeet. okf's table row therefore lists `~/go/bin` as an extra
folder, looked at after PATH. A binary found there is used by absolute path
and the check says "found outside PATH" in `found`, which is information,
not a failure.

### How the user finds out

The attention model applies: say it once, where the human acts, and say
nothing when nothing needs doing.

- **Nothing at app start.** No toast, no badge, no notification for a tool
  that was never there.
- **Promote sheet**: one secondary line when okf is missing. "Memory checks
  need okf, which is not installed. The Project Manager works without it."
  No button; the sheet is about naming.
- **Manager inspector**: one status line with the action next to it.
  "Memory check off: okf is not installed. [Copy Command] [Check Again]".
  Shown on each manager while the state lasts. It is a property of the
  machine shown where it has an effect, not an alert.
- **Settings → Machine**: one page listing every declared dependency, its
  state, which features need it, and the fix command. This is the answer to
  "how do environment checks work" for the human, and the place Video Import
  and managers both link to. Read-only apart from Check Again and Copy.
- **One inbox notification, only for a regression.** If okf worked on this
  machine and then a validation finds it missing, outdated or unreadable,
  one `info` notification goes out, deduped by
  `machine:okf:<state>`. A tool that broke is news; a tool that was never
  installed is not.
- **No status chip.** The status bar is for things that change minute to
  minute; this changes when someone installs something.

### What degrades

A manager without okf starts, runs, remembers and is shown exactly as with
it. What is lost is the okf half of validation only: spec-level findings
(links, orphans, bundle version). The layout check, the concept counts and
the "Memory check" prompt section from layout findings all keep working.

The launch prompt says so in one sentence, because an agent that believes a
checker is watching writes differently from one that knows none is: "No
okf check runs on this machine; only the layout rules above are checked, so
follow them exactly." The manager cannot and need not detect okf itself: its
shell is limited to `sleep` and approved patterns, and the IDE already
knows.

### Install path

okf is a Go module. Building it needs `go`; its `go.mod` asks for Go 1.26,
which `GOTOOLCHAIN=auto` downloads on demand when the local Go is at least
1.21 (the spike did exactly this).

**Recommendation: a command, no Install button, in the first version.**

- The fix line is `go install github.com/okf-memory/okf-agent-memory/cmd/okf@latest`
  (module path confirmed; on this Mac it built in about 5 s and landed in
  `~/go/bin`, which the login-shell PATH does not contain). `@latest`, not a pinned version:
  pinning would make us the owner of okf's upgrades. A version that is too
  old is caught by the minimum check instead.
- When `go` itself is missing or older than 1.21, the okf line's fix is
  `brew install go` first; the Machine page shows `go` as its own row with
  "needed by: okf".
- An Install button would mean running `go install` (and, on a machine whose
  Go is older than okf's 1.26, a toolchain download) from inside the IDE with progress and failure
  reporting, for a check that is advisory. Parakeet earned its button because
  transcription does not work at all without it; okf does not clear that bar.
  (Open question 4.)
- If a button comes later, it follows parakeet's pattern: offered only when
  `go` is the sole thing in place and okf the sole thing missing
  (`can_install`), installing with `GOBIN=<app_data_dir>/runtime/bin`, and
  that folder becomes the first place the okf row looks, ahead of PATH, so a
  successful install cannot be reported as missing.

### Version drift and parsing

okf is open source, so its behaviour is checkable and we check it. Slice 0
installed v0.7.0 (commit `976d2dbc`, the `v0.7.0` tag) and captured
`--version` and `validate` in text and `--json` form for a clean bundle, one
with findings, a malformed one and a missing one
(`src-tauri/src/machine/testdata/okf-*.txt`, the bundles next to them in
`okf-bundles/`). Those captures are the parser's source of truth. What they
showed:

- `okf validate <bundle> --json` exists and is what we call. Exit `0` means
  conformant (broken links and orphans may still be listed), `1` not
  conformant, `2` the bundle could not be loaded, and then the output is
  plain text even with `--json`.
- In the JSON, `broken_links` and `orphans` are `null` when empty, not `[]`;
  `warnings` stayed empty while the text output listed warnings, because they
  are reported under `broken_links`, `orphans` and `gate_findings`. A parser
  that trusts the field names alone would miss them.
- Without `--strict`, orphans are warnings. A young memory has many, so we
  report them as findings but do not pass `--strict`.

- **Minimum version** is the one the captures came from, v0.7.0 (the
  spike's v0.4.4 is older and was never captured). Older, or a version string we cannot read: state `outdated` (or
  `unrecognised`), the check does not run, the line says which version was
  found and the fix command. We do not parse output from a version we never
  saw at all.
- **Newer than tested** runs, parsed defensively. The line notes "tested
  with 0.7.0".
- **Parsing order**: exit code first; exit `2` is `failed` without reading
  the body as JSON. Otherwise the JSON, every list read as "absent or null
  means empty". JSON that does not parse, or lacks `is_conformant`, is
  `unrecognised`. Entries we cannot place are counted, not shown: "okf
  reported 3 things we could not read", with the
  cleaned text in the fold and the full output in a log file. Exit non-zero
  with nothing recognisable is `failed`, one sentence, details folded. A
  timeout is `failed` too, with the time in the sentence.
- **Tool output never becomes the message.** The sentence is ours;
  `readable_details` (moved into `machine/` with the rest) cleans what goes
  into the fold; the frontend renders through `toolFailure.ts`, which
  already demotes traceback-shaped text it is handed by mistake.
- **Drift is detected, not assumed.** An `#[ignore]` test runs the real okf
  against a temp bundle with known faults and asserts our classification.
  When it disagrees: recapture the outputs first, then fix the parser, in
  that order.

## Several projects: the policy does not change

A manager is a supervisor, so everything that bounds a supervisor bounds it,
unchanged: `supervisor-policy.json` (which projects, providers, models, modes,
`maxRunning`), the intersection with each project's provider policy, the
unattended-mode refusal, model ranks and `modelReason`, the per-project
`auric-pm-<folder>` servers, approved skills and tools. Limits count per
supervisor, so each manager has its own `maxRunning` budget, exactly as two
plain supervisors do today. Nothing in this design writes to the policy.

The one thing deliberately left out is narrowing a single manager to a subset
of the allowed projects. That would be a grant, so it would belong in
`supervisor-policy.json`, not in `INSTRUCTIONS.md`. (Open question 2.)

## UX

The surfaces follow the HIG idioms the app already uses: a sidebar with
sections, context menus with an ellipsis where a sheet follows, one modal
sheet with a single default button, destructive actions confirmed in an alert.
New dialogs use `useDialogA11y`; colours and type stay as they are
(`docs/brand-kit.md`).

### Runs rail

```
┌ SUPERVISOR RUNS ─────────────── ↻ ┐
│ PROJECT MANAGERS                   │
│ ● Release Desk        Running      │   ● = live, accent colour
│ ○ Inbox Triage        2 h ago      │
│ ▸ Archived (1)                     │
│ RECENT RUNS                        │
│   Oct 21, 17:00       3 files      │
│   Oct 21, 09:00       12 files     │
└────────────────────────────────────┘
```

- Two sections. Managers sort by name and do not move when they are used;
  runs keep sorting by recency. A manager folder never appears among runs.
- A run row's context menu gains **Promote to Project Manager…**; the hover
  "…" button opens the same menu, because context menus alone are hard to
  discover.
- A manager row's context menu: **Open**, **Edit Instructions…**,
  **Rename…**, **Show in Finder**, **Validate Memory**, separator,
  **Archive…**. An archived row: **Restore**, **Remove Project Manager…**.
- Expanding a manager row shows its inspector inline (the rail is too narrow
  for a side inspector):

```
│ ▾ Release Desk                     │
│   Key  release-desk           ⧉    │
│   Instructions  "Write every…"  Edit│
│   Memory  48 concepts · checked ✓  │
│           Decisions 12 · Facts 20… │
│   Folder  2026-10-21_090000   ▸    │   ▸ = the file tree, as today
│   [ Open ]                         │
```

Status lines appear only when they ask for something: "Instructions
changed since this session started — Restart", "Works as a Project
Manager from its next start — Restart Now", "Memory check found 3
problems — Show", "Memory check off: okf is not installed — Copy Command,
Check Again" (see "Machine dependencies").

### Promote sheet

```
┌──────────────────────────────────────────────┐
│ Promote to Project Manager                   │
│                                              │
│ Name  [ Release Desk                       ] │
│       Address: release-desk                  │
│                                              │
│ It keeps its folder and everything in it,    │
│ gets its own instructions file and starts    │
│ keeping notes in knowledge/.                 │
│                                              │
│ ☑ Show in Quick Access                       │
│ ☑ Show in the menu bar                       │
│                                              │
│                     [ Cancel ]  [ Promote ]  │
└──────────────────────────────────────────────┘
```

- One field. The name is prefilled from the run's key when it has one
  ("mail-triage" → "Mail Triage"), otherwise empty with a placeholder.
- The address line updates as you type and is not editable; a run that
  already has a key shows that key. Hiding the key entirely was considered,
  but integrators need it and it never changes later.
- Promote is disabled with the reason under the field ("A Project Manager
  with this name exists"), never a silent grey button.
- For a running supervisor one extra sentence: "It keeps running as it is and
  works as a Project Manager from its next start."
- The menu-bar checkbox is shown only when the menu bar icon is switched on.
- After Promote the row moves into the managers section and expands.

### Quick Access

Managers get their own tiles after the Supervisor tile: monogram from the
name, the name, a status dot (live, needs input via the attention model,
idle). Click opens. Right-click: Open, Edit Instructions…, Show in Runs,
Archive…. No skill wheel in the first version: a skill always starts a new
supervisor, and a manager has exactly one instance, so the two rules would
collide. The Supervisor tile's own right-click menu gains a "Project
Managers" submenu. With no managers nothing is shown; there is no empty tile
inviting promotion.

### Menu bar

When the icon is on, a "Project Managers" section lists non-archived managers
that are set to show there, by name, with a dot while running. Choosing one
opens it. Each manager can carry a global shortcut, recorded with the
existing `ShortcutRecorder` in its settings. `MenuBarConfig` gains
`managers: [{ key, label, running, shortcut }]` and `LaunchRequest` gains
`managerKey`; the frontend handles it through the same Open path.

### Settings → Supervisor → Project Managers

A list of all managers with the same inspector component as the rail (one
component, two places), plus the presentation switches: Show in Quick Access,
Show in the menu bar, Shortcut. It is a management surface, not the entry
point: the section has no "New" button and says "Promote a run from the
Supervisor Runs rail to add one."

Presentation (visibility, shortcut, tile order) is an application preference,
`auric.supervisor.managers`, keyed by manager key, mirrored like every app
pref. Identity stays in Rust. A pref for a key the registry no longer has is
ignored.

## Contract

`src/lib/agents/supervisorManagers.fixtures.json`, read by Rust
(`include_str!`) and TypeScript. The file is the reference; this excerpt is
abbreviated and only shows its shape:

```json
{
  "version": 1,
  "registryFileName": "supervisor-managers.json",
  "names": {
    "maxLength": 40,
    "valid": ["Release Desk", "Inbox triage 2", "Équipe"],
    "invalid": ["", "   ", "line\nbreak", "x-41-characters-long-name-is-too-long-yes"]
  },
  "keyFromName": [
    { "name": "Release Desk", "taken": [], "key": "release-desk" },
    { "name": "Équipe Nord!", "taken": [], "key": "equipe-nord" },
    { "name": "Release Desk", "taken": ["release-desk"], "key": "release-desk-2" },
    { "name": "Agent 7", "taken": [], "key": "agent-7-2", "$comment": "agent-<n> is reserved" },
    { "name": "!!!", "taken": [], "key": "manager" }
  ],
  "promotionKey": [
    { "liveKey": "mail-triage", "fileKey": null, "name": "Inbox", "key": "mail-triage" },
    { "liveKey": null, "fileKey": "old-desk", "name": "Inbox", "key": "old-desk" },
    { "liveKey": null, "fileKey": null, "name": "Inbox", "key": "inbox" }
  ],
  "launchKey": [
    { "resume": "manager", "own": null, "result": { "key": "release-desk" } },
    { "resume": "manager", "own": "other", "result": { "error": "manager_key_mismatch" } },
    { "resume": null, "own": "release-desk", "result": { "resumes": "2026-10-21_090000" } },
    { "resume": null, "own": "archived-desk", "result": { "error": "manager_archived" } }
  ],
  "refusals": {
    "manager_name_invalid": "…",
    "manager_name_taken": "…",
    "manager_run_missing": "…",
    "manager_run_taken": "…",
    "manager_key_mismatch": "…",
    "manager_archived": "…",
    "manager_not_found": "…",
    "instructions_too_large": "…",
    "registry_unreadable": "…"
  },
  "instructions": {
    "fileName": "INSTRUCTIONS.md",
    "maxBytes": 16384,
    "denyRules": ["Edit(./INSTRUCTIONS.md)", "Write(./INSTRUCTIONS.md)"]
  },
  "memory": {
    "bundleDir": "knowledge",
    "okfVersion": "0.2",
    "sections": {
      "projects": "Project",
      "decisions": "Decision",
      "preferences": "Preference",
      "people": "Person",
      "facts": "Fact",
      "lessons": "Lesson",
      "sessions": "Session"
    },
    "maxFindingsInPrompt": 20,
    "validateTimeoutMs": 10000
  }
}
```

Twins: name validation, `keyFromName` and the refusal codes are implemented in
both languages (the sheet validates as you type, Rust decides). `launchKey`
and `promotionKey` are Rust only but in the fixture so the frontend pre-check
and the docs cannot drift. The memory layout is read by the prompt builder
(TS) and the summary walk (Rust). The prompt itself is TS only.

Captured `okf validate` outputs (clean, findings, malformed front matter) from
the pinned commit live next to the Rust tests as the parser's source of truth.
The mock is those captures, not our idea of the format.

## Tests

Per `docs/testing/test-policy.md`. Key resolution at launch and the
instructions deny rule are agent execution gates, so high risk: positive,
negative and failure cases plus fault injection.

| Layer           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, Rust      | Registry read/write, 0600, atomic replace, unknown version and broken JSON never overwritten. Promote/rename/archive/restore/remove including every refusal. `keyFromName` and names from the fixture. `launchKey` table from the fixture, inside `admit_supervisor`. Memory summary over a temp bundle (bounded walk, front matter only, broken file counted, not fatal). Layout check over a temp bundle with each fixture fault. okf parser over the captured outputs (clean, findings, malformed, unknown lines); a fake `okf` script for timeout, non-zero exit and an old version; missing `okf` gives `missing`. `machine/`: version extractors over captured `--version` samples, the version cache re-probes on a new mtime and not otherwise (injected clock and fs), extra folders searched after PATH, video preflight answers byte-identically before and after the move. |
| Real machine    | `#[ignore]` `machine::inspects_this_machine` prints every declared dependency as found here (the `preflight.rs` test, widened). `#[ignore]` okf drift test: real `okf validate` on a temp bundle with known faults, our classification asserted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Unit, TS        | `keyFromName` and names from the fixture. Prompt: no manager sections for a plain supervisor; for a manager the order is global instructions → manager rules → manager instructions → memory check → pick-up; findings capped at 20. Runs split: a manager folder never appears among runs; archived go to their own group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Contract        | Both sides run the fixture. `supervisor_claude_arguments` for a manager launch carries the deny rules; for a plain supervisor it is byte-identical to today (existing test stays).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Component       | Promote sheet: prefill, live address, disabled-with-reason, running-supervisor sentence, Esc/Enter, focus trap (`useDialogA11y`). Rail sections, context menus, inline inspector status lines. Manager tile states. Settings list reuses the inspector.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Fault injection | Remove the `launchKey` mapping in `admit_supervisor` and confirm the fixture test fails; drop the deny rule and confirm the contract test fails (memory: prove the test by taking the fix out).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Real app        | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Real-app check**, `scripts/probe-project-manager.mjs`, run against an
isolated second instance (own HOME, short socket path, dummy provider), so the
user's real managers are never touched:

1. Seed a run folder with `INSTRUCTIONS.md` containing a marker string, and a
   registry entry for it.
2. `spawn { role: "supervisor", supervisorKey: "probe-desk" }` over
   `control.sock`; assert the agent's `repoPath` is the seeded folder, its name
   is the manager's name, and the console shows the manager section and the
   marker.
3. Spawn again with the same key; assert `supervisor_key_in_use`.
4. Kill it; assert `validation.json` appears with layout findings and an okf
   state (`ok`, `findings` or `missing`, depending on the machine).

Plus one `#[ignore]` cargo test with the real Claude CLI that asks a manager to
edit `INSTRUCTIONS.md` and asserts the file is unchanged. The prompt rule alone
is not evidence; only the real CLI shows whether the deny rule holds.

The UI is checked in browser mode with a seeded store (`pnpm dev` +
`agent-browser`), since the Tauri window cannot be driven from the terminal.

## Implementation slices

Each is sized for one agent. Contract first, then Rust and the TS library in
parallel, then UI, then QA.

| #   | Slice                                                                                                                                                                                                                                                                                                                                                             | Depends on | Files                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Contract. Done 2026-10-22.** Fixture file. okf v0.7.0 installed and captured (version, validate text/JSON for clean, findings, malformed, missing bundle), module path and install folder recorded. Deny rules checked against Claude Code 2.1.308 and written into `denyRules`. Paragraphs added to `design-agent-control.md` and `design-supervisor-link.md`. | –          | `src/lib/agents/supervisorManagers.fixtures.json`, `src-tauri/src/machine/testdata/okf-*.txt`, the two design docs                                                                                                                                                                              |
| 1   | **Rust registry.** Record, read/write, promote/rename/archive/restore/remove, Tauri commands, `SupervisorRun.manager` in the runs list.                                                                                                                                                                                                                           | 0          | `src-tauri/src/supervisor/managers.rs` (new), `supervisor/mod.rs`, `supervisor/runs.rs`, `lib.rs`                                                                                                                                                                                               |
| 2a  | **Machine seam.** Move the mechanism out of `video_import/preflight.rs` into `machine/`, declared table (`ffmpeg`, `ffprobe`, `go`, `okf`), version cache keyed by path + mtime, `refresh_login_shell_env`, `machine_dependencies` command for the Settings page. Full Rust suite (shared foundation).                                                            | 0          | `src-tauri/src/machine/` (new), `video_import/preflight.rs` (+ tests), `agents/shell_env.rs`, `lib.rs`                                                                                                                                                                                          |
| 2   | **Rust memory.** Summary walk with the layout check, okf validate through `machine/` with timeout and defensive parsing, `validation.json`, trigger on session end, regression notification.                                                                                                                                                                      | 0          | `src-tauri/src/supervisor/memory.rs` (new), `agents/run_results.rs` (hook)                                                                                                                                                                                                                      |
| 3   | **TS library.** IPC wrappers, `keyFromName`/name rules on the fixture, runs split, prompt sections, `supervisorConfigFor` manager branch, `openManager` in `openSupervisor.ts`.                                                                                                                                                                                   | 0          | `src/lib/tauri/supervisorManagers.ts` (new), `src/lib/agents/supervisorManagers.ts` (new), `supervisorLaunchPrompt.ts`, `supervisorLaunch.ts`, `store/agent/agentLifecycle.ts`, `openSupervisor.ts`                                                                                             |
| 4   | **Rust launch.** `launchKey` rules in `admit_supervisor`, manager name on the agent, `lastLaunch` written, deny rules in `supervisor_claude_arguments`, live key set on promotion.                                                                                                                                                                                | 1          | `src-tauri/src/agents/manager.rs`, `supervisor/several.rs`, `agents/tests.rs`                                                                                                                                                                                                                   |
| 5   | **Rail UI.** Sections, context menus, Promote sheet, inline inspector, Restart actions.                                                                                                                                                                                                                                                                           | 1, 3       | `SupervisorRunsPanel.tsx`, `PromoteManagerSheet.tsx` (new), `ManagerInspector.tsx` (new), tests next to them                                                                                                                                                                                    |
| 6   | **Quick Access, menu bar, Settings.** Manager tiles, Supervisor tile submenu, menu bar section and shortcuts, Settings list, presentation pref, Settings → Machine page (reads `machine_dependencies`; Video Import links to it).                                                                                                                                 | 4, 5       | `QuickAccess.tsx`, `ManagerTile.tsx` (new), `SupervisorTile.tsx`, `src-tauri/src/menu_bar.rs`, `src/lib/tauri/menuBar.ts`, `useSupervisorMenuBar.ts`, `src/lib/quickAccess/supervisorMenuBar.ts`, `SupervisorContent.tsx`, `MachineContent.tsx` (new), `VideoImportContent.tsx`, `appConfig.ts` |
| 7   | **QA and docs.** Probe script, ignored real-CLI test, adversarial QA pair, `CLAUDE.md` section next to the supervisor, `automation-surface:check`.                                                                                                                                                                                                                | 1–6        | `scripts/probe-project-manager.mjs` (new), `CLAUDE.md`, `docs/automation-surface.md`                                                                                                                                                                                                            |

Slices 1, 2a and 3 run side by side; 2 follows 2a. 4 waits for 1. 5 needs the commands
from 1 and the library from 3.

## Risks

- **The manager rewrites its own steering.** Mitigated by the deny rule
  (checked against the real CLI), the prompt rule, and the visible hash
  comparison. Even if all three fail, the file grants nothing.
- **Memory grows into noise.** The deprecate rule, one-concept-per-file,
  section indexes and validation findings in the next prompt push back. The
  inspector's counts make growth visible. There is no automatic pruning; a
  human can edit or delete any file.
- **A stale memory is believed.** The same failure the spike measured. Only
  `status: deprecated` plus `superseded_by` protects against it, so the
  prompt makes that the one rule it repeats.
- **`okf` changes format.** Unpinned on the machine by choice. Validation is
  advisory and reports `outdated`, `unrecognised` or `failed` in a sentence;
  it never blocks a launch, and the layout check keeps working. Captured
  outputs pin what we parse; a real-tool `#[ignore]` test shows drift.
- **The env refresh touches every spawn.** `refresh_login_shell_env` changes a
  foundation agents depend on. Only an explicit Check Again calls it, and the
  slice runs the full suite.
- **Personal data in long-lived notes.** The prompt forbids secrets and
  unneeded personal details. The folder is under the user's home, outside any
  repository, and is not part of the AuricIDE config backup.

## Decisions on the open questions (2026-10-22)

All four were settled by the user as recommended:

1. **The OKF bundle lives in `knowledge/`** inside the run folder; earlier files
   stay where they are.
2. **No per-manager project limit** for now. Managers see what the supervisor
   policy allows; `INSTRUCTIONS.md` steers the focus. A hard limit, if ever
   needed, goes into `supervisor-policy.json` as a per-manager block.
3. **Memory history via git is a follow-up slice** after the first version, with
   its own deny rule for `.git/`.
4. **No Install button for okf** in the first version: the command with Copy and
   Check Again. A later button follows parakeet's pattern.
