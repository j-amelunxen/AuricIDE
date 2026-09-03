# Codebase Specification Worklog

Audit and modification log for AuricIDE specification documents.
Entries record changes made according to the change-gate rule.

## 2026-09-03 docs/spec/modules/agent-fleet.md

- gate: unspecced
- evidence: src/lib/agents/fleet.ts, src/lib/agents/attention.ts, src-tauri/src/agents.rs
- change: Created module specification for agent fleet lifecycle, PTY streaming, and attention model.

## 2026-09-03 docs/spec/modules/goals-conductor-loop.md

- gate: unspecced
- evidence: src/lib/store/goalsSlice.ts, src/lib/store/conductorSlice.ts, src-tauri/src/database.rs
- change: Created module specification for goal trees, 4 satisfaction conditions, and conductor loop.

## 2026-09-03 docs/spec/modules/git-multirepo.md

- gate: unspecced
- evidence: src-tauri/src/git.rs, src-tauri/src/ignored_repos.rs, src/lib/store/gitSlice.ts
- change: Created module specification for multi-repository discovery, repoPath identity, and ignored repos.

## 2026-09-03 docs/spec/modules/configuration-credentials.md

- gate: unspecced
- evidence: src-tauri/src/app_config.rs, src-tauri/src/provider_policy.rs, src/lib/config/appConfig.ts
- change: Created module specification for app vs project settings, 0600 credentials, and provider policies.

## 2026-09-03 docs/spec/modules/notifications-schedules.md

- gate: unspecced
- evidence: src-tauri/src/notifications.rs, src-tauri/src/schedules.rs, src/lib/notifications/trust.ts
- change: Created module specification for cross-project notification bus, schedule runner, and payload trust.

## 2026-09-03 docs/spec/modules/fastmcp-server.md

- gate: unspecced
- evidence: src/mcp/server.ts, src-tauri/src/mcp.rs, src/mcp/tools/
- change: Created module specification for FastMCP server subprocess, stdio transport, and 15 tool domains.

## 2026-09-03 docs/spec/modules/tauri-backend-core.md

- gate: unspecced
- evidence: src-tauri/src/lib.rs, src-tauri/src/database.rs, src/lib/tauri/invoke.ts
- change: Created module specification for Tauri IPC invoke bridge, PTY shells, SQLite database layer, and file watching.

## 2026-09-03 docs/spec/modules/inbox.md

- gate: unspecced
- evidence: src-tauri/src/inbox.rs, src/lib/inbox/, src/lib/store/inboxSlice.ts
- change: Created module specification for GTD inbox, project assignment, and cross-project PM overview.

## 2026-09-03 docs/spec/modules/usage-tracking.md

- gate: unspecced
- evidence: src-tauri/src/cc_usage/, src-tauri/src/usage_limits/, CLAUDE.md
- change: Created module specification for real-time quota tracking vs historical token consumption.
