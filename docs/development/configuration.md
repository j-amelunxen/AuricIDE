# Configuration and installed builds

[Developer guide index](README.md) · [Documentation index](../README.md)

Application/project settings, credentials, provider enforcement and preference synchronization. See also the [module specification](../spec/modules/configuration-credentials.md) and [provider schema](../../dynamic-providers/README.md).

## The installed app vs. the dev build

`pnpm build:production` (`scripts/build-production.sh`) produces the real macOS
bundle and puts it in `/Applications`, so the IDE can live in the Dock instead
of only starting through `pnpm tauri:dev`. Pass `--no-install` to keep the
bundle in `src-tauri/target/release`, `--dmg` for a disk image, `--open` to
launch it afterwards.

Both builds are meant to be the same install, and that takes two things:

- **Backend state already agrees.** Every store resolves from
  `app_data_dir()`, which Tauri derives from the `identifier` in
  `tauri.conf.json` — one string, both builds, so both land in
  `~/Library/Application Support/com.auricide.ide`. The build script checks the
  bundle it just produced really carries that identifier; a mismatch there is
  what makes an app open looking like a fresh install.
- **`localStorage` does not, so it is mirrored.** WebKit scopes it by data
  store (`~/Library/WebKit/auric-ide` for the bare dev binary,
  `~/Library/WebKit/<identifier>` for the bundle) and by page origin
  (`http://localhost:41873` vs `tauri://localhost`). Neither is ours to align,
  so `webview_prefs` (Rust) and `sharedPrefs.ts` (frontend) keep the values in
  `webview-prefs.json` next to the other stores. `SharedPrefsGate` reconciles
  before the first render, because the theme, the agent spawn defaults and the
  skill sources are all read synchronously as their panels mount.

The file is the source of truth once an origin has been seeded, absences
included — otherwise a preference cleared in one build would be handed back by
the other. The very first run seeds it from whichever webview store was written
to most recently, so which build the user happens to open first does not decide
whose settings survive.

## Configuration: application vs. project

Two layers, and the question that decides which one a setting belongs to: **would
it still be right if you opened a different repository?**

| Layer                    | What lives there                                                                                | Where it is stored                                                                                                                       | API                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Application**          | Theme, editor toggles, remembered launch choices, custom commands                               | `localStorage`, mirrored to `<app_data_dir>/webview-prefs.json` (see [Installed app and dev build](#the-installed-app-vs-the-dev-build)) | `src/lib/config/appConfig.ts`                                     |
| **Application (secret)** | API keys and endpoints for LLM, Judge, Excalidraw+, video transcription                         | `<app_data_dir>/app-credentials.json`, written by Rust at mode 0600                                                                      | `src/lib/tauri/appCredentials.ts` ↔ `src-tauri/src/app_config.rs` |
| **Project**              | Provider policy, commit conventions, ticket pattern, conductor provider, credential _overrides_ | `kv_store` in `<project>/.auric/project.db`                                                                                              | `src/lib/config/projectConfig.ts`                                 |

Credentials are global with a per-project override. One rule decides which wins,
and it lives in `app_config::resolve_credential`: the project value wins when it
carries something, the global one otherwise. A **blank** project value is not an
override — clearing a field means "use the application value again", never "this
project deliberately has no key". `CredentialOverride.tsx` therefore stores
nothing for a cleared field and deletes the row instead.

Projects from before the split migrate once, on open
(`src/lib/config/migrateCredentials.ts`): field by field, a project value moves
up only where the application store has nothing, and otherwise stays put as an
override. The marker `project_config/credentialsMigratedV1` keeps it to one run —
but only after a clean pass, so a failed write is retried rather than stranded.

**No global permission switches.** How freely an agent may act is decided per
launch (the spawn dialog's permission mode, narrowed by the provider and
supervisor policies). The former "Auto-Accept Edits" / "Skip Permission Prompts"
settings never reached a launch and were removed.

### The provider policy

Which agent CLIs a project permits: `{ allow: string[] | null, deny: string[] }`.
`allow === null` (or empty) means no allow list is in effect; `deny` always wins.
An allow list that empties out is an absent one, never a total lockout — denying
everything stays possible, but only by saying so on the deny list.

It has **two implementations on purpose**: `src/lib/config/providerPolicy.ts`
decides what the dialogs offer, `src-tauri/src/provider_policy.rs` decides what
actually spawns. Both are tested against the same
`src/lib/config/providerPolicy.fixtures.json` (Rust reads it via `include_str!`),
because a disagreement between them is the failure that matters: a provider
hidden from every picker would still run, or a permitted one would be refused
with no way to see why. **Change the fixtures first**, then both sides.

The enforcement point is `agents::resolve_permitted_provider`, called from
`spawn_agent_impl` — the one path every agent takes, conductor, retry, resumed
run and notification action included. It checks the **resolved** provider id,
not the requested one: an unknown name falls back to the registry default, so
checking the request would let a deny list be dodged by naming a provider that
does not exist.

### The write sandbox and CLIs with only a global MCP config

A provider config may set `writeSandbox` ([dynamic-providers/README.md](../../dynamic-providers/README.md)). Its
agents then run under a macOS Seatbelt profile (`agents/write_sandbox.rs`,
applied last in `spawn_agent_impl`): writes only in the cwd, the bound project,
a worktree's shared `.git`, temp dirs, package caches and the paths the config
names; reads and network stay open; `exemptPermissionModes` run unconfined; on
other platforms the spawn is refused rather than run without it. It exists
because the Antigravity CLI's own `--sandbox` denies shell writes in the
workspace too, and without it the CLI writes anywhere.

The same CLI has no `--mcp-config` flag, so it binds through the environment:
`projectBinding.environment` exports `AURIC_MCP_CONFIG={mcpConfigPath}`, and
one global entry in its MCP config runs `auric-mcp/bridge.mjs`
(`src/mcp/configBridge.ts`), which becomes that file's `auric-pm` server. The
bridge must never leave the CLI waiting — it blocks its whole turn on a server
that does not answer — so unbound, or when the server dies before its first
reply, it answers as a server with no tools. `scripts/probe-agy-headless.mjs`
and the ignored `agy_headless_end_to_end` test check the real CLI.
