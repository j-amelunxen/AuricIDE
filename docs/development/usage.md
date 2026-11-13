# Usage, quota and run costs

[Developer guide index](README.md) · [Documentation index](../README.md)

Live quota, transcript reports and ticket/goal cost bookkeeping. See also the [module specification](../spec/modules/usage-tracking.md), [run-usage contract](../design-agent-usage.md) and [plugin schema](../../usage-plugins/README.md).

## Two usage features, two different questions

`usage_limits` and `cc_usage` sit next to each other and are easy to confuse.
They are not two views of one number:

|          | `usage_limits`                              | `cc_usage`                               |
| -------- | ------------------------------------------- | ---------------------------------------- |
| Question | How full is the quota window **right now**? | What did the last 24 h–30 d **consume**? |
| Source   | The CLI's own status line / `codex` CLI     | The CLIs' transcripts on disk            |
| Shape    | A percentage and a reset time               | Tokens, turns, sessions and a cost       |
| Surface  | The status-bar chip                         | The report panel beside it               |

Neither can be derived from the other: a percentage does not say how many
tokens produced it, and a token total does not say how much of an allowance is
left. They also fail independently — quota needs an interactive agent to have
run recently, the report needs only files that are already there.

### The plugin seam

What a usage source _is_ — where its records live and what its tokens cost —
is declared in `usage-plugins/*.json` and read by `manifest.rs`, using the same
five-directory scan as `dynamic-providers/`. Only the reader for the
`claude-jsonl` shape is compiled in. [usage-plugins/README.md](../../usage-plugins/README.md) is the schema;
the two things worth knowing here:

- **`claude-code` ships compiled in**, unlike the provider registry where
  users bring their own — a price list nobody wrote is a feature that reports
  nothing. `usage-plugins/*.json` is git-ignored exactly like
  `dynamic-providers/*.json`, so the compiled-in default lives in
  `src-tauri/src/cc_usage/default-manifest.json`: reading it out of an ignored
  directory would make a fresh clone fail to build.
- **Rates are dated.** Each record is priced by the day it happened, so an
  introductory price ending mid-window does not silently rewrite history.

### How the panel reads

Two design rules, both about honesty rather than looks:

- **Every figure is reported against the period before it.** A bare total
  answers "how much" and leaves "compared to what?" unanswered. This is why
  the scan reaches back _twice_ the widest window. Where the transcripts do
  not span the whole earlier period the comparison is withheld
  (`previous: None`) rather than shown as a quiet one — on a real corpus the
  30-day window hits this, and rendering absent as idle would have reported a
  large increase that is only missing data. The coverage test is against the
  oldest turn found, never against the scan range, which is always wide enough
  by construction and would make the check tautological.
- **Each breakdown row carries its own series on one shared scale**
  (`NamedAggregate.series`, aligned index-for-index with the window's
  `buckets`). That makes the breakdown small multiples rather than a ranked
  list: a spike in one row is directly comparable to a spike in another, and a
  quiet row renders quiet. Per-row scaling would stretch a $3 model to the
  same height as a $500 one and invert the finding. Only the drawn rows keep
  a series — several hundred projects times thirty buckets is a lot of JSON
  for bars nobody renders.

### Three rules the numbers depend on

- **A turn is counted once.** The same API call lands in more than one
  transcript when a session is resumed or forked — on a real corpus over half
  of what is read is a duplicate, so counting turns as they are read would
  roughly double every figure. The key is `message.id` + `requestId`; either
  alone would collapse turns that really did both happen.
- **An unpriced model keeps its tokens.** A model missing from the price list
  contributes tokens, contributes no cost, and is named on `unpricedModels`. A
  total that is missing money has to say so rather than look complete.
- **Cost is a list-price equivalent, never a bill.** A transcript records
  tokens, not what the account was charged, so the only rate it can be priced
  at is the published one. On a subscription the real charge is the
  subscription, and the panel says that where the figure is, not in a footnote.

Reading is on demand, cached for 60 seconds, and skips files by modification
time — a file untouched since before the oldest window cannot hold a record
inside it. That last one is the only reason a 30-day report does not read
30 months of transcripts, and it is also the deliberate imprecision: a
transcript whose mtime was rewritten backwards is invisible past a day of
slack. `cargo test cc_usage -- --ignored --nocapture` runs the scanner against
the real machine, which is the only place the transcript format is checked
against what it actually is rather than against our idea of it.

### A third one: what a ticket or goal cost (`agent_usage`)

Every agent run in a project is booked when it ends — exit, kill or app quit — as one
row in `pm_agent_usage` (migrations 25 and 26, twinned in `src/mcp/db.ts` and guarded by a
test that compares the SQL). The row carries the ticket and goal the run was for, so
the PM views can sum per ticket, per goal subtree and per status. Contract and
captured CLI facts: [docs/design-agent-usage.md](../design-agent-usage.md). The rules worth knowing:

- **Exact where the CLI says it, estimated only where it cannot.** Headless Claude
  (`--output-format json`) books the CLI's own figure (`costSource: cli`);
  interactive runs and Codex are read from the transcript/rollout and priced by us
  (`estimated`). Every headless Claude run is read both ways, so the deviation is a
  live figure in the Costs tab.
- **Read `modelUsage`, never `usage`.** The result's `usage` is the last API call
  only; subagents write `<session>/subagents/agent-*.jsonl`; and one message spans
  several transcript lines whose `output_tokens` grows — the **largest** wins. With
  that, `cargo test agent_usage_bench -- --ignored` measured 0.000 % deviation.
  The same first-line-wins bug undercounted output in `cc_usage` until it was fixed.
- **Capture is declared per provider** (`usage` block in `dynamic-providers/*.json`);
  a provider without one books duration and outcome with `costSource: none`.
- **An unknown price is never $0.** Unpriced runs keep their tokens, get
  `cost_usd = NULL`, and every total says how many runs it is missing.
- **A price added later is caught up on request, not by itself.** Settings → Maintenance →
  "Recalculate pricing" reads unpriced estimates again (transcript bounded by the run's own
  start and end) and writes the price only if the evidence still adds up to the booked tokens.
