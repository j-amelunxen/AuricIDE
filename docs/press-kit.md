# AuricIDE Press Kit

> Everything you need to know about AuricIDE — the AI-native desktop IDE built for the agent era.

---

## Product Overview

|             |                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| **Name**    | AuricIDE                                                                                                     |
| **Tagline** | AI Native                                                                                                    |
| **What**    | A desktop IDE purpose-built for AI agents and the humans who work alongside them                             |
| **Who**     | AI engineers, prompt designers, agent developers, and power users who treat AI as a first-class collaborator |

**Elevator Pitch** — AuricIDE is a Markdown-first, AI-native desktop IDE that gives autonomous agents and human operators a shared workspace. Built on Tauri v2 and Next.js 16, it combines a futuristic HUD interface with integrated terminals, visual process canvases, and real-time diagram rendering — all in a fast, lightweight native application.

---

## The Problem

Today's IDEs were designed for humans writing code. When AI agents entered the picture, they were bolted onto editors that were never meant for them — through plugins, side panels, and chat windows that feel like afterthoughts.

AuricIDE starts from a different premise: **what if the IDE was built for agents from day one?**

- Agents need to spawn, manage, and observe long-running processes — not just autocomplete.
- Prompt engineering is a writing discipline — it deserves a Markdown-native editor with semantic understanding, not a code editor with Markdown support.
- Orchestrating multiple agents requires a visual canvas, not a terminal multiplexer.
- The interface itself should communicate state at a glance — like a cockpit HUD, not a text editor.

AuricIDE is the answer: a native desktop environment where agents and humans collaborate as equals.

---

## Key Features

### Markdown-First Editor with Semantic Highlighting

A CodeMirror 6 editor tuned for Markdown and prompt engineering. Beyond standard syntax highlighting, AuricIDE applies **semantic NLP highlighting** — visually distinguishing entities, actions, parameters, keywords, concepts, and prompt directives directly in the editor.

### AI Agent Spawning & Management

Launch, monitor, and manage AI agents from within the IDE. Each agent runs in its own PTY-backed terminal with full process lifecycle control.

### Visual Process Canvas

An interactive React Flow canvas for orchestrating agent workflows visually. Drag, connect, and monitor processes as flowchart nodes with animated edges, multiple node shapes, and real-time status updates.

### Integrated Terminal with PTY

A full xterm.js terminal with WebGL rendering, backed by native PTY sessions via Tauri. Supports dynamic resize, multiple sessions, and direct integration with the agent system.

### Git Integration with Status Display

Built-in Git awareness with file-level change tracking. Added, modified, and deleted files are color-coded throughout the UI using a semantic green/yellow/red palette.

### Command Palette & File Search

Fuzzy file search and command palette for fast navigation. Find any file, run any command — keyboard-driven, instant results.

### Mermaid Diagram Rendering

Write Mermaid diagrams in Markdown and see them rendered inline — both in the editor (as CodeMirror widgets) and in the live preview. Flowcharts, sequence diagrams, and more, visualized without leaving the document.

---

## Tech Stack

| Layer      | Technology                        | Role                                           |
| ---------- | --------------------------------- | ---------------------------------------------- |
| Desktop    | **Tauri v2** (Rust)               | Native shell, PTY, file system, security       |
| Frontend   | **Next.js 16** (App Router)       | UI framework with static export                |
| UI         | **React 19**                      | Component architecture                         |
| Styling    | **Tailwind CSS 4**                | Utility-first styling, custom theme            |
| Editor     | **CodeMirror 6**                  | Markdown editing, syntax/semantic highlighting |
| Terminal   | **xterm.js 6** + WebGL addon      | Terminal emulation                             |
| Canvas     | **React Flow 12** (@xyflow/react) | Visual process orchestration                   |
| Diagrams   | **Mermaid 11**                    | Diagram rendering from Markdown                |
| State      | **Zustand 5**                     | Lightweight global state management            |
| Search     | **fuzzysort**                     | Fuzzy file matching                            |
| Testing    | **Vitest 4** + Testing Library    | Unit & component tests                         |
| E2E        | **Playwright**                    | End-to-end testing                             |
| Rust Tests | **cargo test** + **Clippy**       | Backend unit tests & linting                   |

---

## Design Philosophy

AuricIDE's visual identity is deliberate and uncompromising:

- **Dark-Only** — No light mode. The entire interface is designed for dark backgrounds (`#050508` base). This is a brand decision, not a deferral.
- **HUD Aesthetic** — Inspired by cockpit displays and sci-fi instrumentation. Translucent glass panels, neon accent glows, dashed-circle motifs, and sharp typographic hierarchy create an environment that communicates state at a glance.
- **Glassmorphism as Depth** — Three tiers of translucent panels (`.glass`, `.glass-panel`, `.glass-card`) with backdrop blur create a layered, dimensional UI without heavy shadows.
- **Neon Accent, Not Overload** — The signature purple (`#bc13fe`) is used sparingly for focal points: the cursor, active states, headings, and accents. The rest of the UI stays neutral to let content breathe.
- **Content First** — The editor occupies maximum screen real estate. Chrome is thin, translucent, and deferential.

---

## Brand Assets

### Logo

A 512 × 512 SVG featuring a stylized "A" glyph inside a hexagonal frame, rendered in a purple gradient with a signature neon glow effect. The design evokes precision instrumentation and advanced HUD displays.

### Colors

| Role          | Hex       | Usage                          |
| ------------- | --------- | ------------------------------ |
| Primary       | `#bc13fe` | Accents, active states, cursor |
| Primary Light | `#d66aff` | Secondary accent, headings     |
| Background    | `#050508` | Root background                |
| Background 2  | `#0a0a10` | Editor, panels, terminal       |
| Foreground    | `#e0e0e0` | Primary text                   |
| Muted         | `#808090` | Secondary text, labels         |
| Added         | `#2effa5` | Git: new files                 |
| Modified      | `#ffce2e` | Git: changed files             |
| Deleted       | `#ff4a4a` | Git: removed files             |

### Typography

| Role    | Font               | Notes                                 |
| ------- | ------------------ | ------------------------------------- |
| Display | **Space Grotesk**  | Brand text, headings, UI labels       |
| Code    | **JetBrains Mono** | Editor, terminal, inline code, badges |

### Name Treatment

The brand name is rendered as two typographic segments:

- **AURIC** — Space Grotesk, Black weight, tight tracking, white
- **IDE** — Space Grotesk, Light weight, wide tracking, purple (`#d66aff`)

### Asset Paths

| Asset      | Path                  |
| ---------- | --------------------- |
| App Icon   | `src-tauri/icons/`    |
| Brand Kit  | `docs/brand-kit.md`   |
| Global CSS | `src/app/globals.css` |

---

## At a Glance

|                |                                              |
| -------------- | -------------------------------------------- |
| **Product**    | AuricIDE                                     |
| **Tagline**    | AI Native                                    |
| **Version**    | 0.1.0                                        |
| **App ID**     | `com.auricide.app`                           |
| **Platforms**  | macOS, Windows, Linux (via Tauri v2)         |
| **License**    | AGPL v3                                      |
| **Language**   | TypeScript (frontend), Rust (backend)        |
| **Package**    | `auric-ide`                                  |
| **Built With** | Tauri v2, Next.js 16, React 19, CodeMirror 6 |

---

_Last updated: 2026-02-18_
