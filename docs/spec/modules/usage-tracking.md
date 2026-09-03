# Usage Tracking & Quota

The Usage Tracking & Quota module monitors real-time CLI provider quota limits and analyzes historical token consumption and expenditure across agent sessions in AuricIDE.

---

## 1. Purpose

Developers running autonomous agent fleets need transparency into both instantaneous rate limits and cumulative financial costs. This module addresses two distinct questions:

- **`usage_limits`**: _How full is the quota window right now?_ (Real-time percentage and reset time displayed in the status-bar chip).
- **`cc_usage`**: _What did the agent CLIs consume over the last 24 hours to 30 days?_ (Token totals, turns, sessions, and calculated cost displayed in the usage report panel).

---

## 2. Boundaries

- **Subprocess Execution**: Does not fork or kill agent processes; see [Agent Fleet](./agent-fleet.md).
- **Credentials & Keys**: Does not manage API credentials; see [Configuration & Credentials](./configuration-credentials.md).

---

## 3. Two Usage Features Compared

| Dimension         | Real-Time Quotas (`usage_limits`)                 | Historical Consumption (`cc_usage`)                  |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------- |
| **Question**      | How full is the rate limit window **right now**?  | What was consumed over the last 24 h – 30 d?         |
| **Data Source**   | Live CLI status line output / `codex` probes      | On-disk agent transcript JSONL logs                  |
| **Output Shape**  | Utilization percentage and window reset timestamp | Tokens (input/output/cache), turns, and USD cost     |
| **UI Surface**    | Status bar chip                                   | Comprehensive usage report modal/panel               |
| **Prerequisites** | An interactive agent must have run recently       | Transcripts present on disk (independent of runtime) |

---

## 4. Public Contracts

### Historical Consumption Scanning (`src-tauri/src/cc_usage/`)

- **Manifest Plugin Architecture**:
  - Defined in `usage-plugins/*.json` (scanned across five directory paths) with a compiled-in default (`default-manifest.json`).
  - Dates and prices token rates per day to avoid rewriting historical cost when pricing changes.
- **Reporting Invariant (Prior Period Comparison)**:
  - Every aggregate metric is evaluated against the immediately preceding period of equal length.
  - Scans reach back **twice** the selected timeframe (e.g. 60 days for a 30-day window).
  - If log history does not span the prior period, `previous` is explicitly set to `None` rather than reporting a false 0% baseline.

### Quota Probing (`src-tauri/src/usage_limits/`)

- Supported CLI probes: `claude` (Claude Code status extraction), `codex` CLI probe.
- Emits quota exhaustion thresholds and reset timers.

---

## 5. Key Flows

### 5.1 Historical Usage Report Generation

1. User clicks the status bar usage widget.
2. Frontend calls `cc_usage_report(window: '24h' | '7d' | '30d')`.
3. Rust backend scans discovered transcript directories (`scan.rs`).
4. Groups entries by date, matches applicable pricing model (`pricing.rs`), and tallies tokens and turns (`report.rs`).
5. Returns current totals alongside previous period deltas.

### 5.2 Status Bar Quota Monitoring

1. Active agents emit status lines or quota probe hooks during interaction.
2. `usage_limits::store` captures latest percentage utilization and reset epoch.
3. Updates status bar badge chip with green/yellow/red color thresholds.

---

## 6. Dependencies

- **[Agent Fleet](./agent-fleet.md)**: Produces execution sessions and transcript files.
- **[Tauri Backend Core](./tauri-backend-core.md)**: IPC command handling and filesystem directory scanning.

---

## 7. Relevant Source Paths

- `src-tauri/src/cc_usage/` — Transcript scanning, manifest pricing, and historical report aggregation.
- `src-tauri/src/usage_limits/` — Real-time quota probes, status line parsing, and persistence.
- `src/lib/usage/` — Frontend usage report state and visualization components.
