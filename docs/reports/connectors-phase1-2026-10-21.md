# Generic connectors, phase 1 — 2026-10-21

Status: implementation complete on `auric/connectors-phase-1-generischer-s-d45ee1c2`; not merged. See verification and handoff below.

## Scope and implementation

The IDE imports an external, owner-reviewed stdio MCP manifest and grants it to explicitly allowed logical projects. Application code contains no connector/service-specific names or branches. The concept was read from the main checkout and is not committed; `.gitignore:111` excludes `docs/concepts/connectors-concept.md`.

| What                                                                                                                                       | Source                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Strict v0 YAML parsing, validation, SHA256 pin, immutable registration snapshot, review/save race check                                    | `src-tauri/src/connectors.rs:26`, `:155`, `:175`                                                                           |
| Registry and project scope bindings in the host-owned supervisor policy; old files grant nothing                                           | `src-tauri/src/connectors.rs:46`, `src-tauri/src/supervisor/policy.rs:139`, `:255`                                         |
| Canonical project keys; new approvals validated before the existing private atomic policy write                                            | `src-tauri/src/supervisor/mod.rs:72`, `:729`                                                                               |
| Resolve only from the immutable logical project and the current host policy; disallowed projects receive nothing                           | `src-tauri/src/connectors.rs:211`, `src-tauri/src/agents/manager.rs:705`                                                   |
| Provider capability gate and briefing appended before the provider builds its task command                                                 | `src-tauri/src/connectors.rs:289`, `:303`, `src-tauri/src/agents/manager.rs:727`                                           |
| Private per-agent standard/Crush configs retaining the core `auric-pm` server                                                              | `src-tauri/src/mcp.rs:151`                                                                                                 |
| Codex session overrides and native tool allowlist; Claude declared-tool denials                                                            | `src-tauri/src/providers/types.rs:273`, `:336`                                                                             |
| Review/import/re-approve/remove, digest status, per-project scope checkboxes and derived allowed-tool display, using the existing Save bar | `src/app/components/ide/settings/SupervisorConnectors.tsx:20`, `src/app/components/ide/settings/SupervisorContent.tsx:243` |
| Frontend policy parsing and pure tool derivation/removal                                                                                   | `src/lib/config/connectorPolicy.ts:24`, `:61`, `src/lib/config/supervisorPolicy.ts:515`                                    |

No project `kv_store` supplies connector definitions or grants. No external connector is added to supervisor-global MCP, exported project `.mcp.json`, or global provider configuration. Projectless agents and supervisors receive no external project connectors. Existing provider/model admission remains authoritative.

## Implemented manifest contract

**The owner's `auric-connector/v0` contract is unchanged.** The concept's illustrative `auric.connector/v1`, token auth, broker, HTTP/managed CLI, audit and delegation machinery are outside this delivery.

The owner registers an absolute path to `auric-connector.yaml` in the connector repository:

```yaml
schema: auric-connector/v0
id: example-catalog
version: 1.0.0
transport: stdio-mcp
launch:
  command: ./catalog-server
  args: ['${AURIC_PROJECT_NAME}', '${AURIC_PROJECT_ROOT}']
  env: {}
scopes: [catalog.read]
tools:
  - name: catalog_list
    scopes: [catalog.read]
briefing: |
  Use catalog_list to read the bound project's catalog.
auth: none
```

- `launch.command` is absolute or resolved relative to the canonical manifest directory, never looked up on PATH by the IDE. Interpreter commands must therefore use an absolute interpreter path, or a repository-local wrapper.
- `args` and `env` default to empty. Only args support the two specified substitutions. The canonical logical project directory supplies ROOT; its final directory name supplies NAME. Expansion is single-pass. Task text, execution cwd, agent-provided environment and project database contents cannot supply these values.
- Only `stdio-mcp` and `auth: none` are accepted. `env` is owner-declared non-secret configuration; v0 does not detect secret contents or support credential delivery. Reserved `AURIC_` env keys are rejected.
- Validation rejects unknown manifest fields, malformed semantic versions, duplicate scopes/tools, unknown tool scopes, unsupported placeholders and invalid names. IDs use lowercase ASCII slug characters. Tool names use ASCII letters/digits, underscore, hyphen or dot. Names are capped at 100 characters; briefing at 16 KiB; manifest at 256 KiB. These validation constraints avoid provider permission-rule injection; no schema fields were changed.
- Each tool is allowed only if **all** of its scopes are granted. A tool with an empty scope list requires only an explicit connector binding. An empty resulting tool set omits the server and briefing entirely.
- Registration stores canonical path, SHA256 of the exact manifest bytes, and the reviewed parsed snapshot. Spawn reads and verifies the bytes again. Missing, invalid or changed manifests supply no connector and no briefing. Review/re-approve plus Save pins the replacement definition. Saving an unrelated setting preserves a disabled registration.
- Generated MCP server names are `connector-<manifest id>`, preventing collisions with Auric core names. Removal deletes both registration and grants.

Host policy version remains 1 with an additive optional extension:

```json
{
  "connectors": {
    "registry": {
      "example-catalog": {
        "path": "/connector-repo/auric-connector.yaml",
        "digest": "<64 lowercase SHA256 hex characters>",
        "manifest": "<reviewed parsed manifest object>"
      }
    },
    "bindings": {
      "/canonical/logical/project": { "example-catalog": ["catalog.read"] }
    }
  }
}
```

The schematic example omits existing policy fields; the manifest placeholder stands for an object, not a literal string. Registry and grants are saved together in `<app_data>/supervisor-policy.json`, using the existing mode-0600 atomic writer. Allowed tools are derived, rather than stored as a second authority. The ordinary project entry must also have `allowed: true`. Invalid connector policy fails closed. Legacy files need no manual migration.

## Per-provider enforcement matrix

“Injected” below means the generated launch material was tested; it does **not** mean a live authenticated vendor CLI contract test was performed.

| Provider / adapter                                               | Injection and briefing                                                                                        | Tool shaping                                                                       | Actual boundary / limitation                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude, with its existing full-config binding                    | Private standard `mcpServers` config plus briefing; retains configured `--mcp-config` / `--strict-mcp-config` | Exact `--disallowedTools mcp__connector-<id>__<tool>` for ungranted declared tools | Declared inventory denylist only. Undeclared upstream tools are not blocked. Strict ambient-server exclusion depends on the owner-supplied adapter retaining the strict flag; no new OS boundary or live CLI certification.       |
| Codex                                                            | Session `-c mcp_servers.connector-<id>.{command,args,env,enabled,enabled_tools}` overrides plus briefing      | Native exact `enabled_tools` allowlist                                             | Host supplies only this project's managed connector entries. Ambient/global/plugin MCP configuration is not suppressed. Non-secret env appears in argv, as in the existing renderer; the deferred env/argv finding was not fixed. |
| Crush                                                            | Private `CRUSH_GLOBAL_CONFIG` with `mcp`, stdio type and timeout, plus briefing                               | Both `enabled_tools` and `disabled_tools`                                          | Current upstream supports allowlists. Older versions may honor only the denylist, or neither; no installed-version guarantee. Global/local config merge behavior is not certified or treated as isolation.                        |
| Antigravity / Gemini using the current `AURIC_MCP_CONFIG` bridge | **No external connector or briefing**                                                                         | None                                                                               | The packaged bridge serves only `auric-pm`, not all servers in the JSON file. Nonempty core-binding material is insufficient. Fail closed rather than advertise unavailable tools.                                                |
| Grok with no project MCP binding                                 | **No external connector or briefing**                                                                         | None                                                                               | Existing unbound launch opt-in is preserved for core behavior and grants no connector capability.                                                                                                                                 |
| Other dynamic adapter passing the full config path in arguments  | Standard config plus briefing                                                                                 | No generic provider-native tool filter                                             | Configuration wiring only; provider consumption, filtering and ambient configuration require adapter-specific certification.                                                                                                      |
| Other env-only / unbound adapter                                 | **No external connector or briefing**                                                                         | None                                                                               | Not treated as a full-config consumer.                                                                                                                                                                                            |

The existing bridge limitation is why Antigravity is explicitly unsupported for external connectors in this pass. A multiplexing broker/bridge would be a separate delivery, not an implied property of setting an environment variable.

Native filtering references consulted: [Codex config reference](https://developers.openai.com/codex/config-reference/), [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), [Crush MCP config structure](https://github.com/charmbracelet/crush/blob/main/internal/config/config.go). The automated tests verify the generated material, not a provider's undocumented effective merge behavior.

Scopes and briefing do not make a service read-only. The external connector itself must enforce its advertised catalog-only policy. Shell access, same-user filesystem access, ambient MCP servers, executable changes and upstream permissions are outside this v0 boundary. The SHA256 pins the manifest, not its executable or repository contents.

## Automated evidence and verification

`src-tauri/tests/fixtures/stdio-connector/auric-connector.yaml:1` and executable `fake-mcp.py:1` provide a tiny local JSON-RPC stdio MCP server; no pilot service, tokens, network or vendor CLI is required.

`src-tauri/src/connectors/tests.rs:67` checks project A versus B across standard/Crush config and Codex overrides, all-scope tool selection, briefing and adapter capability gating. `:155` launches the generated server entry and performs initialize, tools/list and tools/call. `:203`, `:305` and `:315` cover changed/removed manifests and approval races. `:331` covers single-pass host substitution; `:343` covers a canonical logical project, a separate execution worktree and agent-writable project DB contents. Shared Rust/TypeScript policy fixtures cover migration and malformed grants. Frontend tests cover preview-before-approval, grants, removal, disabled projects, digest drift and native errors.

| Check                                                                                                               | Result                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Rust suite: `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=4`                              | **1,727 passed, 11 ignored, 0 failed**; includes all 10 connector tests.                                                                                 |
| Focused frontend connector/policy/settings suite, four files                                                        | **150 passed**.                                                                                                                                          |
| Full frontend suite: `node node_modules/vitest/vitest.mjs run --maxWorkers=2`                                       | **11,240 passed / 4 failed**, 744 passing files / 3 failing files (747 total). Two baseline failures plus two load-related timeouts; see evidence below. |
| Browser suite, isolated Next dev server and Chromium                                                                | **22 passed**; dev-only test hooks required, separate port, no committed test-config changes.                                                            |
| Tooling suite: `node --import tsx --test scripts/*.test.mjs scripts/*.test.mts`                                     | **20 passed**.                                                                                                                                           |
| `pnpm build` / Next production export                                                                               | **Passed**, including TypeScript and all static routes.                                                                                                  |
| `cargo build --manifest-path src-tauri/Cargo.toml`                                                                  | **Passed**, native debug build.                                                                                                                          |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`                                                  | **Passed**, no warnings.                                                                                                                                 |
| TypeScript check, full ESLint, changed-file Prettier, Rust fmt, Knip, duplication threshold, normal `cargo machete` | **Passed**.                                                                                                                                              |
| MCP runtime bundle and packaged-runtime smoke                                                                       | **Passed**, packaged runtime advertises 78 core tools.                                                                                                   |
| Test inventory, Tauri version alignment, automation surface                                                         | **Passed**; automation surface unchanged.                                                                                                                |
| Lean lifecycle/isolation/launch proofs and oracle equivalence                                                       | **Passed**.                                                                                                                                              |

The full frontend suite is **not a clean green merge gate**. Its two deterministic failures are unchanged tests in `src/app/components/agents/AgentsPanel.test.tsx`: “asks to merge into main after the agent is stopped” and “keeps the worktree when merge is declined.” Both reproduce in an untouched source archive of starting commit `8fad77a1a8324b4ba3ca41ffd972b1ee3d4c43fd` (91 passed / 2 failed out of 93), as well as on this branch. The cancellation test sees `mergeAgentWorktree` called despite Cancel. These tests and their production code were not changed here.

The full run also hit timing failures in the existing MergeView focus and ActivityFeed reveal-window tests. An isolated single-worker rerun of MergeView, ActivityFeed and agentSlice passed all 254 tests. No assertions or timeouts were weakened and no unrelated production fixes were made. The baseline merge-cancellation failures remain a handoff blocker for an all-green merge.

Initial sandboxed attempts could not run existing macOS process/sandbox tests or launch Chromium; reruns outside that outer sandbox passed the complete Rust and browser suites. The worktree initially symlinked `node_modules` into main, which prevented cache writes and Turbopack resolution. A local copy fixed that without changing main's dependencies. Direct Node equivalents of package scripts were used where needed; later `pnpm build` used `pnpm_config_verify_deps_before_run=false` to avoid an automatic dependency reinstall. No dependency auto-install policy or test configuration was committed. The optional `cargo machete --with-metadata` mode reported the existing `tauri-build` build-dependency as unused; the repository's normal `cargo machete` check passed.

Native desktop WDIO durability/merge workflows and a packaged installer/release build were not run; the native unit suite, native build, production frontend build and browser suite above were run. Live authenticated provider CLIs were not exercised.

## Owner steps: Atlas -> sample-project

1. Obtain the other implementer's actual `auric-connector.yaml` path. Its command/wrapper must exist, be executable, implement stdio MCP and enforce catalog read-only behavior. Use `auth: none` and no tokens/secrets in env or arguments.
2. Run the rebuilt IDE. Star/open and initialize the logical sample-project project if needed. In Settings -> Supervisor -> Projects, allow that project and choose the existing provider/model/mode limits. Projects where the supervisor is disallowed receive no connectors.
3. In **External connectors**, enter the absolute manifest path and select **Review manifest**. Inspect id, version, command, arguments, environment, scopes, tool inventory, briefing and SHA256. Select **Approve this digest**. This changes the draft; it does not launch the connector yet.
4. Under the sample-project root, enable the imported connector and grant only the external manifest's catalog read-only scope(s). Check **Allowed tools**. No other project should be enabled. Do not infer scope names from this report; the external manifest supplies them.
5. Select the existing **Save** button. New registration approvals are checked again against the current file. If the file changed during review, review it again.
6. Launch a new sample-project agent with a supported full-config adapter (the existing strict Claude route is the intended pilot; Codex is also rendered). Its launch context includes the manifest briefing and granted tool names. Launch an agent of another project and confirm the managed connector is absent. Antigravity's current core bridge and unbound Grok intentionally get none.
7. After manifest updates, use **Review / re-approve**, review the changed definition, approve and Save. New launches remain without it while the digest mismatches. **Remove**, then Save, removes registration and every project grant.

## Rebuild, restart and session lifecycle

Both native Rust and frontend code changed: rebuild the desktop IDE, including the MCP runtime bundle, and restart the running IDE once to load this implementation. The production web export and native build were checked; no installer was published.

After that, importing/re-approving/removing manifests and changing grants require **Save and a new agent launch**, not another IDE rebuild or restart. Existing agents keep their launch snapshot. Stop/restart those agents to remove their old access; this phase has no live revocation, token expiry, upstream revocation or child cascade. The owner's cascade decision remains a requirement for the later credential/delegation phase.

## Assumptions and structured open questions

Assumptions:

- The security findings named by the owner remain deferred: no tickets and no unrelated fixes were made. None was required to deliver this non-secret, auth-none wiring pilot.
- A registered manifest is owner-approved executable configuration. “Non-secret” is an owner responsibility in v0; the IDE cannot infer confidentiality from a string.
- NAME means the canonical logical root's directory name; ROOT means that canonical root, independent of execution cwd/worktree. Worktrees use the existing explicit logical-project binding.
- Grants govern IDE-managed new launches. They do not retroactively alter active processes or block same-user/direct shell access.
- Provider-native tool shaping is reported as such; no broker enforcement, global-config isolation or live vendor compatibility is implied.
- The final instruction to commit on this branch and **not merge or remove the worktree** takes precedence over the earlier general merge process.

| ID  | Structured question                                                                                                               | Owner / effect                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Q1  | What exact manifest path and read-only scope/tool inventory will the external Atlas implementation supply?                        | External implementer / owner; consumed through the generic UI, no IDE code change.                                   |
| Q2  | Which deployed CLI versions will be certified with live full-config, tool-filter and ambient-config tests before broader rollout? | Provider adapter maintainers / owner; current evidence is generated-config and fake-server tests, with limits above. |

Neither question requires changing the v0 manifest contract or guessing service-specific configuration in IDE code.

## Commit and merge handoff

- Implementation commit: `e666c1dd1262fab4bbe032aca8be7ffb44958105`.
- Starting commit / main observed during implementation: `8fad77a1a8324b4ba3ca41ffd972b1ee3d4c43fd`.
- Branch: `auric/connectors-phase-1-generischer-s-d45ee1c2`.
- The report is committed separately after the implementation; its commit hash is included in the main-checkout delivery copy.

No merge hash exists: this agent was explicitly instructed not to merge. The worktree remains in place. Before whoever started this work merges it, rebase onto then-current `main`, accommodate Agent-110's model-catalog changes, and rerun the merge gates. No model-catalog changes are included here.
