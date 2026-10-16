# ADR 0004: A supervisor agent with a narrow scope on the control socket

## Status

Accepted

## Context

ADR 0003 opened the agent fleet to clients outside the IDE and closed it to
every agent inside it. The socket walks each caller's parent chain and refuses
the connection with `forbidden_agent_caller` when a running IDE agent is among
the ancestors. The reason is that typing into a console can answer a
permission prompt, so one agent must not be able to approve another agent's
actions.

The next request was a supervisor: an agent started from the IDE (a tile in
Quick Access) that starts agents in other projects, headless when it needs an
answer back and interactive for long work, and picks the smallest model that
fits. That agent is an IDE agent, so under ADR 0003 the socket refuses it.

Four facts shaped the decision:

- The caller's identity is already known to Rust, from the kernel. The peer
  PID and the parent walk say which agent is asking, without trusting
  anything the caller sends.
- Whatever an agent can read, it can pass on. Its environment, its MCP config
  file and its working directory are all readable from its shell.
- The provider policy already decides per project which CLIs may run at all.
  A supervisor must not become a way around it.
- Starting an agent goes through the frontend store (ADR 0003), which owns
  the launch defaults, the bookkeeping and the cards. A supervisor's children
  should be ordinary agents on that path.

## Decision

- **The socket recognises a supervisor by its process, not by a secret.** The
  parent walk returns the matched agent instead of a yes or no, and Rust looks
  up that agent's `role`. No agent ancestor: external caller, as before. A
  supervisor: admitted in the supervisor scope. Any other agent: refused with
  `forbidden_agent_caller`, as before. An unreadable PID is still refused.
  "No agent ancestor" needs proof: the walk goes all the way to launchd, and
  a parent it cannot read, a circle or a chain longer than there are process
  ids is refused like an agent. (Until the QA pass the walk gave up after 64
  levels and answered "external", so 65 nested shells under any agent were
  enough to get `send_input`.)
- **The supervisor scope is small and fixed.** List the allowed projects,
  spawn, list, read, await and kill, each on its own children only. Any other
  agent id is `unknown_agent`. `send_input` is refused with
  `outside_supervisor_scope` even for its own children, so the reason behind
  ADR 0003 still holds: no agent answers another agent's prompt. A child that
  waits on a question is answered by the human in the child's window.
- **What a supervisor may start is a policy Rust owns.**
  `<app_data_dir>/supervisor-policy.json` (mode 0600, read on every check)
  lists per project whether the supervisor may use it, with which providers,
  models and permission mode, interactive or not, and how many at once. A
  missing or broken file allows nothing. The supervisor's provider list is
  intersected with the project's provider policy. `bypassPermissions` is
  rejected when the file is read, and every other mode that skips the
  prompts is refused too: a mode a provider config marks `unattended`, or
  whose launch arguments carry a known skip flag (`--dangerously-…`,
  `--yolo`, `--auto`, …). Providers spell this differently (`auto` is a
  classifier for Claude and no checks at all for another CLI), so the verdict
  comes from the built command, not the mode's name. A mode that hands each
  request to the CLI's own reviewer (Claude's `auto` classifier, Codex
  `--approve-for-me`) is allowed (decided 2026-10-16): the request is still
  judged, only not by the human. It applies to a
  provider's default too, when the policy names no mode
  (`permission_mode_unattended`). Two spellings of one folder in the file
  merge to the stricter entry. The dispatcher checks before the spawn
  reaches the frontend, and `spawn_agent_impl` checks again for any agent
  whose parent is a supervisor. The rules are twinned in TS and Rust against
  `src/lib/config/supervisorPolicy.fixtures.json`.
- **Children are ordinary workers.** The IDE spawns them, so they are not
  descendants of the supervisor's process. They get the normal project
  binding and would be refused at the socket like any other worker. There is
  no recursion: a supervisor cannot start a supervisor, and `role` from a
  supervisor caller is `invalid_params`.
- **A separate MCP mode, `auric-mcp --supervisor`,** offers only the
  supervisor tools. Unlike `--control` it starts while `AURIC_IDE_AGENT` is
  set. The supervisor runs Claude with `--tools ""`, which removes every
  built-in tool (Bash, Edit, Write, WebFetch, …), and `--restricted`, which
  also ignores the user's, project's and local settings files, so allow rules
  such as `Bash(npx:*)` there do not reach it. Only its own MCP tools are
  left, pre-approved. It has no shell at all; an earlier draft relied on Bash
  "asking the human", which the user's allow rules quietly made untrue.
- **A new method, `await_result`,** lets the supervisor wait up to 120 s for a
  child to finish and read its result (the CLI's answer, or the console tail).
  Results stay readable after the supervisor is killed, until its card is
  cleared. The children keep running in that case.

## Rejected alternatives

- **A capability token.** The IDE would hand the supervisor a secret and the
  socket would admit whoever presents it. The token would have to reach the
  MCP server through the environment or the MCP config file, and both are
  readable from the supervisor's shell. Any process it starts, or any child
  that can read the same files, could present it too. A secret the holder can
  read and print is a weaker identity than the PID the kernel reports, which
  the caller cannot choose.
- **The `request_agent_launch` inbox path.** Starting work by writing an
  inbox request is the existing route for agents (ADR 0002), and it keeps the
  human in the loop. It does not fit here: it needs a goal, it starts only on
  a click or a launch grant, it cannot read a child's output or wait for its
  result, and it is bound to one project. A supervisor that has to wait for a
  click per child is not a supervisor.

## Consequences

- One IDE agent can now start other agents without a click. What it can start
  is bounded by the policy file and by the project's provider policy. Its
  children cannot type into anything, and it cannot type into them.
- The policy file is protected by file mode only: 0600, owned by the user.
  The supervisor itself cannot write it (it has no file or shell tools), but
  any other process of the same user can, including any agent that has a
  shell or runs in a mode that skips prompts. The next spawn check reads what
  it finds. The file is not "edited only by the human through Settings"; it is
  edited by whoever runs as the user, and Settings is the intended way.
- A supervisor can kill its children. It cannot kill or read anything else.
- The gap ADR 0003 names is unchanged, and it is cheaper than that ADR made
  it sound: no double fork is needed. `nohup client &` followed by the shell
  exiting is enough; the client is reparented to `launchd`, its chain ends at
  pid 1, and it is admitted as external. This applies to every worker with a
  shell. Reading the peer's environment or session id would not close it
  (`env -i`, `setsid`). The supervisor scope does not widen it: being
  recognised as a supervisor needs a supervisor among the real ancestors.
- The other direction of the same gap: a process a supervisor detaches would
  be external and have more rights than the supervisor. Without an approved
  skill it cannot start one, because it has no shell or other code-running
  tool. With one, only the skill's own patterns run (see the amendment below),
  and approving a pattern is trusting that command with exactly this.
- Children carry `spawnedByAgentId` and `runSource: "supervisor"`, so their
  cost is booked like any other run and can be summed per supervisor.
- The protocol fixtures gained `await_result`, the `role` spawn parameter,
  two error codes and a `callerScope` table. Change the fixtures first, as
  before.

## Verification boundary

The dispatcher scope is tested against a fake backend in Rust, the policy on
both sides against its fixtures. `scripts/probe-supervisor.mjs` and the
ignored Rust test `supervisor_scope_against_running_app` check a running app:
a supervisor started over the socket spawns a headless child, awaits it and
reads its answer, and a disallowed model is refused with `supervisor_denied`.

## Amendment 2026-10-16: a run folder, file tools and approved skills

A supervisor that could only call its MCP tools could not keep what it
gathered: no notes, no intermediate data, no artifacts to hand to the next
child, and no skill (a `/skill` first task arrived as bare text, because
`--tools ""` also removes the `Skill` tool and `--restricted` loads no skills
from disk). The shape changes as follows; identity, scope and the policy check
on every child are unchanged.

- **A fresh run folder per start,** `~/.auric/supervisors/<start time>/`
  (`-2`, `-3` for a second start in the same second), the home-level twin of a
  project's `.auric/`. It replaces the shared `<app_data_dir>/supervisor/`.
- **File tools in that folder.** `--tools "Read,Write,Edit,Glob,Grep,Skill"`
  with `--restricted`, which confines the file tools to the working
  directories and still ignores the user's settings files.
- **`--permission-mode dontAsk` instead of `default`.** The listed tools run
  without asking; everything else is refused rather than put to the human.
  That is what makes "a shell only for these commands" expressible: Claude
  Code has no "deny Bash except", but `dontAsk` refuses whatever no allow rule
  names.
- **Approved skills** are a new `skills` block in `supervisor-policy.json`,
  keyed by skill folder, each with the `Bash(...)` patterns it may run
  (both twins on `supervisorPolicy.fixtures.json`, `skillPatternRules`). Rust
  links the approved folders into `<app_data_dir>/supervisor-skills/<run>/` as
  a plugin named `auric` and passes `--plugin-dir`; the plugin sits outside the
  run folder, so the supervisor cannot rewrite a skill it then runs. `Bash` is
  in `--tools` only while a loaded skill has a pattern.
- **Extra folders per skill** (`dirs`, passed as `--add-dir`): a skill's
  workspace outside the run folder, readable and writable by the file tools.
  A folder that does not exist is left out.
- **One `auric-pm` per permitted project**, named `auric-pm-<folder>`
  (`pmServerNames` fixture, twinned in `supervisorPolicy.ts` for the launch
  prompt), started only where `.auric/project.db` exists, all tools
  pre-approved. Its env carries no `AURIC_AGENT_CWD`, so `request_agent_launch`
  refuses: every agent a supervisor starts still goes through `spawn_agent`
  and this policy.
- **`ToolSearch` is one of its tools.** With a dozen `auric-pm` servers the
  MCP tools load deferred, and without `ToolSearch` they are out of reach; a
  supervisor answering "the auric-supervisor tools aren't available" on its
  first turn is what that looked like.
- **Claude in Chrome is a switch** (`supervisor.chrome`, off by default):
  on, the launch carries `--chrome` and pre-approves `mcp__claude-in-chrome__*`;
  off, it carries `--no-chrome`, because a user's Claude Code may enable the
  integration by itself. It drives the user's own browser with its logged-in
  sessions, so the launch prompt limits it to tabs it opened and forbids
  submitting, buying, sending or deleting without the human.
- **The cost, stated:** the patterns are not scoped to the skill's turn; they
  hold for the whole run. A command matching one can detach a process, which
  the PID walk treats as external. A pattern is therefore a trust statement
  about that command, and Settings says so where it is entered.

Checked against Claude Code 2.1.301: under `--restricted` the `Skill` tool
lists the built-in skills plus the `--plugin-dir` skills and none from
`~/.claude/skills` or the cwd's `.claude/skills`; the supervisor MCP tools load
with the new tool set.
