# ADR 0001: Risk-oriented verification architecture

- Status: Accepted for pilot
- Date: 2026-09-24
- Decision owner: AuricIDE maintainers

## Context

AuricIDE currently relies primarily on colocated Vitest and Rust tests. The
browser Playwright suite starts the Next.js development server and therefore
does not verify the complete desktop path through Tauri IPC, Rust, SQLite, the
filesystem, or application restart.

Some existing tests protect valuable parser, algorithm, state-transition, and
regression behavior. Others primarily assert CSS classes, trivial setters,
mock calls, or internal component structure. Treating all of these tests as
equally valuable makes refactoring expensive without providing equivalent
product confidence.

## Decision

AuricIDE will classify verification by the risk and behavior it protects:

1. Pure algorithms, parsers, and dense edge-case spaces remain covered by fast
   unit and property tests.
2. State transitions, persistence, IPC, serialization, and cross-language
   contracts are covered at their real integration boundaries.
3. A small set of critical user journeys is covered against the built desktop
   application.
4. Stable, deterministic, critical invariants may be expressed as Lean 4
   specifications.
5. Until production code is generated from or formally refined against Lean,
   the precise claim is **Lean-verified specification with differentially
   tested TypeScript/Rust conformance**.
6. Existing tests are removed only after a replacement proof or an explicit
   redundancy decision has passed the shadow and fault-detection gates.

The accepted target architecture and migration sequence are defined in
[Verification Rebalance](../testing/verification-rebalance-plan.md).

## Consequences

### Positive

- Verification follows production risk instead of file boundaries.
- Refactorings are less coupled to CSS, mocks, and internal state shapes.
- TypeScript and Rust implementations can be checked against one executable
  contract.
- Desktop release evidence includes the actual IPC and persistence path.
- Critical domain rules become explicit and reviewable.

### Negative

- Native integration tests require isolation, diagnostics, and platform
  infrastructure.
- Larger tests are slower and can be harder to diagnose.
- Lean adds a separate pinned toolchain and modeling discipline.
- Conformance testing does not by itself prove the production implementation
  correct for every possible input.

## Guardrails

- Test count and line coverage are not success metrics by themselves.
- A retry cannot turn a required flaky gate into a trusted green result.
- Production user data must never be used by integration or desktop tests.
- Lean is not used for UI, framework behavior, network services, or
  probabilistic model output.
- Parser and algorithm tests are not moved to E2E merely to reduce unit-test
  count.

## Revisit conditions

This decision must be revisited if the pilot reduces fault detection, exceeds
the agreed flake or feedback budgets, makes failures materially harder to
localize, or creates a formal model that routinely drifts from production
semantics.
