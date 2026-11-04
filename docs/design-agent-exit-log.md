# Agent exit log

An agent that ends on its own used to show up as status `error`, exit code 1,
no message. `manager.rs` folds every non-success to 1, so a plain `exit 1`, a
SIGKILL from the kernel and a SIGHUP from a closed PTY were indistinguishable.

`agents/exit_log.rs` keeps the raw ending in `<app_data_dir>/agent-exits.jsonl`
(one JSON object per line, rotated to `.1` at 2 MiB). The UI is unchanged:
status, `exit_code` in `agent-status` and the usage outcome still use 0 / 1 / -1.

| Field                                                             | Meaning                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `end`                                                             | `exited`, `signaled`, `ide-kill`, `app-quit`, `wait-failed`                                                                                    |
| `exitCode`, `signal`                                              | Raw values from portable-pty; `signal` is the libc text ("Killed: 9"). Both absent for `ide-kill` and `app-quit`, where the status is not read |
| `killedByIde`                                                     | `true` only for `kill_agent_impl`                                                                                                              |
| `runtimeMs`, `startedAtMs`, `endedAtMs`                           | Run length                                                                                                                                     |
| `lastOutputOffset`, `lastOutputAtMs`, `silentForMs`               | Console bytes in total, when they last grew, and the quiet time before the end                                                                 |
| `memory`                                                          | `availableBytes` (free + inactive + speculative), `swapUsedBytes`, `swapTotalBytes`, `pressureLevel` (1 normal, 2 warning, 4 critical)         |
| `provider`, `model`, `headless`, `role`, `projectPath`, `agentId` | Which run                                                                                                                                      |

No prompt, task text, console output or environment is written. A write that
fails goes to stderr and never changes how the run ends. There is no TypeScript
reader, so there is no twin or fixture.

Reading it: `end: "signaled"` with `Killed: 9` and low `availableBytes` points
to the kernel's memory killer; `Hangup: 1` points to the PTY side closing;
`exited` with code 1 and a long `silentForMs` points to the CLI exiting itself.
This is a reading aid, not proof.
