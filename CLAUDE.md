# CLAUDE.md

AuricIDE is a Tauri v2 desktop app: Next.js 16 / React 19 / TypeScript frontend,
Zustand state, Rust backend and a FastMCP subprocess.

## Working rules

- **Never run `pnpm test`**: it starts watch mode and hangs agents. Use `pnpm test:run`.
- **TDD is mandatory for behavior changes**: write a failing test, confirm the failure,
  implement the minimum, then refactor while green. Verify at the lowest trustworthy
  layer in the [test policy](docs/testing/test-policy.md); unit tests suit combinatorial
  pure logic, not a test quota. Never skip verification.
- TypeScript: strict, single quotes, es5 trailing commas, 100-column width.
  Rust: edition 2021, 100-column width, four-space indentation.
  Use functional components and `'use client'` only when needed.
- Import shared contracts from their library owner, not components or IPC wrappers.
  Use the shared `src/lib/tauri/invoke.ts` helper for IPC, preserve browser-mode
  fallbacks and mock `@tauri-apps/api/core` in tests.
- Test stores use `createTestStore(overrides)` from `src/lib/store/testing.ts`;
  never cast partial objects as complete state.
- When a rule has Rust and TypeScript implementations, **change the shared fixtures
  first, then both implementations**. See [twins and fixtures](docs/architecture/README.md#4-twins-and-fixtures).
- Before committing, run `pnpm check:all` ([checks and workflow](docs/development/workflow.md)).
- Architectural changes must update affected `docs/architecture/*.md` and
  `*.scene.json`, including drifting counts. Run `scene validate docs/architecture --root . --strict`
  and `scene layout <file> --check` for changed scene graphs; note the update in the
  commit/PR. Reviews must verify this. [Scope and details](docs/development/workflow.md#architecture-docs-and-scenes-docsarchitecture).
- Keep this file short. Put feature details in `docs/` and link them from the relevant
  guide and documentation index.

## Key commands

```bash
pnpm dev              # Next.js dev server
pnpm tauri:dev        # Full desktop app
pnpm test:run [file]  # Vitest single pass; optional file filter
pnpm test:e2e         # Playwright
pnpm tauri:test       # Rust tests
pnpm check:all        # Full pre-commit verification
```

Build/install options, individual checks and test environments: [workflow](docs/development/workflow.md)
and [installed vs. dev build](docs/development/configuration.md#the-installed-app-vs-the-dev-build).

## Task-specific documentation

Read the relevant guide before changing an area; load other guides as needed.
Source layout: `src/app/` (UI), `src/lib/` (logic, store, IPC), `src/mcp/` (MCP),
`src-tauri/src/` (Rust; commands registered in `lib.rs`), `e2e/` (Playwright).
Unit/component tests live next to source as `*.test.ts` / `*.test.tsx`.

| Changing                                                            | Read                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Settings, credentials, provider policy, sandbox, shared preferences | [Configuration](docs/development/configuration.md)        |
| Store, IPC, shell UI, editor, formatting, explorer                  | [Frontend](docs/development/frontend.md)                  |
| Goals, tickets, requirements, conductor                             | [Goal workflow and invariants](docs/development/goals.md) |
| Fleet, attention, detached terminals, console                       | [Agent fleet](docs/development/agent-fleet.md)            |
| Control socket, Supervisor Link, jobs, external agents              | [Agent control](docs/development/agent-control.md)        |
| Supervisor policy, launch, managers, memory                         | [Supervisors](docs/development/supervisors.md)            |
| Notifications, schedules, automatic launches                        | [Notifications](docs/development/notifications.md)        |
| Multi-repo Git, discovery, graph                                    | [Git](docs/development/git.md)                            |
| Rust runtime, MCP, machine tools, video import                      | [Backend](docs/development/backend.md)                    |
| Quota, usage reports, run costs                                     | [Usage](docs/development/usage.md)                        |

[Documentation index](docs/README.md) · [Architecture and scenes](docs/architecture/README.md) ·
[External interfaces](docs/architecture/interfaces.md) · [Developer guide index](docs/development/README.md)
