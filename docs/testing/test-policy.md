# AuricIDE Test and Verification Policy

## Purpose

Every relevant behavior must have an executable, deterministic verification at
the lowest layer that can observe the real failure. The goal is meaningful
fault detection, not a preferred test type or a target number of tests.

## Classification algorithm

Classify a test or cluster in this order:

1. **Does it protect pure logic with many input combinations?** Keep or convert
   it to a unit/property test.
2. **Does failure require two modules or a system boundary to disagree?** Use a
   domain-integration or contract test at that real boundary.
3. **Is it observable component behavior without a backend dependency?** Use a
   behavior- or accessibility-focused component/browser test.
4. **Is it a critical user outcome that crosses the desktop stack?** Use a
   native vertical journey, with smaller tests below it for diagnosis and edge
   cases.
5. **Is it a stable, deterministic, critical rule with a tractable model?** It
   may additionally receive a formal Lean specification and conformance
   adapters.
6. **Does it only restate implementation, framework behavior, or another
   stronger test?** Mark it for removal after the migration gates pass.

## Required evidence by risk

| Risk     | Minimum evidence                                                                     |
| -------- | ------------------------------------------------------------------------------------ |
| Low      | One deterministic behavior or contract check                                         |
| Medium   | Positive and negative cases at the responsible boundary                              |
| High     | Positive, negative, and failure cases plus fault injection                           |
| Critical | Named invariant, boundary/contract evidence, and a vertical journey where applicable |

Security, permissions, irreversible state changes, persistence migrations,
agent execution gates, and goal completion rules are at least high risk.

## Lean eligibility

A Lean candidate must be deterministic, semantically stable, critical enough
to justify proof maintenance, independent of UI/framework/I/O mechanics, and
traceable to a production symbol or command.

Lean proves properties of the formal model. Unless code generation or a formal
refinement proof is added, TypeScript and Rust remain connected through
generated examples, property tests, differential tests, and selected real-boundary
integration cases.

## Removal gate

A test may be removed only when the migration ledger records:

- the rule or failure class it protected,
- the replacement evidence or reason it is redundant,
- the result of targeted mutation or fault injection for high-risk behavior,
- the shadow-run evidence,
- the gate in which the replacement runs,
- reviewer approval.

No replacement is required for a test that demonstrably checks only a trivial
implementation detail, but the redundancy decision must still be recorded.

## Shadow and stability policy

- Old and new evidence run together before removal.
- Pilot journeys require 20 consecutive green runs.
- Native journeys must remain below a one-percent flake rate over 100 scheduled
  executions before broad migration relies on them.
- Retries may diagnose a flake but do not erase it.
- A quarantined critical test blocks migration of its protected area.

## Stop policy

Pause or roll back a migration area when fault detection decreases, a critical
invariant loses negative/failure coverage, the real boundary is replaced by a
mock, diagnostics materially worsen, isolation from user data cannot be
guaranteed, or the new verification cost exceeds the agreed budget without a
measurable confidence gain.
