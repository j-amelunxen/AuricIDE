//! Honest per-process memory attribution for the dev Performance Monitor.
//!
//! The old report had two lies baked in: "WebView (UI)" was actually the sum
//! of ALL child processes of the app (agents, PTY shells, MCP server — on
//! macOS the real WKWebView content processes are children of launchd, never
//! of the app), and "Next.js" silently matched node processes system-wide.
//!
//! This module itemizes instead of lumping: the app process itself, each
//! direct child with its full subtree (labeled by what it actually is —
//! a named agent, the MCP server, a shell), the dev server clearly marked
//! as dev-only, and the WebView as the system-wide WebContent estimate it
//! really is.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct SystemProcessEntry {
    pub label: String,
    pub pid: u32,
    pub rss_bytes: u64,
}

pub struct PsEntry {
    pub pid: u32,
    pub ppid: u32,
    pub rss_kb: u64,
    pub command: String,
}

/// A process whose identity the app knows first-hand (e.g. a spawned agent).
pub struct KnownProcess {
    pub pid: u32,
    pub label: String,
}

pub fn read_ps_entries() -> Vec<PsEntry> {
    let output = match std::process::Command::new("ps")
        .args(["axo", "pid=,ppid=,rss=,command="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                return None;
            }
            Some(PsEntry {
                pid: parts[0].parse().ok()?,
                ppid: parts[1].parse().ok()?,
                rss_kb: parts[2].parse().ok()?,
                command: parts[3..].join(" "),
            })
        })
        .collect()
}

pub fn build_memory_report(
    own_pid: u32,
    entries: &[PsEntry],
    known: &[KnownProcess],
) -> Vec<SystemProcessEntry> {
    let mut result: Vec<SystemProcessEntry> = Vec::new();
    let mut counted: std::collections::HashSet<u32> = std::collections::HashSet::new();

    if let Some(own) = entries.iter().find(|e| e.pid == own_pid) {
        counted.insert(own.pid);
        result.push(SystemProcessEntry {
            label: "Tauri (Rust)".to_string(),
            pid: own.pid,
            rss_bytes: own.rss_kb * 1024,
        });
    }

    // One entry per direct child, covering its whole subtree. Labeled by what
    // the process actually is — never lumped into a fake "WebView" bucket.
    for child in entries.iter().filter(|e| e.ppid == own_pid) {
        let subtree = collect_subtree(child.pid, entries);
        for e in &subtree {
            counted.insert(e.pid);
        }
        let label = subtree
            .iter()
            .find_map(|e| known.iter().find(|k| k.pid == e.pid))
            .map(|k| k.label.clone())
            .or_else(|| {
                subtree
                    .iter()
                    .any(|e| e.command.contains("mcp/server.ts"))
                    .then(|| "MCP Server".to_string())
            })
            .unwrap_or_else(|| command_basename(&child.command));
        result.push(SystemProcessEntry {
            label,
            pid: child.pid,
            rss_bytes: subtree.iter().map(|e| e.rss_kb).sum::<u64>() * 1024,
        });
    }

    // Dev server runs beside the app (sibling under the tauri CLI), so it is
    // matched by command — but never re-counted if it was already covered.
    let dev: Vec<&PsEntry> = entries
        .iter()
        .filter(|e| !counted.contains(&e.pid) && is_dev_server(e))
        .collect();
    if !dev.is_empty() {
        for e in &dev {
            counted.insert(e.pid);
        }
        result.push(SystemProcessEntry {
            label: "Next.js Dev Server (dev-only)".to_string(),
            pid: dev[0].pid,
            rss_bytes: dev.iter().map(|e| e.rss_kb).sum::<u64>() * 1024,
        });
    }

    // On macOS WKWebView content processes are children of launchd, never of
    // the app — so this can only ever be a system-wide estimate, and says so.
    let webview_rss: u64 = entries
        .iter()
        .filter(|e| !counted.contains(&e.pid) && e.command.contains("WebContent"))
        .map(|e| e.rss_kb)
        .sum();
    if webview_rss > 0 {
        result.push(SystemProcessEntry {
            label: "WebView (est., system-wide)".to_string(),
            pid: 0,
            rss_bytes: webview_rss * 1024,
        });
    }

    dedupe_labels(&mut result);
    result
}

fn collect_subtree(root_pid: u32, entries: &[PsEntry]) -> Vec<&PsEntry> {
    let mut result: Vec<&PsEntry> = entries.iter().filter(|e| e.pid == root_pid).collect();
    let mut frontier = vec![root_pid];
    let mut visited: std::collections::HashSet<u32> = frontier.iter().copied().collect();

    while !frontier.is_empty() {
        let mut next = Vec::new();
        for entry in entries {
            if frontier.contains(&entry.ppid) && visited.insert(entry.pid) {
                result.push(entry);
                next.push(entry.pid);
            }
        }
        frontier = next;
    }
    result
}

fn is_dev_server(e: &PsEntry) -> bool {
    e.command.contains("next-server") || (e.command.contains("node") && e.command.contains(".next"))
}

fn command_basename(command: &str) -> String {
    let first = command.split_whitespace().next().unwrap_or(command);
    first.rsplit('/').next().unwrap_or(first).to_string()
}

/// The UI keys rows by label — collisions get a pid suffix.
fn dedupe_labels(result: &mut [SystemProcessEntry]) {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for entry in result.iter_mut() {
        if !seen.insert(entry.label.clone()) {
            entry.label = format!("{} (pid {})", entry.label, entry.pid);
            seen.insert(entry.label.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(pid: u32, ppid: u32, rss_kb: u64, command: &str) -> PsEntry {
        PsEntry {
            pid,
            ppid,
            rss_kb,
            command: command.to_string(),
        }
    }

    fn labels(report: &[SystemProcessEntry]) -> Vec<&str> {
        report.iter().map(|e| e.label.as_str()).collect()
    }

    fn find<'a>(report: &'a [SystemProcessEntry], label: &str) -> &'a SystemProcessEntry {
        report
            .iter()
            .find(|e| e.label == label)
            .unwrap_or_else(|| panic!("no entry labeled {label:?} in {:?}", labels(report)))
    }

    #[test]
    fn labels_own_process_as_tauri() {
        let entries = vec![entry(100, 1, 150_000, "/Applications/AuricIDE.app/auric")];
        let report = build_memory_report(100, &entries, &[]);
        let own = find(&report, "Tauri (Rust)");
        assert_eq!(own.pid, 100);
        assert_eq!(own.rss_bytes, 150_000 * 1024);
    }

    #[test]
    fn itemizes_each_direct_child_with_its_subtree_summed() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            // child A: a node process with a grandchild
            entry(200, 100, 500_000, "/usr/local/bin/node something"),
            entry(201, 200, 250_000, "/usr/local/bin/node worker"),
            // child B: a shell
            entry(300, 100, 8_000, "/bin/zsh"),
        ];
        let report = build_memory_report(100, &entries, &[]);

        let node = find(&report, "node");
        assert_eq!(node.pid, 200);
        assert_eq!(node.rss_bytes, (500_000 + 250_000) * 1024);

        let shell = find(&report, "zsh");
        assert_eq!(shell.pid, 300);
        assert_eq!(shell.rss_bytes, 8_000 * 1024);
    }

    #[test]
    fn labels_known_agent_pid_with_its_label_even_when_nested() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            // agent spawned through a wrapper shell: the known pid is the
            // grandchild, but the whole subtree belongs to the agent
            entry(200, 100, 4_000, "/bin/zsh -c claude"),
            entry(201, 200, 1_800_000, "claude --agent"),
            entry(202, 201, 90_000, "node subagent"),
        ];
        let known = vec![KnownProcess {
            pid: 201,
            label: "Agent: Writer".to_string(),
        }];
        let report = build_memory_report(100, &entries, &known);

        let agent = find(&report, "Agent: Writer");
        assert_eq!(agent.rss_bytes, (4_000 + 1_800_000 + 90_000) * 1024);
    }

    #[test]
    fn labels_mcp_server_by_command() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            entry(200, 100, 40_000, "npm exec tsx /repo/src/mcp/server.ts /db"),
            entry(201, 200, 60_000, "node /repo/node_modules/tsx/cli.mjs"),
        ];
        let report = build_memory_report(100, &entries, &[]);
        let mcp = find(&report, "MCP Server");
        assert_eq!(mcp.rss_bytes, (40_000 + 60_000) * 1024);
    }

    #[test]
    fn dedupes_duplicate_labels_by_appending_pid() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            entry(200, 100, 5_000, "/bin/zsh"),
            entry(300, 100, 6_000, "/bin/zsh"),
        ];
        let report = build_memory_report(100, &entries, &[]);
        let all = labels(&report);
        assert!(
            all.contains(&"zsh"),
            "first shell keeps plain label: {all:?}"
        );
        assert!(
            all.contains(&"zsh (pid 300)"),
            "second shell gets pid suffix: {all:?}"
        );
    }

    #[test]
    fn sums_dev_server_processes_and_marks_them_dev_only() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            entry(900, 1, 3_000_000, "next-server (v16.0.0)"),
            entry(901, 900, 500_000, "node /repo/.next/turbopack-worker"),
        ];
        let report = build_memory_report(100, &entries, &[]);
        let dev = find(&report, "Next.js Dev Server (dev-only)");
        assert_eq!(dev.rss_bytes, (3_000_000 + 500_000) * 1024);
    }

    #[test]
    fn does_not_double_count_dev_server_processes_that_are_descendants() {
        // Hypothetical: dev server started BY the app — must appear once,
        // under its child entry, not again as dev server.
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            entry(200, 100, 3_000_000, "next-server (v16.0.0)"),
        ];
        let report = build_memory_report(100, &entries, &[]);
        let dev_rows: Vec<_> = report
            .iter()
            .filter(|e| e.rss_bytes == 3_000_000 * 1024)
            .collect();
        assert_eq!(dev_rows.len(), 1, "{:?}", labels(&report));
    }

    #[test]
    fn estimates_webview_from_systemwide_webcontent_processes() {
        let entries = vec![
            entry(100, 1, 1000, "auric"),
            entry(500, 1, 110_000, "/System/.../com.apple.WebKit.WebContent"),
            entry(501, 1, 90_000, "/System/.../com.apple.WebKit.WebContent"),
        ];
        let report = build_memory_report(100, &entries, &[]);
        let webview = find(&report, "WebView (est., system-wide)");
        assert_eq!(webview.rss_bytes, (110_000 + 90_000) * 1024);
    }

    #[test]
    fn omits_webview_entry_when_no_webcontent_processes_exist() {
        let entries = vec![entry(100, 1, 1000, "auric")];
        let report = build_memory_report(100, &entries, &[]);
        assert!(
            !labels(&report).iter().any(|l| l.starts_with("WebView")),
            "{:?}",
            labels(&report)
        );
    }

    #[test]
    fn own_process_missing_from_ps_still_reports_children() {
        let entries = vec![entry(200, 100, 5_000, "/bin/zsh")];
        let report = build_memory_report(100, &entries, &[]);
        assert_eq!(labels(&report), vec!["zsh"]);
    }
}
