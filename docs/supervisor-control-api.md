# Supervisor Control API — integrator guide

The Supervisor Control API lets a program on your machine work with AuricIDE's
supervisors the way you do from the IDE: start one, watch what it and the
agents it started are doing, answer their questions, stop them. On top of
that it can read and propose JSON documents in projects you share, and ask for
**jobs** — an agent that does one piece of work in a project and leaves the
result on a git branch for you to review.

This page is for people who write such a program (a **client**). It covers
setup, the connection, the security model, every method, event and error
code, configuration, and a minimal client. The design reasoning and the full
contract live in [`design-supervisor-link.md`](design-supervisor-link.md); the
machine-checkable half is
[`src/lib/agents/supervisorLink.fixtures.json`](../src/lib/agents/supervisorLink.fixtures.json).
Where this guide and the fixtures disagree, the fixtures win.

AuricIDE knows no particular client, document format or job kind. What a
document is and which jobs exist is configuration you write per project.

## Contents

- [What a client can and cannot do](#what-a-client-can-and-cannot-do)
- [Enabling it](#enabling-it)
- [Connecting](#connecting)
- [Security model and limits](#security-model-and-limits)
- [Messages](#messages)
- [Methods](#methods)
- [Events](#events)
- [Document types and job kinds](#document-types-and-job-kinds)
- [Previewing unmerged results](#previewing-unmerged-results)
- [The job counter](#the-job-counter)
- [Error codes](#error-codes)
- [A minimal client](#a-minimal-client)
- [Troubleshooting](#troubleshooting)
- [Compatibility and stability](#compatibility-and-stability)

## What a client can and cannot do

| A client can                                                 | A client cannot                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Start a new supervisor, with a first task                    | See or touch agents you started yourself in the IDE                    |
| List supervisors, the agents they started and job agents     | Start a plain worker agent                                             |
| Read their console output, live or from an offset            | Choose provider, model or permission mode for a job's agent            |
| Type into them and submit (answer a question)                | Read any file that is not a document of a type you configured          |
| Stop an agent in that tree                                   | Write into a project's working tree, index or checked-out branch       |
| Find, read and resolve JSON documents in projects you shared | Act in a project you did not share, or run a job kind you did not list |
| Propose a changed document as a new git branch               | Merge anything — merging is always yours                               |
| Start a job of a kind you listed, follow it, cancel it       | Run more jobs than the daily counter allows                            |

## Enabling it

The socket is served whenever AuricIDE runs (macOS and Linux). Out of the box
a client can reach only the supervisor half, and that only once you allowed a
supervisor at least one project; it sees no documents and can run no jobs.
Three settings decide what it gets:

1. **Settings → Supervisor** — which projects a supervisor (and therefore a
   job's agent) may work in, with which providers and models. A job needs its
   project open to supervisors here, and a provider with at least one model
   that has a size (`rank`).
2. **Settings → Supervisor → Supervisor link** — per starred project: whether
   the client may see it, its **document types** and its **job kinds** (a JSON
   object, see [below](#document-types-and-job-kinds)). Projects appear here
   once you star them in Quick Access.
3. **Settings → Supervisor → Supervisor link → Jobs per 24 h** — the
   [counter](#the-job-counter). `0` switches jobs off.

The settings are stored in `<app_data_dir>/supervisor-link.json` (mode 0600).
A missing or broken file means **nothing is shared**, never everything.

## Connecting

| What       | Value                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| Transport  | WebSocket (RFC 6455) over a unix domain socket                                       |
| Socket     | `<app_data_dir>/supervisor-link.sock`, mode 0600                                     |
| macOS      | `~/Library/Application Support/com.auricide.ide/supervisor-link.sock`                |
| Linux      | `${XDG_DATA_HOME:-~/.local/share}/com.auricide.ide/supervisor-link.sock`             |
| Windows    | not available                                                                        |
| Path       | `/v1` — any other request path is answered with HTTP 404                             |
| Frames     | text frames, one JSON object each; binary frames are answered with `invalid_request` |
| Keep-alive | the server pings every 30 s; WebSocket libraries answer automatically                |

Convention for clients: honour an `AURIC_LINK_SOCKET` environment variable as
an override of the socket path (the probe script does). The development build
and the installed app share the path; whichever starts first serves it.

With Node.js and the [`ws`](https://www.npmjs.com/package/ws) package the URL
is `ws+unix://<socket path>:/v1`. In Python, `websockets.unix_connect(path,
"ws://localhost/v1")`. A browser cannot connect: there is no TCP port. A web
UI talks to its own backend, and the backend holds the connection.

### Handshake and versioning

There is no login. After the WebSocket upgrade the connection is ready.
`session.hello` is optional and tells you what this build offers:

```json
→ { "v": 1, "id": 1, "method": "session.hello", "params": { "client": "my-tool" } }
← { "v": 1, "type": "response", "id": 1, "ok": true,
    "result": { "protocol": 1, "server": "AuricIDE",
                "methods": ["session.hello", "supervisors.spawn", "…"],
                "events": ["agent.added", "…"] } }
```

Every message carries `"v": 1`. A message with another `v` is answered with
`unsupported_version`. The request path `/v1` and the `v` field change
together, and only for a breaking change.

## Security model and limits

**Who may connect.** Two checks, no token:

- The socket file is mode 0600 in your user's app data folder, so only
  processes of your own user can open it.
- When a process connects, AuricIDE reads its PID from the socket and walks
  its parent processes. If any of them is a running IDE agent — a supervisor,
  a worker, a job's agent — the connection is refused with
  `forbidden_agent_caller` and closed (code 1008). An agent must not steer its
  own supervisor or start jobs. A process whose ancestry cannot be traced is
  refused the same way.

Any other process of your user may connect. Treat a connected client like any
other program you run: it can start supervisors and jobs within the limits you
configured. One known gap, shared with the control socket (ADR 0003): an
agent that fully detaches a process (double fork, reparented to `launchd` or
`init`) is no longer in that process's parent chain.

**What a client sees.** Only the supervisor tree: supervisors, the agents they
started, and job agents. An id outside it is answered exactly like an id that
does not exist (`unknown_agent`). Note that `currentTask` of a supervisor is its
full launch prompt, including your standing instructions from Settings →
Supervisor — do not put secrets there.

**Documents.** Only files that a configured document type's globs match, in a
shared project. Ids are project-relative paths whose segments start with a
letter or digit and hold only `[A-Za-z0-9._-]`: no `..`, no absolute paths, no
hidden files or folders (so never `.git`). Every file is resolved and must
still lie inside the project, so a symlink cannot lead out. At a revision,
only regular files count (a symlink entry is "not found").

**Revisions.** `rev` is a commit id (full or abbreviated) or a branch or tag
name. Anything starting with `-`, revision expressions (`HEAD~1`, `main^`,
`@{1}`, `:/text`, `a..b`) and anything git would not take as a ref name are
refused with `invalid_params` before git sees them. AuricIDE uses libgit2, not
a git command line, and never runs a shell.

**Proposals and jobs never touch your checkout.** A proposal is a commit on a
new branch `auric/proposal/<name>-<8 hex>`, written straight into the object
store. A job's agent works in a git worktree of its own. Nothing reaches your
working tree or `HEAD` until you merge.

**Job payloads are untrusted data.** The payload ends up in an agent's prompt.
AuricIDE puts its own rules first, then the payload inside a fence with a
random delimiter the client cannot know, introduced as data and never as
instructions. That lowers the risk of prompt injection; it does not remove it.
What bounds the damage: the agent gets no right a supervisor's child would not
get in that one project, never an unattended permission mode, always runs
headless in its own worktree, and its result is a branch you review. Files it
changed outside the kind's `writes` are listed in `otherFiles` and named in
the inbox notification. **Put only the user's own request into a payload,
never content fetched from elsewhere.**

**Limits.**

| Limit                           | Value                                                | Over it                                                            |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Inbound message                 | 1 MiB                                                | connection closed with code 1009                                   |
| Open connections (all clients)  | 16                                                   | one `error` message `busy` (`too_many_connections`), close 1013    |
| Requests waiting per connection | 64 (plus the one being answered)                     | that request answered `busy` (`too_many_pending_requests`) at once |
| Handshake                       | 10 s from connect                                    | connection dropped                                                 |
| Client not reading              | an outgoing message may wait 10 s                    | connection dropped                                                 |
| Document                        | 256 KiB                                              | `document_invalid`                                                 |
| Index file                      | 4 MiB                                                | the index is ignored, names fall back                              |
| `jobs.create` payload           | 16 KiB as JSON                                       | `invalid_params`                                                   |
| `agents.read` `tailBytes`       | 262144                                               | `invalid_params`                                                   |
| `documents.search`              | 200 results, 8 folder levels, 2000 files per project | results capped                                                     |
| Jobs                            | the [counter](#the-job-counter), default 20 per 24 h | `quota_exceeded`                                                   |

These protect the IDE from a misbehaving client. They are not an access
control: anything running as your user can do more than this socket allows.

## Messages

```ts
type ClientMessage = {
  v: 1;
  id: string | number; // echoed in the response
  method: string;
  params?: object; // omitted = {}
};

type ServerMessage =
  | { v: 1; type: 'response'; id: string | number; ok: true; result: unknown }
  | { v: 1; type: 'response'; id: string | number | null; ok: false; error: LinkError }
  | { v: 1; type: 'event'; seq: number; event: string; data: unknown }
  | { v: 1; type: 'error'; error: LinkError }; // only right before the server closes

type LinkError = { code: string; message: string; reason?: string };
```

- Requests on one connection are answered **in the order they were sent**,
  one at a time. A slow request (a spawn waits up to 30 s for the IDE window)
  holds the ones behind it; events keep flowing meanwhile. The one exception
  is `busy`: a request that does not fit the queue is answered at once, so
  match responses by `id`, not by position.
- Unknown params are refused (`invalid_params`), so a typo never quietly does
  the default.
- `seq` counts events on one connection from 1, without gaps. A gap means a
  lost frame: subscribe again.
- Match on `code` (and `reason`). The `message` is for people and may change.

## Methods

| method               | params                                                                                             | result                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `session.hello`      | `{ client?: string }`                                                                              | `{ protocol, server, methods, events }` |
| `supervisors.spawn`  | `{ task?: string, provider?: string, model?: string }`                                             | `{ agentId }`                           |
| `agents.list`        | —                                                                                                  | `{ agents: LinkAgent[] }`               |
| `agents.read`        | `{ agentId, sinceOffset?: number, tailBytes?: number }`                                            | `OutputChunk`                           |
| `agents.send`        | `{ agentId, text: string, submit?: boolean }` (`submit` defaults to `true`)                        | `{ agentId, bytesWritten }`             |
| `agents.kill`        | `{ agentId }`                                                                                      | `{ agentId, killed: true }`             |
| `events.subscribe`   | `{ agentIds?: string[], output?: boolean, sinceOffsets?: Record<string, number>, jobs?: boolean }` | `{ agents: LinkAgent[] }`               |
| `events.unsubscribe` | —                                                                                                  | `{ subscribed: false }`                 |
| `documents.projects` | —                                                                                                  | `{ projects: DocumentProject[] }`       |
| `documents.search`   | `{ query?: string, project?: string, type?: string, limit?: number }`                              | `{ documents: DocumentEntry[] }`        |
| `documents.get`      | `{ project, type, id, rev?: string }`                                                              | `Document`                              |
| `documents.resolve`  | `{ project, type, from, ref, rev?: string }`                                                       | `Document`                              |
| `documents.propose`  | `{ project, type, id, document: object, baseHash: string \| null, message?: string }`              | `Proposal`                              |
| `jobs.create`        | `{ project, kind, payload }` (`payload` required, `null` allowed)                                  | `JobStarted`                            |
| `jobs.list`          | `{ project?: string, status?: 'running' \| 'finished' \| 'failed', limit?: number }`               | `{ jobs: Job[] }`                       |
| `jobs.cancel`        | `{ jobId }`                                                                                        | `{ jobId, cancelled, status }`          |

`project` is always an absolute path, as `documents.projects` lists it.

### Supervisors and agents

**`supervisors.spawn`** starts a **new** supervisor exactly like the
Supervisor tile in the IDE: its launch prompt, your standing instructions, its
approved skills and tools. `task` becomes its first task; `provider` and
`model` default to your supervisor settings. A running supervisor is never
reused — to talk to one, use `agents.send`.

```json
→ { "v": 1, "id": "s", "method": "supervisors.spawn", "params": { "task": "Plan the export feature" } }
← { "v": 1, "type": "response", "id": "s", "ok": true, "result": { "agentId": "agent-12" } }
```

**`agents.list`** answers the supervisor tree. A `LinkAgent` carries at least:

```ts
type LinkAgent = {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  role: 'worker' | 'supervisor';
  spawnedByAgentId: string | null; // the supervisor that started it
  currentTask: string | null;
  startedAt: number; // ms since the epoch
  lastActivityAt: number | null;
  projectPath: string | null;
  repoPath: string | null; // its worktree, when it has one
  headless: boolean;
  outputBytes: number; // running offset of its console text
};
```

**`agents.read`** returns cleaned console text. `tailBytes` defaults to 16384;
`sinceOffset` returns only what is new since that offset. It is a redrawing
terminal, so expect repeated fragments rather than a transcript.

```ts
type OutputChunk = {
  agentId: string;
  status: LinkAgent['status'];
  text: string;
  startOffset: number;
  endOffset: number; // pass as sinceOffset next time
  truncated: boolean; // the buffer no longer reaches back that far
};
```

**`agents.send`** types `text` and, with `submit: true` (the default), presses
Enter. An empty `text` with `submit: true` is a bare Enter. Headless agents
(every job agent) have no input: `headless_no_stdin`.

```json
→ { "v": 1, "id": "y", "method": "agents.send", "params": { "agentId": "agent-12", "text": "Yes, go ahead" } }
← { "v": 1, "type": "response", "id": "y", "ok": true, "result": { "agentId": "agent-12", "bytesWritten": 14 } }
```

**`agents.kill`** is the same as the stop button in the IDE.

### Documents

```ts
type DocumentProject = {
  path: string;
  name: string;
  isGitRepo: boolean;
  documentTypes: { name: string; globs: string[]; schema: string | null }[];
  jobKinds: string[];
};

type DocumentEntry = {
  project: string;
  type: string;
  id: string; // project-relative path
  path: string; // absolute path
  name: string;
  description: string | null;
  tags: string[];
  hash: string; // git blob hash of the file
};

type Document = {
  project: string;
  type: string;
  id: string;
  path: string;
  hash: string;
  rev: string | null; // full commit id it was read at; null = working tree
  merged: boolean | null; // null without rev; false = not in HEAD yet
  document: object;
};

type Proposal = {
  project: string;
  type: string;
  id: string;
  branch: string;
  commit: string;
  base: string; // the HEAD commit it was built on
  created: boolean; // the document did not exist at HEAD
  hash: string;
};
```

**`documents.search`** matches every word of `query` (case-insensitive)
against id, name, description and tags; no `query` lists everything. Ordered
by project, type and id.

**`documents.get`** reads one document from the working tree, or with `rev`
from a commit, branch or tag.

```json
→ { "v": 1, "id": 2, "method": "documents.get",
    "params": { "project": "/home/me/src/example", "type": "diagram", "id": "docs/system.diagram.json" } }
← { "v": 1, "type": "response", "id": 2, "ok": true,
    "result": { "project": "/home/me/src/example", "type": "diagram", "id": "docs/system.diagram.json",
                "path": "/home/me/src/example/docs/system.diagram.json", "hash": "5b1f0c…",
                "rev": null, "merged": null, "document": { "nodes": [] } } }
```

**`documents.resolve`** follows a pointer inside a document. `from` is the id
of the document the pointer is in, `ref` the pointer. It tries `ref` relative
to `from`'s folder, then (unless `ref` starts with `./` or `../`) relative to
the project root, each as written and with the type's file suffix added, and
reads the first that exists.

```json
→ { "v": 1, "id": 3, "method": "documents.resolve",
    "params": { "project": "/home/me/src/example", "type": "diagram",
                "from": "docs/system.diagram.json", "ref": "modules/auth" } }
← { "v": 1, "type": "response", "id": 3, "ok": true,
    "result": { "id": "docs/modules/auth.diagram.json", "rev": null, "merged": null, "document": { "…": "…" }, "…": "…" } }
```

**`documents.propose`** writes the full new content as a commit on a new
branch built from `HEAD`. `baseHash` is required: the `hash` you read, or
`null` for a new document. If `HEAD` holds something else the answer is
`document_conflict` and nothing is written. You get one inbox notification
per proposal.

```json
→ { "v": 1, "id": 4, "method": "documents.propose",
    "params": { "project": "/home/me/src/example", "type": "diagram", "id": "docs/modules/auth.diagram.json",
                "baseHash": "9e07aa…", "document": { "nodes": [] }, "message": "Mark the token cache" } }
← { "v": 1, "type": "response", "id": 4, "ok": true,
    "result": { "branch": "auric/proposal/auth-3fa1c2d9", "commit": "c0ffee…", "base": "abc123…",
                "created": false, "hash": "71d2e4…", "…": "…" } }
```

### Jobs

```ts
type JobStarted = {
  jobId: string; // "job-<12 hex>"
  agentId: string;
  branch: string | null;
  base: string | null; // the commit the branch started from
  provider: string;
  model: string;
};

type Job = {
  jobId: string;
  project: string;
  kind: string;
  payload: unknown;
  status: 'running' | 'finished' | 'failed';
  agentId: string;
  provider: string;
  model: string;
  branch: string | null;
  worktree: string | null;
  base: string | null;
  createdAt: number;
  finishedAt: number | null;
  commit: string | null; // the branch's last commit once ended
  changed: string[]; // changed paths it may write
  documents: { type: string; id: string; hash: string; created: boolean }[];
  files: string[]; // changed paths it may write that are no document (or were deleted)
  otherFiles: string[]; // changed paths outside its writes — check before merging
  error: { code: JobErrorCode; message: string } | null;
  cancelRequested: boolean;
};

type JobErrorCode =
  | 'agent_failed' // the agent ended with an error
  | 'no_changes' // it ended without changing a file it may write
  | 'document_invalid' // a document it wrote is no JSON object or too large
  | 'cancelled' // jobs.cancel, or its project or kind was withdrawn while it ran
  | 'interrupted' // AuricIDE quit while it ran
  | 'internal';
```

**`jobs.create`** checks, in this order: the project is shared and lists the
kind (`document_not_visible`, `job_kind_not_allowed`); the kind's instructions
file exists and the project is the root of a git repository with a commit
(`invalid_params`, `not_a_git_repo`); the [counter](#the-job-counter) has room
(`quota_exceeded`); the supervisor policy allows the agent
(`supervisor_denied`, with the rule as `reason`). Provider and model are
chosen by AuricIDE — the project's load-balancing choice and the smallest
ranked model — never by the client. The agent runs headless in a worktree of
its own on a new branch.

```json
→ { "v": 1, "id": 5, "method": "jobs.create",
    "params": { "project": "/home/me/src/example", "kind": "diagram.draw",
                "payload": { "parent": "docs/system.diagram.json", "node": "auth", "request": "Open up the auth module" } } }
← { "v": 1, "type": "event", "seq": 7, "event": "job.started", "data": { "job": { "jobId": "job-4b1e09c2aa71", "status": "running", "…": "…" } } }
← { "v": 1, "type": "response", "id": 5, "ok": true,
    "result": { "jobId": "job-4b1e09c2aa71", "agentId": "agent-21", "branch": "auric/…", "base": "abc123…",
                "provider": "claude", "model": "…" } }
```

When the agent stops, AuricIDE commits whatever it left uncommitted **in the
paths it may write**, compares the branch with its base and ends the job with
`job.finished` or `job.failed`. Either way one notification lands in the
project's inbox.

A running job is stopped by AuricIDE itself (ending as `cancelled`, with the
reason in `error.message`) when you remove its project from the link settings
or remove its kind from the project.

**`jobs.list`** answers the register newest first (`limit` 1–200, default
50). It survives restarts: finished jobs stay seven days. A job that was
running when AuricIDE quit is `failed` with `interrupted`; its worktree and
branch stay for you to look at.

**`jobs.cancel`** stops the job's agent. The job ends as `cancelled` on the
next tick (every 2 s). A job that already ended answers
`{ "cancelled": false, "status": "<its status>" }`; an unknown id is
`unknown_job`.

## Events

`events.subscribe` replaces the connection's subscription and returns the tree
as it is now, so you start from a consistent picture.

- `agentIds` — only these agents (ids outside the tree: `unknown_agent`).
  Omitted: the whole tree, including agents that join later.
- `output` (default `true`) — push console text.
- `sinceOffsets` — per agent, the output offset to continue from after a
  reconnect. Without it, output starts at the current end; use `agents.read`
  for history.
- `jobs` (default `true`) — push `job.*` events for every job, whichever
  client created it.

| event           | data                                                                      | when                                              |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `agent.added`   | `{ agent: LinkAgent }`                                                    | an agent joined the tree                          |
| `agent.updated` | `{ agent: LinkAgent }`                                                    | its status, name, current task or project changed |
| `agent.removed` | `{ agentId }`                                                             | its card was cleared in the IDE                   |
| `agent.output`  | `OutputChunk`                                                             | new console text (collected every 250 ms)         |
| `job.started`   | `{ job: Job }`                                                            | `jobs.create` started the agent                   |
| `job.progress`  | `{ jobId, project, kind, agentId, branch, changed: string[], elapsedMs }` | the set of changed, writable paths changed        |
| `job.finished`  | `{ job: Job }`                                                            | it ended with valid changes                       |
| `job.failed`    | `{ job: Job }`                                                            | it ended otherwise; `job.error` says why          |

**Reconnecting.** Events are not queued for a disconnected client. After a
reconnect: subscribe again with `sinceOffsets` set to the last `endOffset` you
saw per agent, and call `jobs.list` to learn what happened to jobs meanwhile.
Jobs keep running while no client is connected.

## Document types and job kinds

Per shared project, Settings → Supervisor → Supervisor link holds one JSON
object:

```json
{
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
```

**Document type**

| Field              | Required | Meaning                                                                                          |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `name`             | yes      | `^[a-z0-9][a-z0-9._-]*$`, at most 64 characters, unique in the project                           |
| `globs`            | yes      | project-relative globs; `*` and `?` within one segment, `**` as a whole segment                  |
| `index`            | no       | a file `{ "<entriesKey>": [{ "id", "name", "description", "tags" }] }` that names documents      |
| `nameField`        | no       | dotted path of a string in the document used as its name when the index has none                 |
| `descriptionField` | no       | the same for the description                                                                     |
| `schema`           | no       | project-relative path of a JSON schema, handed to clients and agents; AuricIDE does not check it |

A document is any file one of the globs matches whose content is a JSON object
of at most 256 KiB. AuricIDE checks nothing else — **validate what you read
before you render it.**

**Job kind**

| Field          | Required | Meaning                                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------------------------- |
| `kind`         | yes      | same rule as a type name                                                                 |
| `instructions` | yes      | project-relative file the agent reads first; it defines the work and the payload's shape |
| `writes`       | no       | globs the agent may write; empty means the globs of every document type                  |

The instructions file is versioned with the project, so the people who own the
repository decide what a kind does, not the client.

### Example: a 3D scene as a document type

Nothing in AuricIDE is specific to diagrams. A project that stores 3D scenes
as JSON might share them like this, with a job kind that lets an agent add
objects to a scene:

```json
{
  "documentTypes": [
    {
      "name": "scene",
      "globs": ["scenes/**/*.scene.json"],
      "index": { "path": "scenes/index.json", "entriesKey": "scenes" },
      "nameField": "title",
      "schema": "scenes/scene.schema.json"
    }
  ],
  "jobKinds": [
    {
      "kind": "scene.extend",
      "instructions": "scenes/agents/extend-scene.md",
      "writes": ["scenes/**/*.scene.json", "scenes/index.json"]
    }
  ]
}
```

A client would then call `documents.search` with `"type": "scene"`, render
what `documents.get` returns, follow links between scenes with
`documents.resolve`, and ask for `jobs.create` with
`{ "kind": "scene.extend", "payload": { "scene": "scenes/lobby.scene.json", "request": "add a reception desk" } }`.

## Previewing unmerged results

A proposal and a finished job both leave their result on a branch. To show it
before it is merged, read it with `rev`:

```json
→ { "v": 1, "id": 6, "method": "documents.get",
    "params": { "project": "/home/me/src/example", "type": "diagram",
                "id": "docs/modules/auth.diagram.json", "rev": "auric/proposal/auth-3fa1c2d9" } }
← { "v": 1, "type": "response", "id": 6, "ok": true,
    "result": { "rev": "c0ffee…", "merged": false, "document": { "…": "…" }, "…": "…" } }
```

`rev` in the result is the full commit id. `merged` says whether that commit is
`HEAD` or an ancestor of it. While `merged` is `false`, present the content
as a **preview** (for example "Preview, not merged" next to the branch name)
and keep the working-tree version — read without `rev` — as what is real.
Once you merge the branch in the IDE, the same read answers `merged: true`.

For a job, use the branch from `JobStarted.branch` or the commit from the
`job.finished` event as `rev`.

## The job counter

A guard against a client that starts jobs in a loop, not a budget:

- at most `dailyLimit` jobs (default **20**) in any 24 hours across all
  projects, and optionally `perProjectDailyLimit` per project;
- `0` switches jobs off; each value is at most 1000;
- over it, `jobs.create` answers `quota_exceeded` with `reason`
  `daily_limit` or `project_daily_limit` and says when the next slot frees up.

A job counts from the moment its agent is started, even if it fails later.
Requests refused before that (unknown kind, no repository, policy) do not
count. The counter is stored in `<app_data_dir>/supervisor-link-jobs.json`
(mode 0600) and survives restarts. It uses the wall clock: setting the clock
back frees no slot, setting it forward by a day does.

```json
← { "v": 1, "type": "response", "id": 7, "ok": false,
    "error": { "code": "quota_exceeded", "reason": "daily_limit",
               "message": "20 jobs in 24 hours in all projects reached (Settings → Supervisor → Supervisor link); the next one frees up in 42 min" } }
```

## Error codes

| code                     | meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `invalid_request`        | not JSON, not a text frame, no `method`                                                |
| `unsupported_version`    | `v` is not `1`                                                                         |
| `unknown_method`         | no such method in this build                                                           |
| `invalid_params`         | params missing, of the wrong type, unknown or out of range (also a bad `rev`)          |
| `forbidden_agent_caller` | the connecting process runs inside an IDE agent                                        |
| `unknown_agent`          | no such agent, not in the supervisor tree, or already removed                          |
| `agent_not_running`      | the agent is in the tree but not running                                               |
| `headless_no_stdin`      | a headless agent cannot be typed into                                                  |
| `supervisor_unavailable` | no project is open to supervisors yet (Settings → Supervisor)                          |
| `provider_denied`        | the project's provider policy refused the spawn                                        |
| `provider_unsupported`   | a supervisor cannot run on that provider                                               |
| `frontend_unavailable`   | the IDE window did not answer within 30 s                                              |
| `document_not_visible`   | the project is not shared with the link                                                |
| `document_not_found`     | no such document (at that revision)                                                    |
| `document_invalid`       | not a JSON object, or too large                                                        |
| `document_conflict`      | `baseHash` does not match `HEAD`                                                       |
| `not_a_git_repo`         | the project is not the root of a git repository, or has no commit                      |
| `supervisor_denied`      | the supervisor policy refused a job's agent; `reason` names the rule                   |
| `job_kind_not_allowed`   | the project does not list that job kind                                                |
| `quota_exceeded`         | the job counter is full; `reason` is `daily_limit` or `project_daily_limit`            |
| `unknown_job`            | no such job                                                                            |
| `busy`                   | a limit was reached; `reason` is `too_many_connections` or `too_many_pending_requests` |
| `internal`               | anything else; the message says what                                                   |

## A minimal client

Node.js 18+, `npm install ws`. It connects, says hello, subscribes, lists the
shared projects and prints events until you press Ctrl-C.

```js
// supervisor-client.mjs — node supervisor-client.mjs
import WebSocket from 'ws';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const dataDir =
  platform() === 'darwin'
    ? join(homedir(), 'Library/Application Support')
    : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'));
const socketPath =
  process.env.AURIC_LINK_SOCKET ?? join(dataDir, 'com.auricide.ide', 'supervisor-link.sock');

const ws = new WebSocket(`ws+unix://${socketPath}:/v1`);
const pending = new Map();
let nextId = 1;

function call(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ v: 1, id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === 'response') {
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (!waiting) return;
    if (message.ok) waiting.resolve(message.result);
    else waiting.reject(Object.assign(new Error(message.error.message), message.error));
  } else if (message.type === 'event') {
    console.log(`#${message.seq} ${message.event}`, JSON.stringify(message.data).slice(0, 200));
  } else if (message.type === 'error') {
    console.error(`refused: ${message.error.code}: ${message.error.message}`);
  }
});

ws.on('close', (code) => console.log(`closed (${code})`));
ws.on('error', (error) => console.error(`cannot connect to ${socketPath}: ${error.message}`));

ws.on('open', async () => {
  try {
    const hello = await call('session.hello', { client: 'example-client' });
    console.log(`connected to ${hello.server}, protocol ${hello.protocol}`);
    const { agents } = await call('events.subscribe', {});
    console.log(`${agents.length} agent(s) in the supervisor tree`);
    const { projects } = await call('documents.projects');
    for (const project of projects) {
      const types = project.documentTypes.map((t) => t.name).join(', ') || 'none';
      console.log(`${project.name}: types ${types}; jobs ${project.jobKinds.join(', ') || 'none'}`);
    }
  } catch (error) {
    console.error(`${error.code}: ${error.message}`);
    ws.close();
  }
});
```

Run it from an ordinary terminal, **not** from inside an IDE agent's shell —
the link refuses those (`forbidden_agent_caller`).

### The probe script

The repository ships a dependency-free probe that speaks the protocol by hand
over `node:net`. It is the quickest check that the running IDE answers:

```bash
node scripts/probe-supervisor-link.mjs                    # hello, agents.list, documents.projects, jobs.list
node scripts/probe-supervisor-link.mjs --watch 20         # …then print events for 20 s
node scripts/probe-supervisor-link.mjs --spawn "<task>"   # start a supervisor first
node scripts/probe-supervisor-link.mjs --search "<query>" # documents.search
```

It honours `AURIC_LINK_SOCKET` and exits non-zero on a refused request.

## Troubleshooting

| Symptom                                             | Cause and fix                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENOENT` / `ECONNREFUSED` on connect                | AuricIDE is not running, or another build serves the socket. Check the path for your OS.                                                                                    |
| The socket file never appears                       | AuricIDE prints `Supervisor link unavailable: …` to its standard error. Unix socket paths are limited to about 104 bytes on macOS; a very long home folder path exceeds it. |
| HTTP 404 on the upgrade                             | The request path is not `/v1`.                                                                                                                                              |
| `forbidden_agent_caller` and close 1008             | Your client runs inside an IDE agent (its terminal, a tool it started). Start it from a normal terminal.                                                                    |
| `busy` / `too_many_connections`                     | Sixteen connections are open. Close idle clients; reuse one connection.                                                                                                     |
| `busy` / `too_many_pending_requests`                | You sent more than 64 requests without waiting for answers. Wait for responses before sending more.                                                                         |
| Close 1009                                          | A message was larger than 1 MiB.                                                                                                                                            |
| `supervisor_unavailable`                            | No project is open to supervisors. Allow one in Settings → Supervisor.                                                                                                      |
| `documents.projects` is empty                       | No project is shared in Settings → Supervisor → Supervisor link, or the settings file is broken (it then shares nothing).                                                   |
| `document_not_visible`                              | The project path is not shared, or differs (use the path `documents.projects` returns).                                                                                     |
| A file does not show up in `documents.search`       | Its path does not match a glob, has a hidden segment, is deeper than 8 levels below the glob's base, is over 256 KiB, or is not a JSON object.                              |
| `invalid_params` for `rev`                          | Use a commit id, branch or tag name; expressions like `HEAD~1` are not read.                                                                                                |
| `supervisor_denied`, `reason: "no_ranked_model"`    | No allowed model of the chosen provider has a size. Give the models a `rank` in the provider config.                                                                        |
| `supervisor_denied`, `reason: "project_not_listed"` | The project is shared with the link but not open to supervisors.                                                                                                            |
| `quota_exceeded`                                    | The counter is full. The message says when a slot frees up; raise it in the settings if that is intended.                                                                   |
| A job fails with `no_changes`                       | The agent wrote nothing it may write. Check the instructions file and the kind's `writes`.                                                                                  |
| A job fails with `interrupted`                      | AuricIDE quit while it ran. Its worktree and branch are still there; remove them when done (`git worktree remove`, `git branch -D`).                                        |

## Compatibility and stability

- **Protocol v1 is stable.** Within v1, methods, events, fields and error
  codes may be **added**; existing ones keep their meaning. A client must
  ignore unknown fields and events and treat an unknown error code like
  `internal`.
- A change that would break a v1 client gets a new protocol version, a new
  request path (`/v2`) and a new `v`. AuricIDE then says so in
  `session.hello`.
- The limits in this guide may be raised in a later build; they will not be
  lowered within v1 without a note in the release.
- The settings file has its own version (currently 2). Older files are read
  and migrated in memory; the next save writes the current version.
- What is **not** part of the contract: the wording of `message` fields, the
  exact text of agent output, the job prompt, and the branch name suffixes.
