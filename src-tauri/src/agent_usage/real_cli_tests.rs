//! Runs the real CLIs, costs real money, and is `#[ignore]`d.
//!
//! The parsers are otherwise tested against captures of these CLIs, which
//! proves they read what the CLI *was* printing. These check that it still is:
//!
//! ```text
//! cargo test agent_usage_real_cli -- --ignored --nocapture
//! ```

use std::path::PathBuf;
use std::process::Command;

use chrono::{Local, Utc};
use uuid::Uuid;

use super::claude::{find_session_files, parse_result, session_tokens};
use super::codex::{
    extract_session_id, find_rollout_by_session, find_rollout_heuristic, parse_rollout,
    RolloutClaims,
};
use crate::cc_usage::manifest::{UsagePlugin, BUILT_IN_CLAUDE_CODE};
use crate::cc_usage::pricing::{price_bundle, TokenCounts};

const PROMPT: &str = "Reply with the single word hello and nothing else.";
/// How far the transcript price may sit from the CLI's own figure.
const ALLOWED_DEVIATION: f64 = 0.02;
const TRANSCRIPT_FLUSH_ATTEMPTS: u32 = 20;

fn home() -> PathBuf {
    dirs::home_dir().expect("a home directory")
}

fn workdir() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temp dir")
}

#[test]
#[ignore = "runs the real claude CLI and spends a few cents"]
fn agent_usage_real_cli_claude_result_and_transcript_agree() {
    let cwd = workdir();
    let session = Uuid::new_v4().to_string();

    let output = Command::new("claude")
        .args(["-p", PROMPT, "--model", "haiku", "--output-format", "json"])
        .args(["--session-id", &session])
        .current_dir(cwd.path())
        .output()
        .expect("claude is installed");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = stdout
        .lines()
        .rev()
        .find_map(parse_result)
        .unwrap_or_else(|| panic!("no result object in: {stdout}"));

    let mut files = Vec::new();
    for _ in 0..TRANSCRIPT_FLUSH_ATTEMPTS {
        files = find_session_files(&home().join(".claude/projects"), &session);
        if !files.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    assert!(!files.is_empty(), "no transcript for session {session}");

    let plugin: UsagePlugin = serde_json::from_str(BUILT_IN_CLAUDE_CODE).unwrap();
    let day = Utc::now().format("%Y-%m-%d").to_string();
    let by_model = session_tokens(&files, 0);
    let mut transcript = TokenCounts::default();
    let mut estimate = 0.0;
    for (model, counts) in &by_model {
        transcript += *counts;
        estimate += price_bundle(&plugin, model, &day, counts)
            .unwrap_or_else(|| panic!("{model} is not on the price list"));
    }

    let cli = result.total_counts();
    let cli_cost = result.cost_usd().expect("the CLI reports a cost");
    println!("cli {cli:?} ${cli_cost}\ntranscript {transcript:?} ${estimate}");
    assert_eq!(result.session_id.as_deref(), Some(session.as_str()));
    assert_eq!(transcript.output, cli.output, "output tokens");
    assert_eq!(transcript.input, cli.input, "input tokens");
    assert_eq!(transcript.cache_read, cli.cache_read, "cache read tokens");
    assert_eq!(
        transcript.cache_write5m + transcript.cache_write1h,
        cli.cache_write5m,
        "cache write tokens"
    );
    let deviation = (estimate - cli_cost).abs() / cli_cost;
    assert!(
        deviation <= ALLOWED_DEVIATION,
        "cost off by {:.2} %",
        deviation * 100.0
    );
}

#[test]
#[ignore = "runs the real codex CLI and spends a few cents"]
fn agent_usage_real_cli_codex_rollout_is_found_and_parsed() {
    let cwd = workdir();
    let spawned_at = Utc::now();
    let start_day = Local::now().date_naive();

    let output = Command::new("codex")
        .args([
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            PROMPT,
        ])
        .current_dir(cwd.path())
        .output()
        .expect("codex is installed");
    let printed = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let session = extract_session_id(&printed)
        .unwrap_or_else(|| panic!("no `session id:` header in: {printed}"));

    let root = home().join(".codex/sessions");
    let path = find_rollout_by_session(&root, &session, start_day)
        .unwrap_or_else(|| panic!("no rollout for {session}"));
    let usage = parse_rollout(&std::fs::read_to_string(&path).unwrap()).expect("token counts");

    let model = usage.model.clone().expect("a model in turn_context");
    let plugin: UsagePlugin = serde_json::from_str(super::CODEX_PRICING).unwrap();
    let day = spawned_at.format("%Y-%m-%d").to_string();
    let cost = price_bundle(&plugin, &model, &day, &usage.tokens.to_counts());
    println!("{model}: {:?} -> ${cost:?}", usage.tokens);
    assert!(usage.tokens.input_tokens > 0 && usage.tokens.output_tokens > 0);
    assert!(cost.is_some(), "{model} is not on the Codex price list");

    // What an interactive session would rely on, checked against the same file.
    let cwd_text = cwd.path().to_string_lossy().into_owned();
    assert_eq!(
        find_rollout_heuristic(
            &root,
            &cwd_text,
            spawned_at,
            start_day,
            &RolloutClaims::default()
        ),
        Some(path)
    );
}

// ---------------------------------------------------------------------------
// Benchmark: how far is our transcript price from the CLI's own figure?
// ---------------------------------------------------------------------------

const BENCH_N_ENV: &str = "AURIC_USAGE_BENCH_N";
const BENCH_DEFAULT_RUNS: usize = 6;
const BENCH_MAX_DEVIATION_PCT: f64 = 2.0;
const NOTE_FILE: &str = "note.txt";

/// Tiny tasks of different shapes; run `n` of them, cycling through the list.
const BENCH_TASKS: [(&str, &str); 6] = [
    ("plain answer", PROMPT),
    (
        "one Read",
        "Use the Read tool to read note.txt, then answer with its content in one word.",
    ),
    (
        "one Bash",
        "Use the Bash tool to run `echo hi`, then answer with the output in one word.",
    ),
    (
        "one subagent",
        "Use the Agent tool once to spawn a subagent that reads note.txt and reports its \
         content. Then answer with that content in one word.",
    ),
    (
        "two subagents",
        "Use the Agent tool to spawn a subagent that reads note.txt and reports its content. \
         When it is done, use the Agent tool again to spawn a second subagent that reports \
         the length of that content. Then answer with both in one short line.",
    ),
    (
        "multi-turn",
        "Write the text 'alpha' to out.txt with the Write tool, read it back with the Read \
         tool, append the text ' beta' with the Edit tool, read it again, then answer with \
         the final content.",
    ),
];

struct BenchRow {
    label: &'static str,
    cli_cost: f64,
    estimate_cost: f64,
    /// Names of the token classes that differ, with cli vs transcript.
    differing: Vec<String>,
}

impl BenchRow {
    fn deviation_pct(&self) -> f64 {
        (self.estimate_cost - self.cli_cost).abs() / self.cli_cost * 100.0
    }
}

fn differing_classes(cli: &TokenCounts, transcript: &TokenCounts) -> Vec<String> {
    let cli_write = cli.cache_write5m + cli.cache_write1h;
    let transcript_write = transcript.cache_write5m + transcript.cache_write1h;
    [
        ("input", cli.input, transcript.input),
        ("output", cli.output, transcript.output),
        ("cache_read", cli.cache_read, transcript.cache_read),
        ("cache_write", cli_write, transcript_write),
    ]
    .into_iter()
    .filter(|(_, cli, transcript)| cli != transcript)
    .map(|(name, cli, transcript)| format!("{name} {cli}/{transcript}"))
    .collect()
}

fn bench_one(label: &'static str, prompt: &str, plugin: &UsagePlugin) -> BenchRow {
    let cwd = workdir();
    std::fs::write(cwd.path().join(NOTE_FILE), "hello").expect("write the note");
    let session = Uuid::new_v4().to_string();

    let output = Command::new("claude")
        .args(["-p", prompt, "--model", "haiku", "--output-format", "json"])
        .args(["--session-id", &session])
        .args(["--permission-mode", "bypassPermissions"])
        .current_dir(cwd.path())
        .output()
        .expect("claude is installed");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = stdout
        .lines()
        .rev()
        .find_map(parse_result)
        .unwrap_or_else(|| panic!("{label}: no result object in: {stdout}"));

    let mut files = Vec::new();
    for _ in 0..TRANSCRIPT_FLUSH_ATTEMPTS {
        files = find_session_files(&home().join(".claude/projects"), &session);
        if !files.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    assert!(!files.is_empty(), "{label}: no transcript for {session}");

    let day = Utc::now().format("%Y-%m-%d").to_string();
    let mut transcript = TokenCounts::default();
    let mut estimate_cost = 0.0;
    for (model, counts) in &session_tokens(&files, 0) {
        transcript += *counts;
        estimate_cost += price_bundle(plugin, model, &day, counts)
            .unwrap_or_else(|| panic!("{label}: {model} is not on the price list"));
    }
    BenchRow {
        label,
        cli_cost: result.cost_usd().expect("the CLI reports a cost"),
        estimate_cost,
        differing: differing_classes(&result.total_counts(), &transcript),
    }
}

fn median(sorted: &[f64]) -> f64 {
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

#[test]
#[ignore = "runs N real claude tasks (AURIC_USAGE_BENCH_N, default 6) and spends a few cents each"]
fn agent_usage_bench() {
    let runs: usize = std::env::var(BENCH_N_ENV)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(BENCH_DEFAULT_RUNS);
    let plugin: UsagePlugin = serde_json::from_str(BUILT_IN_CLAUDE_CODE).unwrap();

    let rows: Vec<BenchRow> = (0..runs)
        .map(|index| {
            let (label, prompt) = BENCH_TASKS[index % BENCH_TASKS.len()];
            bench_one(label, prompt, &plugin)
        })
        .collect();

    println!(
        "{:<16} {:>10} {:>10} {:>8}  differing token classes (cli/transcript)",
        "task", "cli $", "est $", "dev %"
    );
    for row in &rows {
        println!(
            "{:<16} {:>10.6} {:>10.6} {:>8.3}  {}",
            row.label,
            row.cli_cost,
            row.estimate_cost,
            row.deviation_pct(),
            if row.differing.is_empty() {
                "-".to_string()
            } else {
                row.differing.join(", ")
            }
        );
    }
    let mut deviations: Vec<f64> = rows.iter().map(BenchRow::deviation_pct).collect();
    deviations.sort_by(f64::total_cmp);
    let mean = deviations.iter().sum::<f64>() / deviations.len() as f64;
    let max = deviations.last().copied().unwrap_or(0.0);
    println!(
        "mean {mean:.3} %  median {:.3} %  max {max:.3} %  (n={})",
        median(&deviations),
        rows.len()
    );

    assert!(
        max < BENCH_MAX_DEVIATION_PCT,
        "max deviation {max:.3} % >= {BENCH_MAX_DEVIATION_PCT} %"
    );
}
