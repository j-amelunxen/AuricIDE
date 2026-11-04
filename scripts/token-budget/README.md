# token-budget

Offline, deterministic, read-only CLI that shows where tokens go across agent runs: by project,
session, role, model, ticket/goal, skill phase, activity, tool, day, and (where provable) cause.
No LLM, no network, no verdicts: it labels rule-based _candidates_ and leaves the decision to a human.
Standard library only (Python 3.11+). It touches nothing in the IDE.

```bash
python3 scripts/token-budget/token_budget.py --out DIR [--since YYYY-MM-DD] [--until YYYY-MM-DD] \
    [--project SUBSTRING] [--paths] [--config thresholds.json] [--skip claude|codex|box|auric]
python3 -I -m unittest discover -s scripts/token-budget/tests -t scripts/token-budget
```

`DIR` is created with mode 0700, files 0600. Same inputs and options give byte-identical output
(no wall-clock, stable sorts, 6-decimal rounding). Day = UTC date of the request.

## Sources (all read-only)

| Source      | Where                                                                                              | Notes                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `~/.claude/projects/**/*.jsonl` incl. `subagents/`                                                 | repeated lines of one response merged by `message.id`+`requestId` (largest figure wins); a request seen in an earlier file is counted once |
| Codex       | `~/.codex/sessions/**/*.jsonl`                                                                     | token figures only; no content analysis                                                                                                    |
| AuricIDE    | `<project>/.auric/project.db` (`pm_agent_usage`, read from a temp copy), `task-logs/tasks-*.jsonl` | links session to ticket, goal, provider; reconciliation                                                                                    |
| sandboxctl  | `~/Library/Application Support/sandboxctl/usage/<lease>.json` and `<lease>.transcripts.tgz`        | archives are streamed, never extracted; leases without archive are booked as recorded cost only                                            |

Prices come from the repo's own tables (`src-tauri/src/cc_usage/default-manifest.json`,
`src-tauri/src/agent_usage/codex-pricing.json`). Unpriced models keep their tokens and are listed. Costs are
list-price equivalents, never bills.

## Privacy

Only sizes, counts, token figures, timestamps, model, tool name, skill name, agent ids and one-way hashes of
tool-call inputs are kept. Bash keeps at most the first word. File paths are written only with `--paths`, and only
to `paths.csv`. `schema_dump.py` prints key names and types only; use it, not `cat`, to look at real files.

## Method

Per request, the billed cost is split into pools that sum to it: carried context (cache read), new content
(cache write / fresh input), rewrites after a cache loss, and output. Arriving items (tool results, injected
attachments, user text, assistant output) get their size from the cache-write delta when alone in the gap
(`measured`), else from length / `chars_per_token`, scaled down to the measured gap (`estimated`). What cannot be
explained stays in `unattributed` buckets, so every table sums to the total. Skill phase is a heuristic: from a
`Skill` tool call (or `attributionSkill`) to the next real human message; sub-agents inherit the parent's phase
at their first request.

Outputs: `summary.json` (schema 1.0.0, see `schema_version`; top-level keys `coverage`, `totals`, `tables`,
`baseline`, `reconciliation`, `box`, `budget_view`, `thresholds`, `prices_used`, `not_covered`), one CSV per table,
`report.md` (coverage first, then the budget view). Every figure carries a `quality` of measured, estimated or
heuristic. Thresholds live in `thresholds.json` and are echoed into the summary.
