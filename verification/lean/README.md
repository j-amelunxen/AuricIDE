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

The claim boundary is deliberate:

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

That command compiles the MCP lifecycle proofs before regenerating and
comparing the provider-policy oracle corpus.
