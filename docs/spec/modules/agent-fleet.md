# Agent Fleet

The Agent Fleet module manages the lifecycle, execution, PTY I/O streaming, and human attention supervision for local AI agent subprocesses within AuricIDE.

---

## 1. Purpose

AuricIDE executes multiple command-line AI agents concurrently (Crush, Claude Code, Gemini CLI, etc.) as native OS subprocesses. The Agent Fleet module ensures:

- Robust process management via cross-platform pseudo-terminals (`portable-pty`).
- Non-blocking output streaming with terminal reassembly and scrollback buffering.
- Fleet visualization that remains readable under multi-agent workloads without constant manual polling.
- An attention model that reliably alerts the developer when human input or intervention is needed.

---

## 2. Boundaries

- **Provider CLI Resolution**: Does not resolve CLI argument templates, permission flags, or dynamic JSON configs; this belongs to [Configuration & Credentials](./configuration-credentials.md).
- **Conductor Work Orchestration**: Does not decide ticket prioritization or loop execution; that belongs to [Goals & Conductor Loop](./goals-conductor-loop.md).
- **Notification Scheduling**: Does not run background schedules; that is handled by [Notifications & Schedules](./notifications-schedules.md).

---

## 3. Public Contracts

### Rust IPC Commands (`src-tauri/src/agents.rs`)

- `agent_spawn(req: SpawnAgentRequest) -> Result<String, String>`: Spawns an agent CLI subprocess connected to a pseudo-terminal. Returns unique `agent_id`.
- `agent_kill(agent_id: String) -> Result<(), String>`: Sends SIGKILL/terminate to the process tree of the specified agent.
- `agent_send_input(agent_id: String, input: String) -> Result<(), String>`: Writes raw keyboard/control characters directly to the agent's PTY standard input.
- `agent_list() -> Result<Vec<AgentSummary>, String>`: Returns snapshot of all running, queued, and finished agents.

### Tauri Events

- `agent-output-{agent_id}`: Emitted per output chunk containing UTF-8 terminal text streamed from the PTY.
- `agent-status-changed`: Emitted when an agent transitions between `queued`, `running`, `idle` (done), or `error`.

### Frontend Fleet Types (`src/lib/agents/fleet.ts` & `attention.ts`)

- `splitFleet(agents, minimizedAgentIds) -> { active, finished, parked }`:
  - `active`: Agents with status `running` or `queued` (sorted by rank and start time).
  - `finished`: Stopped agents (`idle` or `error`), sorted newest-outcome-first.
  - `parked`: Minimized/set-aside agents preserved in user parking order.
- `agentAttention(agent, now) -> 'error' | 'needs-input' | 'stalled' | null`:
  - `error`: Unreviewed termination failure (highest priority).
  - `needs-input`: Agent is prompting for permission/input (checked before stall clock).
  - `stalled`: Running with silence exceeding `AGENT_STALL_MS` (120,000 ms).

---

## 4. Key Flows

### 4.1 Spawning an Agent

1. **Request Formulation**: Initiated by user action (Start Agent dialog, ticket button) or automated conductor run.
2. **Provider Resolution**: Resolved through provider policy and credentials.
3. **PTY Subprocess Fork**: Rust backend allocates a PTY via `portable-pty`, configures working directory (`repoPath`), environment variables, and launches the CLI command.
4. **Registration**: The agent is added to the active registry (`src-tauri/src/agents.rs`) and initial status `running` is broadcast to the frontend Zustand store.

### 4.2 Streaming & Attention Supervision

1. **PTY Ingestion**: Rust background reader thread reads raw bytes, reassembles UTF-8 sequences (`utf8_stream.rs`), writes to disk log (`agent_log.rs`), and emits `agent-output-{id}`.
2. **UI Rendering**: Frontend appends chunks to xterm instance or headless serialize buffer.
3. **Throttled Activity Bump**: Activity tail is parsed (`awaitingInput.ts`) to detect permission prompts (`awaitingInput = true`).
4. **Attention Escalation**: If an agent prompts for input or stalls past 120s, the header badge increments and an attention pointer row is displayed.

### 4.3 Termination, Dismissal & Review

1. **Process Exit**: When the CLI exits with code 0 (`idle`) or non-zero (`error`), the backend records `finishedAt` and emits status change.
2. **Unreviewed Failures**: A finished agent with `error` status is flagged until the user explicitly opens its terminal log (`reviewed = true`).
3. **Dismiss vs Kill**:
   - `dismissFinishedAgent`: Removes stopped agents from view; strictly refuses running agents and causes no PM side-effects.
   - `killRunningAgent`: Terminates running process, marks ticket/conductor as failed, and requires confirmation.

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: IPC invocation bridge, crash logging, and process lifecycle.
- **[Configuration & Credentials](./configuration-credentials.md)**: Provider permission modes, allow/deny policies, and executable definitions.
- **[Goals & Conductor Loop](./goals-conductor-loop.md)**: Conductor spawns implementer and judge agents via fleet commands.

---

## 6. Relevant Source Paths

- `src/lib/agents/` — Fleet layout (`fleet.ts`), attention model (`attention.ts`), liveness (`liveness.ts`), activity parsing (`activity.ts`), naming (`naming.ts`).
- `src/lib/store/agentSlice.ts` — Zustand store slice for running agents, log buffering, and selection.
- `src-tauri/src/agents.rs` — Rust process lifecycle, PTY thread allocation, and IPC commands.
- `src-tauri/src/agent_log.rs` — File-backed log persistence for agent runs.
