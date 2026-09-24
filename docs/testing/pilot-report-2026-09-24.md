# Verification Rebalance Pilot Report — 2026-09-24

## Decision

**Go for the verification architecture and continued shadow operation. No-Go
for broad deletion of the existing test portfolio.**

The pilots demonstrate that AuricIDE can replace implementation-coupled checks
with stronger semantic, contract, formal-model, and native-boundary evidence.
They do not yet satisfy the policy's 20-consecutive-run pilot threshold or the
100-run native flake sample. Higher-risk legacy tests therefore remain.

## What the pilot established

| Pilot             | New evidence                                                                                                | Observed result                                                                                              | Boundary                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Phase labels      | Semantic component assertion plus Playwright user-observable labels                                         | Targeted Vitest and browser E2E pass                                                                         | Does not exercise Tauri                                                                      |
| Native durability | Two distinct built Tauri processes over real IPC, SQLite, and file I/O                                      | Write/read passed with retries disabled; a forced foreign-key failure rolls back without partial state       | Direct privileged IPC harness, not Requirement UI creation/display; macOS stability pending  |
| Provider policy   | Lean 4 reference model, pinned toolchain, versioned oracle corpus, TypeScript and Rust readers              | Lean build passes; generated JSONL is byte-identical; targeted TS and Rust conformance pass                  | Production implementations are differentially tested against the model, not formally refined |
| PM transitions    | Pure `State × Event → State × EffectIntent` transition with existing save/load/failure integration coverage | 61 PM tests passed in the focused worker run; 128 combined focused pilot tests passed in final orchestration | No old PM tests removed                                                                      |
| Goal satisfaction | One versioned 11-case contract executed against frontend and MCP/SQLite implementations                     | Both implementations agree on satisfaction and normalized blocker categories                                 | Executable specification, not a Lean proof                                                   |

## Reproducible evidence

- Baseline: 536 Vitest files, 7,676 passing tests, 55.3 seconds; 750 Rust
  tests discovered, 747 passed and 3 ignored.
- Current inventory heuristic: 612 test files, 8,327 test cases, 3,335 mock
  occurrences, and zero unclassified test files. Counts are discovery signals,
  not parser-accurate coverage metrics.
- Tooling tests: 13 passed for inventory, gate orchestration, Lean corpus
  comparison, the native runner plan, and the release-boundary guard.
- Current fast gate: 538 Vitest files and 7,700 tests passed; Rust discovered
  751 tests, of which 748 passed and 3 were intentionally ignored.
- Focused TypeScript pilot run: 128 passed.
- Rust provider-policy corpus test: passed.
- Lean: 6 build jobs passed; the regenerated provider-policy corpus matched
  byte-for-byte.
- Native run: production Next build succeeded, the feature-gated Tauri binary
  built, then write and read specs each passed in a distinct process with
  retries set to zero.
- The new phase-label Playwright pilot passed without retries. The complete
  browser gate is still red on legacy expectations that predate this pilot:
  stale `AgenticDE` branding and project-only Goal Lines/Requirements actions
  being asserted on the no-project start screen. Consequently `verify:pr` is
  not yet a green required check even though its earlier static steps pass.

The native harness deliberately tests the desktop boundary directly through
WDIO's privileged executor. It does **not** yet prove that a user can create and
redisplay the Requirement through the visible UI, nor that failed persistence
produces the correct unsaved/error UI. Those remain acceptance gaps rather
than being inferred from IPC success.

The first sandboxed native attempt failed before compilation because
`next/font` could not reach Google Fonts. The identical run outside the network
sandbox passed. That is a build-environment dependency, not an application-test
failure, but it should be removed from CI eventually by self-hosting fonts.
An earlier runner version emitted a non-fatal WDIO teardown warning. The final
hardened run did not reproduce it; the scheduled stability sample remains the
appropriate way to establish whether it is eliminated.

## Gains

- Tests now state user-visible behavior or domain invariants instead of CSS and
  internal wiring.
- Cross-language drift becomes observable through versioned corpora.
- The release architecture has a real desktop path rather than treating a
  browser dev server as desktop evidence.
- PM mutation logic is independently testable without hiding persistence
  behavior behind mocks.
- Lean's claim is precise: it proves properties of a small normalized policy
  model while adapters test production conformance.
- Removal decisions are reversible and recorded in the migration ledger.

## Costs and losses

- The native gate is materially slower and depends on macOS build tooling.
- Larger journeys localize failures less precisely, so focused component,
  transition, and contract tests remain necessary.
- Lean adds a pinned toolchain and proof maintenance.
- Corpus conformance samples a finite production input space; it is not a proof
  of TypeScript or Rust implementation equivalence.
- A raw reduction in test count is not yet available: shadow operation
  intentionally runs old and new evidence together.

## Divergence and failure analysis

No semantic divergence was observed in the provider-policy or goal-satisfaction
contracts. The pilot did expose four infrastructure issues:

1. A scriptless dependency install removes the native `better-sqlite3` binding;
   normal CI must allow its approved build step.
2. Tauri rejects `CI=1`; the native runner now normalizes its build child to
   `CI=true`.
3. The native production build currently needs network access for Google Fonts.
4. The embedded service and direct-eval client must share the exact random-port
   environment contract; the runner now enforces that contract.

The feature-enabled test binary also exposes a powerful loopback WebDriver
surface while it runs. It now fails closed unless launched by the WDIO service,
cannot be built as a release artifact, and receives a per-run high port. This
reduces accidental exposure and local interference; it is still a same-user
test-control surface, not an authentication boundary.

These are useful findings: the new layers detected real build and runtime
preconditions that mocked unit tests cannot see.

## Exit criteria for the next decision

Broad portfolio migration remains blocked until all of the following are
recorded:

- 20 consecutive green runs for each pilot journey,
- at least 100 scheduled native runs with a flake rate below one percent,
- targeted mutation or fault-injection evidence for each high-risk area,
- acceptable p95 gate durations from CI rather than a single workstation,
- no recurrence of the earlier WDIO teardown warning in the stability sample,
  plus resolution or accepted ownership of the font network dependency,
- a visible Requirement create/reload journey and user-visible failed-save
  behavior,
- repair or deliberate replacement of the stale legacy browser journeys so
  that `verify:pr` is green as one command,
- explicit reviewer approval for each ledger removal row.

Until then, only tests that demonstrably assert presentation details or exact
duplicates may be removed. Parser, algorithm, security, persistence-failure,
and domain-edge tests remain.
