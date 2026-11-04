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

| Parameter     | Type                                | Rule                                                  |
| ------------- | ----------------------------------- | ----------------------------------------------------- |
| `externalId`  | string, required                    | The caller's name for the run, such as a box name     |
| `runId`       | string                              | Tells runs of one `externalId` apart, such as a lease |
| `projectPath` | string, required                    | Path or name of a project in the supervisor policy    |
| `name`        | string, required                    | One line, shown on the timeline                       |
| `provider`    | string, required                    | For the log only; no policy check, nothing is spawned |
| `model`       | string                              | For the log only                                      |
| `ticketId`    | string                              | Full id or unique prefix (4+) in that project         |
| `goalId`      | string                              | The same; default is the ticket's goal                |
| `state`       | `registered` \| `running`, required | Off (known, not working) or on                        |
| `startedAt`   | Unix ms                             | Used only when the entry is created; default now      |

Answers `{ agent, created, changed }`. It is safe to call again at any time:

- Unknown key: creates the entry.
- Known and live: moves it between `registered` and `running` if `state` differs,
  updates `name`, `provider`, `model`, `ticketId` and `goalId` if given, and
  counts as a sign of life. A different project is `invalid_params`.
- Already stopped: changes nothing (`changed: false`). A new run of the same box
  needs a new `runId`.

### `stop_external_agent` (`external_stop`)

| Parameter                                                            | Rule                                       |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `externalId`, `runId`                                                | The same key as at registration            |
| `outcome`                                                            | `success` (default) \| `failed`            |
| `activeSeconds`                                                      | Real runtime, as reported                  |
| `agentRuns`, `partial`                                               | Starts of the agent; figures cut off       |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | As reported                                |
| `costUsd`                                                            | As reported; absent stays unknown, never 0 |
| `model`                                                              | Replaces the registered model              |
| `finishedAt`                                                         | Unix ms; default now                       |

Answers `{ agent, alreadyStopped, booked }`. A second stop changes nothing and
books nothing, whatever figures it carries: the first stop wins. `booked: false`
means the entry is final but a write to the history failed; the IDE tries again
at every later call and at start.

### `list_external_agents` (`external_list`)

Answers `{ agents }`: the caller's own entries, so a resumed supervisor can see
what it left open.

## Who may call

Only a supervisor, and only for its own entries. Identity comes from the control
socket's PID walk, as everywhere.

- A worker gets `forbidden_agent_caller`. An outside client on `control.sock` gets
  `outside_supervisor_scope`, and the supervisor link, which dispatches as one, has
  no route to these methods.
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
`external_agent_close { id }`). That books it with `closedBy: "human"`, outcome
`killed`, state `stopped` and no runtime. This is the way out for an
entry whose stop never comes.

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

| Field            | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `source`         | `"external"`; absent on a normal agent's line                    |
| `durationMs`     | Registered time: first registration to stop, off phases included |
| `onMs`           | The time the IDE was told it was `running`                       |
| `activeMs`       | Real runtime as reported; **absent when unknown, never 0**       |
| `runtimePartial` | The reporter marked the runtime as cut off                       |
| `closedBy`       | `"human"` when closed by hand                                    |

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
