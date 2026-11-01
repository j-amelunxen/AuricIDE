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
