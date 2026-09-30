# Agent usage per ticket and goal — design and contract

What one unit of work cost: tokens and USD for every agent run, recorded when the run ends,
attributed to the ticket or goal it ran for, and summed in the PM views.

This file is the contract between the Rust backend, the MCP server and the frontend. Change
it first, then the code on both sides.

## The rule: exact where the CLI tells us, estimated only where it does not

| Run                                                   | Where the numbers come from                          | `costSource` |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------ |
| Claude, headless (`-p`)                               | The CLI's result object (`--output-format json`)     | `cli`        |
| Claude, interactive                                   | The session transcript, priced by our price list     | `estimated`  |
| Codex, headless or interactive                        | The rollout file, priced by our price list           | `estimated`  |
| Provider without a `usage` block, or nothing readable | Nothing — the row still records duration and outcome | `none`       |

Token counts read from a transcript are the API's own numbers, not a guess. Only the USD
figure is ours. It is a list-price equivalent either way: the CLI's `total_cost_usd` is
priced from a list too (`"costBasis": "list"`), never from the bill.

**Benchmark.** Every headless Claude run is read both ways. The CLI figure is stored as the
cost, the transcript figure as `estimateCostUsd` (plus its token counts). The Costs tab
shows the mean and median absolute deviation over every row that has both.

The ignored test `agent_usage_bench` (`src-tauri/src/agent_usage/real_cli_tests.rs`) measures it on real
haiku runs of mixed shape (plain, Read, Bash, one and two subagents, multi-turn) and asserts max < 2 %:
`AURIC_USAGE_BENCH_N=6 cargo test agent_usage_bench -- --ignored --nocapture`.

Result on 2026-09-30 (Claude Code CLI, haiku, n = 6): 0.000 % deviation on every run, mean,
median and max, including two-subagent and multi-turn runs. The transcript is exact once the
largest `output_tokens` per message wins; with first-line-wins it undercounted output by up
to 99 % on subagent turns. Re-run after a CLI upgrade — a non-zero figure means the
transcript format moved.

## What the real CLIs actually emit (captured 2026-09-30)

Fixtures: `src-tauri/src/agent_usage/fixtures/`. Captured from real runs, then anonymised.

### Claude `claude -p --output-format json --session-id <uuid>` (CLI 2026-09)

One JSON object on stdout at the end.

- **`usage` is the LAST API call only**, not the session. In the capture it said 10 input /
  74 output while the session used 65k cache writes and 121k cache reads. Never read it for
  totals.
- **`modelUsage` is the whole session, subagents included**, keyed by full model id:
  `inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens,
webSearchRequests, costUSD, thinkingTokens, canonicalModel, costBasis`.
  Totals = sum over `modelUsage`. `thinkingTokens` is already inside `outputTokens`.
- `total_cost_usd` = sum of `costUSD`. `session_id`, `num_turns`, `is_error`, `subtype`,
  `duration_ms`, `result` (the answer text).
- `modelUsage` has no 5m/1h split for cache writes. The CLI's own cost already accounts
  for it, so we take `costUSD` as it is.

### Claude transcript (`~/.claude/projects/<cwd-slug>/<session>.jsonl`)

- The session id is ours: `--session-id <uuid>` at spawn (fresh UUID per run).
- **Subagents write their own files**: `<cwd-slug>/<session>/subagents/agent-*.jsonl`
  (plus `*.meta.json`). They must be read too, or subagent cost is missing.
- **One API message spans several lines, and `output_tokens` grows from line to line**
  (3 → 345 in the capture). Dedupe key stays `message.id + requestId`, but the line with the
  **largest** `output_tokens` wins, not the first one. With that rule the capture matches
  the CLI exactly: 46 / 1007 / 121339 / 65165 tokens, $0.12199 — 0.0 % deviation.
  Input and cache fields are identical on every line of a message.
- Cache writes carry `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.
  Priced with `write5m` / `write1h` from the manifest.
- `cwd-slug` = the absolute cwd with every `/` and `.` replaced by `-`. Do not rebuild it
  by hand; search `~/.claude/projects/*/<session>.jsonl` (one glob, the uuid is unique).

### Codex (`codex exec`, CLI 0.159)

- Text mode is kept (the console stays readable). The header on stderr, which the PTY
  merges into the stream, carries `session id: <uuid>`.
- Rollout file: `~/.codex/sessions/YYYY/MM/DD/rollout-<local-ts>-<uuid>.jsonl`. Find it by
  the uuid suffix (glob over the start day and the day after).
- Totals = `payload.info.total_token_usage` of the **last** `event_msg` with
  `payload.type == "token_count"`: `input_tokens, cached_input_tokens,
cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens`.
  **`cached_input_tokens` is a subset of `input_tokens`** (OpenAI semantics), so uncached
  input = `input_tokens - cached_input_tokens`. `reasoning_output_tokens` is inside
  `output_tokens`.
- Model: `turn_context.payload.model` (last one wins). cwd and start: `session_meta.payload`.
- Interactive Codex prints no session id we can rely on. The rollout is matched by
  `session_meta.cwd == agent cwd` and `timestamp` within 60 s after spawn (1 s of clock skew before it is tolerated: the spawn time is taken just after the
  process starts), the closest one not already claimed by another agent wins → `match: "heuristic"`.

## Provider config: the `usage` block

Optional. Missing → no capture (`costSource: "none"`). Parsed strictly when present.

```json
"usage": {
  "result": { "format": "claude-json", "headlessArgs": ["--output-format", "json"] },
  "transcript": { "format": "claude-jsonl", "sessionIdFlag": "--session-id" }
}
```

```json
"usage": {
  "transcript": { "format": "codex-rollout", "sessionIdFrom": "output" }
}
```

- `result.format`: `"claude-json"` (only one for now). `headlessArgs` are appended only for
  headless spawns.
- `transcript.format`: `"claude-jsonl" | "codex-rollout"`.
- `transcript.sessionIdFlag`: when set, Rust generates a UUID v4 and passes
  `<flag> <uuid>`, for headless and interactive alike.
- `transcript.sessionIdFrom: "output"`: read the id from the output (`session id: <uuid>`).
- The readers are compiled in; the config only picks one (as with `usage-plugins`).

Rust type (`providers/types.rs`), serde camelCase:

```rust
pub struct UsageConfig { pub result: Option<ResultUsageConfig>, pub transcript: Option<TranscriptUsageConfig> }
pub struct ResultUsageConfig { pub format: ResultFormat, pub headless_args: Vec<String> }
pub enum ResultFormat { ClaudeJson }                       // "claude-json"
pub struct TranscriptUsageConfig { pub format: TranscriptFormat,
    pub session_id_flag: Option<String>, pub session_id_from: Option<SessionIdFrom> }
pub enum TranscriptFormat { ClaudeJsonl, CodexRollout }    // "claude-jsonl", "codex-rollout"
pub enum SessionIdFrom { Output }                          // "output"
```

## The headless console stays prose

With `--output-format json` the final stdout line of a Claude run is a JSON object. In
`pump_agent_output`, for an agent whose provider has `usage.result` and that runs headless:

- Lines that do not start with `{` pass through unchanged, as they arrive.
- A line starting with `{` is held back. At exit, if it parses as a result object, emit its
  `result` text, then one line `— 12.3k tokens · $0.42 · 7 turns`. Otherwise emit the raw
  held-back text unchanged.
- The same emitted text goes into `OutputBuffers`, so the terminal, the feed, `errorDigest`
  and the control socket all see prose.

## Storage: migration 25, `pm_agent_usage` in `<project>/.auric/project.db`

Twin in `src-tauri/src/database/migrations.rs` and `src/mcp/db.ts`, identical SQL.
Append-only, written by Rust at the end of the run. Never edited by the frontend.

```sql
CREATE TABLE IF NOT EXISTS pm_agent_usage (
  id TEXT PRIMARY KEY,                  -- uuid
  agent_id TEXT NOT NULL,
  ticket_id TEXT,                       -- no FK: a deleted ticket keeps its cost history
  goal_id TEXT,
  run_kind TEXT NOT NULL,               -- 'ticket' | 'goal' | 'review' | 'other'
  run_source TEXT NOT NULL,             -- 'ui' | 'conductor' | 'schedule' | 'mcp' | 'other'
  provider TEXT NOT NULL,
  model TEXT,                           -- as reported by the CLI when known, else requested
  headless INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  ticket_status_at_start TEXT,
  started_at TEXT NOT NULL,             -- RFC 3339 UTC
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL,                -- 'success' | 'error' | 'killed'
  input_tokens INTEGER NOT NULL DEFAULT 0,        -- uncached input
  output_tokens INTEGER NOT NULL DEFAULT 0,       -- includes thinking/reasoning
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,    -- informative, already in output
  cost_usd REAL,                        -- NULL = unknown (unpriced model or costSource none)
  cost_source TEXT NOT NULL,            -- 'cli' | 'estimated' | 'none'
  match_kind TEXT NOT NULL DEFAULT 'exact', -- 'exact' | 'heuristic'
  estimate_cost_usd REAL,               -- benchmark: transcript price next to a cli cost
  estimate_input_tokens INTEGER,
  estimate_output_tokens INTEGER,
  estimate_cache_read_tokens INTEGER,
  estimate_cache_write_tokens INTEGER,
  unpriced_models TEXT,                 -- JSON array, NULL when every model was priced
  model_usage_json TEXT,                -- per-model breakdown as JSON, informative
  num_turns INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pm_agent_usage_ticket ON pm_agent_usage(ticket_id);
CREATE INDEX IF NOT EXISTS idx_pm_agent_usage_goal ON pm_agent_usage(goal_id);
CREATE INDEX IF NOT EXISTS idx_pm_agent_usage_started ON pm_agent_usage(started_at);
```

The row is written only when the agent has a `project_path` whose `.auric/project.db`
exists. Agents outside a project are not recorded here.

Kill counts: a killed run still reads its transcript. Tokens spent before a kill were spent.

## Attribution

Rust `AgentConfig` gains three optional camelCase fields, sent by the frontend:

| Field              | Values                               | Set by                                                 |
| ------------------ | ------------------------------------ | ------------------------------------------------------ |
| `runSource`        | `ui`, `conductor`, `schedule`, `mcp` | already on the TS config; now forwarded                |
| `runKind`          | `ticket`, `goal`, `review`, `other`  | derived by the frontend at spawn                       |
| `reviewOfTicketId` | ticket id                            | conductor review spawns (`spawnedForReviewOfTicketId`) |

The stored `ticket_id` = `spawnedByTicketId ?? reviewOfTicketId`. When `runKind` is absent,
Rust derives it: review id → `review`, ticket id → `ticket`, goal id → `goal`, else `other`.
`runSource` absent → `other`. `ticket_status_at_start` is read by Rust from `pm_tickets` at
spawn.

## IPC

```
agent_usage_load { projectPath: string } -> AgentUsageRow[]   // newest first
```

TS (`src/lib/tauri/agentUsage.ts`):

```ts
export type UsageCostSource = 'cli' | 'estimated' | 'none';
export type UsageRunKind = 'ticket' | 'goal' | 'review' | 'other';
export interface AgentUsageRow {
  id: string;
  agentId: string;
  ticketId: string | null;
  goalId: string | null;
  runKind: UsageRunKind;
  runSource: string;
  provider: string;
  model: string | null;
  headless: boolean;
  sessionId: string | null;
  ticketStatusAtStart: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'killed';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  costSource: UsageCostSource;
  matchKind: 'exact' | 'heuristic';
  estimateCostUsd: number | null;
  estimateInputTokens: number | null;
  estimateOutputTokens: number | null;
  estimateCacheReadTokens: number | null;
  estimateCacheWriteTokens: number | null;
  unpricedModels: string[] | null;
  numTurns: number | null;
}
```

Event: Rust emits `agent-usage-recorded { projectPath, row: AgentUsageRow }` after the insert,
so the open project's slice can append without a reload.

## Pricing

`cc_usage::pricing::price_bundle(plugin: &UsagePlugin, model: &str, day: &str,
counts: &TokenCounts) -> Option<f64>`: `model_for` → `rate_on` → `cost_of` with the model's
cache multipliers. `None` = unpriced model; the row keeps its tokens, gets `cost_usd = NULL`,
and names the model in `unpriced_models`.

Codex models are priced from a second compiled-in manifest,
`src-tauri/src/agent_usage/codex-pricing.json` (same schema as `usage-plugins`, dated rates,
source URL in each rate's `note`). OpenAI cached input is expressed as the `read` cache
multiplier (cached price / input price).

## Aggregation (frontend, `src/lib/pm/usage/`)

Pure functions, the only place sums are computed:

- `sumUsage(rows) -> UsageTotals` — `{ runs, costUsd, costKnownRuns, estimatedRuns,
unknownCostRuns, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
totalTokens, durationMs }`. `costUsd` sums known costs only; `unknownCostRuns` says how
  many are missing, so a total never looks complete when it is not.
- `usageForTicket(rows, ticketId)`.
- `usageForGoalSubtree(rows, goal, goals, tickets)` — runs on the goal or any descendant
  goal, plus runs on tickets whose `goalId` is in that subtree. A run counts once.
- `groupUsage(rows, by, ctx)` with `by: 'status' | 'epic' | 'goal' | 'provider' | 'model' | 'day'`.
  `status` groups by the ticket's **current** status (`ctx.tickets`); unattributed rows go
  into one `—` group.
- `withinWindow(rows, window: '7d' | '30d' | 'all', now)`.
- `estimateDeviation(rows) -> { n, meanAbsPct, medianAbsPct, maxAbsPct } | null` over rows
  with both `costUsd` (cli) and `estimateCostUsd`; `null` when n = 0.

## MCP

`src/mcp/tools/agentUsage.ts`:

- `list_agent_usage { ticketId?, goalId?, since?, limit? }` → rows (goal filter covers the
  subtree, same rule as `usageForGoalSubtree`).
- `get_usage_summary { groupBy: 'ticket' | 'goal' | 'status' | 'provider' | 'model' }` →
  groups with totals.

## Out of scope for now

- EUR. USD only.
- Pricing the historical `pm_goal_runs` rows. Recording starts with this feature.
- Live cost during a run (`stream-json`). Numbers land when a run ends.
