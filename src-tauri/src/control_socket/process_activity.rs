//! Best-effort local tool activity; no network calls or provider internals.
use crate::agents::AgentRole;
use std::collections::{HashMap, HashSet};

struct Process {
    parent: u32,
    command: String,
}

fn parse(snapshot: &str) -> HashMap<u32, Process> {
    snapshot
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let parent = fields.next()?.parse().ok()?;
            Some((
                pid,
                Process {
                    parent,
                    command: fields.collect::<Vec<_>>().join(" "),
                },
            ))
        })
        .collect()
}

fn infrastructure(command: &str) -> bool {
    let command = command.to_ascii_lowercase();
    let mut words = command.split_whitespace();
    let executable = words.next().unwrap_or("");
    let name = executable.rsplit('/').next().unwrap_or("");
    // Inspect the launched program/script, not arbitrary tool arguments: a
    // `cargo test src/mcp` command is work, not a persistent MCP server.
    let program = if matches!(
        name,
        "node" | "bun" | "deno" | "python" | "python3" | "npx" | "uvx"
    ) {
        words.next().unwrap_or("")
    } else {
        executable
    };
    program.contains("mcp") || program.contains("claude") || program.contains("codex")
}

fn active(snapshot: &str, roots: &HashMap<u32, (String, AgentRole)>) -> HashSet<String> {
    let processes = parse(snapshot);
    let mut busy = HashSet::new();
    for (&pid, process) in &processes {
        if roots.contains_key(&pid) || infrastructure(&process.command) {
            continue;
        }
        let executable = process
            .command
            .split_whitespace()
            .next()
            .unwrap_or("")
            .rsplit('/')
            .next()
            .unwrap_or("");
        // CLI wrappers and idle language servers aren't evidence of a tool call.
        let runtime_tool = matches!(executable, "node" | "bun" | "deno" | "python" | "python3")
            && [
                "vitest", "jest", "mocha", "pytest", "unittest", "pnpm", "npm-cli",
            ]
            .iter()
            .any(|tool| process.command.contains(tool));
        if !runtime_tool
            && !matches!(
                executable,
                "sh" | "bash"
                    | "zsh"
                    | "fish"
                    | "sleep"
                    | "cargo"
                    | "rustc"
                    | "rustdoc"
                    | "git"
                    | "curl"
                    | "make"
                    | "cmake"
                    | "gcc"
                    | "clang"
                    | "pytest"
                    | "pnpm"
                    | "npm"
                    | "yarn"
            )
        {
            continue;
        }
        let mut ancestor = process.parent;
        let mut seen = HashSet::new();
        while seen.insert(ancestor) {
            if let Some((id, _)) = roots.get(&ancestor) {
                busy.insert(id.clone());
                break;
            }
            let Some(parent) = processes.get(&ancestor) else {
                break;
            };
            ancestor = parent.parent;
        }
    }
    busy
}

pub(super) fn busy_agents(roots: &HashMap<u32, (String, AgentRole)>) -> HashSet<String> {
    if roots.is_empty() {
        return HashSet::new();
    }
    // ps is present on supported Unix desktops. Failure means "unknown", not
    // "busy forever". The watchdog continues on cleaned output alone.
    let snapshot = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,args="])
        .output();
    match snapshot {
        Ok(output) if output.status.success() => {
            active(&String::from_utf8_lossy(&output.stdout), roots)
        }
        _ => HashSet::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_test_command_counts_but_cli_and_mcp_servers_do_not() {
        let roots = HashMap::from([(10, ("a".into(), AgentRole::Worker))]);
        let idle =
            "10 1 /bin/zsh -c claude\n11 10 node /cli/claude.js\n12 11 node auric-mcp/server.js\n";
        assert!(active(idle, &roots).is_empty());
        assert_eq!(
            active(
                &format!("{idle}13 12 /bin/sh -c sleep 900\n14 13 sleep 900\n"),
                &roots
            ),
            HashSet::from(["a".into()])
        );
        assert_eq!(
            active(
                &format!("{idle}20 11 /bin/zsh -c cargo test\n21 20 cargo test\n"),
                &roots
            ),
            HashSet::from(["a".into()])
        );
        assert_eq!(
            active("10 1 claude\n20 10 cargo test src/mcp\n", &roots),
            HashSet::from(["a".into()])
        );
        assert!(active("20 1 cargo test", &roots).is_empty());
    }

    #[test]
    fn real_silent_child_process_is_detected() {
        let mut command = std::process::Command::new("sh")
            .args(["-c", "sleep 2 & wait"])
            .spawn()
            .unwrap();
        let roots = HashMap::from([(command.id(), ("test".into(), AgentRole::Worker))]);
        let detected = (0..50).any(|_| {
            if busy_agents(&roots).contains("test") {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            false
        });
        let _ = command.wait();
        assert!(detected);
    }
}
