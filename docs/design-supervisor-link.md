# The supervisor link

Status: contract v1, 2026-10-17. The machine-checkable half is
`src/lib/agents/supervisorLink.fixtures.json`; Rust reads it in its tests.
**Change the fixtures first**, then both this file and the code.

A companion app (an assistant app running on the same machine)
talks to AuricIDE's supervisors over one bidirectional WebSocket instead of a
handful of MCP tools. Over it the companion can:

- start a supervisor, list the supervisors and every agent they started,
- read what is on a supervisor's (or its children's) console and get every new
  line pushed as it appears,
- type into a supervisor and submit,
- stop an agent in that tree,
- find, read and resolve 3D scenes stored in the projects, and propose changes
  to them as a git branch the human merges or deletes.

The human stays in the companion, talks, looks at visualisations and gives
feedback; the worker level runs underneath without needing their attention.

## Shape

```
companion server ──WebSocket over unix socket──▶ Rust supervisor_link ──▶ control_socket::Dispatcher ──▶ AgentManager / PTY
                                                     │                          └─ spawn/kill ─▶ frontend store (same path as the UI)
                                                     ├─ events pump (agent list + output buffers, every 250 ms)
                                                     └─ scenes (docs/**/*.scene.json in projects the human made visible)
```

- **The link is a narrower door, not a new one.** Everything it does to agents
  goes through the dispatcher that already answers `control.sock`
  (`docs/design-agent-control.md`), as an external caller, after the link has
  checked its own scope. It can therefore never do more than `control.sock`
  already lets the same process do. It does less: only the supervisor tree, no
  plain worker spawns, no projects outside the scene policy.
- **The companion's backend is the client, not a browser.** The transport is a
  unix socket, so a web page cannot open it. The companion's server holds the
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
agent is refused, supervisors included: an agent must not steer its own
supervisor. A peer whose PID cannot be read is refused too. The refusal comes
after the handshake as one `error` message, then a close with code 1008:

```json
{
  "v": 1,
  "type": "error",
  "error": {
    "code": "forbidden_agent_caller",
    "message": "process 4711 runs inside an IDE agent; agents may not use the supervisor link"
  }
}
```

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

| method               | params                                                                             | result                         |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| `session.hello`      | `{ client?: string }`                                                              | `Hello`                        |
| `supervisors.spawn`  | `{ task?: string, provider?: string, model?: string }`                             | `{ agentId }`                  |
| `agents.list`        | —                                                                                  | `{ agents: LinkAgent[] }`      |
| `agents.read`        | `{ agentId, sinceOffset?: number, tailBytes?: number }`                            | `OutputChunk`                  |
| `agents.send`        | `{ agentId, text: string, submit?: boolean (default true) }`                       | `{ agentId, bytesWritten }`    |
| `agents.kill`        | `{ agentId }`                                                                      | `{ agentId, killed: true }`    |
| `events.subscribe`   | `{ agentIds?: string[], output?: boolean, sinceOffsets?: Record<string, number> }` | `{ agents: LinkAgent[] }`      |
| `events.unsubscribe` | —                                                                                  | `{ subscribed: false }`        |
| `scenes.projects`    | —                                                                                  | `{ projects: SceneProject[] }` |
| `scenes.search`      | `{ query?: string, project?: string, limit?: number }`                             | `{ scenes: SceneEntry[] }`     |
| `scenes.get`         | `{ project, id, rev?: string }`                                                    | `Scene`                        |
| `scenes.resolve`     | `{ project, from, ref, rev?: string }`                                             | `Scene`                        |
| `scenes.propose`     | `{ project, id, scene: object, baseHash: string \| null, message?: string }`       | `Proposal`                     |

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
    "events": ["agent.added", "agent.updated", "agent.removed", "agent.output"]
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

The **tree** is every agent whose role is `supervisor`, and every agent whose
`spawnedByAgentId` chain leads to one. An agent the human started from the IDE
is not in it. Every method that takes an `agentId` answers an id outside the
tree with `unknown_agent`, exactly like an id that does not exist: the
companion learns nothing about agents it may not touch.

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
when it is not running.

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

## Scenes

Scenes are the 3D pictures the companion's canvas draws. They live in the
products they describe, as files, versioned with the code:

- **Where:** `docs/**/*.scene.json` in a project. Nothing else is read.
- **Identity:** the id is the path from the project root without
  `.scene.json`: `docs/architecture/system.scene.json` is `docs/architecture/system`.
  An id matches `^docs(/[A-Za-z0-9][A-Za-z0-9._-]*)+$`; no `..`, no empty segment.
- **Content:** a JSON object. The IDE does not check it against the
  companion's scene schema; that is the companion's contract
  (its own scene schema). The IDE only requires an object, at most
  256 KiB.
- **Optional index:** `docs/scenes.index.json` names and describes scenes:
  `{ "scenes": [{ "id": "docs/architecture/system", "name": "…", "description": "…", "tags": ["…"] }] }`.
  Without an entry, `name` is the scene's `hud.title`, else the file name;
  `description` is `hud.subtitle`, else `null`.
- **Hash:** the git blob hash of the file's bytes (`git hash-object`), so a
  client can compare it with git itself.

### Who sees what

`<app_data_dir>/supervisor-link.json`, written by Rust at mode 0600 and edited
in Settings → Supervisor → Companion link:

```json
{ "version": 1, "scenes": { "projects": ["/Users/me/WebstormProjects/example-product"] } }
```

A project not listed does not exist for the link: `scenes.search` skips it and
every other scene method answers `scene_not_visible`. A missing or broken file
means no project is visible. Paths are compared canonically (symlinks
resolved).

### `scenes.projects`

```ts
type SceneProject = { path: string; name: string; isGitRepo: boolean };
```

### `scenes.search`

Case-insensitive match of every word of `query` against id, name, description
and tags; no `query` lists everything. `project` narrows to one project.
`limit` defaults to 50, max 200. Ordered by project, then id.

```ts
type SceneEntry = {
  project: string;
  id: string;
  path: string; // path: absolute file path
  name: string;
  description: string | null;
  tags: string[];
  hash: string;
};
```

### `scenes.get`

```ts
type Scene = {
  project: string;
  id: string;
  path: string;
  hash: string;
  rev: string | null; // the commit it was read at; null = the working tree
  scene: object;
};
```

Without `rev` the file is read from the working tree, which is what the human
sees. With `rev` (anything `git rev-parse` accepts: a branch, a tag, a commit)
it is read from that commit, and `rev` in the result is the full commit id.

Errors: `scene_not_visible`, `scene_not_found` (also for a `rev` git does not
know), `scene_invalid` (not JSON, not an object, too large), `invalid_params`
(bad id, relative project path), `not_a_git_repo` (a `rev` in a project without
a repository).

### `scenes.resolve`

For drilldown: a node points at a sub-scene, the client hands the pointer over
and gets the scene back.

- `from` is the id of the scene the pointer is in, `ref` the pointer.
- A `ref` starting with `docs/` is an id.
- Otherwise it is relative to the folder of `from`: in `docs/architecture/system`,
  `modules/auth` and `./modules/auth` both mean `docs/architecture/modules/auth`,
  `../overview` means `docs/overview`.
- A trailing `.scene.json` on `ref` is ignored.
- A `ref` that leaves `docs/` is `invalid_params`.
- `rev` as in `scenes.get`.

The result is a `Scene`, as from `scenes.get`.

### `scenes.propose`

The link never writes into a project's folder. A proposal becomes a commit on a
**new branch**, built straight from the project's `HEAD` without touching the
working tree, the index or the checked-out branch. The human reviews it like any
other branch, merges it or deletes it.

- `scene` is the full new content (not a patch); it is written as
  pretty-printed JSON with a trailing newline.
- `baseHash` is required: the hash of the scene the change is based on, as
  `scenes.get` returned it, or `null` for a new scene. If the file at `HEAD`
  has another hash (or exists although `null` was sent), the answer is
  `scene_conflict` and nothing is written. Compare is against `HEAD`, not the
  working tree, because `HEAD` is what the branch is built on.
- Branch name: `auric/scene-proposal/<last id segment>-<8 hex>`.
- Commit message: `scene: propose <id>`, then `message` as the body when given.
  Author and committer are the repository's configured git user.
- The IDE drops one notification into the project's inbox: which scene, which
  branch, how to accept it.

```ts
type Proposal = {
  project: string;
  id: string;
  branch: string;
  commit: string;
  base: string; // the HEAD commit it was built on
  created: boolean; // true when the scene did not exist at HEAD
  hash: string; // hash of the proposed content
};
```

Errors: `scene_not_visible`, `scene_conflict`, `scene_invalid` (not an object,
too large), `not_a_git_repo` (the project has no repository or no commit yet),
`invalid_params`.

Not in v1: a review dialog inside the IDE that shows the diff with
Accept/Reject. The branch is reviewed in the Git panel today.

## Error codes

| code                     | meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `invalid_request`        | not JSON, not a text frame, no `method`                                |
| `unsupported_version`    | `v` is not `1`                                                         |
| `unknown_method`         | no such method in this build                                           |
| `invalid_params`         | params missing, of the wrong type, unknown, or out of range            |
| `forbidden_agent_caller` | the connecting process runs inside an IDE agent                        |
| `unknown_agent`          | no such agent, or not in the supervisor tree                           |
| `agent_not_running`      | the agent exists but is not running                                    |
| `headless_no_stdin`      | a headless agent cannot be typed into                                  |
| `supervisor_unavailable` | the supervisor policy shows a supervisor no project yet                |
| `provider_denied`        | the provider policy refused the spawn                                  |
| `frontend_unavailable`   | the IDE window did not answer within 30 s                              |
| `scene_not_visible`      | the project is not in the link's scene policy                          |
| `scene_not_found`        | no such scene (at that revision)                                       |
| `scene_invalid`          | the file or the proposed content is not a JSON object, or too large    |
| `scene_conflict`         | `baseHash` does not match `HEAD`                                       |
| `not_a_git_repo`         | the project has no git repository, or no commit to build a proposal on |
| `internal`               | anything else; the message says what                                   |

## Examples

Start a supervisor and follow it:

```json
→ { "v": 1, "id": "a", "method": "events.subscribe", "params": {} }
← { "v": 1, "type": "response", "id": "a", "ok": true, "result": { "agents": [] } }
→ { "v": 1, "id": "b", "method": "supervisors.spawn", "params": { "task": "Plan the scene export for example-product" } }
← { "v": 1, "type": "event", "seq": 1, "event": "agent.added", "data": { "agent": { "id": "agent-12", "role": "supervisor", "status": "running", "…": "…" } } }
← { "v": 1, "type": "response", "id": "b", "ok": true, "result": { "agentId": "agent-12" } }
← { "v": 1, "type": "event", "seq": 2, "event": "agent.output", "data": { "agentId": "agent-12", "text": "…", "startOffset": 0, "endOffset": 912, "truncated": false, "status": "running" } }
```

Answer it:

```json
→ { "v": 1, "id": "c", "method": "agents.send", "params": { "agentId": "agent-12", "text": "Yes, use opus for that one" } }
← { "v": 1, "type": "response", "id": "c", "ok": true, "result": { "agentId": "agent-12", "bytesWritten": 27 } }
```

Load a scene, drill into a module, propose a change:

```json
→ { "v": 1, "id": 1, "method": "scenes.search", "params": { "query": "architecture" } }
← { "v": 1, "type": "response", "id": 1, "ok": true, "result": { "scenes": [
    { "project": "/Users/me/src/example-product", "id": "docs/architecture/system",
      "path": "/Users/me/src/example-product/docs/architecture/system.scene.json",
      "name": "example-product", "description": "Services and queues", "tags": ["architecture"],
      "hash": "5b1f0c…" } ] } }
→ { "v": 1, "id": 2, "method": "scenes.resolve", "params": { "project": "/Users/me/src/example-product", "from": "docs/architecture/system", "ref": "modules/auth" } }
← { "v": 1, "type": "response", "id": 2, "ok": true, "result": { "id": "docs/architecture/modules/auth", "hash": "9e07aa…", "rev": null, "scene": { "nodes": [ … ] }, "…": "…" } }
→ { "v": 1, "id": 3, "method": "scenes.propose", "params": { "project": "/Users/me/src/example-product", "id": "docs/architecture/modules/auth", "baseHash": "9e07aa…", "scene": { "nodes": [ … ] }, "message": "Mark the token cache as the hot spot" } }
← { "v": 1, "type": "response", "id": 3, "ok": true, "result": { "branch": "auric/scene-proposal/auth-3fa1c2d9", "commit": "c0ffee…", "base": "abc123…", "created": false, "hash": "71d2e4…", "project": "…", "id": "docs/architecture/modules/auth" } }
```

## Deliberately open in v1

- No in-IDE accept/reject dialog for proposals; the Git panel is the review.
- No scene index watcher: `scenes.search` walks the visible projects' `docs/`
  on every call (bounded: depth 8, 2000 files per project). Fine for docs
  folders; a watcher comes when it is not.
- No `code.graph` or other read access to a project's code. Each further read
  is a further narrow method, never a generic file read.
- One subscription per connection.
- Several companions may connect at once; they do not see each other.
