# Development workflow

[Developer guide index](README.md) · [Documentation index](../README.md)

Commands, test environments, commit checks and documentation maintenance. Verification rules: [test policy](../testing/test-policy.md).

## Key Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm test:run         # Vitest single run (use this, not pnpm test)
pnpm test:e2e         # Playwright E2E
pnpm lint             # ESLint
pnpm format:check     # Prettier check
pnpm tauri:dev        # Full desktop app (Rust + Next.js)
pnpm build:production # Build the .app and install it to /Applications
pnpm tauri:test       # Rust unit tests
pnpm tauri:clippy     # Rust linter
pnpm check:all        # Everything at once
```

## Running a Single Test

```bash
# Run one file
pnpm test:run src/lib/store/pmSlice.test.ts

# Run tests matching a name pattern
pnpm test:run --reporter=verbose -t "epic"
```

Vitest runs two projects (`vitest.config.mts`): `.ts` tests in `node`, `.tsx`
tests in `happy-dom`. A file that needs jsdom says so on its first line with
`// @vitest-environment jsdom` — a `.ts` test touching the DOM, or a component
test that depends on something happy-dom does differently (colour
normalisation, a writable `navigator.clipboard`, fuller CSS parsing).
`pnpm test:run:jsdom` runs every component test on jsdom as a cross-check.
Why, and how it was verified: [docs/testing/migration-ledger.md](../testing/migration-ledger.md).

## Before Committing

Run `pnpm check:all`. It is an 11-step chain and four of the steps are gates people
forget they can fail on their own: `automation-surface:check` (regenerates
[docs/automation-surface.md](../automation-surface.md) and diffs it), `knip` (unused exports/deps), `jscpd`
(copy-paste detection) and `tauri:machete` (unused Rust deps) — alongside
`tauri:versions:check`, lint, format, TS tests, cargo test, clippy and rustfmt.

### Architecture docs and scenes (`docs/architecture/`)

`docs/architecture/` holds `README.md` (modules, dependencies, gap list),
`interfaces.md` (external docking points) and the 3D scenes `*.scene.json`
(`auricide-modules`, `auricide-interfaces`, `auricide-runtime-flow`, `system` and the
per-module scenes). The scenes are served to external clients through the Supervisor
Link, so stale scenes show wrong architecture to users.

- **What counts as architectural impact:** new, removed or renamed modules or Rust/TS
  top-level areas; changed dependencies between modules; new, changed or removed
  external interfaces (Tauri commands/events, MCP servers/tools, Supervisor Link
  methods, policy fields, file contracts, hooks, `AURIC_*` env vars); or changed
  runtime flows (supervisor, agent or job lifecycle).
- **Before finishing:** update the affected `docs/architecture/*.md` and
  `*.scene.json` files (including any file/slice/tool/command counts that would drift),
  run `scene validate docs/architecture --root . --strict` with the `scene` CLI from
  the `3d-architecture` project (`@archscene/core`) — and `scene layout <file> --check`
  when a scene's graph changed — and note the update in the commit or PR. If nothing
  architectural changed, no update is needed.
- **Reviews and checks** must verify that changes with architectural impact include the
  corresponding `docs/architecture/` updates and pass strict scene validation.

---
