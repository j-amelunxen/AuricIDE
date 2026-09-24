# Verification Rebalance Acceptance Matrix

| ID     | Observable acceptance                                                                                                             | Governing invariant                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| VFY-01 | Every change maps to a documented verification gate; exceptions are explicit.                                                     | No change merges without a verification path.                                                         |
| VFY-02 | Inventory includes Vitest, Playwright, and Rust tests with classification and baseline measures.                                  | No protection is removed without naming its previous assertion.                                       |
| VFY-03 | `verify:fast`, `verify:pr`, `verify:native`, and `verify:release` are reproducible and fail non-zero when a required check fails. | A green gate cannot silently skip a required check.                                                   |
| VFY-04 | Phase labels remain user-observable and consistent while CSS implementation can change freely.                                    | Equal phase state implies equal semantic meaning.                                                     |
| VFY-05 | Create → IPC → Rust → SQLite → restart/reload preserves the requirement; failures never report false success.                     | Confirmed success is durable; failure creates no unexplained partial state.                           |
| VFY-06 | Lean oracle, TypeScript, and Rust agree for every versioned policy case.                                                          | The Lean model is the policy reference; production conformance is corpus-tested, not formally proved. |
| VFY-07 | Pilot report records coverage boundaries, divergence, runtime, stability, and an explicit Go/No-Go decision.                      | No rollout follows an inconclusive pilot.                                                             |
| VFY-08 | Domain transitions cover cascade, reorder, save, reload, and failure effects without hidden mutation.                             | State changes follow a defined event transition.                                                      |
| VFY-09 | Goal satisfaction has explicit predicates, truth cases, and counterexamples.                                                      | A goal is never reported achieved while its predicate is false.                                       |
| VFY-10 | Every migrated area completes replacement, shadow comparison, and reversible removal.                                             | New evidence replaces no protection before equivalence is demonstrated.                               |

## Hard No-Go conditions

- A required gate is missing, flaky, or silently skipped.
- A persistence failure appears as success or leaves unexplained partial data.
- TypeScript, Rust, and the Lean policy oracle diverge without an accepted
  specification change.
- A shadow comparison differs without a root-cause decision.
- A critical invariant loses negative or failure coverage.
- Goal or state-transition semantics remain undecided.
- User data cannot be isolated from native test data.
