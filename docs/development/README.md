# Developer guides

Read the guide for the area you are changing. Repository-wide working rules stay in
[CLAUDE.md](../../CLAUDE.md); feature implementation details belong here.
Commands and source paths in these guides are relative to the repository root.

| Area                         | Guide                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Development and verification | [Commands, test environments, commit checks and architecture maintenance](workflow.md)                 |
| Configuration and builds     | [Application/project settings, credentials, provider policy and dev/installed state](configuration.md) |
| Frontend                     | [Zustand, IPC, UI composition, CodeMirror, formatting and explorer](frontend.md)                       |
| Goals and requirements       | [Conductor, dependencies, satisfaction gates and requirement lifecycle](goals.md)                      |
| Agent fleet                  | [Attention, detached terminal windows and console feed](agent-fleet.md)                                |
| Agent control                | [Control socket, Supervisor Link, jobs and external agents](agent-control.md)                          |
| Supervisors and managers     | [Policy, child scope, model choice, run folders and manager memory](supervisors.md)                    |
| Notifications and schedules  | [Trust, launch defaults, Command Center and scheduled conductor](notifications.md)                     |
| Git                          | [Multi-repository identity, ignored repos and graph operations](git.md)                                |
| Backend and MCP              | [Runtime ownership, Rust modules, MCP modes and machine dependencies](backend.md)                      |
| Usage and costs              | [Quota, transcript pricing and per-run bookkeeping](usage.md)                                          |

For system structure and external interfaces, use the [architecture map](../architecture/README.md)
and [interface contracts](../architecture/interfaces.md). The [documentation index](../README.md)
links module specifications, designs and verification evidence.
