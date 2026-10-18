# Supervisor stall watchdog

Ticket: `8f7da56b`. The Rust IDE polls every five seconds, independently of
supervisor model turns, using the existing finish-pingback thread and PTY
message composition. Interactive-turn pingbacks remain ticket `88d571fd`.

## Configuration and scope

Set `AURIC_AGENT_STALL_MINUTES` in the IDE's launch environment and restart the
IDE. It accepts whole minutes from 1 to 10080; missing, invalid, zero and
out-of-range values use **15 minutes**. No provider or supervisor prompt can
change it through agent input. The second interval has the same length.

Only running children with supervisor provenance (`spawnedByAgentId`) are
watched. Queued, finished, failed, removed and human-started agents are excluded.
If the supervisor has ended or disappeared, the bounded delivery attempts fall
back to the human inbox. Restarting the IDE starts a fresh observation window; nothing is
inferred about activity while it was not running.

## What counts as activity

The console keeps its existing cleaned byte offsets unchanged. A separate,
bounded signal detects new normalized lines, including unfinished lines.
ANSI sequences are removed by the existing streaming console stripper. Blank
and decoration rows, known spinner rows and their changing timers, `esc to
interrupt` rows, repeated whitespace-normalized lines in the last 256 distinct
lines, and the watchdog's own echoed message do not advance this signal.
Repeated multi-line TUI redraws therefore do not keep an otherwise stuck run
alive. The pending line is capped at 4096 bytes on UTF-8 character boundaries.

On macOS the IDE samples the local process tree directly with `libproc` and
`sysctl`, without spawning a command. It skips sampling when no supervised
child is running, caps the snapshot at 32768 PIDs, checks a 100-ms budget
between kernel calls and ancestry steps, and reads at most 64 KiB of arguments
per descendant. Only descendants of agent roots have their arguments inspected;
environment entries are excluded from the parsed command. Zombies do not count.
An incomplete or over-budget scan conservatively treats the roots as active for
that poll, preventing an uncertain scan from producing a false stall. Other
Unix desktops retain the `/bin/ps` fallback.

The process classifier is shared across these snapshots. A running
shell or recognized tool process below the agent's PTY process counts as
activity even if it prints nothing. This covers, for example, a shell waiting
for `cargo test` or `sleep`, and direct build tools or recognized Node/Python test runners. Generic runtime
processes alone do not prove activity: they can be provider wrappers.
Provider CLI wrappers and MCP server processes are excluded: an idle persistent
server alone must not suppress the watchdog. A recognized shell/tool below a
local MCP server does count as activity. Process arguments are inspected
in memory and are never stored in notifications or logs.

Detected questions use the shared `awaits_input` patterns. A question, a human
draft in the child's console, or an active tool resets the inactivity window.
The `await_result(untilInput)` twenty-second silence heuristic is deliberately
**not** an exclusion here: it also describes a stuck CLI, so using it would make
stall detection impossible. The existing await behavior is unchanged.

### Limits

This is a heuristic, not proof of a deadlock. Provider-specific spinner/status
formats outside these rules, redraws larger than the recent-line window, or
wrapping an echoed nudge across lines can count as progress. Repeated real
identical log lines can be deduplicated. Process sampling can miss commands
shorter than five seconds. Detached/reparented jobs, remote tools, unfamiliar
executables without a recognized shell ancestor, and requests executed inside
a persistent MCP server without a recognizable child process cannot reliably
be recognized. If process inspection is
unavailable on macOS, that poll conservatively counts as activity; other Unix
snapshot failures retain output-only detection. A hung command still alive in
the process tree is indistinguishable from an intentionally silent long command
and suppresses the watchdog for as long as it runs.

## One nudge, then escalation

After one inactive interval, the IDE records the stall and sends an interactive
child exactly one message through the `send_agent_input` dispatcher path:

> Kurzer Statuscheck: Woran hängst du? Mach weiter, oder nenne deine Frage oder Blockade in einer Zeile.

The attempt is reserved before writing. A write failure is reported to the
supervisor and is never retried as another nudge. Headless agents receive no
input; their supervisor is told to read output and decide whether to stop,
restart or ask the human. A supervisor notice never gives the model permission
to send a duplicate nudge.

After another full inactive interval following that first notice, the IDE
sends one escalation to the supervisor and the existing human inbox, with an
agent reference and dedupe key. It does not kill or restart agents. Meaningful
progress clears the current stall and escalation window, but the nudge budget
is **one attempt per agent run**, including after recovery. A later stall can
produce a new notice/escalation, never another nudge.

Supervisor notices use the finish-pingback delivery path, defer while the human
has a draft there, and recheck that the supervisor is live and interactive.
Failed deliveries retry at most three times, at five-second intervals, then
leave a warning in the inbox. An escalation already delivered to the human
is not delivered again if its supervisor pingback fails. A finish/removal or recovery cancels pending stall
notices. Human escalation does not wait for a supervisor draft to be sent.

## API fields

`list_my_agents` (socket `list_agents`) and pending `await_agent_result` expose
`idleForMs` and `stalledSinceMs`. Both are nullable; null means no live watchdog
observation (including finished or out-of-scope agents). `idleForMs` is the
monotonic inactivity duration at the last poll. `stalledSinceMs` is the Unix
millisecond timestamp when the first interval elapsed, null before that or
after recovery. Values can lag by five seconds. Existing `outputBytes` remains
the readable console offset and may grow due to redraw noise; it is not the
watchdog's progress signal. Clients accept absent fields from older IDEs.

## Assumptions and open questions

- Configuration through the IDE launch environment satisfies configurable N;
  this ticket does not prescribe a Settings control.
- A nudge budget belongs to the run, rather than each silence episode.
- Headless silence gets the same two-stage notification timing as interactive
  silence, without input.
- Question: should remote/MCP tool execution explicitly publish start/end
  activity? Why: local process inspection cannot distinguish an idle server
  from a silent in-process request without a child process. Options: provider-specific events or a
  shared tool-activity protocol in a follow-up.
- Question: should configuration be exposed in Settings? Why: GUI-only launches
  do not conveniently inherit shell environment variables. Options: keep the
  launch setting or add a persisted Settings control in a follow-up.

## Verification (2026-10-18)

The unchanged `6d75d4c` baseline was archived before implementation. Rust's
Seatbelt tests require a baseline outside `/tmp`, because the sandbox expressly
permits temporary directories; the baseline under the worktree's ignored
`src-tauri/target/stall-baseline` passed with normal macOS process access.

| Check                            | Baseline                      | Implementation            |
| -------------------------------- | ----------------------------- | ------------------------- |
| Vitest                           | 10,769 passed / 716 files     | 10,770 passed / 716 files |
| Native Rust                      | 1,584 passed, 11 ignored      | 1,596 passed, 11 ignored  |
| Lint                             | 0 errors, 2 existing warnings | Same                      |
| Typecheck / Clippy `-D warnings` | Passed                        | Passed                    |

The last process-classifier refinement additionally passed both native process
activity tests (including a real silent child) and Clippy. Red/green checks
covered API field preservation, ASCII spinner timers, commands below an MCP
server, and tool arguments containing `mcp`. Dispatcher tests cover thresholds,
noise-only output, questions, active commands, stopped agents, one nudge even
after recovery, headless operation, escalation, draft deferral, failed writes,
ownership/orphans, and list/await metrics. The prompt snapshot was regenerated
and its added rule reviewed against the non-blocking-wait rule.

`pnpm check:all` was run: versions, lint, automation surface, formatting, Knip,
jscpd and the full TS suite passed. The outer execution sandbox blocks native
Seatbelt/process tests, so Rust tests, Clippy, rustfmt and cargo-machete were
completed separately with normal process access. The native suite passed with
four test threads. An existing worktree birth-time race occurred in an earlier
high-concurrency run; the clean baseline and final native run passed it.
Local evidence logs: `/tmp/stall-watchdog-evidence/`.

## Independent merge review (2026-10-18)

Confirmed fixes with failing regression tests before implementation:

- Absolute path lines were discarded as ASCII spinner rows. ASCII spinner
  prefixes now require following whitespace; new path output counts as progress.
- Escalation pingback exhaustion sent a second human notification. Exhaustion
  now only falls back to the inbox before escalation, since escalation already
  notified it.
- Replaced macOS `ps` polling with the bounded native snapshot described above.
  The native silent-child test exercises the production snapshot; the argv
  parser test excludes executable padding and environment entries.

Lifecycle tests cover removal and error exits while notices are deferred by a
supervisor draft. Recovery followed by a new stall is explicitly verified to
escalate once for the new episode while preserving the single nudge per run.
The ticket's original “Kein Dauer-Stupsen” leaves the recovery budget implicit;
its implementation notes and this review retain the conservative per-run budget.
The nudge remains verbatim the ticket's suggested German text. The short prompt
rule leaves polling and nudging to the IDE and preserves non-blocking waits.

Independent verification against unchanged local main `6d75d4c`:

| Suite                                             | Main baseline             | Reviewed branch           |
| ------------------------------------------------- | ------------------------- | ------------------------- |
| TypeScript                                        | 10,769 passed / 716 files | 10,770 passed / 716 files |
| Native Rust (normal process access, four threads) | 1,584 passed / 11 ignored | 1,600 passed / 11 ignored |

The main sandbox run failed the existing Seatbelt and real-grandchild tests;
both pass with normal process access. All `check:all` gates are executed
individually so an environmental failure cannot hide later checks; typecheck
is run additionally. Evidence for this review is in
`/tmp/stall-review-evidence/`. Main was clean at baseline. No browser was needed.
