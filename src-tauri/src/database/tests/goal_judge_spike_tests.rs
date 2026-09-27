//! Spike (sub-goal 01, station 4): can Codex run headless as a goal judge?
//!
//! Every test here is `#[ignore]`d: it starts the real `codex` CLI, which costs
//! money and needs a login. Run it on purpose:
//!
//! ```bash
//! AURIC_SPIKE_CODEX_PROVIDER=/path/to/dynamic-providers/codex.json \
//!   cargo test goal_judge_spike -- --ignored --nocapture --test-threads=1
//! ```
//!
//! What it holds the judge to is the same launch the conductor's review agent
//! gets from `spawn_agent_impl`: the provider's own spawn command with
//! `headless: true`, the Codex MCP project binding, the reserved `AURIC_*`
//! variables, run under `/bin/zsh -c` inside a PTY with the project as cwd.
//! Only the `AppHandle` parts (usage sidecar, private MCP config files, the
//! notifications database) are left out; Codex does not read the config files,
//! its binding travels as `-c` overrides.
//!
//! The prompt names the goal by id and nothing else. Which stations exist, and
//! which one is still open, is only in the project database, so a correct
//! verdict is evidence that the judge read the goal through the Auric MCP
//! server rather than guessing.

use super::*;
use crate::agents::manager::binding_injection_for;
use crate::agents::project_binding::resolve_project_binding;
use crate::database::*;
use crate::providers::{
    project_binding_material, AgentProvider, DynamicProvider, ProviderConfig, SpawnInjection,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

const VERDICT_MARKER: &str = "AURIC_GOAL_VERDICT";
const JUDGE_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, serde::Deserialize)]
struct GoalVerdict {
    pass: bool,
    reason: String,
}

fn goal_judge_prompt(goal_id: &str) -> String {
    format!(
        "You are an independent goal judge. Use the auric-pm MCP tools get_goal and \
         list_stations to inspect the goal with id {goal_id}. Do not change anything. \
         The goal is achieved only if every one of its stations has status done. \
         If a station is not done, name it in your reason. End your answer with one \
         line that starts with {VERDICT_MARKER} followed by a single-line JSON object \
         with the keys pass (boolean) and reason (string)."
    )
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

/// The last marker line that carries a valid verdict. The prompt itself names
/// the marker too, and Codex echoes the prompt, so earlier hits are skipped.
fn extract_verdict(output: &str) -> Option<GoalVerdict> {
    strip_ansi(output).lines().rev().find_map(|line| {
        let (_, rest) = line.split_once(VERDICT_MARKER)?;
        let json = rest.trim_start_matches([':', ' ']).trim();
        serde_json::from_str::<GoalVerdict>(json).ok()
    })
}

#[test]
fn extract_verdict_takes_the_last_parseable_marker_line() {
    let output = "user\nEnd with a line that starts with AURIC_GOAL_VERDICT followed by JSON\n\
                  \u{1b}[1mcodex\u{1b}[0m\nAURIC_GOAL_VERDICT {\"pass\":false,\"reason\":\"x open\"}\n";
    let verdict = extract_verdict(output).expect("verdict");
    assert!(!verdict.pass);
    assert_eq!(verdict.reason, "x open");
    assert!(extract_verdict("AURIC_GOAL_VERDICT not json").is_none());
}

fn seed_project(root: &Path) {
    let conn = init_db(root.to_str().unwrap()).unwrap();
    let mut done_goal = make_test_goal("goal-done", None);
    done_goal.name = "Release notes published".to_string();
    done_goal.status = "active".to_string();
    let mut open_goal = make_test_goal("goal-open", None);
    open_goal.name = "Onboarding flow shipped".to_string();
    open_goal.status = "active".to_string();

    let station = |id: &str, goal: &str, order: i32, name: &str, done: bool| {
        let mut s = make_test_station(id, goal, order);
        s.name = name.to_string();
        if done {
            s.status = "done".to_string();
            s.evidence_kind = "file_exists".to_string();
            s.evidence_note = "verified by predicate".to_string();
            s.done_at = Some("2026-09-27 01:00:00".to_string());
        }
        s
    };
    let mut payload = sync_payload(vec![done_goal, open_goal], vec![], vec![]);
    payload.stations = vec![
        station("d1", "goal-done", 0, "Draft written", true),
        station("d2", "goal-done", 1, "Notes posted", true),
        station("o1", "goal-open", 0, "Screens designed", true),
        station("o2", "goal-open", 1, "Station KOBALT-7 wired", false),
    ];
    goals_sync_impl(&conn, &payload).unwrap();
    // The test's writer must not hold the WAL while the MCP server reads.
    drop(conn);

    // `codex exec` refuses to start outside a git repository (see the spike
    // write-up); a project the IDE opens normally is one.
    let status = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success());
}

/// The one thing the spike adds to the production launch. `codex exec` runs
/// with `approval: never`, and every MCP tool call needs an approval unless
/// the config pre-approves it, so without this the judge cannot read the goal
/// at all (first spike run: both calls "failed", verdict pass=false). Only
/// the two read tools are approved, per tool, not the whole server.
fn judge_tool_approvals() -> SpawnInjection {
    let arguments = ["get_goal", "list_stations"]
        .iter()
        .flat_map(|tool| {
            [
                "-c".to_string(),
                format!("'mcp_servers.auric-pm.tools.{tool}.approval_mode=\"approve\"'"),
            ]
        })
        .collect();
    SpawnInjection {
        arguments,
        env_vars: Vec::new(),
    }
}

/// The command `spawn_agent_impl` would run for a headless, read-only Codex
/// review agent bound to `root`, plus the environment it would set.
fn judge_command(root: &Path, goal_id: &str) -> (String, Vec<(String, String)>) {
    let provider_path = std::env::var("AURIC_SPIKE_CODEX_PROVIDER")
        .expect("set AURIC_SPIKE_CODEX_PROVIDER to your dynamic-providers/codex.json");
    let config: ProviderConfig =
        serde_json::from_str(&std::fs::read_to_string(provider_path).unwrap()).unwrap();
    let provider = DynamicProvider::new(config);

    let spawn = provider.build_spawn_command(
        "auto",
        &goal_judge_prompt(goal_id),
        Some("plan"),
        false,
        false,
        true,
    );
    let binding = resolve_project_binding(Some(root.to_str().unwrap()))
        .unwrap()
        .unwrap();
    let runtime = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/auric-mcp/server.mjs");
    assert!(runtime.is_file(), "run `pnpm mcp:bundle` first");
    let provider_binding = binding
        .provider_binding()
        .with_runtime_entrypoint(runtime.to_string_lossy().into_owned());
    let injection = binding_injection_for(
        "codex",
        project_binding_material("codex", &provider, &provider_binding).unwrap(),
        provider.allows_unbound_mcp(),
    )
    .unwrap();
    let spawn = spawn
        .with_injection(injection)
        .with_injection(judge_tool_approvals())
        .with_injection(SpawnInjection {
            arguments: Vec::new(),
            env_vars: binding.environment(),
        });
    (spawn.command, spawn.env_vars)
}

/// Runs the command the way the agent manager does: `/bin/zsh -c` in a PTY.
fn run_in_pty(root: &Path, command: &str, env: &[(String, String)]) -> (String, Duration) {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.arg("-c");
    cmd.arg(command);
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.cwd(root);

    let started = Instant::now();
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let pump = std::thread::spawn(move || {
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        out
    });
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if started.elapsed() > JUDGE_TIMEOUT {
            child.kill().ok();
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let elapsed = started.elapsed();
    drop(pair.master);
    let bytes = pump.join().unwrap();
    (String::from_utf8_lossy(&bytes).into_owned(), elapsed)
}

fn judge(root: &Path, goal_id: &str) -> GoalVerdict {
    let (command, env) = judge_command(root, goal_id);
    let (output, elapsed) = run_in_pty(root, &command, &env);
    let log = std::env::temp_dir().join(format!("auric-goal-judge-{goal_id}.log"));
    std::fs::write(&log, &output).unwrap();
    println!(
        "goal {goal_id}: {:.1}s, {} bytes of output, log {}",
        elapsed.as_secs_f64(),
        output.len(),
        log.display()
    );
    let verdict = extract_verdict(&output)
        .unwrap_or_else(|| panic!("no verdict for {goal_id}; see {}", log.display()));
    println!(
        "goal {goal_id}: pass={} reason={}",
        verdict.pass, verdict.reason
    );
    let used_mcp = strip_ansi(&output).contains("auric-pm");
    assert!(
        used_mcp,
        "judge for {goal_id} never called the auric-pm server"
    );
    verdict
}

#[test]
#[ignore = "starts the real codex CLI; needs AURIC_SPIKE_CODEX_PROVIDER"]
fn goal_judge_spike_codex_passes_a_finished_goal_and_rejects_an_open_one() {
    let dir = tempfile::tempdir().unwrap();
    seed_project(dir.path());

    let done = judge(dir.path(), "goal-done");
    assert!(done.pass, "finished goal rejected: {}", done.reason);

    let open = judge(dir.path(), "goal-open");
    assert!(!open.pass, "open goal approved: {}", open.reason);
    assert!(
        open.reason.contains("KOBALT-7"),
        "reason does not name the open station: {}",
        open.reason
    );
}
