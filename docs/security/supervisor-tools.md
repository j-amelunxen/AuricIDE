# Security notes: the supervisor's tools and socket methods

Who this is for: anyone changing how agents talk to their supervisor. For each tool and
socket method it says how it can be abused, what stops that, and what does not. Each claim was
checked against the code, and most by a test that attacks it over a real socket
(`control_socket/socket_tests.rs`, `control_socket/mcp_e2e_tests.rs`).

The behaviour itself is in `docs/design-agent-control.md`.

## What holds for all of them

**Identity comes from the kernel.** The control socket reads the peer's process id from the
connection and walks up the process table to the nearest running IDE agent (`caller.rs`). No
request names its caller. A walk that cannot finish is refused rather than read as "outside".

**The socket is mode 0600.** Other users cannot connect. A process of the same user can, and on
that side the socket is not a wall: it decides what agents may do to each other, and an agent's
reads are not sandboxed.

**A detached process gets out.** A process that leaves its agent's process tree, for example with
`nohup` after its shell exits, ends up below launchd and is admitted as an outside client. That is
known and accepted (ADR 0004); these methods neither fix nor widen it.

**Limits per connection.** A request line holds at most 1 MiB, and a connection that stays silent
for 60 seconds is closed. There is no limit on how many connections run at once on this socket,
unlike the supervisor link. A worker used to be refused after its first line and may now keep
connections open until the idle limit, each holding one thread.

## ask_supervisor [#el_vdqm4hcv] and raise_question [#el_85cp2q7y]

_Speaking for another agent._ The method has no agent field. The socket refuses unknown fields
(`deny_unknown_fields`), the contract does too (`.strict()`), and the tool's own schema drops
them. The question is booked on the agent the kernel found. A process below an agent speaks for
that agent, and a nested process speaks for the nearest one.

_Reaching beyond the one right._ A worker is admitted to this socket for this method alone. Every
other method answers `forbidden_agent_caller`, also for the worker's own data. The supervisor
link keeps refusing workers and supervisors alike, because it uses the stricter admission.

_Asking when nobody is there._ Only an agent a supervisor started has someone to ask. The socket
checks that against the agent list, whatever the environment says; `AURIC_ASK_SUPERVISOR` only
decides whether the tool is listed.

_Prompt injection through the text._ A worker may have read something hostile and pass it on. The
text is stored as it came, control characters and terminal escapes included, and leaves only
inside a JSON tool result. The notice typed into the supervisor's console holds ids and a count,
never the text, so a question cannot type into a terminal. The launch prompt tells the supervisor
that text from an agent is data. That sentence is the only defence against the model believing
what it reads: a persuasive question can still persuade. Options are text too and carry no
authority.

_Flooding._ A run keeps at most 50 questions; the next is refused and nothing old is dropped.
Question and context hold 4 KiB each, in bytes, and up to 10 options hold 4 KiB each. So one run
can store about 2.4 MiB, and the logs of the newest 1000 agents are kept. **Weak spot:**
`await_agent_result` has no paging, so one answer can carry all 2.4 MiB into the supervisor's
context. Notices cost the supervisor a turn each, are grouped per look (every 2 seconds), and
there are never more notices than questions (`notices_at_most_questions`).

## read_agent_report [#el_8822ww84] and read_report [#el_r3sk9wv0]

_Reading a foreign child._ A supervisor reaches only agents it started. Any other id answers
`unknown_agent`, the same as an id that does not exist, so probing teaches nothing. An outside
client may read every agent; that is its role. A worker may read nothing, its own report included.

_A foreign transcript._ The agent id is a key into in-memory maps and never touches a path. The
transcript is found by the session id of that run: one the IDE handed to the CLI, or for Codex
the one it printed. It must be a UUID before it touches a path, and without one the answer is
`transcript_missing`, never the newest file in a folder. **Weak spot:** a Codex agent whose
session id was read from its own console could print another session's id before the CLI's header
does, and so be credited with that session's last turn. It gains nothing it could not read
anyway, but a supervisor would misread where the text came from.

_Prompt injection through the report._ The report is the agent's own words and may say anything.
It comes back as text in a JSON result and is never typed anywhere. The tool description and the
launch prompt both say to read it as data; as with questions, that is all that stands between the
text and a credulous model.

_Passing console text off as a report._ A console tail is never a report: a finished run with
only a tail answers `console_only`. The Lean model proves this for the rule itself
(`available_never_from_console`).

_Size._ At most 64 KiB, cut at the front on a character boundary, with `truncated: true`. At most
8 MiB of a transcript is read per lookup.

## await_agent_result [#el_rqg3vpjg] and await_result [#el_a75yd10b]

_Waiting on a foreign child, or hearing its questions._ Same scope check as above, before anything
is read. The questions of a foreign child do not appear in the refusal.

_Holding a thread._ The wait is cut to 15 seconds on both sides. The client gives up 5 seconds
after that.

_Hostile cursors._ Negative, fractional and non-numeric cursors are refused on both sides. A
cursor past the end only filters. `sinceReport` is only compared, so its size costs nothing but
the line limit.

_Losing a question._ The cursor belongs to the reader. An answer that gets lost changes nothing,
and the same cursor brings the same questions again (`lost_answer_changes_nothing_for_the_reader`).

## list_my_agents [#el_sf1eca3c]

It takes no parameter that could widen it: extra fields are dropped, and the list holds only what
this supervisor started. `questionCount` is a number, so no text from an agent gets in through it.
`name` and `currentTask` are agent text and data like any other, and `answerPreview` holds at most
300 characters of an agent's last ANSWER line.

## pm_tools [#el_d93xrgtp], pm_call [#el_h6np2qvy] and pm_target [#el_ff0j17a0]

_Reaching a project outside the policy._ The gateway asks Rust on every call, before it looks at
its children, so a revoked project is out of reach at once even with its child still cached
(`revocation_holds_at_once`). Rust resolves the name against the permitted list only. An absolute
path is compared after symlinks are resolved, so `..` and a link pointing out both answer
`unknown_project`. Relative paths and `~` name nothing. "Not permitted", "not a project" and
"spelled wrong" get one answer, so probing teaches nothing.

_A guess._ A name that fits two projects is refused with their paths. An empty project is refused;
only leaving it out on `pm_tools` means the first usable one, and `pm_call` requires it.

_Who may ask._ Only a supervisor. An outside client has its own `auric-pm`, and a worker is refused.

_Passing a tool name along._ The name must match `^[A-Za-z0-9_-]{1,64}$`, travels as one JSON
string to a child that knows only its own tools, and is never part of a command line. The folder
on the child's command line is the one Rust answered, never what the supervisor typed.

_Arguments._ They go to the tool unchanged, and each tool validates its own. The gateway adds no
check of its own, and those tools can write: **a supervisor can do in a permitted project whatever
the PM tools can do**, deleting goals included. The policy decides per project, not per tool.

_Starting agents through the back door._ The project servers run without `AURIC_AGENT_CWD`, so
`request_agent_launch` refuses, and without the control socket's address. Spawning stays with
`spawn_agent`, under the supervisor policy.

_Too many processes._ At most 8 children at a time; the least recently used goes unless a call is
running in it, and if all are busy the call answers `pm_busy`. A child that does not answer in 120
seconds is ended.
