# Model catalog fix — 2026-10-21

## Root cause

Per-provider model catalogs live in gitignored `dynamic-providers/*.json`
(`info.models`). The IDE passes those ids verbatim as `--model <id>` to the
CLI. There is **no IDE-side effort split**: Antigravity’s own ids already
include the effort suffix (`gemini-4-argon-high`). The spawn failure for
`gemini-3.1-pro-high` was a **stale static catalog** — that id is no longer in
`agy models`. The CLI’s `--effort ""` in the error is its own reporting of an
empty separate effort flag when a compound model id is used; the IDE was not
stripping `-high` incorrectly.

Supervisor policy and last-launch defaults still named the old ids, so the
picker kept offering them until the CLI refused.

## Real model lists (probed 2026-10-21, no paid runs)

| CLI | Version / source | Models |
| --- | --- | --- |
| **agy** (`antigravity`) | 1.4.4 · `agy models` | `gemini-4-argon-{medium,high,low}`, `gemini-3.8-flash-{high,medium,low}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium` |
| **codex** | 0.163.0 · `~/.codex/models_cache.json` (`visibility: list`) | `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |
| **claude** | 2.1.306 · `/model` aliases | `sonnet`, `opus`, `haiku`, `fable`, `best`, `sonnet[1m]`, `opus[1m]`, `fable[1m]`, `opusplan`, `default` (aliases still valid; no machine list command) |
| **grok** | 1.0.62 · `grok models` | `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5` (default) |

## Changes (file:line)

### Runtime discovery + merge

- `src-tauri/src/providers/model_catalog.rs` — new module: parsers (`tsv-id-label`, `grok-bullet`, `codex-cache`), cache under `<app_data_dir>/model-catalog/`, `merge_catalog`, `infer_rank`, `refuse_unavailable_model`, built-in discovery for `antigravity` / `grok` / `codex` (lines 37–58, 66–103, 123–180, 229–261).
- `src-tauri/src/providers/types.rs:40–67` — `ModelOption.available` (default true); `:560–607` — optional `modelsDiscovery` on `ProviderConfig`.
- `src-tauri/src/providers/dynamic.rs:25–57` — resolve models via catalog; fall back default when configured default is unavailable.
- `src-tauri/src/providers/registry.rs:23–58, 94–127, 195` — pass catalog cache dir into providers.
- `src-tauri/src/providers/mod.rs` — export `model_catalog`.

### Spawn + supervisor offer set

- `src-tauri/src/supervisor/mod.rs:203–226` — `model_names` keeps only `available` ids (spawn/policy checks); full list still returned for Settings.
- `src-tauri/src/agents/manager.rs:702–710` — every spawn path refuses unavailable/unknown models with a message that lists current ids.

### UI

- `src/lib/tauri/providers.ts:14–23` — `available?` + `isModelAvailable`.
- `src/app/components/agents/spawnDialog/ProviderModelSection.tsx:121–136` — disabled `(unavailable)` options + amber alert.
- `src/app/components/agents/spawnDialog/useSpawnAgentDialog.ts:121–125` — last-launch restore skips unavailable ids.
- `src/app/components/ide/settings/SupervisorProjectRow.tsx:250–337` — unavailable chips + orphan policy ids marked, not rewritten.

### Docs / static fallbacks (machine-local JSON)

- `dynamic-providers/README.md:150–177` — `modelsDiscovery` schema.
- Updated (gitignored) static catalogs on this machine for antigravity / codex / grok with current ids + ranks/`useFor`/`relativeCost`. Claude aliases left as-is.

### Tests

- `src-tauri/src/providers/model_catalog.rs` — 6 unit tests (parsers, merge, refuse, ranks).
- `src/lib/tauri/providers.test.ts` — `isModelAvailable`.
- Call-site fixes: `registry_tests.rs`, `agents/tests.rs`, `control_socket/tests.rs`.

## Uncertain ranks (inferred for new ids without static metadata)

| Provider | Id pattern | Inferred rank | Confidence |
| --- | --- | --- | --- |
| antigravity | `*argon*`, `*opus*` | 3 | medium — family size, effort not separated |
| antigravity | `*sonnet*` | 2 | medium |
| antigravity | `*flash*`, `*gpt-oss*` | 1 | medium |
| codex | astra / sol / terra / luna | 4 / 3 / 2 / 1 | high — matches existing convention |
| grok | 4.7 / 4.7-build-fast / 4.6 / 4.5 | 3 / 2 / 2 / 1 | medium |

Static JSON entries carry explicit ranks where known; inference only fills gaps.

## Effort mapping

**No IDE change.** Compound Antigravity ids are the CLI’s own identifiers (`agy models`). Passing `--model gemini-4-argon-high` is correct; do not strip `-high` into `--effort`.

## Assumptions

1. Claude’s short aliases remain the stable catalog; full Anthropic model ids are not required in the picker.
2. Codex’s on-disk `models_cache.json` is a fair free probe (no `codex models` TTY list).
3. Built-in discovery by provider id is enough even when a JSON omits `modelsDiscovery`.
4. Showing stale static ids as `available: false` is enough for Settings; policy files are never rewritten.
5. OpenCode / Gemini CLI catalogs were out of scope of the four named CLIs; Gemini CLI is not installed here.

## Tests and build

| Check | Result |
| --- | --- |
| `cargo test --lib providers::` | 78 passed |
| `cargo test --lib` (full) | **1723 passed**, 11 ignored |
| Vitest full suite | **11234 passed**; 1 unrelated flake in `QuickAccessSettingsDialog` emoji picker (timeout; re-run also flaked on emoji tests — not touched by this change) |
| `cargo build` (dev) | ok |
| `next build` | ok (ran in `/tmp` copy because worktree `node_modules` is a symlink Turbopack rejects) |
| code-gate `--diff` | no findings |

## Commit and merge

- **Branch:** `auric/fix-veraltete-provider-modellkat-590f1ad7`
- **Commit:** 
- **Merge:** not performed (per task: leave merge to the starter)

## IDE restart

**Yes.** Runtime discovery and spawn refusal live in the Rust binary; a running app keeps the old registry until restart (or a fresh `pnpm tauri:dev` / production rebuild). Updating only the gitignored JSON files is not enough for an already-running process.

Installed `/Applications/AuricIDE.app` Resources were **not** overwritten (needs explicit approval). After merge/rebuild, `build:production` refreshes them; until then, discovery still works once the new binary runs, because built-in discovery does not depend on the JSON field.

## Mapping question (for the owner)

Settings and supervisor policy still list old Antigravity ids (e.g. `gemini-3.1-pro-high`). They are marked unavailable and refused at spawn. **Which old→new mapping should we offer as a one-click migration?**

1. **Recommended:** `gemini-3.1-pro-high` → `gemini-4-argon-high`; `gemini-3.1-pro-low` → `gemini-4-argon-low` (and add Argon Medium as a new choice).
2. Map 3.1 Pro → Gemini 3.8 Flash at the same effort suffix instead.
3. No migration helper — leave unavailable until manually re-selected.
4. Other mapping (please specify).

Same question for removed Codex ids `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini` (no longer in the Codex cache): drop them, or map to `gpt-5.6-*` / `gpt-6-*`?

## Assumptions list (short)

- See “Assumptions” above.
- Report also copied to the main checkout path required by the task.
