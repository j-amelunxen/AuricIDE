# Lean verification pilots

`AuricIDE/McpLifecycle.lean` proves the pure lifecycle coordinator properties
that matter during asynchronous workspace changes: stale completions cannot
overwrite a newer operation, an accepted start publishes a coherent
PID/workspace pair, and the model represents at most one managed child. OS
process readiness/termination and SQLite isolation remain integration-test
obligations.

`AuricIDE/McpSessionIsolation.lean` proves the ownership boundary introduced
for concurrent agents: UI project changes cannot retarget a session, a
projectless session cannot inherit ambient UI state, and ending one session
does not alter another session's binding.

`AuricIDE/ProviderPolicy.lean` is the normative model for the **normalised
decision** only. The explicit Lake executable in
`AuricIDE/ProviderPolicyOracle.lean` deterministically emits the checked-in
`../../contracts/provider-policy-v1.jsonl` corpus.

`AuricIDE/LaunchGate.lean` models the gate in front of an automatic agent start
under a launch grant (goal-native mission, REQ-LAUNCH-01..03) in the shape of
the native store: grants are rows with ids, saving a grant replaces the row in
force for its root, a revocation stamps a row, a decision attempt carries the
grant id an app instance last saw (possibly stale), and a request's goal can
move to another mission root. There is no clock: a request written before the
grant starts once it is given, capped by limit and budget. Proved for every
interleaving: a start needs a row in force at the decision whose root is the
goal's root at that moment, and a revoked or replaced id never starts anything
again (REQ-01); held slots never exceed the limit of the grant in force, and
only an explicit resolution frees a slot (REQ-02); a start needs budget, usage
never goes down, and a spent budget stops the root until a new grant (REQ-03).
`claim_start_iff_gate` ties the native claim to the pure TypeScript gate.
`scripts/lean-check.mjs` prints the axioms of the requirement theorems and
fails on anything but `propext`, `Classical.choice` and `Quot.sound`.

The executable `AuricIDE/LaunchGateOracle.lean` emits 360 generated traces with
both decisions of the model at every step into
`../contracts/launch-gate-v1.jsonl`. `src/lib/notifications/launchGate.oracle.test.ts`
replays them against the TypeScript `decideLaunch` (plus mutants that must
fail), and a Rust test in `src-tauri/src/notifications/tests.rs` replays them
against the native claim with real grant rows, revocations from a second
connection and ancestry read from a real `project.db`. JSON/IPC adapters, the
spawn, the working-directory rule, retries and the UI acknowledgement stay
test obligations.

The claim boundary for the provider policy is deliberate:

- Lean proves deny precedence, empty-allow openness, blank-id rejection,
  determinism, and boolean totality for `Policy` values whose ids are already
  normalised.
- Lean does not model JSON parsing, Unicode trimming/case folding, duplicate
  removal, provider-registry default resolution, Tauri IPC, or agent spawning.
  TypeScript and Rust retain tests for their respective adapter and integration
  behaviour.
- Conformance is corpus-based. A green result proves agreement for the
  versioned bounded corpus, not formal equivalence of production code.

Only Lean's standard library is used. The exact toolchain is pinned in
`lean-toolchain`.

## Install and verify

Lean/Lake is intentionally not vendored. Install the official Elan version
manager, then start a new shell so `lake` is on `PATH`:

```sh
curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh
cd verification/lean
lake exe provider-policy-oracle
```

Run the repository conformance check from its root afterwards:

```sh
node scripts/lean-check.mjs
```

That command compiles the MCP lifecycle and session-isolation proofs, then
regenerates the provider-policy and launch-gate oracle corpora (building each
executable compiles its model and proofs) and compares them byte-for-byte.
