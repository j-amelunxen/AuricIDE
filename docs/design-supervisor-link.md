# The supervisor link — Supervisor Control API

Status: contract v1, revised 2026-10-17 (documents and jobs replace the
scene methods of the first draft; no client was live on those). The
machine-checkable half is `src/lib/agents/supervisorLink.fixtures.json`; Rust
reads it in its tests. **Change the fixtures first**, then both this file and
the code.

A client — any app running on the same machine, typically the backend of an
assistant app — talks to AuricIDE's supervisors over one bidirectional
WebSocket instead of a handful of MCP tools. Over it the client can:

- start a supervisor, list the supervisors and every agent they started,
- read what is on a supervisor's (or its children's) console and get every new
  line pushed as it appears,
- type into a supervisor and submit,
- stop an agent in that tree,
- find, read and resolve JSON documents stored in the projects, and propose
  changes to them as a git branch the human merges or deletes,
- run a **job** in a project: an agent that works in its own worktree and
  leaves its result on a branch, followed by events until it ends.

AuricIDE knows no client, no document format and no job kind. What a document
is and which jobs exist is configuration per project, written by the human in
Settings → Supervisor → Supervisor link. The examples below use a document
type `diagram` and a job kind `diagram.draw`; a project could just as well
describe 3D scenes, test plans or anything else stored as JSON.

## Shape

```
client server ──WebSocket over unix socket──▶ Rust supervisor_link ──▶ control_socket::Dispatcher ──▶ AgentManager / PTY
                                                 │                          └─ spawn/kill ─▶ frontend store (same path as the UI)
                                                 ├─ events pump (agent list, output buffers, job register; every 250 ms)
                                                 ├─ documents (files the project's document types describe)
                                                 └─ jobs (headless agent in a worktree, under the supervisor policy; 2 s tick)
```

- **The link is a narrower door, not a new one.** Everything it does to agents
  goes through the dispatcher that already answers `control.sock`
  (`docs/design-agent-control.md`), as an external caller, after the link has
  checked its own scope. It can therefore never do more than `control.sock`
  already lets the same process do. It does less: only the supervisor tree, no
  plain worker spawns, no project outside the link policy, and a job's agent
  gets no right a supervisor's child would not get.
- **The client's backend is the client, not a browser.** The transport is a
  unix socket, so a web page cannot open it. The client's server holds the
  connection and relays to its own UI.

## Transport

| What        | Value                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Socket      | `<app_data_dir>/supervisor-link.sock` (`~/Library/Application Support/com.auricide.ide/supervisor-link.sock`) |
| Override    | The client may read `AURIC_LINK_SOCKET`.                                                                      |
| Permissions | Mode 0600. Rust removes a stale file before binding.                                                          |
| Protocol    | WebSocket (RFC 6455) over that socket. Request path `/v1`; any other path is answered with HTTP 404.          |
| Frames      | Text frames, one JSON message per frame. Binary frames are refused (`invalid_request`).                       |
| Max message | 1 MiB inbound. A larger one closes the connection with code 1009.                                             |
| Keep-alive  | The server pings every 30 s. Standard clients answer automatically.                                           |

With Node's `ws` package:

```ts
import WebSocket from 'ws';
const socket = `${process.env.HOME}/Library/Application Support/com.auricide.ide/supervisor-link.sock`;
const ws = new WebSocket(`ws+unix://${socket}:/v1`);
```

Only one AuricIDE build serves the socket at a time (dev and installed share
the path, the first one to start wins), exactly like `control.sock`.

### Who may connect

Rust reads the peer's PID from the socket and walks its parent chain, as
`control.sock` does. A process that is, or descends from, **any** running IDE
agent is refused, supervisors and job agents included: an agent must not
steer its own supervisor or start jobs. A peer whose PID cannot be read is
refused too. The refusal comes after the handshake as one `error` message,
then a close with code 1008:

```json
{
  "v": 1,
  "type": "error",
  "error": {
    "code": "forbidden_agent_caller",
    "message": "agent-2 is an IDE agent; agents may not use the supervisor link"
  }
}
```

The `code` is fixed; the `message` is for people and names the cause. It
reads `<agentId> is an IDE agent; …` when the nearest agent in the parent
chain is a supervisor, `process <pid> runs inside an IDE agent; agents may not
use the supervisor link` for any other agent, and `the connecting process could
not be identified` or `the ancestry of process <pid> could not be traced to
launchd; it is refused like an agent` when the walk cannot finish. Match on
`code`, never on the text.

No token. The socket's mode keeps other users out; the parent walk keeps
agents out. What is left open is what ADR 0003 already names for
`control.sock`: an agent that fully detaches a process (double fork,
reparented to `launchd`) is no longer in that process's chain.

## Messages

Every message carries `"v": 1`. A message with another `v` is answered with
`unsupported_version` and otherwise ignored. Field names are camelCase.

```ts
type ClientMessage = {
  v: 1;
  id: string | number; // echoed in the response
  method: Method;
  params?: object; // omitted = {}
};

type ServerMessage =
  | { v: 1; type: 'response'; id: string | number; ok: true; result: unknown }
  | { v: 1; type: 'response'; id: string | number | null; ok: false; error: LinkError }
  | { v: 1; type: 'event'; seq: number; event: EventName; data: unknown }
  | { v: 1; type: 'error'; error: LinkError }; // only before a close

type LinkError = { code: ErrorCode; message: string; reason?: string };
```

- Requests on one connection are answered **in order**. A slow one (a spawn
  waits for the IDE window, up to 30 s) holds the ones behind it; events still
  flow meanwhile.
- `seq` counts events on this connection from 1, without gaps. A gap means the
  client lost a frame and should resubscribe.
- A message that is not JSON, or has no string `method`, gets a response with
  `id: null` (or the id, when one was readable) and `invalid_request`.
- Unknown params are refused (`invalid_params`), so a typo does not quietly do
  the default.

## Methods

| method               | params                                                                                | result                            |
| -------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| `session.hello`      | `{ client?: string }`                                                                 | `Hello`                           |
| `supervisors.spawn`  | `{ task?: string, provider?: string, model?: string }`                                | `{ agentId }`                     |
| `agents.list`        | —                                                                                     | `{ agents: LinkAgent[] }`         |
| `agents.read`        | `{ agentId, sinceOffset?: number, tailBytes?: number }`                               | `OutputChunk`                     |
| `agents.send`        | `{ agentId, text: string, submit?: boolean (default true) }`                          | `{ agentId, bytesWritten }`       |
| `agents.kill`        | `{ agentId }`                                                                         | `{ agentId, killed: true }`       |
| `events.subscribe`   | `{ agentIds?: string[], output?: boolean, sinceOffsets?: Record<string, number> }`    | `{ agents: LinkAgent[] }`         |
| `events.unsubscribe` | —                                                                                     | `{ subscribed: false }`           |
| `documents.projects` | —                                                                                     | `{ projects: DocumentProject[] }` |
| `documents.search`   | `{ query?: string, project?: string, type?: string, limit?: number }`                 | `{ documents: DocumentEntry[] }`  |
| `documents.get`      | `{ project, type, id, rev?: string }`                                                 | `Document`                        |
| `documents.resolve`  | `{ project, type, from, ref, rev?: string }`                                          | `Document`                        |
| `documents.propose`  | `{ project, type, id, document: object, baseHash: string \| null, message?: string }` | `Proposal`                        |
| `jobs.create`        | `{ project, kind: string, payload: any }`                                             | `JobStarted`                      |
| `jobs.list`          | `{ project?: string, status?: JobStatus, limit?: number }`                            | `{ jobs: Job[] }`                 |
| `jobs.cancel`        | `{ jobId }`                                                                           | `{ jobId, cancelled, status }`    |

### `session.hello`

Optional, but the way to learn what this build offers:

```json
{
  "v": 1,
  "type": "response",
  "id": 1,
  "ok": true,
  "result": {
    "protocol": 1,
    "server": "AuricIDE",
    "methods": ["session.hello", "supervisors.spawn", "agents.list", "…"],
    "events": ["agent.added", "agent.updated", "agent.removed", "agent.output", "job.started", "…"]
  }
}
```

A later version adds methods; it never changes what an existing one means
without raising `v`.

### The supervisor tree

`LinkAgent` is the agent as `control.sock` reports it (`AgentSummary` in
`docs/design-agent-control.md`):

```ts
type LinkAgent = {
  id: string;
  name: string;
  model: string;
  provider: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  role: 'worker' | 'supervisor';
  spawnedByAgentId: string | null; // the supervisor that started it
  currentTask: string | null;
  startedAt: number;
  lastActivityAt: number | null; // ms since the epoch
  projectPath: string | null;
  repoPath: string | null;
  headless: boolean;
  outputBytes: number; // running offset of its console text
  // …plus the remaining AgentSummary fields, passed through unchanged
};
```

The **tree** is every agent whose role is `supervisor`, every agent whose
`spawnedByAgentId` chain leads to one, and the agent of every job
(`jobs.create`). An agent the human started from the IDE
is not in it. Every method that takes an `agentId` answers an id outside the
tree with `unknown_agent`, exactly like an id that does not exist: the
client learns nothing about agents it may not touch.

This holds after `agents.kill` too. A killed agent's card leaves the tree
(`agent.removed`), and the console buffer that outlives it records no lineage,
so the link cannot tell a finished member of the tree from a finished agent the
human started. `agents.send`, `agents.read` and `agents.kill` on a removed id
therefore answer `unknown_agent`, not `agent_not_running`: the latter would
confirm that an id from outside the tree once existed. `agent_not_running` is
for an agent that is still in the tree but not running (for example `idle` or
`error`). A client that gets `unknown_agent` after it killed an agent itself
should read it as "gone", and it also has the `agent.removed` event.

### `supervisors.spawn`

Starts a **new** supervisor, built exactly like one from the Supervisor tile in
Quick Access: the launch prompt from the supervisor policy, the human's
standing instructions from Settings → Supervisor, its own run folder, its
approved skills and tools. `task` becomes its first task. `provider` and
`model` default to the policy's supervisor settings; a provider the policy does
not list is refused. The IDE never opens its provider picker for a link spawn.

Unlike the tile, a running supervisor is not reused: the link asked for a new
one. To talk to a running one, use `agents.send`.

Errors: `supervisor_unavailable` when the policy shows the supervisor no
project yet (the human has to allow one in Settings → Supervisor first),
`invalid_params` for a provider the policy does not list,
`provider_unsupported` for a provider the policy lists but the supervisor
cannot run on (v1: `claude` and `codex`),
`frontend_unavailable` when the IDE window did not answer within 30 s.

### `agents.read`

Same as `control.sock`'s `read_output`: cleaned console text, offsets in bytes
of that text, `tailBytes` default 16384 and max 262144, `sinceOffset` for only
what is new, `truncated` when the buffer no longer reaches back that far. It is
still a redrawing terminal, so expect repeated fragments rather than a
transcript.

```ts
type OutputChunk = {
  agentId: string;
  status: LinkAgent['status'];
  text: string;
  startOffset: number;
  endOffset: number;
  truncated: boolean;
};
```

### `agents.send`

Writes `text` and, when `submit` is true, the Enter key (`\r`, what a terminal
sends; `\n` would only add a line in Claude Code's input box). An empty `text`
with `submit: true` is a bare Enter. The message shows up in the IDE's console
feed like one typed there.

Allowed for every agent in the tree, workers included. That includes answering
a worker's permission prompt, which is why the tree ends where the human's own
agents begin.

Refused with `headless_no_stdin` for a headless agent, `agent_not_running`
when it is in the tree but not running. A killed agent is no longer in the
tree and answers `unknown_agent` (see "The supervisor tree").

### `agents.kill`

Same store action as the kill button in the IDE. The IDE shows a toast naming
the link as the one who stopped it.

### Events

`events.subscribe` replaces the connection's subscription and returns the tree
as it is now, so the client starts from a consistent picture.

- `agentIds` omitted: the whole tree, including agents that join it later. Given:
  only those (ids outside the tree are refused with `unknown_agent`).
- `output` (default `true`): push console text for the subscribed agents.
- `sinceOffsets`: per agent, the offset to continue from after a reconnect.
  Without it, output starts at the agent's current `outputBytes` (nothing old
  is replayed; use `agents.read` for history).
- `jobs` (default `true`): push `job.*` events for every job (see "Jobs").
  Nothing old is replayed; `jobs.list` gives the state after a reconnect.

| event           | data                   | when                                                      |
| --------------- | ---------------------- | --------------------------------------------------------- |
| `agent.added`   | `{ agent: LinkAgent }` | an agent joined the tree (a supervisor started a child)   |
| `agent.updated` | `{ agent: LinkAgent }` | status, name, current task or project of an agent changed |
| `agent.removed` | `{ agentId }`          | the agent left the IDE's list (its card was cleared)      |
| `agent.output`  | `OutputChunk`          | new console text                                          |

Events are collected every 250 ms. `agent.output` for one agent carries
everything new since the last one (at most 256 KiB; `truncated: true` when more
was lost). `lastActivityAt` and `outputBytes` alone do not raise
`agent.updated`; they ride along on the next one, and output has its own event.

```json
{
  "v": 1,
  "type": "event",
  "seq": 42,
  "event": "agent.output",
  "data": {
    "agentId": "agent-12",
    "status": "running",
    "text": "Spawned agent-13 in example-product\n",
    "startOffset": 18211,
    "endOffset": 18239,
    "truncated": false
  }
}
```

## Who sees what

`<app_data_dir>/supervisor-link.json`, written by Rust at mode 0600 and edited
in Settings → Supervisor → Supervisor link:

```json
{
  "version": 2,
  "projects": {
    "/Users/me/src/example-product": {
      "documentTypes": [
        {
          "name": "diagram",
          "globs": ["docs/**/*.diagram.json"],
          "index": { "path": "docs/diagrams.index.json", "entriesKey": "documents" },
          "nameField": "meta.title",
          "descriptionField": "meta.subtitle",
          "schema": "docs/diagram.schema.json"
        }
      ],
      "jobKinds": [
        {
          "kind": "diagram.draw",
          "instructions": "docs/agents/draw-diagram.md",
          "writes": ["docs/**/*.diagram.json", "docs/diagrams.index.json"]
        }
      ]
    }
  },
  "jobs": { "dailyLimit": 20, "perProjectDailyLimit": null }
}
```

- **A project not listed does not exist for the link**: `documents.search`
  skips it and every other document or job method answers
  `document_not_visible`. A project listed without document types or job
  kinds is visible but offers nothing.
- **It fails closed.** A missing or broken file, or an unknown `version`,
  means no project is visible. A project entry that does not validate is
  dropped on read, so a hand edit cannot half-open a project. Paths are
  compared canonically (symlinks resolved).
- **Validation** (on write, and again on read): project paths absolute; type
  and kind names `^[a-z0-9][a-z0-9._-]*$`, at most 64 characters, unique per
  project; globs and file paths project-relative (no leading `/`, no `.` or
  `..` segment, no `\\`); a type has at least one glob; a kind may write
  something (its own `writes`, else every document type's globs). The
  fixture `policyRejects` lists the refusals.
- **Globs** know `*` and `?` within one path segment and `**` as a whole
  segment for any number of them, nothing else (fixture `globs`).
- **Migration from version 1.** The first draft stored
  `{ "version": 1, "scenes": { "projects": [..] } }`. Each listed project is
  read as a project with exactly one document type, `scene`, carrying the
  places and names that draft had fixed (fixture `migration.v1DocumentType`)
  and no job kinds. The next save writes version 2.

## Documents

A document is a file in a visible project that one of the project's document
types matches. Nothing else is read.

- **Identity:** `type` plus `id`, the project-relative path:
  `{ "type": "diagram", "id": "docs/architecture/system.diagram.json" }`. An
  id's segments start alphanumeric and hold only `[A-Za-z0-9._-]`; no `..`, no
  empty or hidden segment (fixture `documentIds`). An id the type's globs do
  not match is `invalid_params`.
- **Content:** a JSON object, at most 256 KiB. The IDE checks nothing else;
  the format is between the project and its clients. `schema` (when the type
  names one) is handed on to clients and agents, never enforced by the IDE.
- **Names in a listing:** the index entry when the type has an index file,
  else the string at `nameField` / `descriptionField` (dotted paths) in the
  document, else the file name without the type's suffix. An index is
  `{ "<entriesKey>": [{ "id", "name", "description", "tags" }] }`; an entry's
  `id` may be the full id or the id without the suffix. A broken index is no
  index.
- **Suffix:** the literal end of a glob after its last wildcard
  (`.diagram.json` for `docs/**/*.diagram.json`).
- **Hash:** the git blob hash of the file's bytes (`git hash-object`), so a
  client can compare it with git itself.

### `documents.projects`

```ts
type DocumentProject = {
  path: string;
  name: string;
  isGitRepo: boolean;
  documentTypes: { name: string; globs: string[]; schema: string | null }[];
  jobKinds: string[];
};
```

### `documents.search`

Case-insensitive match of every word of `query` against id, name, description
and tags; no `query` lists everything. `project` and `type` narrow it.
`limit` defaults to 50, max 200. Ordered by project, type, then id. Each type
is walked from the fixed folder its globs start with, at most 8 levels deep
and 2000 documents per project.

```ts
type DocumentEntry = {
  project: string;
  type: string;
  id: string;
  path: string; // absolute file path
  name: string;
  description: string | null;
  tags: string[];
  hash: string;
};
```

### `documents.get`

```ts
type Document = {
  project: string;
  type: string;
  id: string;
  path: string;
  hash: string;
  rev: string | null; // the commit it was read at; null = the working tree
  merged: boolean | null; // null without rev; false = the commit is not in HEAD
  document: object;
};
```

Without `rev` the file is read from the working tree, which is what the human
sees. With `rev` (anything `git rev-parse` accepts: a branch, a tag, a commit)
it is read from that commit, `rev` in the result is the full commit id, and
`merged` says whether that commit is `HEAD` or an ancestor of it.

**Preview before merge.** A job or a proposal leaves its result on a branch.
The client reads it with `rev` set to the branch (or the commit from the
`job.finished` event). While `merged` is `false` the client must present it as
a preview — for example a badge "Preview, not merged" on the drawing and the
branch name beside it — and keep the working-tree version (no `rev`) as what
is real. Once the human merged the branch, the same read answers
`merged: true`, and a read without `rev` shows the new content.

Errors: `document_not_visible`, `document_not_found` (also for a `rev` git
does not know), `document_invalid` (not JSON, not an object, too large),
`invalid_params` (bad id, unknown type, relative project path),
`not_a_git_repo` (a `rev` in a project without a repository).

### `documents.resolve`

For drilldown: a node points at another document, the client hands the
pointer over and gets the document back. `from` is the id of the document the
pointer is in, `ref` the pointer, both of type `type`. The candidates, most
likely first (fixture `resolve`):

1. `ref` relative to the folder of `from`, as written, then with the type's
   suffix added (when it does not end with it already);
2. unless `ref` starts with `./` or `../`: the same relative to the project
   root.

Candidates the type's globs do not match are dropped; the first that exists
(at `rev`, or in the working tree) is read like `documents.get`. None exists:
`document_not_found`. None is a document of the type, or `ref` is empty,
absolute or climbs out of the project: `invalid_params`.

### `documents.propose`

The link never writes into a project's folder. A proposal becomes a commit on a
**new branch**, built straight from the project's `HEAD` without touching the
working tree, the index or the checked-out branch.

- `document` is the full new content (not a patch); it is written as
  pretty-printed JSON with a trailing newline.
- `baseHash` is required: the hash of the document the change is based on, as
  `documents.get` returned it, or `null` for a new document. If the file at
  `HEAD` has another hash (or exists although `null` was sent), the answer is
  `document_conflict` and nothing is written.
- Branch name: `auric/proposal/<file name without suffix>-<8 hex>`.
- Commit message: `<type>: propose <id>`, then `message` as the body when
  given. Author and committer are the repository's configured git user.
- The IDE drops one notification into the project's inbox.

```ts
type Proposal = {
  project: string;
  type: string;
  id: string;
  branch: string;
  commit: string;
  base: string; // the HEAD commit it was built on
  created: boolean; // true when the document did not exist at HEAD
  hash: string; // hash of the proposed content
};
```

Errors: `document_not_visible`, `document_conflict`, `document_invalid`,
`not_a_git_repo` (no repository, or no commit yet), `invalid_params`.

## Jobs

A job is work a client asks an agent to do in a project: "draw the diagram
for the auth module", "update the overview after this change". The client
names a **kind** the project lists and hands over a **payload**; the IDE
starts one agent, follows it and reports the branch it leaves behind. The
human reviews and merges like any other branch.

### `jobs.create`

```ts
type CreateJob = { project: string; kind: string; payload: unknown }; // payload ≤ 16 KiB as JSON, required (null allowed)
type JobStarted = {
  jobId: string; // "job-<12 hex>"
  agentId: string;
  branch: string | null;
  base: string | null; // the commit the branch started from
  provider: string;
  model: string;
};
```

In this order, the first that fails is the answer:

1. The project is listed (`document_not_visible`) and the kind is one of its
   `jobKinds` (`job_kind_not_allowed`, naming the allowed ones).
2. The kind's `instructions` file exists in the working tree, and the project
   is the root of a git repository with a commit (`invalid_params`,
   `not_a_git_repo`).
3. The counter has room (`quota_exceeded`, see below).
4. The supervisor policy allows it (`supervisor_denied`, `reason` = the rule):
   the project must be open to supervisors (Settings → Supervisor), the
   provider is the project's load-balancing `next`, else the supervisor's own
   provider if allowed there, else the first allowed one; the model is the
   **smallest ranked** model of that provider the project allows (unranked
   models are never picked, `reason: "no_ranked_model"`). Then the same
   `check_spawn` a supervisor's child passes: permission mode not
   unattended, `maxRunning` of the project and in total, with running jobs
   counted as one supervisor's children. **The client cannot choose provider,
   model, permission mode or anything else about the agent.**

The agent then runs **headless** (no stdin, nobody can answer a prompt) in a
**git worktree of its own** on a new branch; it is part of the supervisor
tree, so `agents.read` and the `agent.*` events show its console. Nothing
before step 4 counts against the counter; from step 4 on the job counts, even
when it fails later.

What the agent is told, in this order: the job id and kind; that the kind's
instructions file in the repository describes the work; the IDE's rules (write
only paths matching the kind's `writes`, stay inside the repository, no
secrets or network, commit on its branch with `<kind>: <jobId>`); then the
payload, pretty-printed between `<<<PAYLOAD-<12 hex>` and `PAYLOAD-<12 hex>>>>`
with a fence the client cannot know in advance, introduced as data from a
client and never instructions of its own.

### Following a job

A tick every 2 s looks at each running job:

- While the agent runs: the paths it changed so far (committed or not) that
  it may write. When that set changes, a `job.progress` event.
- When the agent stopped: anything it left **uncommitted in paths it may
  write** is committed on its branch (an agent whose permission mode did not
  let it run `git commit` loses nothing; leftovers elsewhere stay where they
  are, uncommitted). Then the branch is compared with its base and the job
  ends: `job.finished`, or `job.failed` with a code. Either way one
  notification goes to the project's inbox, naming the branch.

```ts
type JobStatus = 'running' | 'finished' | 'failed';
type Job = {
  jobId: string;
  project: string;
  kind: string;
  payload: unknown;
  status: JobStatus;
  agentId: string;
  provider: string;
  model: string;
  branch: string | null;
  worktree: string | null;
  base: string | null;
  createdAt: number; // ms since the epoch
  finishedAt: number | null;
  commit: string | null; // the branch's last commit once ended
  changed: string[]; // paths it may write that changed
  documents: { type: string; id: string; hash: string; created: boolean }[];
  files: string[]; // changed paths it may write that are no document, or were deleted
  otherFiles: string[]; // changed paths outside what it may write — check before merging
  error: { code: JobErrorCode; message: string } | null;
  cancelRequested: boolean;
};
type JobErrorCode =
  | 'agent_failed' // the agent ended with an error
  | 'no_changes' // it ended without changing a file it may write
  | 'document_invalid' // a document it wrote is no JSON object or too large
  | 'cancelled' // jobs.cancel
  | 'interrupted' // AuricIDE quit while it ran
  | 'internal';
```

| event          | data                                                                      | when                             |
| -------------- | ------------------------------------------------------------------------- | -------------------------------- |
| `job.started`  | `{ job: Job }`                                                            | `jobs.create` started the agent  |
| `job.progress` | `{ jobId, project, kind, agentId, branch, changed: string[], elapsedMs }` | the set of changed paths changed |
| `job.finished` | `{ job: Job }`                                                            | it ended with valid changes      |
| `job.failed`   | `{ job: Job }` (`job.error` set)                                          | it ended otherwise               |

`job.*` events go to every subscribed connection, whoever created the job.
A headless agent prints nothing until it ends, so `job.progress` (from the
files) is the progress signal, not its console.

### `jobs.list` and `jobs.cancel`

`jobs.list` answers the register newest first, `limit` 1..200 (default 50).
The register is `<app_data_dir>/supervisor-link-jobs.json` (0600); finished
jobs stay seven days (at most 500), so the counter survives a restart. A job
that was running when AuricIDE quit is `failed` with `interrupted` on the next
start: its agent ended with the app.

`jobs.cancel` stops a running job's agent (the same kill as the IDE's button);
the next tick ends it as `failed` with `cancelled`, the branch reported as it
stands. A job that already ended answers `{ cancelled: false, status }`. An
unknown id is `unknown_job`.

### The counter

Not a budget, a guard against a client that starts jobs in a loop: at most
`jobs.dailyLimit` jobs (default **20**) in any 24 hours in all projects
together, and optionally `jobs.perProjectDailyLimit` per project. `0` switches
jobs off; each is at most 1000. Over it, `jobs.create` answers
`quota_exceeded` with `reason` `daily_limit` or `project_daily_limit` and a
message saying when the next slot frees up (fixture `jobs.quota`). Settings →
Supervisor → Supervisor link edits both and shows how many ran in the last 24
hours. The cost of each job still lands in the usage reports like any agent
run (`runSource: "supervisor"`).

## Error codes

| code                     | meaning                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `invalid_request`        | not JSON, not a text frame, no `method`                                     |
| `unsupported_version`    | `v` is not `1`                                                              |
| `unknown_method`         | no such method in this build                                                |
| `invalid_params`         | params missing, of the wrong type, unknown, or out of range                 |
| `forbidden_agent_caller` | the connecting process runs inside an IDE agent                             |
| `unknown_agent`          | no such agent, not in the supervisor tree, or already removed               |
| `agent_not_running`      | the agent is in the tree but not running                                    |
| `headless_no_stdin`      | a headless agent cannot be typed into                                       |
| `supervisor_unavailable` | the supervisor policy shows a supervisor no project yet                     |
| `provider_denied`        | the provider policy refused the spawn                                       |
| `provider_unsupported`   | the supervisor cannot run on that provider (v1: `claude`, `codex`)          |
| `frontend_unavailable`   | the IDE window did not answer within 30 s                                   |
| `document_not_visible`   | the project is not in the link policy                                       |
| `document_not_found`     | no such document (at that revision)                                         |
| `document_invalid`       | the file or the proposed content is not a JSON object, or too large         |
| `document_conflict`      | `baseHash` does not match `HEAD`                                            |
| `not_a_git_repo`         | the project has no git repository, or no commit to build a branch on        |
| `supervisor_denied`      | the supervisor policy refused a job's agent; `reason` names the rule        |
| `job_kind_not_allowed`   | the project does not list that job kind                                     |
| `quota_exceeded`         | the job counter is full; `reason` is `daily_limit` or `project_daily_limit` |
| `unknown_job`            | no such job                                                                 |
| `internal`               | anything else; the message says what                                        |

## Examples

Start a supervisor and follow it:

```json
→ { "v": 1, "id": "a", "method": "events.subscribe", "params": {} }
← { "v": 1, "type": "response", "id": "a", "ok": true, "result": { "agents": [] } }
→ { "v": 1, "id": "b", "method": "supervisors.spawn", "params": { "task": "Plan the export for example-product" } }
← { "v": 1, "type": "event", "seq": 1, "event": "agent.added", "data": { "agent": { "id": "agent-12", "role": "supervisor", "status": "running", "…": "…" } } }
← { "v": 1, "type": "response", "id": "b", "ok": true, "result": { "agentId": "agent-12" } }
```

Answer it:

```json
→ { "v": 1, "id": "c", "method": "agents.send", "params": { "agentId": "agent-12", "text": "Yes, go ahead" } }
← { "v": 1, "type": "response", "id": "c", "ok": true, "result": { "agentId": "agent-12", "bytesWritten": 14 } }
```

Load a document, drill into a node, propose a change:

```json
→ { "v": 1, "id": 1, "method": "documents.search", "params": { "query": "architecture", "type": "diagram" } }
← { "v": 1, "type": "response", "id": 1, "ok": true, "result": { "documents": [
    { "project": "/Users/me/src/example-product", "type": "diagram", "id": "docs/architecture/system.diagram.json",
      "path": "/Users/me/src/example-product/docs/architecture/system.diagram.json",
      "name": "example-product", "description": "Services and queues", "tags": ["architecture"],
      "hash": "5b1f0c…" } ] } }
→ { "v": 1, "id": 2, "method": "documents.resolve", "params": { "project": "/Users/me/src/example-product", "type": "diagram", "from": "docs/architecture/system.diagram.json", "ref": "modules/auth" } }
← { "v": 1, "type": "response", "id": 2, "ok": true, "result": { "id": "docs/architecture/modules/auth.diagram.json", "hash": "9e07aa…", "rev": null, "merged": null, "document": { "nodes": [ … ] }, "…": "…" } }
→ { "v": 1, "id": 3, "method": "documents.propose", "params": { "project": "/Users/me/src/example-product", "type": "diagram", "id": "docs/architecture/modules/auth.diagram.json", "baseHash": "9e07aa…", "document": { "nodes": [ … ] }, "message": "Mark the token cache as the hot spot" } }
← { "v": 1, "type": "response", "id": 3, "ok": true, "result": { "branch": "auric/proposal/auth-3fa1c2d9", "commit": "c0ffee…", "base": "abc123…", "created": false, "hash": "71d2e4…", "…": "…" } }
```

Ask for a job, follow it, preview the result:

```json
→ { "v": 1, "id": 4, "method": "jobs.create", "params": { "project": "/Users/me/src/example-product", "kind": "diagram.draw",
    "payload": { "parent": "docs/architecture/system.diagram.json", "node": "auth", "request": "Open up the auth module", "depth": 1 } } }
← { "v": 1, "type": "event", "seq": 7, "event": "job.started", "data": { "job": { "jobId": "job-4b1e09c2aa71", "status": "running", "branch": "auric/diagram-draw-job-4b1e…", "…": "…" } } }
← { "v": 1, "type": "response", "id": 4, "ok": true, "result": { "jobId": "job-4b1e09c2aa71", "agentId": "agent-21", "branch": "auric/…", "base": "abc123…", "provider": "claude", "model": "…" } }
← { "v": 1, "type": "event", "seq": 9, "event": "job.progress", "data": { "jobId": "job-4b1e09c2aa71", "changed": ["docs/architecture/modules/auth.diagram.json"], "elapsedMs": 84000, "…": "…" } }
← { "v": 1, "type": "event", "seq": 12, "event": "job.finished", "data": { "job": { "jobId": "job-4b1e09c2aa71", "status": "finished", "commit": "d00d1e…",
    "documents": [ { "type": "diagram", "id": "docs/architecture/modules/auth.diagram.json", "hash": "aa31…", "created": true } ], "otherFiles": [], "…": "…" } } }
→ { "v": 1, "id": 5, "method": "documents.get", "params": { "project": "/Users/me/src/example-product", "type": "diagram", "id": "docs/architecture/modules/auth.diagram.json", "rev": "d00d1e…" } }
← { "v": 1, "type": "response", "id": 5, "ok": true, "result": { "rev": "d00d1e…", "merged": false, "document": { … }, "…": "…" } }
```

The payload's shape (`parent`, `node`, `request`, `depth` above) is whatever
the kind's instructions file says; the IDE passes it on unread.

A refusal:

```json
→ { "v": 1, "id": 6, "method": "jobs.create", "params": { "project": "/Users/me/src/example-product", "kind": "diagram.draw", "payload": null } }
← { "v": 1, "type": "response", "id": 6, "ok": false, "error": { "code": "quota_exceeded", "reason": "daily_limit",
    "message": "20 jobs in 24 hours in all projects reached (Settings → Supervisor → Supervisor link); the next one frees up in 42 min" } }
```

## Security notes

- **`currentTask` of a supervisor is its full launch prompt.** `agents.list`,
  `events.subscribe` and `agent.added` / `agent.updated` pass the `AgentSummary`
  fields through unchanged, so for a supervisor `currentTask` holds the
  generated launch prompt, including the human's standing instructions from
  Settings → Supervisor and the list of allowed projects; for a job's agent it
  holds the job prompt, payload included. This is a conscious decision: a
  connected client is the human's own tool, already trusted to type into the
  tree and to start supervisors. Do not put secrets into the standing
  instructions. If that stops being acceptable, the fix is to redact
  `currentTask` in `LinkAgent`, a breaking change to this contract.
- Who may connect is decided by the socket's mode (`0600`) and the parent walk
  (see "Who may connect"), not by a token. Any process of the user that is not
  an IDE agent may therefore create jobs; the counter limits a runaway, not an
  attacker who already runs code as the user.
- **Who may run a job, and what it may touch.** Only kinds the human listed
  for a project run, only in projects listed both in the link policy and as
  open to supervisors, only with a provider, model and permission mode the
  supervisor policy allows, never unattended, always headless and always in a
  worktree of its own. The result is a branch; nothing reaches the human's
  checkout or `HEAD` without the human merging it. Paths outside the kind's
  `writes` that the agent changed and committed anyway are listed in
  `otherFiles` and named in the inbox notification. The IDE does not prevent
  such a write — the agent is a coding agent with the permissions its mode
  gives it (and the write sandbox where its provider config sets one) — it
  makes it visible before the merge.
- **Prompt injection through `payload`.** The payload is text an outside
  program wrote, and it ends up in an agent's prompt. It is therefore placed
  after the IDE's own rules, inside a fence with a random delimiter the client
  cannot close early, and introduced as data that must never be followed as
  instructions; the agent is told to refuse and report anything else it asks
  for. This lowers the risk, it does not remove it: a model can still be
  talked into things. What bounds the damage is the list above — the
  agent's rights are those of a supervisor's child in that one project, its
  work lands on a branch, and the kind's instructions file (written by the
  project's maintainers, versioned in the repository) is what defines the
  task. Clients should still put only the user's request into the payload,
  never content fetched from elsewhere.
- **Documents are opaque.** The IDE checks size and "is a JSON object", not a
  schema, so a client must validate what it reads before rendering it.

## Deliberately open in v1

- No in-IDE accept/reject dialog for proposals or job branches; the Git panel
  is the review. Job worktrees stay until the branch is merged or removed.
- No document index watcher: `documents.search` walks the visible projects on
  every call (bounded: depth 8, 2000 documents per project).
- No schema validation of documents in the IDE (`schema` is passed on).
- No per-client counter: a client's name (`session.hello.client`) is
  self-declared and would be no key for a limit.
- No `code.graph` or other read access to a project's code. Each further read
  is a further narrow method, never a generic file read.
- One subscription per connection.
- Several clients may connect at once; they do not see each other's
  subscriptions, but they see the same jobs.
