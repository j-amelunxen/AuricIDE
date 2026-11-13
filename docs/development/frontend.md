# Frontend, editor and explorer

[Developer guide index](README.md) · [Documentation index](../README.md)

Store ownership, IPC wrappers, UI composition, editing and file-tree behavior. See also the [architecture map](../architecture/README.md).

## State Management (Zustand)

All frontend state lives in one Zustand store. `src/lib/store/types.ts` owns the authoritative `StoreState` intersection and the `StoreGet`/`StoreSet` contracts derived from Zustand. Each slice is checked against that complete state; `createStore.ts` composes the 34 store slices and the overlay slice in their existing order. `index.ts` creates the application hook:

```typescript
// Each slice follows this pattern:
export const createPmSlice: StateCreator<StoreState, [], [], PmSlice> = (set, get) => ({ ... });

// Combined type in types.ts:
export type StoreState = FileTreeSlice & TabsSlice & GitSlice & PmSlice & ...;
```

Tests use `createTestStore(overrides)` from `src/lib/store/testing.ts`. It creates
fresh complete state through the same composition factory, with explicit typed
overrides for dependencies under test. A partial object must not masquerade as a
complete store: that hides missing sibling actions from the compiler and can
produce unhandled failures when a hook reaches them.

Key store slices:

| Slice                                                                                   | Key Concern                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pmSlice`                                                                               | Epics, tickets, test cases, dependencies; draft/persisted split with a `pmDirty` flag |
| `agentSlice`                                                                            | Running AI agents, per-agent logs, [fleet view state](agent-fleet.md)                 |
| `gitSlice`                                                                              | Branch, file statuses (A/M/D), staging, commit                                        |
| `fileTreeSlice`, `projectDbSlice`                                                       | Explorer tree; project SQLite init/close lifecycle                                    |
| `tabsSlice`                                                                             | Open editor tabs and active tab                                                       |
| `qaSlice`                                                                               | Test-coverage summary, per-file coverage, heatmap config                              |
| `canvasSlice`                                                                           | XYFlow nodes/edges for workflow canvas                                                |
| `uiSlice`                                                                               | Modal open/closed states, panel visibility                                            |
| `diagnosticsSlice`                                                                      | remark-lint errors keyed by file path                                                 |
| `goalsSlice`                                                                            | Goal hierarchy trees, satisfaction predicates, step states                            |
| `requirementsSlice`                                                                     | Application invariants, test links, freshness checks                                  |
| `conductorSlice`                                                                        | Conductor run status, judge backend evaluation loops                                  |
| `recentProjectsSlice`, `starredProjectsSlice`                                           | Multi-project history, pinned shortcuts                                               |
| `wikiLinkSlice`, `entityIndexSlice`                                                     | WikiLinks graph and each file's headings, NLP entity index                            |
| `blueprintsSlice`, `obsidianCanvasSlice`, `excalidrawSlice`                             | Canvas blueprints, Obsidian canvas view, Excalidraw scenes                            |
| `slashCommandSlice`, `commandUsageSlice`, `scratchSlice`                                | Slash commands, usage telemetry, scratchpad                                           |
| `toastSlice`, `notificationsSlice`, `schedulesSlice`, `skillComboSlice`, `overlaySlice` | System toasts, notification bus, recurring schedules, skill combos, overlay stack     |
| `inboxSlice`                                                                            | App-level GTD inbox: captured items, project assignment, cross-project PM overview    |

**PM draft pattern:** `pmDraftEpics` holds in-progress edits; `pmEpics` is the last-persisted snapshot. `savePmData()` flushes drafts to SQLite via IPC.

## Tauri IPC Pattern

All IPC wrappers live in `src/lib/tauri/*.ts`. They share one helper —
`src/lib/tauri/invoke.ts` — rather than each repeating the dynamic import:

```typescript
import { invoke } from './invoke';

export async function requirementsLoad(projectPath: string): Promise<RequirementsState> {
  return await invoke<RequirementsState>('requirements_load', { projectPath });
}
```

The import stays lazy so browser and test environments don't break on load, and
`resolveTauriInvoke` does two things a hand-rolled copy misses: it unwraps
`mod.invoke ?? mod.default?.invoke` (bundlers disagree on the shape), and it
throws `Tauri IPC is unavailable (<cmd>)` instead of calling `undefined(...)`.
Import the helper; don't re-implement it.

Rust commands are registered in `src-tauri/src/lib.rs` with `#[tauri::command]` and wired up in `.invoke_handler(tauri::generate_handler![...])`.

**In tests**, mock the IPC layer:

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => mockData) }));
```

## Main Page Structure

`src/app/page.tsx` (the main page) splits concerns into three hooks:

- `useIDEState()` – derives all state from the store
- `useIDEHandlers()` – event handlers and computed props
- `useIDEActions()` – side-effect setup (file watcher, Tauri event listeners)

The active tab type determines which viewer renders: `MarkdownEditor` (CodeMirror), `CanvasView` (XYFlow), `MindmapView`, `DiffViewer`, `ImageViewer`, `VideoViewer`, `PDFViewer`, `HtmlViewer`, `ObsidianCanvasView`, `ExcalidrawViewer`, or `WorkView`.

Shared frontend contracts live below the UI and IPC layers: domain types in
`src/lib/{agents,goals,pm,quickAccess}/types.ts`, UI-shell contracts in
`lib/ide/types.ts`, `lib/settings/types.ts`, `lib/terminal/types.ts`, and menu
options in `lib/ui/contextMenu.ts`. Shared UI primitives live in
`src/app/components/ui`; pure explorer tree helpers live in `lib/explorer/fileTree.ts`.
Import contracts from their library owner instead of re-exporting them from a
component or IPC wrapper. MCP uses domain types without importing `lib/tauri`.

Shared diff rendering and shortcuts live in `components/diff`, consumed by the
editor wrapper and git review/merge views. Markdown parsers and `LinkIndexEntry`
live in `lib/markdown`; `EntityOccurrence` lives in `lib/nlp/nlpTypes.ts` and
`ReferenceResult` in `lib/refactoring/types.ts`. Import these contracts directly
instead of through index slices or the reference computation module.

Pure goal rules live in `src/lib/goals/model/`: tree traversal/moves,
satisfaction/completion/progress and dependency adapters. Import them directly
instead of through `goalsSlice`. Store draft rebasing and mutation timestamps
remain in `lib/store`; the model does not load store initialization or IPC.

## CodeMirror Editor

`src/lib/editor/setup.ts` assembles the editor state. Each feature is a separate extension:

- `auricTheme` / `auricHighlightStyle` – theme styling and Markdown token colours
- `nlpHighlightExtension` – synchronous marking of **actionable** spans: entities,
  keywords and prompt-framework labels. It never colours word classes; POS
  highlighting was deliberately removed. See [docs/semantic-markdown-highlighting.md](../semantic-markdown-highlighting.md).
- `deepHighlightExtension` – async Transformers.js NER plus paragraph intent
  classification (`src/lib/nlp/`, not `src/lib/editor/`)
- `mermaidWidgetExtension` – inline Mermaid diagram rendering
- `wikiLink broken/hover/completion extensions` – `[[WikiLink]]` completion, hover popups, and broken link markers
- `markdownFoldExtension` – heading-based section folding
- `createGitGutter` – per-line git status in gutter
- `markdownLintExtension` / `jsonLintExtension` / `xmlLintExtension` / `yamlLintExtension` – real-time diagnostics
- `renameHeadingExtension` / `findReferencesExtension` – markdown refactoring actions

Dynamic reconfigurations use CodeMirror `Compartment`s so the editor doesn't need to be recreated.

### Format on save

⌘S in the editor (and, if switched on, focus leaving it) formats the file with
the project's own tool. Settings → Editor → Formatting holds the two triggers
and one switch per language (`auric.editor.format-*`). Rules worth keeping:

- **The formatter never decides whether the save happens.** `handleSave` writes
  the text as typed first, then asks `format_document` (`src-tauri/src/formatter/`).
  A missing tool, a syntax error or the 10 s timeout cost the formatting and one
  short toast (`formatOnSave.ts` says a missing tool once per language per
  session), never the save. The Rust command answers an outcome and never writes.
- **Installed tools, nothing bundled.** Project `node_modules/.bin/biome` (with a
  biome config) or `prettier` first, then the login shell's `prettier` (only where
  the project has a prettier config, or its defaults would rewrite a repository
  that never used it), `ruff` / `black`, `gofmt`, `rustfmt`, `shfmt`. JSON has a
  built-in re-indenter that copies every token verbatim. TS owns extension →
  language (`formatLanguages.ts`), Rust owns language → formatter.
- **Autosave never formats.** It fires 400 ms after typing; rewriting the line
  under the cursor is not a save.
- **Leaving the editor touches only files typed into since their last format.**
  The editor does not reload on outside changes, so writing an untouched buffer
  on blur would put stale text over an agent's edit.
- **A late result is dropped, never written.** If the tab was left or the buffer
  changed while the formatter ran, the formatting is lost and the text as typed
  stays saved.
- **Formatted text enters as an edit, not as a `content` prop.** A prop change is
  the whole-buffer swap for tab switches (undo reset, cursor at the top).
  `applyFormattedText` (`activeEditor.ts`) dispatches one undoable change, maps
  the cursor through it, and refuses when the buffer moved on while the
  formatter ran.

## Moving, selecting and comparing in the explorer

- **Row drags are mouse events, not HTML5 drag-and-drop.** Tauri's native drop
  handler (`dragDropEnabled`, default on, needed for Finder drops into
  terminals, video import and the canvas) takes every drag session over the
  webview on macOS: wry answers it itself and never hands it to WKWebView, so
  `dragover`/`drop` never fire in the page. `useTreeDrag.ts` therefore tracks
  the press on window listeners and hit-tests with `elementFromPoint`
  (`dropTarget.ts`: folder row = that folder, file row = its folder, empty
  pane = project root). Finder drops arrive as `onDragDropEvent` with absolute
  paths in physical pixels (`useExternalTreeDrop.ts`) and are **copied**.
- **One plan, one clash rule.** `src/lib/explorer/transferPlan.ts` decides what
  a drop does (never into itself, nothing for an item already in that folder,
  a folder once with its selected children); `useFileMutations.transferInto`
  asks Replace / Keep Both / Cancel per clash. Replace deletes first, so it is
  refused when the destination holds any item of the drop, compared without
  case (APFS is case-insensitive by default).
- **Selection** is `src/lib/explorer/treeSelection.ts` (Cmd toggles, Shift
  ranges from the anchor, Cmd+Shift adds a range; the order is kept, so
  "Compare Selected" reads the first two as left and right). Compare opens the
  normal `DiffViewer` on a `DiffSource` of kind `files` (Rust `diff_files`,
  read-only: no repo, no hunk actions). Real-app check:
  `pnpm test:e2e:tauri:file-tree`.

## Dating folders without walking them

The explorer marks a file created in the last five minutes, and marks any folder
that holds one anywhere beneath it. Answering that from the filesystem means
walking a folder's whole subtree on every directory read — on this repo that was
thousands of `stat` calls per watcher event, on the main thread.

`recent_creations.rs` maintains the answer instead of recomputing it. Opening a
project seeds one map of "newest descendant-file birth time" per directory;
after that every watcher event stamps the file's birth time onto each ancestor
directory. A read costs one lookup per child.

Three things hold this together, and breaking any of them makes a folder's date
depend on who answered:

- **Both walks prune identically.** `walk_files_with_birth_time` (seeding) and
  `newest_file_created_at_by_child` (fallback) share `skip_recent_walk_dir` and
  `should_filter_watcher_path`. `the_cache_dates_folders_exactly_as_the_walk_would`
  asserts the two produce the same listing.
- **A root counts as seeded only once its contents are in.** `seed_root` marks
  and fills in one step. Marking first would let a read land mid-walk and
  conclude a folder holds nothing recent — wrong, and nothing would correct it.
  Until seeding lands, `newest_by_child` returns `None` and the caller walks.
- **The five-minute window is not in Rust.** The backend reports a timestamp;
  `src/lib/explorer/recentlyCreated.ts` owns what counts as recent. One
  definition, so the two sides cannot drift.

The deliberate imprecision: a cached timestamp only moves forward. Delete the
one young file in a folder and it keeps glowing for the rest of the window.
That is the price of not walking, and it was taken knowingly.

`read_directory` is `#[tauri::command(async)]` for the same reason — a plain
`fn` command runs on the main thread, and the fallback walk still happens for
any directory outside a seeded root.
