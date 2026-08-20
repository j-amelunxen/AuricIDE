<p align="center">
  <img src="docs/assets/hero-banner.jpg" alt="AuricIDE" width="100%" />
</p>

# AuricIDE

> [!WARNING]
> **Alpha.** Breaking changes, missing features, rough edges. Don't put production work on this yet.

Desktop IDE (Tauri) for Markdown-heavy project work with AI agent orchestration. You define a **goal** with checkable success criteria, hang **tickets** (and optionally requirements) off it, start the **conductor**, and it dispatches agents until the goal is actually satisfied, not until an agent says it is.

![Screenshot](public/screenshot.png)

---

## Why AuricIDE vs your IDE + AI plugins

A regular IDE with AI plugins is great for _editing with help_. AuricIDE is built for _running work until an outcome is true_.

| Your IDE + AI plugins                             | AuricIDE                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| One chat / one agent in a sidebar                 | A fleet of real CLI agents, scheduled and watched                             |
| "Done" is whatever the model says                 | Goals with checkable success criteria; conductor only stops when they hold    |
| Tickets live in an external tracker, agents don't | Goals, tickets, requirements, deps are first-class and MCP-shared with agents |
| Plugin = one vendor stack                         | Bring any CLI agent (OpenCode, Crush, …) via `dynamic-providers/`             |
| Code-first workspace                              | Markdown-heavy project workspace: goals, canvases, docs, PM in one shell      |

You still write code. The difference is orchestration: define the outcome, hang work on it, let the conductor dispatch, and get blockers instead of vibes when it isn't satisfied yet.

---

## How the loop works

1. **Goal**: desired outcome + `successCriteria`. Goals form a tree (`parentId`).
2. **Work**: link tickets, attach requirements as gates, or let a planning agent call `decompose_goal` / `create_ticket`.
3. **Conductor**: spawns agents for unblocked open tickets (priority + deps, concurrency cap, max 2 attempts). Tickets marked `needsHumanSupervision` wait for explicit approval.
4. **Done**: `getGoalSatisfaction` requires: subtree tickets `done`, linked requirements `verified`, child goals `achieved`. Otherwise you get the blockers. Empty goals never auto-satisfy.

Epics/tickets stay the backlog view; the goal link is the outcome view. Conductor decisions go into a timestamped log (`conductorDecisions`).

The agent panel is built so you don't have to poll cards: one attention model (`error` > `needs-input` > `stalled`), a real "all quiet" signal while things run, parked agents still running but out of the way. Details live in `src/lib/agents/`.

---

## Features

**Goals & conductor**

- Goal tree, ticket links, requirement gates, planning-agent decomposition
- Conductor on ticket events + 15s watchdog; dependency-aware scheduling
- Decision log; opt-in human approval per ticket

**Agents**

- Real child processes over PTY (`portable-pty`), streamed output, real exit codes
- Add whatever custom CLI agent provider you need (OpenCode, Crush, etc.) via JSON under `dynamic-providers/` (no recompile)
- Repo grouping, kill one / kill all, image attach, per-project prompt history
- Permission modes delegated to the underlying CLI flags

**Requirements**

- Long-lived invariants, not tickets: lifecycle `draft → active → implemented → verified → deprecated`
- Stale after 30 days without re-verify; link to test cases; MCP-exposed

**PM**

- Epics / tickets / deps: table, dependency graph (xyflow + dagre), metrics
- Deps actually block conductor scheduling
- Test cases per ticket feed into agent prompts

**Editor / docs**

- CodeMirror 6: Markdown-first, remark-lint, JSON/XML/YAML diagnostics
- NLP highlighting aimed at actionable/factual bits (not rainbow POS tagging)
- WikiLinks, Mermaid widgets (round-trip), mindmaps, Excalidraw embed
- Workflow canvas stored as plain Markdown (`## Node:` …); also Obsidian `.canvas`
- ASCII box-drawing repair for mangled AI diagrams
- Slash commands, blueprint templates

**Git / terminal**

- git2-rs: status, diff, stage, commit, discard; CodeMirror git gutter
- Agentic commit (agent writes message from staged diff)
- Full PTY terminal (xterm.js)
- No in-app branch switch yet (known gap)

**MCP**

- FastMCP server (`src/mcp/server.ts`) over the project SQLite DB
- 15 tool domains: goals, epics, tickets, tasks, requirements, testcases, dependencies, blueprints, context, canvas, stations, knowledge, reviews, notifications, history
- Same state as the UI/conductor: agents mutate the real project, not a side export

---

## Stack

| Layer        | Tech                                              |
| ------------ | ------------------------------------------------- |
| Shell        | Tauri v2 (Rust)                                   |
| UI           | Next.js 16, React 19, Tailwind 4                  |
| Editor       | CodeMirror 6                                      |
| Canvas       | XYFlow, dagre, Excalidraw                         |
| State        | Zustand                                           |
| DB           | SQLite (`rusqlite` backend, `better-sqlite3` MCP) |
| Terminal     | portable-pty + xterm.js                           |
| Agents / MCP | PTY child processes, FastMCP                      |
| NLP          | wink-nlp, Transformers.js (optional bits)         |

---

## Requirements

- Node.js ≥ 20.9 (Next 16 rejects 20.0–20.8)
- pnpm 11.21.0 — pinned via `packageManager`; run `corepack enable` once and the
  right version is used automatically. The lockfile is v9 and pnpm 8 cannot read it.
- Rust ≥ 1.77.2
- [Tauri system deps](https://v2.tauri.app/start/prerequisites/) for your OS

`./check_env.sh` verifies all three versions, not just that the tools exist.

---

## Run

```bash
git clone https://github.com/j-amelunxen/AuricIDE.git
cd AuricIDE
./run_dev.sh          # check_env + pnpm install + tauri dev
```

Or step by step:

```bash
./check_env.sh
pnpm install
pnpm tauri:dev        # full desktop app
pnpm dev              # Next only: limited native features
```

Build a real app bundle:

```bash
pnpm build:production # builds the macOS .app and installs it to /Applications
                      # --no-install keeps it in src-tauri/target/release
                      # --dmg for a disk image, --open to launch it
pnpm tauri:build      # plain tauri build, no install step
```

### Agent providers

AuricIDE compiles in **one** agent provider, Crush. Everything else — Claude Code,
Gemini CLI, Codex, OpenCode, … — is a JSON file you drop into
`dynamic-providers/`, and those files are deliberately **not** in the repo
(`.gitignore`), because they describe CLIs installed on _your_ machine. A fresh
clone therefore starts with Crush only.

See [`dynamic-providers/README.md`](dynamic-providers/README.md) for the config
format and a worked example to copy.

---

## Tests & checks

TDD is the house rule (see `CLAUDE.md`). Don't run `pnpm test` in CI/agents: watch mode hangs. Use `test:run`.

```bash
pnpm check:all        # tauri versions check, lint, automation surface check, format, knip, jscpd, TS tests, cargo test, clippy, fmt, machete
pnpm test:run         # Vitest once
pnpm tauri:test       # Rust
pnpm tauri:clippy
pnpm test:e2e         # Playwright
pnpm lint
pnpm format:check
```

Single file / name:

```bash
pnpm test:run src/lib/store/pmSlice.test.ts
pnpm test:run -t "epic"
```

---

## Layout

```text
src/
  app/                 # Next App Router UI
  lib/
    store/             # Zustand slices (pm, goals, conductor, agents, …)
    editor/            # CodeMirror extensions
    tauri/             # typed IPC wrappers
    agents/            # fleet, attention, liveness, …
    nlp/ orchestration/ …
  mcp/                 # FastMCP server + tools (one file per domain)
src-tauri/src/         # Rust: DB, agents, git, PTY, LLM, MCP subprocess
e2e/                   # Playwright
dynamic-providers/     # drop-in agent CLI JSON configs
docs/                  # assets, brand, automation surface notes
```

---

## Docs

| Document                                                                            | What it is                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                                            | Architecture and house rules. The map for anyone (or anything) working in this repo |
| [`docs/automation-surface.md`](docs/automation-surface.md)                          | Every command addressable from outside the app. **Generated** — don't hand-edit     |
| [`docs/semantic-markdown-highlighting.md`](docs/semantic-markdown-highlighting.md)  | How the Markdown/NLP highlighting layers work                                       |
| [`dynamic-providers/README.md`](dynamic-providers/README.md)                        | Agent-provider JSON format                                                          |
| [`themes/README.md`](themes/README.md)                                              | Custom theme JSON format                                                            |
| [`docs/brand-kit.md`](docs/brand-kit.md) · [`docs/press-kit.md`](docs/press-kit.md) | Visual identity and press material                                                  |

---

## License

**AGPL-3.0-only.** Commercial licensing on request.
