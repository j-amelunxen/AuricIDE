# Configuration & Credentials

The Configuration & Credentials module governs the storage, scoping, resolution, and security gates for machine-wide settings, per-project preferences, API secrets, and agent execution policies.

---

## 1. Purpose

Configuration in AuricIDE is governed by one architectural question: _“Would this setting still be right if you opened a different repository?”_

- **Application scope**: Settings and secrets that belong to the machine and user across all projects.
- **Project scope**: Settings, workflows, overrides, and policies that belong strictly to the open repository.
- **Security & Permissions**: File permission fencing (0600) for secrets, ephemeral safety switches, and strict agent provider allow/deny enforcement.

---

## 2. Boundaries

- **Subprocess Spawning**: Does not spawn agent processes; it enforces whether a requested provider is permitted and passes resolved credentials to [Agent Fleet](./agent-fleet.md).
- **Git State**: Does not execute Git commands; see [Git Multi-Repo](./git-multirepo.md).

---

## 3. Configuration Hierarchy

| Layer                    | Content                                                                 | Storage Location                                               | API / Access                                        |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| **Application**          | Theme, editor toggles, launch choices, custom commands                  | `localStorage` mirrored to `<app_data_dir>/webview-prefs.json` | `src/lib/config/appConfig.ts` ↔ `webview_prefs.rs`  |
| **Application (Secret)** | API keys & endpoints for LLM, Judge, Excalidraw                         | `<app_data_dir>/app-credentials.json` (Rust mode 0600)         | `src/lib/tauri/appCredentials.ts` ↔ `app_config.rs` |
| **Project**              | Provider policy, commit conventions, ticket pattern, conductor provider | `kv_store` in `<project>/.auric/project.db`                    | `src/lib/config/projectConfig.ts` ↔ `database.rs`   |
| **Project Overrides**    | Per-project API keys overriding machine keys                            | `kv_store` in `<project>/.auric/project.db`                    | `app_config::resolve_credential`                    |

---

## 4. Public Contracts & Rules

### Credential Resolution Rule (`resolve_credential`)

- Evaluates `(project_value, global_value)`:
  - Non-empty project value **wins**.
  - Empty or absent project value falls back to the **global machine credential**.
  - A blank string in project settings deletes the override row; it never means "deliberately no key".

### Ephemeral Safety Switches (Deliberately Not Persisted)

- `dangerouslyIgnorePermissions` and `autoAcceptEdits` are never saved to disk.
- Both reset to `false` on every application restart and whenever a different project is opened.

### Provider Policy (`src/lib/config/providerPolicy.ts` & `src-tauri/src/provider_policy.rs`)

- Schema: `{ allow: string[] | null, deny: string[] }`.
- Rules:
  - `allow === null` or empty array: No allow list active (all non-denied providers permitted).
  - `deny`: Denied providers always rejected, even if explicitly on the allow list.
  - Denying everything is supported, but only by explicitly placing providers on the `deny` list.
- **Twin Implementation**: Tested against `providerPolicy.fixtures.json` on both TypeScript and Rust sides.
- **Enforcement Point**: Evaluated inside `spawn_agent_impl` on the **resolved** provider ID (preventing fallback bypasses).

### Cross-Origin Webview Preferences Sync (`webview_prefs.rs`)

- WebKit isolates `localStorage` between dev binary origins (`http://localhost:41873`) and installed bundle origins (`tauri://localhost`).
- Both sync synchronously via `<app_data_dir>/webview-prefs.json` on app mount via `SharedPrefsGate`.

---

## 5. Key Flows

### 5.1 Project Open & Credential Migration

1. On opening a project, `migrateCredentials.ts` inspects `<project>/.auric/project.db`.
2. Legacy project-stored global keys migrate up to `<app_data_dir>/app-credentials.json` if the machine store is currently empty.
3. Once completed cleanly, the marker `project_config/credentialsMigratedV1` is recorded to prevent repeated migration passes.

### 5.2 Provider Spawn Resolution

1. Conductor or user requests agent spawn with `providerId`.
2. Provider policy resolves whether the requested provider is permitted for this project.
3. If denied, spawn halts immediately with an explanatory error toast.
4. If permitted, credentials and executable arguments are formatted for the child process.

---

## 6. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite storage for project `kv_store`, native 0600 file I/O, and IPC invoke registration.
- **[Agent Fleet](./agent-fleet.md)**: Consumes resolved providers and credentials.

---

## 7. Relevant Source Paths

- `src/lib/config/appConfig.ts` — Frontend application-level configuration.
- `src/lib/config/projectConfig.ts` — Frontend project-scoped configuration.
- `src/lib/config/providerPolicy.ts` — TypeScript provider allow/deny policy parser.
- `src-tauri/src/app_config.rs` — Rust 0600 machine credentials storage and resolution.
- `src-tauri/src/provider_policy.rs` — Rust provider policy enforcement.
- `src-tauri/src/webview_prefs.rs` — Webview preferences mirroring to disk.
