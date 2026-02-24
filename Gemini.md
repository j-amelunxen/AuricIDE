# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

> **IMPORTANT:** Never invoke `pnpm test` (watch mode) — it will hang. Always use `pnpm test:run` for a single pass.

## TDD Workflow (mandatory)

1. **Write a failing test** for the new behavior
2. **Run the test** — confirm it fails for the right reason
3. **Implement** the minimum code to make it pass
4. **Refactor** while keeping tests green
5. **Never skip tests** — every feature needs unit coverage

## Key Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm test:run         # Vitest single run (use this, not pnpm test)
pnpm test:e2e         # Playwright E2E
pnpm lint             # ESLint
pnpm format:check     # Prettier check
pnpm tauri:dev        # Full desktop app (Rust + Next.js)
pnpm tauri:test       # Rust unit tests
pnpm tauri:clippy     # Rust linter
pnpm check:all        # Everything at once
```

### Running a Single Test

```bash
# Run one file
pnpm test:run src/lib/store/pmSlice.test.ts

# Run tests matching a name pattern
pnpm test:run --reporter=verbose -t "epic"
```

## Code Style

- **TypeScript:** strict mode, single quotes, trailing commas (es5), 100 char width
- **Rust:** edition 2021, 100 char width, 4-space indent
- **Components:** functional components, `'use client'` only when needed
- **Tauri IPC:** mock `@tauri-apps/api/core` in tests, try/catch fallback for browser mode

## Project Structure

- `src/app/` — Next.js App Router pages and components
- `src/lib/` — Shared logic (editor extensions, store slices, NLP, IPC wrappers)
- `src/mcp/` — MCP server (FastMCP, tool implementations per domain)
- `src-tauri/src/` — Rust backend (commands in lib.rs)
- `e2e/` — Playwright E2E tests
- Tests live next to source files (`*.test.tsx`)

## Before Committing

Run `pnpm check:all` to verify lint, format, tests, and Rust checks all pass.

---

## Architecture Overview

AuricIDE is a **Tauri v2 desktop app**: a Next.js 16 frontend communicates with a Rust backend over Tauri's IPC command system. Think of it as three layers:

```
Next.js (React/TypeScript)  →  Tauri IPC invoke()  →  Rust backend
src/app/ + src/lib/             src/lib/tauri/*.ts      src-tauri/src/
```

## State Management (Zustand)

All frontend state lives in a single combined Zustand store (`src/lib/store/index.ts`). It's composed of ~15 slices using `StateCreator`:

```typescript
// Each slice follows this pattern:
export const createPmSlice: StateCreator<PmSlice> = (set, get) => ({ ... });

// Combined in index.ts:
export type StoreState = FileTreeSlice & TabsSlice & GitSlice & PmSlice & ...;
```

Key slices and what they own:

| Slice | Key Concern |
|---|---|
| `pmSlice` | Epics, tickets, test cases, dependencies; draft/persisted split with a `pmDirty` flag |
| `agentSlice` | Running AI agents, per-agent logs |
| `gitSlice` | Branch, file statuses (A/M/D), staging, commit |
| `tabsSlice` | Open editor tabs and active tab |
| `mcpSlice` | MCP server running state and PID |
| `canvasSlice` | XYFlow nodes/edges for workflow canvas |
| `uiSlice` | Modal open/closed states, panel visibility |
| `diagnosticsSlice` | remark-lint errors keyed by file path |

**PM draft pattern:** `pmDraftEpics` holds in-progress edits; `pmEpics` is the last-persisted snapshot. `savePmData()` flushes drafts to SQLite via IPC.

## Tauri IPC Pattern

All IPC wrappers live in `src/lib/tauri/*.ts`. They all use a lazy dynamic import to avoid breaking browser/test environments:

```typescript
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}
```

Rust commands are registered in `src-tauri/src/lib.rs` with `#[tauri::command]` and wired up in `.invoke_handler(tauri::generate_handler![...])`.

**In tests**, mock the IPC layer:
```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => mockData) }));
```

## CodeMirror Editor

`src/lib/editor/setup.ts` assembles the editor state. Each feature is a separate extension:

- `auricHighlightExtension` / `nlpHighlightExtension` – grammar-aware syntax highlighting
- `mermaidWidgetExtension` – inline Mermaid diagram rendering
- `wikiLinkExtension` – `[[WikiLink]]` completion and hover
- `markdownFoldExtension` – heading-based section folding
- `gitGutterExtension` – per-line git status in gutter
- `remarkLintProcessor` – real-time remark-lint diagnostics

Dynamic reconfigurations use CodeMirror `Compartment`s so the editor doesn't need to be recreated.

## MCP Server

`src/mcp/server.ts` is a FastMCP server that exposes the PM database as AI tools (epics, tickets, tasks, dependencies, history). It runs as a subprocess started by Rust (`src-tauri/src/mcp.rs`) and communicates via stdio JSON-RPC. To run it standalone:

```bash
npx tsx src/mcp/server.ts /path/to/project.db
```

Tool implementations are in `src/mcp/tools/` — one file per domain.

## Main Page Structure

`src/app/page.tsx` (the only page) splits concerns into three hooks:
- `useIDEState()` – derives all state from the store
- `useIDEHandlers()` – event handlers and computed props
- `useIDEActions()` – side-effect setup (file watcher, Tauri event listeners)

The active tab type determines which viewer renders: `MarkdownEditor` (CodeMirror), `CanvasView` (XYFlow), `MindmapView`, `DiffViewer`, or `ImageViewer`.

## Rust Backend Modules

| Module | File | Responsibility |
|---|---|---|
| Commands | `lib.rs` | IPC command registration, PTY shell (`shell_spawn/write/read`), file watcher |
| Agents | `agents.rs` | Spawn/kill AI agent processes, stream output |
| Database | `database.rs` | SQLite schema, all PM CRUD (epics, tickets, test cases, dependencies) |
| MCP | `mcp.rs` | Start/stop MCP server subprocess |
| Providers | `providers.rs` | LLM provider config registry |
| LLM | `llm.rs` | HTTP calls to LLM APIs |
