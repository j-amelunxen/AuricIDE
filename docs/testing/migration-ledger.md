# Verification Migration Ledger

This ledger is the auditable removal record required by the test policy. A row
is not permission for portfolio-wide deletion: each area must complete its own
shadow and stability window.

| Area                             | Previous protection                                      | Replacement evidence                                                                                                                                                            | Gate                              | Shadow evidence                                                                       | Decision                                                                |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PhaseChip` presentation details | Vitest asserted concrete Tailwind classes for each phase | Vitest asserts the accessible phase label; `e2e/agent-status.spec.ts` observes Running and Waiting-on-you labels through the user workflow                                      | `verify:fast`, `verify:pr`        | Both checks currently coexist; the semantic component assertion remains for diagnosis | Remove CSS-class assertions only; retain semantic component test        |
| Provider allow/deny policy       | Independent TypeScript and Rust example tests            | Lean reference model + versioned JSONL corpus + byte-identical oracle comparison + TypeScript/Rust corpus readers                                                               | `verify:fast`                     | Existing implementation tests remain                                                  | No deletion; pilot establishes conformance infrastructure               |
| PM draft transitions             | Store tests coupled to Zustand action implementation     | Pure `State × Event → State × EffectIntent` transition tests, plus existing save/load/failure integration tests                                                                 | `verify:fast`                     | Original slice suite remains                                                          | No deletion until a separate mutation/shadow review                     |
| Goal satisfaction                | Separate frontend and SQLite examples                    | Versioned executable contract evaluated by both implementations with normalized blocker categories                                                                              | `verify:fast`                     | Existing tests remain                                                                 | No deletion until the contract has run through the agreed shadow window |
| Native persistence               | No native desktop journey at baseline                    | Two-process macOS Tauri/WDIO durability journey persists and reloads a Requirement over real IPC/SQLite, verifies file I/O, and proves rollback on a forced foreign-key failure | `verify:native`, `verify:release` | New evidence; 20/100-run stability samples are outstanding                            | Blocks broad reliance until stability thresholds pass                   |

## Obsolete contract correction, 2026-10-17

The complete verification for the worktree merge fix found that
`AgentContent.test.tsx` still expected a global “Skip permission prompts” toggle.
That control is already absent in the unchanged baseline production component;
CLAUDE.md's “No global permission switches” rule requires permission choices per
launch. The existing component test is corrected to assert absence of global
skip/auto-accept controls. This is a correction of an obsolete contract, not a
migration to a weaker test layer or removal of a live confirmation gate. The
active confirmation behavior remains covered by `useConfirm.test.tsx`, including
Cancel, Escape, superseded questions and the new secondary affirmative action.
Gate: `pnpm test:run`; the original test's full-suite failure is the baseline
failure evidence. No production permission behavior was changed.

## Test environments split by file kind, 2026-10-28

No test was removed or weakened; the environment each file runs in changed.
Every Vitest file used to start a jsdom window. For the 518 pure-logic `.ts`
files that setup cost about six times the tests themselves, so `.ts` files now
run in `node`, and component files (`.tsx`) in happy-dom, which sets up in
about half the time of jsdom.

- **Exceptions are explicit.** 55 `.ts` files and 9 `.tsx` files carry
  `// @vitest-environment jsdom`. The `.ts` ones were found by running every
  `.ts` file in node; the `.tsx` ones failed on happy-dom only where it differs
  from browsers (`#hex` colours left unnormalised, a read-only
  `navigator.clipboard`, unparsed gradients and transforms).
- **Coverage evidence.** A full coverage run with the old configuration and one
  with the new were compared per source position (statements, branches,
  functions). Covered statements 35,783 vs 35,780. The differences: three
  components now run their `ResizeObserver` path (happy-dom has one, jsdom has
  none; WebKit takes that path) and no longer their no-observer fallback;
  three spots covered only by timing accidents (a promise settling after
  unmount, two rows in the same second, a 2 s timer firing late), asserted by
  no test before or after; and `iconHueCache.ts`, where the test kept passing
  in node while its `Image` mock went unused, because "no DOM" and "image
  failed" both resolve `null`. That file is back on jsdom and its test now
  asserts that the mock was loaded; without the jsdom line it fails.
- **Cross-check.** `pnpm test:run:jsdom` runs every component test on jsdom.
  Before trusting a happy-dom-only pass on a behaviour that browsers and
  happy-dom might disagree on, run it there.
- **Measured** on the same machine, old against new configuration back to
  back, twice each: full suite 196 s → 107 s wall, CPU (user) 1,201 s →
  656 s, 11,823 tests passing in both. The node split alone gave 192 s →
  146 s; happy-dom and Vitest's `experimental.fsModuleCache` the rest. The
  coverage run went from 233 s to 130 s.
- **Not taken:** `isolate: false` (1,302 failures, state leaks between files),
  the `threads` pool (6 % faster, and a segfault with the native SQLite
  module), `css: false` (no measurable gain), userEvent without delay (no
  measurable gain, one broken test).

Gate: `verify:fast` (`pnpm test:run`). Reversal: drop the `projects` block in
`vitest.config.mts`; the first-line comments are then harmless.

## Reversibility

The only removed assertions in this pilot were presentation-coupled CSS class
checks in `PhaseChip.test.tsx`. Their behavioral replacement is isolated in a
separate Playwright spec, so reverting the migration does not require changing
production code. All higher-risk legacy suites remain in place.

## Untangle T1 unreachable surfaces, 2026-11-11

This removes unreachable application code and its dedicated assertions. It does
not replace live verification with a different test layer. The source and import
inspection covered `src`, `scripts` and `e2e`, including dynamic imports and the
MCP registration entry points. The original focused suite passed before removal
(25 files, 692 tests); the changed owner suites passed afterwards (29 files,
821 tests, including additional unchanged MCP/metrics consumers).

| Retired surface                                                                      | Previous protection and removal rationale                                                                                                                                                                                        | Retained evidence / gate                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReferencesPanel` and its `uiSlice` state/action                                     | Eight component tests and six state tests protected a panel mounted by no application entry point. Its editor callback computed results into state read by no component. Delete that callback, panel and state together.         | Live rename reference counting still calls `findAllReferences`; its algorithm tests and `MarkdownEditor.test.tsx` remain in `pnpm test:run`.                                                                                     |
| `BlueprintsPanel`                                                                    | Thirteen tests protected an obsolete panel imported only by its test. The application mounts `BlueprintsGallery`. No live confirmation gate is removed.                                                                          | `BlueprintsGallery.test.tsx` retains open/approve/decline deletion and nested Escape coverage; `useConfirm.test.tsx` and blueprint store tests remain in `pnpm test:run`.                                                        |
| `lib/git/defaultBranch`                                                              | Six tests exercised a TS branch-selection copy called only by those tests. The application uses `gitDefaultBranch` over IPC.                                                                                                     | Existing real-repository `git::tests::worktree_tests` cover the live native default-branch rule in `cargo test`; no replacement of those tests.                                                                                  |
| `buildMissionSchedule` and `createMissionWithSchedule`                               | Two tests exercised an unused TS schedule-builder copy and an injectable forwarding wrapper. The dialog now calls the same `missionCreate` adapter directly.                                                                     | `MissionCreateDialog.test.tsx` keeps request and failure assertions; `missions::tests::coordinated_create_persists_exactly_one_linked_schedule` and rollback/collision tests retain native persistence coverage in `cargo test`. |
| `listCrashLogs`, `readCrashLog`, `excalidrawTestConnection`, `clearVideoImportCache` | Four tests asserted argument forwarding for TS wrappers imported only by those tests; their native commands remain registered. These assertions verify retired wrappers, not a user-accessible TS path.                          | Live wrappers keep their forwarding and error tests; crash-report failure propagation is retained through `reportFrontendCrash` in `pnpm test:run`.                                                                              |
| `isProviderFullyBlocked`, `formatScopeBadge`, `isAnsweredNotification`               | Five tests protected helpers with no application caller. No launch/notification authority consumes them.                                                                                                                         | Live quota matching, supervisor policy fixture cases and notification action parsing tests remain unchanged in `pnpm test:run`; these deletions do not change enforcement.                                                       |
| Test-only constants and pass-through helpers                                         | Remove `DEFAULT_PTY_SIZE`'s fixture-to-itself assertion. Move the exhaustive drop-zone list into its test; inspect reason text directly in the shared fixture; exercise launch-entry slot IDs through existing public functions. | All model-choice/check-spawn fixture-coverage assertions, drop-zone cases and wheel-slot assertions remain in `pnpm test:run`.                                                                                                   |
| `agentMirrorIsLive`                                                                  | Remove the production test probe, retaining every freeze/thaw test. Tests now observe actual terminal `dispose` and snapshot `write` calls instead of asking the mirror whether it considers itself live.                        | `agentMirror.test.ts` retains lifetime, frozen screen, late output, seeded mirror, resize and mouse encoding assertions in `pnpm test:run`.                                                                                      |

The station resolver is consolidated without deleting its tests. Five added
SQLite characterization cases ran against the original resolver first, then the
shared implementation: exact-ID precedence, short/empty prefixes, absent UUIDs,
case-insensitive lookup, ambiguity and precise station errors. Other tables keep
their existing UUID fast path and four-character minimum.

The migrated mirror lifetime test was fault-checked: omitting the real freeze
`term.dispose()` produced the expected failure (zero disposals instead of one).
The fault was restored before the final green verification.

Independent review approved these removals after checking all 44 retired test
cases, the live call paths and unchanged assertions. A differential SQLite
check compared 88 station lookup inputs with the original implementation and
found no mismatch. Omitting the real terminal disposal made the migrated
lifetime test fail; restoring it returned the 35 mirror tests to green. No live
confirmation, native persistence or policy-enforcement test was removed.
