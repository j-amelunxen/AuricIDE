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
- [Several supervisors](#several-supervisors)
- [Events](#events)
- [Document types and job kinds](#document-types-and-job-kinds)
- [Policy proposals](#policy-proposals)
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
2. **Settings → Supervisor → Supervisor link** — the **global defaults**
   (document types and job kinds defined once, see
   [below](#document-types-and-job-kinds)), and per starred project whether the
   client may see it and how it differs from the defaults. A shared project
   with nothing of its own inherits every default, so sharing a new project is
   one switch. Projects appear here once you star them in Quick Access.
3. **Settings → Supervisor → Supervisor link → Jobs per 24 h** — the
   [counter](#the-job-counter). `0` switches jobs off.

The settings are stored in `<app_data_dir>/supervisor-link.json` (mode 0600,
version 3). A missing or broken file means **nothing is shared**, never
everything. Files of versions 1 and 2 are read as they are and written as
version 3 on the next save. A supervisor cannot change the file; it can only
[propose](#policy-proposals) a change that you apply with one click.

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

With Node.js and the [`ws`](https://www.npmjs.com/package/ws) package, hand
the unix socket over as the connection and use a plain URL for the handshake:

```js
import net from 'node:net';
import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost/v1', {
  createConnection: () => net.connect(socketPath),
});
```

Do not put the path into a `ws+unix://<socket path>:/v1` URL: the default
macOS path contains a space ("Application Support"), and `ws` turns it into
`%20` and fails with `ENOENT`. In Python, `websockets.unix_connect(path,
"ws://localhost/v1")` takes the path as its own argument and has no such
problem. A browser cannot connect: there is no TCP port. A web UI talks to its
own backend, and the backend holds the connection.

### Handshake and versioning

There is no login. After the WebSocket upgrade the connection is ready.
`session.hello` is optional and tells you what this build offers:

```json
→ { "v": 1, "id": 1, "method": "session.hello", "params": { "client": "my-tool" } }
← { "v": 1, "type": "response", "id": 1, "ok": true,
    "result": { "protocol": 1, "server": "AuricIDE",
                "methods": ["session.hello", "supervisors.spawn", "…"],
                "events": ["agent.added", "…"],
                "features": ["supervisorKeys"] } }
```

`features` names what this build added within protocol 1. `supervisorKeys`
means everything under [Several supervisors](#several-supervisors) is there:
check for it before you send a `key` or a `supervisor` param to an older build,
which would refuse the unknown param with `invalid_params`.

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

| Limit                           | Value                                                   | Over it                                                            |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Inbound message                 | 1 MiB                                                   | connection closed with code 1009 (after the rest is read off)      |
| Open connections (all clients)  | 16                                                      | one `error` message `busy` (`too_many_connections`), close 1013    |
| Requests waiting per connection | 64 (plus the one being answered)                        | that request answered `busy` (`too_many_pending_requests`) at once |
| Handshake                       | 10 s from connect                                       | connection dropped                                                 |
| Client not reading              | an outgoing message may wait 10 s                       | connection dropped                                                 |
| Document                        | 256 KiB                                                 | `document_invalid`                                                 |
| Index file                      | 4 MiB                                                   | the index is ignored, names fall back                              |
| Asset (`documents.asset`)       | `maxAssetBytes` per type, default 2 MiB, at most 16 MiB | `document_invalid`                                                 |
| `jobs.create` payload           | 16 KiB as JSON                                          | `invalid_params`                                                   |
| `agents.read` `tailBytes`       | 262144                                                  | `invalid_params`                                                   |
| `documents.search`              | 200 results, 8 folder levels, 2000 files per project    | results capped                                                     |
| Jobs                            | the [counter](#the-job-counter), default 20 per 24 h    | `quota_exceeded`                                                   |

These protect the IDE from a misbehaving client. They are not an access
control: anything running as your user can do more than this socket allows.

## Messages

```ts
type ClientMessage = {
  v: 1;
  id: string | number; // echoed in the response; anything else is invalid_request
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

| method               | params                                                                                                                     | result                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `session.hello`      | `{ client?: string }`                                                                                                      | `{ protocol, server, methods, events, features }` |
| `supervisors.spawn`  | `{ key?: string, if?: 'new' \| 'existing', task?: string, provider?: string, model?: string }` (`if` only with `key`)      | `{ agentId, key: string \| null, existing }`      |
| `supervisors.list`   | —                                                                                                                          | `{ supervisors: LinkSupervisor[] }`               |
| `agents.list`        | —                                                                                                                          | `{ agents: LinkAgent[] }`                         |
| `agents.read`        | `{ agentId \| supervisor, sinceOffset?: number, tailBytes?: number }`                                                      | `OutputChunk`                                     |
| `agents.send`        | `{ agentId \| supervisor, text: string, submit?: boolean }` (`submit` defaults to `true`)                                  | `{ agentId, bytesWritten }`                       |
| `agents.kill`        | `{ agentId \| supervisor }`                                                                                                | `{ agentId, killed: true }`                       |
| `events.subscribe`   | `{ agentIds?: string[], supervisors?: string[], output?: boolean, sinceOffsets?: Record<string, number>, jobs?: boolean }` | `{ agents: LinkAgent[] }`                         |
| `events.unsubscribe` | —                                                                                                                          | `{ subscribed: false }`                           |
| `documents.projects` | —                                                                                                                          | `{ projects: DocumentProject[] }`                 |
| `documents.search`   | `{ query?: string, project?: string, type?: string, limit?: number }`                                                      | `{ documents: DocumentEntry[] }`                  |
| `documents.get`      | `{ project, type, id, rev?: string }`                                                                                      | `Document`                                        |
| `documents.resolve`  | `{ project, type, from, ref, rev?: string }`                                                                               | `Document`                                        |
| `documents.asset`    | `{ project, path, rev?: string }`                                                                                          | `Asset`                                           |
| `documents.propose`  | `{ project, type, id, document: object, baseHash: string \| null, message?: string, supervisor?: string }`                 | `Proposal`                                        |
| `jobs.create`        | `{ project, kind, payload, supervisor?: string }` (`payload` required, `null` allowed)                                     | `JobStarted`                                      |
| `jobs.list`          | `{ project?: string, status?: 'running' \| 'finished' \| 'failed', limit?: number }`                                       | `{ jobs: Job[] }`                                 |
| `jobs.cancel`        | `{ jobId }`                                                                                                                | `{ jobId, cancelled, status }`                    |

`agentId | supervisor` means exactly one of the two: an agent id, or a
[supervisor key](#several-supervisors) resolved when the request runs. Both or
neither is `invalid_params`.

`project` is always an absolute path, as `documents.projects` lists it.

### Supervisors and agents

**`supervisors.spawn`** starts a supervisor exactly like the Supervisor tile
in the IDE: its launch prompt, your standing instructions, its approved skills
and tools. `task` becomes its first task; `provider` and `model` default to
your supervisor settings. Several supervisors may run at once, each with its
own children.

Without `key` every call starts a **new** supervisor. With `key` the new one
carries that address (see [Several supervisors](#several-supervisors)), and
`if` says what a key a live supervisor already carries means: `"new"` (the
default) refuses with `supervisor_key_in_use`; `"existing"` answers that
supervisor with `existing: true` and starts nothing — the `task` is **not**
sent to it, use `agents.send` for that.

```json
→ { "v": 1, "id": "s", "method": "supervisors.spawn", "params": { "key": "mail-triage", "if": "existing", "task": "Triage the inbox" } }
← { "v": 1, "type": "response", "id": "s", "ok": true, "result": { "agentId": "agent-12", "key": "mail-triage", "existing": false } }
```

**`supervisors.list`** answers the live supervisors and the finished ones whose
result AuricIDE still keeps, live first:

```ts
type LinkSupervisor = {
  agentId: string;
  key: string | null;
  name: string;
  status: LinkAgent['status'];
  run: string | null; // the run folder's name, e.g. "2026-10-21_090000"
  children: { running: number; total: number }; // its whole subtree, grandchildren included; jobs are not children
};
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
  supervisorKey: string | null; // a supervisor's key, else null
  rootSupervisorId: string | null; // the topmost supervisor of its chain; a supervisor's own id
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
Enter. An empty `text` with `submit: true` is a bare Enter. Text longer than
32 bytes or with a line break is typed as one bracketed paste when the agent's
terminal supports it, so long and multi-line messages arrive whole and are
submitted; `bytesWritten` then counts the paste markers too. Headless agents
(every job agent) have no input: `headless_no_stdin`.

```json
→ { "v": 1, "id": "y", "method": "agents.send", "params": { "agentId": "agent-12", "text": "Yes, go ahead" } }
← { "v": 1, "type": "response", "id": "y", "ok": true, "result": { "agentId": "agent-12", "bytesWritten": 14 } }
```

**`agents.kill`** is the same as the stop button in the IDE.

All three take `supervisor: "<key>"` instead of `agentId` to reach the live
supervisor carrying that key; none does: `unknown_supervisor`.

### Documents

```ts
type DocumentProject = {
  path: string;
  name: string;
  isGitRepo: boolean;
  documentTypes: {
    name: string;
    globs: string[];
    schema: string | null;
    assets: string[]; // globs documents.asset reads; [] = none
    maxAssetBytes: number;
    origin: 'global' | 'project' | 'override'; // where the type comes from
  }[];
  jobKinds: string[];
  jobKindOrigins: Record<string, 'global' | 'project' | 'override'>;
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

type Asset = {
  project: string;
  type: string; // the document type whose assets glob matched
  path: string; // project-relative, as requested
  rev: string | null; // as in Document
  merged: boolean | null;
  size: number; // bytes
  sha256: string; // hex
  hash: string; // git blob hash, comparable with Document.hash
  encoding: 'base64';
  data: string;
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

**`documents.asset`** reads a file a document refers to — a model, an image,
a texture — as base64. It is read-only and opaque: AuricIDE never looks
inside an asset. A path is readable when an `assets` glob of one of the
project's document types matches it, under the same rules as
`documents.get`: a project-relative path of plain segments (no `..`, no
hidden names), with `rev` a commit id, branch or tag (only regular files
count there, not symlinks). In the working tree the file a symlink points to
must lie inside the project **and** match an `assets` glob itself; otherwise
the answer is `document_not_found`. A path no `assets` glob names is
`invalid_params`; one over the type's `maxAssetBytes` is `document_invalid`,
refused before it is read.

```json
→ { "v": 1, "id": 5, "method": "documents.asset",
    "params": { "project": "/home/me/src/example", "path": "scenes/assets/desk.glb" } }
← { "v": 1, "type": "response", "id": 5, "ok": true,
    "result": { "project": "/home/me/src/example", "type": "scene", "path": "scenes/assets/desk.glb",
                "rev": null, "merged": null, "size": 48213, "sha256": "9f2c…", "hash": "e1a0…",
                "encoding": "base64", "data": "Z2xURgIAAAA…" } }
```

To show a job's or a proposal's version of an asset, pass the same `rev` you
read its documents with.

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
  requestedBy: { key: string; agentId: string } | null; // jobs.create { supervisor }
};

type JobErrorCode =
  | 'agent_failed' // the agent exited with an error, or was stopped from outside (agents.kill, Stop)
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

`supervisor: "<key>"` records which supervisor wants the job (`requestedBy`,
with the agent id the key named at creation; a key no live supervisor carries
is `unknown_supervisor`, checked before anything starts). The job's agent is
still no child of that supervisor: it counts against the job counter, not
against the supervisor's child limit.

When the agent stops, AuricIDE commits whatever it left uncommitted **in the
paths it may write**, compares the branch with its base and ends the job with
`job.finished` or `job.failed`. Either way one notification lands in the
project's inbox. A job with `requestedBy` also gets one line typed into that
supervisor's console — whoever carries the key at that moment, else the agent
that asked, if it still runs and nobody is halfway through typing there.

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

## Several supervisors

Any number of supervisors may run at once; each manages only the agents it
started. A supervisor's `agentId` is a counter and changes when it is resumed
or AuricIDE restarts, so a client that wants **its** supervisor back after a
reconnect gives it a **key**: an address it chooses, `^[a-z0-9][a-z0-9-]{0,47}$` and not shaped like an
agent id (`agent-12` is refused).

- A key is unique among **live** supervisors. When one ends, its key is free.
- The key is kept with the supervisor across a restart and in its run folder,
  so a supervisor resumed from the IDE (tile, Supervisor Runs) answers to the
  same key.
- A resumed supervisor takes over the children of the one it replaces: their
  `spawnedByAgentId` (and `rootSupervisorId`) name the new id.
- A key is an **address, not a permission.** Any client of the link may use
  any key; there is no ownership per connection.

The reconnect pattern, the same on the first connect and on every later one:

```json
→ { "v": 1, "id": 1, "method": "supervisors.spawn", "params": { "key": "mail-triage", "if": "existing", "task": "Triage the inbox every hour" } }
← { "v": 1, "type": "response", "id": 1, "ok": true, "result": { "agentId": "agent-12", "key": "mail-triage", "existing": true } }
→ { "v": 1, "id": 2, "method": "events.subscribe", "params": { "supervisors": ["mail-triage"] } }
← { "v": 1, "type": "response", "id": 2, "ok": true, "result": { "agents": [ … the supervisor and its subtree … ] } }
→ { "v": 1, "id": 3, "method": "agents.send", "params": { "supervisor": "mail-triage", "text": "Anything new?" } }
```

`existing: true` means the supervisor was already running and the `task` was
not sent; send what it should do now with `agents.send`. To learn what ran
while you were away, `supervisors.list` and `jobs.list`.

## Events

`events.subscribe` replaces the connection's subscription and returns the tree
as it is now, so you start from a consistent picture.

- `agentIds` — only these agents (ids outside the tree: `unknown_agent`).
  Omitted (and no `supervisors`): the whole tree, including agents that join
  later.
- `supervisors` — keys or agent ids. Each covers that supervisor, every agent
  below it through `spawnedByAgentId` (worked out again every 250 ms, so a
  child started later joins), and the jobs it asked for with their agents. An
  entry nothing matches yet is not an error: it covers a supervisor that
  starts later under that key. With `agentIds`, the union of both.
- `output` (default `true`) — push console text.
- `sinceOffsets` — per agent, the output offset to continue from after a
  reconnect. Without it, output starts at the current end; use `agents.read`
  for history.
- `jobs` (default `true`) — push `job.*` events for every job, whichever
  client created it; with `supervisors`, only for the jobs those supervisors
  asked for.

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

Document types and job kinds are defined **once, globally**, in Settings →
Supervisor → Supervisor link → Global defaults. Every shared project inherits
them. A project only lists what is different about it. This example defines a
`scene` document type and a `scene.draw` job kind for every project:

```json
{
  "documentTypes": [
    {
      "name": "scene",
      "globs": ["docs/**/*.scene.json"],
      "index": { "path": "docs/scenes.index.json", "entriesKey": "scenes" },
      "nameField": "hud.title",
      "descriptionField": "hud.subtitle",
      "schema": "docs/scene.schema.json"
    }
  ],
  "jobKinds": [
    {
      "kind": "scene.draw",
      "instructions": "docs/agents/draw-scene.md",
      "globalInstructions": "scene.draw.md",
      "writes": ["docs/**/*.scene.json", "docs/scenes.index.json"]
    }
  ]
}
```

With that in place, sharing a project is a switch: its entry is empty and it
gets `scene` and `scene.draw`. A project that has its own
`docs/agents/draw-scene.md` uses that file; all others use the global
`<app_data_dir>/job-kinds/scene.draw.md`.

**A project's entry** says how the project differs. Every field is optional:

```json
{
  "inherit": true,
  "disabledDocumentTypes": [],
  "disabledJobKinds": ["scene.draw"],
  "documentTypes": [{ "name": "scene", "globs": ["scenes/**/*.scene.json"] }],
  "jobKinds": [],
  "dailyLimit": 5
}
```

| Field                   | Meaning                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `documentTypes`         | own types; one with the name of a global type **replaces** it (override), a new name extends         |
| `jobKinds`              | the same for job kinds                                                                               |
| `disabledDocumentTypes` | names of global types this project does not take over                                                |
| `disabledJobKinds`      | names of global kinds this project does not take over                                                |
| `inherit`               | `false`: none of the global defaults apply here; default `true`                                      |
| `dailyLimit`            | this project's own job limit, in place of the shared per-project limit ([counter](#the-job-counter)) |

An override replaces the whole definition, not single fields. The settings
show every shared project's **effective** configuration with where each type
and kind comes from (`global`, `project`, `override`); `documents.projects`
reports the same as `origin` and `jobKindOrigins`. A project whose merged
configuration breaks a rule (for example a kind left with nothing to write) is
refused on save and, in a hand-edited file, not shared at all.

**Document type**

| Field              | Required | Meaning                                                                                                                                                      |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`             | yes      | `^[a-z0-9][a-z0-9._-]*$`, at most 64 characters, unique in the project                                                                                       |
| `globs`            | yes      | project-relative globs; `*` and `?` within one segment, `**` as a whole segment                                                                              |
| `index`            | no       | a file `{ "<entriesKey>": [{ "id", "name", "description", "tags" }] }` that names documents                                                                  |
| `nameField`        | no       | dotted path of a string in the document used as its name when the index has none                                                                             |
| `descriptionField` | no       | the same for the description                                                                                                                                 |
| `schema`           | no       | project-relative path of a JSON schema, handed to clients and agents; AuricIDE does not check it                                                             |
| `assets`           | no       | project-relative globs of files the documents refer to, readable with `documents.asset`; never written by the link and not part of a kind's default `writes` |
| `maxAssetBytes`    | no       | the largest asset handed out, 1 to 16777216 bytes; default 2097152 (2 MiB)                                                                                   |

A document is any file one of the globs matches whose content is a JSON object
of at most 256 KiB. AuricIDE checks nothing else — **validate what you read
before you render it.**

**Job kind**

| Field                | Required     | Meaning                                                                                                      |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `kind`               | yes          | same rule as a type name                                                                                     |
| `instructions`       | one of these | project-relative file the agent reads first; it defines the work and the payload's shape                     |
| `globalInstructions` | one of these | a file outside every project: a name under `<app_data_dir>/job-kinds/`, or an absolute path you set yourself |
| `writes`             | no           | globs the agent may write; empty means the globs of every (effective) document type                          |

**Which instructions a job gets.** When the project has the `instructions`
file, that file wins and the agent reads it in its worktree; it is versioned
with the project, so the people who own the repository decide what a kind
does, not the client. Otherwise AuricIDE reads the `globalInstructions` file
itself and puts its text into the job's prompt. A global file:

- is read by AuricIDE only. No `documents.*` method can reach it, and an error
  a client sees never names its path;
- must be a regular UTF-8 file of at most 64 KiB;
- when given as a name under `job-kinds/`, must resolve inside that folder: a
  symlink pointing elsewhere is refused;
- can be an absolute path anywhere only when you type it into the settings. A
  supervisor's [proposal](#policy-proposals) may only name a file under
  `job-kinds/`.

If neither file can be read, `jobs.create` answers `invalid_params` and no job
starts.

### Example: a 3D scene as a document type

Nothing in AuricIDE is specific to diagrams or scenes. A single project that
stores 3D scenes as JSON, with models and textures beside them, might carry
its own definition like this (as its project entry, or as global defaults if
every project is laid out the same way), with a job kind that lets an agent
add objects to a scene:

```json
{
  "documentTypes": [
    {
      "name": "scene",
      "globs": ["scenes/**/*.scene.json"],
      "index": { "path": "scenes/index.json", "entriesKey": "scenes" },
      "nameField": "title",
      "schema": "scenes/scene.schema.json",
      "assets": ["scenes/assets/**/*.glb", "scenes/assets/**/*.png"],
      "maxAssetBytes": 8388608
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
`documents.resolve`, load the models a scene names with `documents.asset`
(for example `scenes/assets/desk.glb`), and ask for `jobs.create` with
`{ "kind": "scene.extend", "payload": { "scene": "scenes/lobby.scene.json", "request": "add a reception desk" } }`.

## Policy proposals

A client cannot change the settings, and neither can a supervisor. A
supervisor can **propose** a change, and you apply it with one click. This is
how a client that needs, say, a new job kind gets it without anybody editing
JSON by hand: it tells its supervisor (with `agents.send`), the supervisor
proposes, you decide.

The supervisor has two tools for this on its MCP server (`auric-supervisor`):

| Tool                  | What it does                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `link_policy_get`     | the stored settings, the effective configuration per project with origins, and its proposals still pending |
| `link_policy_propose` | `{ reason, changes }`: checks the change against the current settings and stores it as a pending proposal  |

A change is one of: `share_project`, `set_default_document_type`,
`set_default_job_kind`, `set_project_document_type`, `set_project_job_kind`,
`set_project_inherit`, `set_daily_limit`, `set_per_project_daily_limit`,
`set_project_daily_limit`. There is no removal; taking something away is
yours to do in the settings. Example:

```json
{
  "reason": "The web client draws scenes; this project should offer it like the others.",
  "changes": [
    { "op": "share_project", "project": "/home/me/src/example" },
    {
      "op": "set_default_job_kind",
      "jobKind": { "kind": "scene.draw", "globalInstructions": "scene.draw.md" }
    }
  ]
}
```

What happens then:

1. The change is checked with every rule a save from the settings meets. A
   refused change is `invalid_params` naming the change and the rule; nothing
   is stored. A change that would leave the settings as they are is refused
   too.
2. The proposal is stored (`<app_data_dir>/supervisor-link-proposals.json`,
   mode 0600) and the inbox shows a notification with the reason, a readable
   diff (`+` added, `~` changed old → new) and two buttons: **Apply** and
   **Discard**. Pending proposals are also listed in Settings → Supervisor →
   Supervisor link.
3. **Nothing changes until you press Apply** in the IDE. Applying is a command
   of the IDE window; neither socket has a method that applies or discards, so
   no supervisor, agent or client can approve its own proposal.
4. A proposal expires after **24 hours**. It is applied only onto the settings
   it was made against: if you changed them in between, Apply withdraws it
   unapplied and says so.
5. Every outcome (`applied`, `discarded`, `expired`, `outdated`) is appended to
   `<app_data_dir>/supervisor-link-policy-audit.jsonl` (mode 0600) with who
   proposed it, the reason, the diff and the time.

At most 20 proposals wait at once, each with at most 20 changes and a reason
of at most 500 characters. Over the Supervisor Control API itself
(`supervisor-link.sock`) none of this exists: a client asks its supervisor.

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
  projects, and optionally `perProjectDailyLimit` per project; a project's
  own `dailyLimit` (in its entry) replaces `perProjectDailyLimit` for it;
- each value is at most 1000;
- over it, `jobs.create` answers `quota_exceeded` with `reason`
  `daily_limit` or `project_daily_limit` and says when the next slot frees up;
- `0` switches jobs off (for a project, if it is the limit that applies to
  it):
  `jobs.create` answers `quota_exceeded` with `reason` `disabled`, and no slot
  ever frees up until the limit is raised.

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

| code                     | meaning                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `invalid_request`        | not JSON, not a text frame, no `method`, an `id` that is neither string nor number                 |
| `unsupported_version`    | `v` is not `1`                                                                                     |
| `unknown_method`         | no such method in this build                                                                       |
| `invalid_params`         | params missing, of the wrong type, unknown or out of range (also a bad `rev`)                      |
| `forbidden_agent_caller` | the connecting process runs inside an IDE agent                                                    |
| `unknown_agent`          | no such agent, not in the supervisor tree, or already removed                                      |
| `agent_not_running`      | the agent is in the tree but not running                                                           |
| `headless_no_stdin`      | a headless agent cannot be typed into                                                              |
| `supervisor_unavailable` | no project is open to supervisors yet (Settings → Supervisor)                                      |
| `provider_denied`        | the project's provider policy refused the spawn                                                    |
| `provider_unsupported`   | a supervisor cannot run on that provider                                                           |
| `frontend_unavailable`   | the IDE window did not answer within 30 s                                                          |
| `document_not_visible`   | the project is not shared with the link                                                            |
| `document_not_found`     | no such document (at that revision)                                                                |
| `document_invalid`       | not a JSON object, or too large                                                                    |
| `document_conflict`      | `baseHash` does not match `HEAD`                                                                   |
| `not_a_git_repo`         | the project is not the root of a git repository, or has no commit                                  |
| `supervisor_denied`      | the supervisor policy refused a job's agent; `reason` names the rule                               |
| `job_kind_not_allowed`   | the project does not list that job kind                                                            |
| `quota_exceeded`         | the job counter is full (`reason` `daily_limit`, `project_daily_limit`) or 0 (`disabled`)          |
| `unknown_job`            | no such job                                                                                        |
| `busy`                   | a limit was reached; `reason` is `too_many_connections` or `too_many_pending_requests`             |
| `supervisor_key_invalid` | a key is not 1–48 of `a-z`, `0-9`, `-`, starting with a letter or digit, or looks like `agent-<n>` |
| `supervisor_key_in_use`  | `supervisors.spawn` with `if: "new"` and a live supervisor already carries that key                |
| `unknown_supervisor`     | no live supervisor carries that key                                                                |
| `internal`               | anything else; the message says what                                                               |

## A minimal client

Node.js 18+, `npm install ws`. It connects, says hello, starts its own
supervisor under a key (or finds it again), subscribes to that supervisor's
subtree, lists the shared projects and prints events until you press Ctrl-C.

```js
// supervisor-client.mjs — node supervisor-client.mjs
import WebSocket from 'ws';
import net from 'node:net';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const dataDir =
  platform() === 'darwin'
    ? join(homedir(), 'Library/Application Support')
    : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'));
const socketPath =
  process.env.AURIC_LINK_SOCKET ?? join(dataDir, 'com.auricide.ide', 'supervisor-link.sock');

// The socket is the connection; the URL only shapes the handshake. A
// ws+unix:// URL would break on the space in "Application Support".
const ws = new WebSocket('ws://localhost/v1', { createConnection: () => net.connect(socketPath) });
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
    // Our own supervisor, by key: started on the first run, found again later.
    const KEY = 'example-client';
    const mine = await call('supervisors.spawn', { key: KEY, if: 'existing' });
    console.log(`supervisor ${mine.agentId} (${mine.existing ? 'already running' : 'started'})`);
    const { agents } = await call('events.subscribe', { supervisors: [KEY] });
    console.log(`${agents.length} agent(s) in its subtree`);
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

| Symptom                                             | Cause and fix                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENOENT` / `ECONNREFUSED` on connect                | AuricIDE is not running, or another build serves the socket. Check the path for your OS.                                                                                                                |
| The socket file never appears                       | AuricIDE prints `Supervisor link unavailable: …` to its standard error. Unix socket paths are limited to about 104 bytes on macOS; a very long home folder path exceeds it.                             |
| HTTP 404 on the upgrade                             | The request path is not `/v1`.                                                                                                                                                                          |
| `forbidden_agent_caller` and close 1008             | Your client runs inside an IDE agent (its terminal, a tool it started). Start it from a normal terminal.                                                                                                |
| `busy` / `too_many_connections`                     | Sixteen connections are open. Close idle clients; reuse one connection.                                                                                                                                 |
| `busy` / `too_many_pending_requests`                | You sent more than 64 requests without waiting for answers. Wait for responses before sending more.                                                                                                     |
| Close 1009                                          | A message was larger than 1 MiB.                                                                                                                                                                        |
| `ENOENT` with `%20` in the path, from `ws+unix://`  | `ws` encodes the space in the socket path (macOS: "Application Support") and looks for a file that does not exist. Pass the socket through `createConnection` as shown under [Connecting](#connecting). |
| `supervisor_unavailable`                            | No project is open to supervisors. Allow one in Settings → Supervisor.                                                                                                                                  |
| `documents.projects` is empty                       | No project is shared in Settings → Supervisor → Supervisor link, or the settings file is broken (it then shares nothing).                                                                               |
| `document_not_visible`                              | The project path is not shared, or differs (use the path `documents.projects` returns).                                                                                                                 |
| A file does not show up in `documents.search`       | Its path does not match a glob, has a hidden segment, is deeper than 8 levels below the glob's base, is over 256 KiB, or is not a JSON object.                                                          |
| `invalid_params` for `rev`                          | Use a commit id, branch or tag name; expressions like `HEAD~1` are not read.                                                                                                                            |
| `supervisor_denied`, `reason: "no_ranked_model"`    | No allowed model of the chosen provider has a size. Give the models a `rank` in the provider config.                                                                                                    |
| `supervisor_denied`, `reason: "project_not_listed"` | The project is shared with the link but not open to supervisors.                                                                                                                                        |
| `quota_exceeded`                                    | The counter is full. The message says when a slot frees up; raise it in the settings if that is intended. With `reason: "disabled"` the limit is 0: jobs are off.                                       |
| A job fails with `no_changes`                       | The agent wrote nothing it may write. Check the instructions file and the kind's `writes`.                                                                                                              |
| A job fails with `agent_failed`                     | The agent exited with an error, or someone stopped it. What it committed is still on the job's branch (`commit`).                                                                                       |
| A job fails with `interrupted`                      | AuricIDE quit while it ran. Its worktree and branch are still there; remove them when done (`git worktree remove`, `git branch -D`).                                                                    |

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
