# External agents: runs the IDE tracks but does not run

An agent can work somewhere the IDE has no process for it: a sandbox, a remote
box, another machine. A supervisor that started such a run can tell the IDE about
it. The run then shows in the supervisor's Agents timeline and in the usage
history, with its ticket, tokens and runtime as reported.

This is a loose coupling on purpose. The IDE knows nothing about sandboxes. It
offers three generic tools and stores what it is told.

The machine-checkable half of this contract is
`src/lib/agents/externalAgents.fixtures.json`, read by Rust and TypeScript.
**Change the fixtures first.**

## What it is not

An external run is not an agent. It is not in the agent list, so these hold by
construction and need no exception anywhere:

- It has no process, so it has no console, no input, no kill and no worktree.
- It does not count against `max_running*` and not in any "N running" figure.
- The stall watchdog, the attention model and the pingbacks never see it.
- An app restart cannot mark it interrupted, because `active-agents.json` does
  not hold it.

## Tools

Offered only by `auric-mcp --supervisor`. Socket methods in brackets.

### `register_external_agent` (`external_register`)

| Parameter         | Type                                | Rule                                                  |
| ----------------- | ----------------------------------- | ----------------------------------------------------- |
| `externalId`      | string, required                    | The caller's name for the run, such as a box name     |
| `runId`           | string                              | Tells runs of one `externalId` apart, such as a lease |
| `projectPath`     | string, required                    | Path or name of a project in the supervisor policy    |
| `name`            | string, required                    | One line, shown on the timeline                       |
| `provider`        | string, required                    | For the log only; no policy check, nothing is spawned |
| `model`           | string                              | For the log only                                      |
| `ticketId`        | string                              | Full id or unique prefix (4+) in that project         |
| `goalId`          | string                              | The same; default is the ticket's goal                |
| `state`           | `registered` \| `running`, required | Off (known, not working) or on                        |
| `startedAt`       | Unix ms                             | Used only when the entry is created; default now      |
| `tokenTtlSeconds` | integer, 60 to 2 592 000            | Life of the token issued by this call; default 72 h   |
| `newToken`        | boolean                             | Issue a further token for a run that is live already  |

Answers `{ agent, created, changed, token? }`. `token` is there only when this call
issued one: on creation, and on a live entry with `newToken: true` (see "Tokens").
It is safe to call again at any time:

- Unknown key: creates the entry.
- Known and live: moves it between `registered` and `running` if `state` differs,
  updates `name`, `provider`, `model`, `ticketId` and `goalId` if given, and
  counts as a sign of life. A different project is `invalid_params`.
- Already stopped: changes nothing (`changed: false`). A new run of the same box
  needs a new `runId`.

### `stop_external_agent` (`external_stop`)

| Parameter                                                            | Rule                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `externalId`, `runId`                                                | The same key as at registration                                          |
| `outcome`                                                            | `success` (default) \| `failed`                                          |
| `activeSeconds`                                                      | Real runtime, as reported                                                |
| `agentRuns`, `partial`                                               | Starts of the agent; figures cut off                                     |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | As reported                                                              |
| `costUsd`                                                            | As reported; absent stays unknown, never 0                               |
| `model`                                                              | Replaces the registered model                                            |
| `finishedAt`                                                         | Unix ms; default now                                                     |
| `endReason`                                                          | `completed` \| `error` \| `timeout` \| `cancelled` \| `reaped` \| `lost` |
| `token`                                                              | The run's capability token (see "Tokens")                                |
| `force`                                                              | Owner only; see "Force and corrections"                                  |

Answers `{ agent, alreadyStopped, booked }`. Without `force`, a second stop changes
nothing and books nothing, whatever figures it carries: the first stop wins. `booked: false`
means the entry is final but a write to the history failed; the IDE tries again
at every later call and at start.

### `list_external_agents` (`external_list`)

Answers `{ agents }`: the caller's own entries, so a resumed supervisor can see
what it left open.

## Who may call

Only a supervisor, and only for its own entries. Identity comes from the control
socket's PID walk, as everywhere. The one exception is `external_stop` with the
run's token, which any external or supervisor caller may send (see "Tokens").

- A worker gets `forbidden_agent_caller`, token or not. An outside client on
  `control.sock` gets `outside_supervisor_scope`, except for `external_stop` with a
  token. The supervisor link, which dispatches as an outside client, has no route to
  these methods.
- **An entry belongs to the supervisor's run folder**, not its agent id. The id
  changes on every resume and the folder does not, so a resumed supervisor keeps
  its entries with no adoption step.
- A key another supervisor holds: `register` is `supervisor_denied`
  (`external_id_in_use`), `stop` is `unknown_agent`.
- The project must be in the caller's supervisor policy and initialised, otherwise
  `unknown_project`. A name two projects share is `supervisor_denied`
  (`ambiguous_project`), as in `pm_target`.
- A ticket or goal that is not in that project, or a prefix that fits more than one,
  is `invalid_params` naming the field, so a typo cannot lose a run's place in the
  billing. A repeat on a stopped key does not look them up.
- `startedAt` must lie within 30 days before now and 5 minutes after it, `finishedAt`
  between the registration and 5 minutes after now (fixtures, `clock`). Otherwise
  `invalid_params`. A call that changes nothing looks at neither.

## States

| State        | Means                                 | Counts as on |
| ------------ | ------------------------------------- | ------------ |
| `registered` | Known, not working now (a parked box) | no           |
| `running`    | Reported as working                   | yes          |
| `stopped`    | Ended, final                          | no           |
| `failed`     | Ended with `outcome: failed`, final   | no           |

**Stale is not a state, it is a reading.** A live entry with no call for
`stale.runningAfterMs` (26 h) or `stale.registeredAfterMs` (72 h) reads "Stale?".
The clock is `lastSeenAt`, which every `register` from the owner moves. The limits
sit above one night and above the longest default run, so a Mac that was off
overnight does not turn an entry stale. Stale changes nothing stored; a late stop
still works normally.

The human can close any live entry from its timeline row (Tauri command
`external_agent_close { id, force?, finishedAt?, endReason? }`). That books it with
`closedBy: "human"`, outcome `killed`, state `stopped` and no runtime. This is the
way out for an entry whose stop never comes. The end is now, unless `finishedAt`
says otherwise: the timeline closes a **stale** entry at its last sign of life
(`finishedAt: lastSeenAt`, `endReason: "lost"`, no force), so a run that died
on Monday does not book as running until Thursday.

## Tokens

The process that ends a run is often not the supervisor: a sandbox pool's reaper or
a timeout runs detached, so the PID walk finds no supervisor and the stop came late
or never. `external_register` therefore hands its caller a **capability token** for
the run (`docs/design-capability-tokens.md`, scope `external_run`):

```json
"token": {
  "token": "auric_cap_…43 characters…",
  "kind": "external_run",
  "resourceId": "ext-1a2b3c4d",
  "actions": ["external_stop"],
  "expiresAt": 1794009600000
}
```

- Shown once. The IDE keeps its SHA-256 only; `newToken: true` on a live run issues
  another (at most 8 live per run; the oldest goes).
- It allows `external_stop` of **that run only**: the key in the call must name the
  run it was issued on (`token_scope` otherwise). It never allows `register`, `list`,
  another run, or `force`.
- The supervisor passes it to the process that will end the run, through the
  environment or a pipe, never a command line or a shared file.
- It is revoked when the run becomes final, by any path (stop, token stop, human
  close, forced close), and expires after `tokenTtlSeconds` (default 72 h, at most
  30 days). A repeat registration does not extend it.
- A token stop carries the same end data as the owner's stop (`outcome`, figures,
  `finishedAt`, `model`, `endReason`). A leaked token can therefore book wrong
  figures on that one run until the owner corrects them with `force`; it cannot
  reach any other run.
- A token stop sets `closedBy: "token"` and books like the owner's stop: its outcome
  is the given one, not `killed`. The owner is unchanged.
- After the run ended the holder hears `token_denied` / `token_revoked`: the run is
  over, nothing to do. Unknown or expired is `token_unknown`.

A token stop on the raw socket (`control.sock`, one JSON line each way):

```json
{"id":1,"method":"external_stop","params":{"externalId":"box-7","runId":"lease-42","token":"auric_cap_…","outcome":"failed","endReason":"timeout","finishedAt":1793782800000}}
{"id":1,"ok":true,"result":{"agent":{"id":"ext-1a2b3c4d","state":"failed","closedBy":"token","endReason":"timeout",…},"alreadyStopped":false,"booked":true}}
```

## Force and corrections

`force: true` on `external_stop` (the owning supervisor, by PID walk, never with a
token) and on `external_agent_close` (the human):

- **On a live entry** it closes it with the values given (`finishedAt` defaults to
  now) and writes an audit record.
- **On a final entry** it replaces the end data with the values given and books the
  run again. The owner may correct `finishedAt`, `outcome`, the figures (given ones
  replace, absent ones stay), `model` and `endReason`; the human `finishedAt` and
  `endReason`. `closedBy` stays who closed it. A forced call that changes nothing
  writes nothing.
- `finishedAt` keeps the clock rule. Moving the end moves the on-spans with it.
- Without `force` nothing changes: a second stop is still a no-op.

Each forced change appends to `corrections` on the entry (at most 16, then
`invalid_params`):

```json
{ "at": 1793790000000, "forcedBy": "supervisor", "agentId": "agent-22", "wasBooked": true,
  "previous": { "state": "stopped", "finishedAt": 1793782800000, "closedBy": null,
                "report": { "activeMs": 9000000, … }, "model": "opus" } }
```

A run that was booked already gets its `pm_agent_usage` row **replaced** (same id),
and a second task log line with `"corrected": true`. **The last line per `agentId`
wins** for a reader of the task log. The line goes into the month of the corrected
`finishedAt`, so a reader of one month must look at the neighbouring month when a
correction moved the end across the boundary.

`force` means both "close this live run" and "correct this final one". A program
that only wants the first should not send it: on a live entry `finishedAt` and the
figures apply without force. The timeline's stale close therefore sends no force;
a hand-set end is audited anyway, and if the run's real stop landed while the
confirm dialog was open, the close changes nothing.

An entry whose owner is no longer in the fleet is orphaned: it stays visible in
every supervisor's timeline while it is live, because otherwise nobody could close
it. Another supervisor still cannot stop it.

## Storage

`<app_data_dir>/external-agents.json`, Rust-owned, mode 0600, version 1, written
through a temp file and a rename. It is read before every change rather than cached,
because the dev and the installed build share the folder. A file lock
(`external-agents.lock`) holds from that read to the rename, so neither two
connections nor two builds can lose each other's entry. `external-agents-changed`
goes out, without a payload, on every change a frontend should read.

An unreadable file or an unknown version is never overwritten: calls answer
`registry_unreadable` and the timeline shows no external rows.

Bounds (`retention` in the fixtures): at most 200 live entries
(`supervisor_denied`, `external_limit`), 64 on-spans per entry (further changes
extend the last span), and final, booked entries are dropped after 7 days. The
history keeps them; only the timeline row goes.

**What is stored.** The fields above and nothing else. Unknown parameters are
refused, so a prompt cannot be passed by accident. Ids and model names have a fixed
alphabet. `name` is one line of at most 80 characters and is refused when it looks
like a credential. There is no free-text reason, error or note field.

**Reported figures are stored as reported**, after a range check (fixtures,
`ranges`). The IDE cannot verify them. They are a report, not an invoice.

## The record

One finished run leaves what any run leaves, plus what tells it apart. No parallel
log exists.

**`pm_agent_usage`, migration 26**, adds to every project database: `active_ms`,
`on_ms`, `agent_runs`, `runtime_partial`, `external_id`, `external_run_id`,
`closed_by`, all nullable. The row has `run_source: "external"`,
`cost_source: "reported"` (`none` if no figures came), `headless: true`,
`match_kind: "exact"`, `agent_id` = the entry's id, and its `id` is derived from
the entry, so a retry cannot book twice. `ticket_status_at_start` stays `NULL`: the
entry does not record it. Absent tokens are 0 here because those columns cannot be
empty; `cost_source` and the task log line keep "nothing came" apart.

The entry is made final first and marked booked last. A project with no database,
or one that stays locked, leaves it final and unbooked; it keeps its figures and
stays until a later call can book it.

`endReason` and the audit trail are not columns; they live on the entry and the
task log line.

**`tasks-YYYY-MM.jsonl`** gets the same fields on external lines only. Lines of
normal agents are unchanged, byte for byte.

```json
{
  "title": "Fix the parser",
  "agentId": "ext-1a2b3c4d",
  "name": "Fix the parser",
  "role": "worker",
  "provider": "claude",
  "model": "opus",
  "status": "success",
  "startedAt": "2026-11-03T22:00:00.000Z",
  "finishedAt": "2026-11-04T07:00:00.000Z",
  "durationMs": 32400000,
  "projectPath": "/tmp/example-project",
  "spawnedByAgentId": "agent-22",
  "ticketId": "…",
  "inputTokens": 1200,
  "outputTokens": 800,
  "source": "external",
  "externalId": "box-7",
  "runId": "lease-42",
  "onMs": 10800000,
  "activeMs": 9000000,
  "agentRuns": 1,
  "costSource": "reported",
  "cacheReadTokens": 50000,
  "cacheWriteTokens": 900
}
```

| Field            | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `source`         | `"external"`; absent on a normal agent's line                                            |
| `durationMs`     | Registered time: first registration to stop, off phases included                         |
| `onMs`           | The time the IDE was told it was `running`                                               |
| `activeMs`       | Real runtime as reported; **absent when unknown, never 0**                               |
| `runtimePartial` | The reporter marked the runtime as cut off                                               |
| `closedBy`       | `"human"` when closed by hand, `"token"` when stopped with a token; absent for the owner |
| `endReason`      | The end reason, when one was given                                                       |
| `corrected`      | `true` on a line that replaces an earlier one for the same run                           |

### What a billing script must read

`durationMs` is not working time on an external line. The rule:

```text
billable = source == "external" ? (activeMs ?? onMs, flagged for a look) : durationMs
```

The Costs views apply the same rule (`usageRunMs`, `src/lib/pm/usage/aggregate.ts`),
so a box that lay parked all night does not add ten hours to a ticket.

External runs do not count towards load balancing (`runs_by_provider_since`):
balancing steers what the supervisor spawns, and these it did not spawn through
the IDE.

## The timeline

A row below the supervisor's family, never clickable, always labelled "External".

- The bar spans registration to stop. Off time is grey and dashed, on time solid
  (`onSpans`), so "registered" never reads as "working".
- With a ticket, the label starts with the ticket's name, like the conductor's
  `conductor:<ticket>`.
- The badge reads Off, Stale?, Stopped or Failed; plain running shows only External.
- `Agents · N running` keeps counting real agents. External ones get their own
  figure beside it ("N external"), counting on entries only.
- Close asks first, and appears only on live entries.

## Not in this version

- The supervisor link does not show external runs.
- Per-model token splits. One row, one model.
- Ticket status is not moved by a registration or a stop. That stays with the
  ticket's owner.
