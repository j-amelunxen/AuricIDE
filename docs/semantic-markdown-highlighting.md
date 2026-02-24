# AuricIDE

An AI-native desktop IDE built for working with Markdown and natural language. Spawn coding agents directly from your editor, visualize processes on a canvas, and keep everything under Git version control — all in a lightweight, futuristic dark-mode shell.

## Features

- **Markdown-first editor** — CodeMirror-based editing with syntax highlighting, Mermaid diagram preview, and image support
- **Agent integration** — Spawn and manage AI coding agents (e.g. Claude Code) from within the IDE; monitor their activity in real-time via embedded xterm.js terminals
- **Visual process canvas** — React Flow powered node graph for designing workflows that map back to structured Markdown
- **File explorer with Git status** — Color-coded indicators (new / modified / deleted) and a source control panel for staging and committing
- **Command palette & file search** — Fuzzy-find files and commands, VS Code-style
- **Integrated terminal** — Full PTY sessions powered by `portable-pty` on the Rust side and xterm.js on the frontend
- **Lightweight & fast** — Tauri v2 desktop shell with a Next.js 16 frontend; no Electron bloat

## Tech Stack

| Layer         | Technology                                                     |
| ------------- | -------------------------------------------------------------- |
| Frontend      | Next.js 16 (App Router), React 19, Tailwind CSS 4              |
| Editor        | CodeMirror 6 (JS, TS, CSS, HTML, JSON, Python, Rust, Markdown) |
| Canvas        | React Flow (`@xyflow/react`)                                   |
| Terminal      | xterm.js + `portable-pty`                                      |
| Diagrams      | Mermaid                                                        |
| State         | Zustand                                                        |
| Desktop       | Tauri v2 (Rust)                                                |
| Git           | `git2` (libgit2 bindings for Rust)                             |
| File watching | `notify` crate                                                 |
| Testing       | Vitest + Testing Library, Playwright, `cargo test`             |

## Prerequisites

- **Node.js** >= 20
- **pnpm** (see `packageManager` field in `package.json` for the pinned version)
- **Rust** >= 1.77.2 (for the Tauri backend)
- Platform-specific Tauri dependencies — see the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Install frontend dependencies
pnpm install

# Start the full desktop app (Rust + Next.js)
pnpm tauri:dev

# Or run just the Next.js dev server (browser mode, no native features)
pnpm dev
```

## Scripts

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm build            # Next.js production build
pnpm test             # Vitest watch mode
pnpm test:run         # Vitest single run
pnpm test:coverage    # Vitest with coverage
pnpm test:e2e         # Playwright E2E tests
pnpm lint             # ESLint
pnpm format:check     # Prettier check
pnpm tauri:dev        # Full desktop app (Rust + Next.js)
pnpm tauri:build      # Production Tauri build
pnpm tauri:test       # Rust unit tests
pnpm tauri:clippy     # Rust linter
pnpm check:all        # Lint + format + tests + Rust checks
```

## Project Structure

```
src/
  app/
    components/
      agents/        # Agent spawning, monitoring, and card UI
      canvas/        # React Flow process canvas
      editor/        # CodeMirror editor, tab bar, Mermaid preview, image viewer
      explorer/      # File tree with Git status indicators
      git/           # Source control panel (stage, commit)
      ide/           # Shell layout, activity bar, command palette, status bar
      terminal/      # xterm.js terminal panel and PTY bridge
    page.tsx         # App entry point
    layout.tsx       # Root layout
src-tauri/
  src/
    lib.rs           # Tauri commands (FS, Git, terminal, file watching)
    agents.rs        # Agent process management
e2e/                 # Playwright E2E tests
```

## License

AGPL-3.0
