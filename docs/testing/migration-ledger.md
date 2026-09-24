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

## Reversibility

The only removed assertions in this pilot were presentation-coupled CSS class
checks in `PhaseChip.test.tsx`. Their behavioral replacement is isolated in a
separate Playwright spec, so reverting the migration does not require changing
production code. All higher-risk legacy suites remain in place.
