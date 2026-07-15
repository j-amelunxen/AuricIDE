# AuricIDE

> [!WARNING]
> **ALPHA SOFTWARE — NOT PRODUCTION READY**
> This project is in early alpha. Expect breaking changes, missing features, and rough edges. Use at your own risk.

**AuricIDE** is a Tauri desktop IDE for Markdown-based project work with AI agent orchestration. It bridges structured documentation and agentic workflows: define a **goal**, decompose it into **tickets**, let the **conductor** dispatch AI agents against those tickets, and watch the goal verify itself as done.

> **Auric** (adj.): Derived from gold (aurum). An IDE for the "Golden Age" of AI-driven development.

![AuricIDE Screenshot](public/screenshot.png)

---

## 🌟 Why AuricIDE

Chat-window coding assistants make you babysit: you prompt, you watch, you approve every step, you re-explain context every session. AuricIDE is built around a different premise — **you define what "done" means, and the IDE proves it, not you.**

That's the core loop: define a **goal** with machine-checkable success criteria, attach the work (tickets, requirements, or a planning agent that decomposes the goal itself), start the **conductor**, and walk away. The conductor dispatches agents against unblocked work, retries failures, pauses for your approval where you asked it to, and only marks the goal achieved once every linked ticket is done and every linked requirement is verified — not when an agent _claims_ it's done. Every decision it makes is logged, so "walk away" doesn't mean "lose visibility."

**Who it's for:** developers and small teams who run AI agents against real codebases, live in an IDE all day, and think in issue-tracker terms (epics, tickets, dependencies) — but want to steer agents at the goal level instead of supervising every tool call.

**What makes it different from most AI coding assistants:**

- **Outcomes over chat turns.** Most AI IDEs optimize the single edit-and-accept loop. AuricIDE's unit of work is a goal with `successCriteria` — the conductor keeps dispatching agents against a ticket backlog until the goal is machine-verified, unattended, with a bounded retry budget and a full audit trail.
- **Requirements as invariants, not tickets.** A requirement is never "done" — it's `fulfilled` or `violated`, tracked with verification freshness (a requirement unverified for 30+ days is flagged stale). This is closer to a loop invariant than a backlog item, and it gates goal completion.
- **Markdown as the actual source of truth.** The visual workflow canvas isn't a JSON blob behind a pretty UI — its nodes and edges _are_ `## Node:` headings with metadata in a plain `.md` file, so it stays diffable, greppable, and readable without the app.
- **Prose stays prose.** NLP highlighting marks actionable/factual content instead of tinting every noun and verb — built to keep long specs skimmable, not decorate them.

---

## 🚀 Key Features

### 🎯 Goals → Tickets → Conductor → Verified (the core loop)

- **Goals as the outcome view:** a goal is a desired world state with machine-checkable `successCriteria`, organized in a tree via `parentId`. Epics and tickets remain the organizational backlog underneath it.
- **Attach work:** link tickets to a goal, attach requirements as acceptance gates, or launch a planning agent that decomposes the goal into tickets on its own.
- **The Conductor:** a genuinely autonomous dispatcher — it ticks on ticket-completion events plus a 15-second watchdog heartbeat so it can't silently stall, resolves unblocked work dependency-aware and priority-sorted, respects a configurable concurrency cap, and builds goal-aware prompts that inject the success criteria and linked test cases straight into the agent's instructions.
- **Retry, not blind persistence:** a failed ticket gets up to two attempts before the conductor gives up and surfaces it; a ticket you kill by hand reopens instead of being silently retried.
- **Human-supervision gate:** mark a ticket `needsHumanSupervision` and the conductor parks it in a pending-approvals queue instead of spawning an agent — it only proceeds after you explicitly approve it.
- **Verified done, not claimed done:** a goal auto-achieves only once every ticket in its subtree is `done`, every linked requirement is `verified`, and every child goal has `achieved` — otherwise the blockers are listed explicitly, not hand-waved.
- **Decision log:** every conductor action (start, spawn, complete, fail, approval needed, approved, goal achieved) is recorded with a timestamp — a real audit trail for unattended runs, not a decorative activity feed.

### 🕹️ Cockpit (Mission Control)

- The home view whenever a project is open with nothing focused — a literal **Spec → Plan → Execute → Verify** station strip with live counts (spec docs found, open tickets, running agents, requirements still needing proof) plus the full conductor panel embedded.
- **Quick Access:** a hold-to-star project switcher for jumping between workspaces in one click, with a deliberate hold-to-unstar gesture (radial progress ring) so you can't remove a starred project by a stray click.

### 🤖 Agent Orchestration

- Agents run as real child processes over a PTY (Rust's `portable-pty`), with output streamed to the frontend and real exit codes surfaced — a crashed agent shows as `Error`, not silently as idle.
- **Pluggable providers:** ships with Claude Code, Gemini, and Crush/Kimi support out of the box, and you can register your own provider via a JSON config — no fork required.
- Agents are grouped by repo in the Agents panel, with per-agent or "kill all" control, drag-and-drop image attachment, and persisted prompt history per project.
- Fine-grained tool-call approval (plan mode, auto-accept, etc.) is delegated to the underlying CLI's own flags — AuricIDE's supervision model is spawn / kill / approval-gate-at-the-ticket-level with a full decision log, not per-keystroke babysitting.

### 📋 Requirements as Invariants

- **Application Invariants:** long-lived functional & non-functional requirements a project must continuously satisfy — unlike tickets, requirements are never "done"; they're `fulfilled` or `violated`.
- **Lifecycle tracking:** `draft → active → implemented → verified → deprecated`, with a real "Verify Now" action and a `lastVerifiedAt` timestamp. Requirements unverified for 30+ days are flagged stale, and that count drives the Cockpit's headline "needs proof" number — it's not cosmetic.
- **Test linkage:** connect requirements to the test cases that prove them; exposed via MCP so agents can verify requirements as part of their own workflow.
- **Scoped & filterable:** category-based auto ID generation (`REQ-AUTH-01`), an editable `appliesTo` file-path scope, and filters by priority, status, or verification freshness (Fresh / Stale / Unverified).
- **Acceptance criteria:** Markdown checklists that define what "fulfilled" means, bridging spec and test.

### 🗂️ Project Management: Epics, Tickets & Dependencies

- Three real views on the same backlog: a sortable **table**, a **dependency graph** (`@xyflow/react` + `dagre` auto-layout, with heat-map coloring by blocker load), and a **metrics** view (burndown + velocity).
- Dependencies you create actually block conductor scheduling — this isn't a decorative graph.
- Test cases attach per-ticket and feed directly into conductor prompts as acceptance criteria.

### 🎨 Visual & Diagramming

- **Markdown-as-canvas:** a node-based workflow canvas (`@xyflow/react`) whose nodes and edges are literally `## Node:` headings with metadata in a plain `.md` file — bidirectional, diffable, and readable without the app.
- **Obsidian `.canvas` compatibility** for reading and writing Obsidian's own canvas format.
- **Live Mermaid diagrams:** inline, round-trip editable diagram widgets directly in the Markdown flow — edit the diagram, the source updates, and vice versa.
- **Mindmaps & Excalidraw:** dedicated mindmap views and embedded Excalidraw sketches for freeform structural thinking.
- **WikiLink ecosystem:** `[[WikiLinks]]` with fuzzy autocomplete, hover previews, broken-link detection, find-references, and heading rename that updates references across the project.

### 🧠 Editor Intelligence

- **NLP highlighting:** marks actionable/factual content rather than tinting every word class, so long specs stay skimmable instead of looking like a syntax-highlighted novel.
- **ASCII-art repair:** detects and reconstructs broken box-drawing diagrams (`┌─┐│└─┘`) via majority-voting and fuzzy matching — genuinely useful when an AI-generated ASCII diagram goes ragged.
- **Per-language diagnostics:** real-time linting with gutter markers for Markdown (via `remark-lint`), JSON, XML, and YAML.
- **Slash commands:** Notion-style `/commands` for inserting templates, diagrams, and agent prompts.
- **Blueprints:** a gallery of reusable, categorized spec templates with optional sync from a remote blueprint server for repeatable project scaffolding.

### 🛠️ Git & Terminal

- Real git integration via `git2-rs`: status, diff, stage/unstage, commit, and discard — plus a from-scratch CodeMirror gutter extension showing added/modified/deleted lines at the source level.
- **Agentic commit:** a toggle that hands the staged diff to an agent to write and make the commit, instead of you writing the message.
- **Professional terminal:** full PTY sessions (`portable-pty` + `xterm.js`) for seamless CLI interaction alongside the editor.
- _Known gap:_ no in-app branch switching yet — this is alpha software, and that's on the roadmap, not silently missing on purpose.

### 🔌 MCP Server

AuricIDE ships its own [FastMCP](https://github.com/punkpeye/fastmcp) server (`src/mcp/server.ts`) that exposes the project's PM database — goals, epics, tickets, requirements, test cases, dependencies, blueprints, canvas, and history — as tools any MCP-compatible AI client can call. It runs as a Rust-managed subprocess over stdio, so agents (and Claude Code / Cursor / Gemini via `.mcp.json`) can read and mutate project state directly — the same state the conductor and UI operate on, not a separate read-only export.

---

## 🛠️ Tech Stack

| Layer                  | Technology                                                                                                                    |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Desktop Core**       | [Tauri v2](https://tauri.app/) (Rust)                                                                                         |
| **Frontend Framework** | [Next.js 16](https://nextjs.org/) (App Router), React 19                                                                      |
| **Editor Engine**      | [CodeMirror 6](https://codemirror.net/)                                                                                       |
| **Styling**            | [Tailwind CSS 4](https://tailwindcss.com/)                                                                                    |
| **Visual Canvas**      | [XYFlow](https://xyflow.com/) (React Flow) + [dagre](https://github.com/dagrejs/dagre), [Excalidraw](https://excalidraw.com/) |
| **3D**                 | [react-three-fiber](https://github.com/pmndrs/react-three-fiber) + [drei](https://github.com/pmndrs/drei)                     |
| **NLP Engine**         | [wink-nlp](https://winkjs.org/), [Transformers.js](https://huggingface.co/docs/transformers.js/)                              |
| **State Management**   | [Zustand](https://github.com/pmndrs/zustand)                                                                                  |
| **Terminal**           | [xterm.js](https://xtermjs.org/) + `portable-pty`                                                                             |
| **Local Database**     | SQLite via `better-sqlite3` (frontend/MCP) and `rusqlite` (Tauri backend)                                                     |
| **Agent Protocol**     | [FastMCP](https://github.com/punkpeye/fastmcp) (Model Context Protocol server)                                                |

---

## 🏁 Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8
- **Rust** >= 1.77 (for building the Tauri backend)
- [Tauri Dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

### Installation & Development

The easiest way to get started is using the provided development scripts:

```bash
# Clone the repository
git clone https://github.com/PlasmaLampe/AuricIDE.git
cd AuricIDE

# Check your environment and start the development server
./run_dev.sh
```

Alternatively, you can run the steps manually:

```bash
# Verify your environment
./check_env.sh

# Install dependencies
pnpm install

# Launch in Development Mode (Full Desktop App)
pnpm tauri:dev

# Run Web-only Preview (Limited native features)
pnpm dev
```

---

## 🧪 Quality Assurance

AuricIDE is built with a focus on reliability and performance, following a strict TDD workflow (see `CLAUDE.md`).

```bash
pnpm check:all         # Runs lint, format check, knip, jscpd, TS tests, Rust tests, and Clippy
pnpm test:run          # Run Vitest suite once (do NOT use `pnpm test` — its watch mode hangs CI/agents)
pnpm tauri:test        # Run Cargo tests (Rust backend)
pnpm tauri:clippy      # Rust linter
pnpm test:e2e          # Run Playwright end-to-end tests
pnpm lint              # ESLint
pnpm format:check      # Prettier check
```

---

## 📂 Project Structure

```text
├── src/
│   ├── app/                # Next.js Application (App Router)
│   │   └── components/     # UI: goals, pm, requirements, agents, canvas, mindmap,
│   │                       #     excalidraw, cockpit, git, terminal, editor, ...
│   ├── lib/                # Shared logic
│   │   ├── store/          # Zustand slices (pm, goals, conductor, agents, git, canvas, ...)
│   │   ├── editor/          # CodeMirror extensions (highlighting, mermaid, wikilinks, git gutter)
│   │   ├── tauri/           # Typed IPC wrappers around Tauri commands
│   │   ├── nlp/             # wink-nlp / Transformers.js based highlighting & entity extraction
│   │   ├── orchestration/   # Ticket/dependency graph building for the conductor
│   │   └── ...              # ascii-art, blueprints, canvas, mermaid, refactoring, qa, ...
│   ├── mcp/                 # FastMCP server + tool implementations (one file per domain)
│   └── types/                # Global TypeScript definitions
├── src-tauri/
│   ├── src/                 # Rust backend (database, agents, git, PTY shell, LLM, MCP subprocess)
│   └── tauri.conf.json      # Tauri configuration
└── e2e/                      # Playwright E2E tests
```

---

Driven by: https://software-architecture.ai

---

## 📜 License

Licensed under **AGPL v3**. Commercial licensing available on request.
