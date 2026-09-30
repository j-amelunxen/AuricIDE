//! Claude Code: the result object `-p --output-format json` prints, and the
//! session transcripts the CLI writes next to it.
//!
//! The two are read for different reasons. The result object is the CLI's own
//! accounting and is what a headless run is billed by in our books. The
//! transcript is the API's own token counts, priced by us: the only source for
//! an interactive run, and the benchmark for a headless one.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::cc_usage::pricing::TokenCounts;
use crate::cc_usage::scan::{deduplicate, turns_in_file};

/// What one model consumed, as the CLI counts it.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelTokens {
    pub counts: TokenCounts,
    pub cost_usd: Option<f64>,
}

/// The parts of the CLI's result object a usage row needs.
#[derive(Debug, Clone, PartialEq)]
pub struct CliResult {
    pub session_id: Option<String>,
    pub answer: String,
    pub is_error: bool,
    pub num_turns: Option<u64>,
    pub total_cost_usd: Option<f64>,
    /// Keyed by full model id. The whole session, subagents included.
    pub models: BTreeMap<String, ModelTokens>,
    /// `modelUsage` exactly as the CLI wrote it, kept for the row's breakdown.
    pub model_usage_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawResult {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    num_turns: Option<u64>,
    #[serde(default)]
    total_cost_usd: Option<f64>,
    #[serde(rename = "modelUsage", default)]
    model_usage: BTreeMap<String, RawModelUsage>,
}

#[derive(Debug, Deserialize)]
struct RawModelUsage {
    #[serde(rename = "inputTokens", default)]
    input: u64,
    #[serde(rename = "outputTokens", default)]
    output: u64,
    #[serde(rename = "cacheReadInputTokens", default)]
    cache_read: u64,
    #[serde(rename = "cacheCreationInputTokens", default)]
    cache_write: u64,
    #[serde(rename = "thinkingTokens", default)]
    thinking: u64,
    #[serde(rename = "costUSD", default)]
    cost_usd: Option<f64>,
}

/// Reads one stdout line as the CLI's result object; `None` for anything else.
///
/// The top-level `usage` object is deliberately not read: it describes the
/// last API call only. `modelUsage` is the whole session.
pub fn parse_result(line: &str) -> Option<CliResult> {
    let raw: RawResult = serde_json::from_str(line.trim()).ok()?;
    if raw.kind != "result" {
        return None;
    }
    let model_usage_json = serde_json::from_str::<serde_json::Value>(line.trim())
        .ok()
        .and_then(|value| value.get("modelUsage").cloned())
        .and_then(|usage| serde_json::to_string(&usage).ok());
    let models = raw
        .model_usage
        .into_iter()
        .map(|(model, usage)| {
            let counts = TokenCounts {
                input: usage.input,
                output: usage.output,
                cache_read: usage.cache_read,
                // The CLI does not split cache writes by TTL, and its own
                // cost already accounts for the split, so the total is enough.
                cache_write5m: usage.cache_write,
                thinking: usage.thinking,
                ..Default::default()
            };
            (
                model,
                ModelTokens {
                    counts,
                    cost_usd: usage.cost_usd,
                },
            )
        })
        .collect();
    Some(CliResult {
        session_id: raw.session_id,
        answer: raw.result.unwrap_or_default(),
        is_error: raw.is_error,
        num_turns: raw.num_turns,
        total_cost_usd: raw.total_cost_usd,
        models,
        model_usage_json,
    })
}

impl CliResult {
    pub fn total_counts(&self) -> TokenCounts {
        let mut total = TokenCounts::default();
        for model in self.models.values() {
            total += model.counts;
        }
        total
    }

    /// The CLI's `total_cost_usd`, or the sum of its per-model costs when the
    /// total is absent.
    pub fn cost_usd(&self) -> Option<f64> {
        self.total_cost_usd.or_else(|| {
            let costs: Vec<f64> = self.models.values().filter_map(|m| m.cost_usd).collect();
            (!costs.is_empty()).then(|| costs.iter().sum())
        })
    }
}

/// The transcript files of one session: the main file, then every subagent's.
///
/// Searched for by session id under `projects_root` rather than derived from
/// the cwd, because the directory name is the cwd with `/` and `.` mangled and
/// rebuilding that by hand is a way to be wrong. The id is ours (a UUID we
/// passed with `--session-id`); anything that is not shaped like one is
/// refused so a hostile value cannot walk out of the directory.
pub fn find_session_files(projects_root: &Path, session_id: &str) -> Vec<PathBuf> {
    if !is_uuid(session_id) {
        return Vec::new();
    }
    let Ok(project_dirs) = fs::read_dir(projects_root) else {
        return Vec::new();
    };
    for project_dir in project_dirs.flatten().map(|entry| entry.path()) {
        let main = project_dir.join(format!("{session_id}.jsonl"));
        if !main.is_file() {
            continue;
        }
        let mut files = vec![main];
        files.extend(subagent_files(
            &project_dir.join(session_id).join("subagents"),
        ));
        return files;
    }
    Vec::new()
}

fn subagent_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| name.starts_with("agent-"))
        })
        .collect();
    files.sort();
    files
}

pub(super) fn is_uuid(candidate: &str) -> bool {
    let groups: Vec<&str> = candidate.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(group, len)| group.len() == len && group.chars().all(|c| c.is_ascii_hexdigit()))
}

/// What each model consumed over all of `files` from `since` (unix seconds)
/// on, one API message counted once. A run owns only the turns after its own
/// start, so a session that was ever continued is not counted twice.
pub fn session_tokens(files: &[PathBuf], since: i64) -> BTreeMap<String, TokenCounts> {
    session_tokens_between(files, since, i64::MAX)
}

/// Like [`session_tokens`], but only turns up to `until` (Unix seconds,
/// inclusive). Reading a finished run again later needs the upper bound: a
/// session resumed after the run appends turns that were never part of it.
pub fn session_tokens_between(
    files: &[PathBuf],
    since: i64,
    until: i64,
) -> BTreeMap<String, TokenCounts> {
    let turns: Vec<_> = files
        .iter()
        .flat_map(|path| turns_in_file(path, since))
        .filter(|turn| turn.at <= until)
        .collect();
    let (turns, _) = deduplicate(turns);
    let mut by_model: BTreeMap<String, TokenCounts> = BTreeMap::new();
    for turn in turns {
        *by_model.entry(turn.model).or_default() += turn.counts;
    }
    by_model
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESULT: &str = include_str!("fixtures/claude-result.json");
    const TRANSCRIPT: &str = include_str!("fixtures/claude-transcript.jsonl");
    const SUBAGENT: &str = include_str!("fixtures/claude-subagent.jsonl");
    const SESSION: &str = "9c5f6f43-fd2c-469e-868d-0f2918f324f3";
    const HAIKU: &str = "claude-haiku-4-5-20251001";

    fn lay_out_session(root: &Path) {
        let project = root.join("-Users-dev-project");
        let subagents = project.join(SESSION).join("subagents");
        fs::create_dir_all(&subagents).unwrap();
        fs::write(project.join(format!("{SESSION}.jsonl")), TRANSCRIPT).unwrap();
        fs::write(subagents.join("agent-a1.jsonl"), SUBAGENT).unwrap();
        fs::write(subagents.join("agent-a1.meta.json"), "{}").unwrap();
    }

    #[test]
    fn the_captured_result_is_read_from_model_usage_not_from_the_last_call() {
        let result = parse_result(RESULT).expect("a result object");

        let total = result.total_counts();
        assert_eq!(total.input, 46, "the top-level usage says 10");
        assert_eq!(total.output, 1007);
        assert_eq!(total.cache_read, 121_339);
        assert_eq!(total.cache_write5m, 65_165);
        assert_eq!(total.thinking, 698);
        assert_eq!(result.cost_usd(), Some(0.12199465));
        assert_eq!(result.session_id.as_deref(), Some(SESSION));
        assert_eq!(result.answer, "hello");
        assert_eq!(result.num_turns, Some(1));
        assert!(!result.is_error);
        assert!(result.models.contains_key(HAIKU));
        assert!(result
            .model_usage_json
            .as_deref()
            .is_some_and(|json| json.contains("costBasis")));
    }

    #[test]
    fn several_models_are_summed() {
        let line = r#"{"type":"result","modelUsage":{
            "a":{"inputTokens":1,"outputTokens":2,"cacheReadInputTokens":3,"cacheCreationInputTokens":4,"costUSD":0.5},
            "b":{"inputTokens":10,"outputTokens":20,"cacheReadInputTokens":30,"cacheCreationInputTokens":40,"costUSD":0.25}}}"#;

        let result = parse_result(line).expect("a result object");

        assert_eq!(result.total_counts().output, 22);
        assert_eq!(result.total_counts().cache_write5m, 44);
        assert_eq!(
            result.cost_usd(),
            Some(0.75),
            "summed when there is no total"
        );
    }

    #[test]
    fn an_error_result_without_usage_is_still_a_result() {
        let result =
            parse_result(r#"{"type":"result","is_error":true,"result":"boom"}"#).expect("result");
        assert!(result.is_error);
        assert_eq!(result.total_counts(), TokenCounts::default());
        assert_eq!(result.cost_usd(), None);
    }

    #[test]
    fn anything_that_is_not_a_result_object_is_not_read() {
        assert!(parse_result("plain prose").is_none());
        assert!(parse_result(r#"{"type":"assistant"}"#).is_none());
        assert!(parse_result(r#"{"type":"result""#).is_none());
    }

    #[test]
    fn a_session_is_found_with_its_subagents_by_id_alone() {
        let root = tempfile::tempdir().unwrap();
        lay_out_session(root.path());

        let files = find_session_files(root.path(), SESSION);

        let names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, [format!("{SESSION}.jsonl"), "agent-a1.jsonl".into()]);
    }

    #[test]
    fn an_unknown_session_finds_nothing() {
        let root = tempfile::tempdir().unwrap();
        lay_out_session(root.path());
        let other = "11111111-2222-3333-4444-555555555555";
        assert!(find_session_files(root.path(), other).is_empty());
        assert!(find_session_files(&root.path().join("missing"), SESSION).is_empty());
    }

    #[test]
    fn an_id_that_is_not_a_uuid_is_refused_before_it_touches_a_path() {
        let root = tempfile::tempdir().unwrap();
        lay_out_session(root.path());
        assert!(find_session_files(root.path(), "../../etc/passwd").is_empty());
        assert!(find_session_files(root.path(), "").is_empty());
    }

    #[test]
    fn the_transcript_adds_up_to_what_the_cli_reported() {
        let root = tempfile::tempdir().unwrap();
        lay_out_session(root.path());

        let by_model = session_tokens(&find_session_files(root.path(), SESSION), 0);

        assert_eq!(by_model.len(), 1);
        let counts = by_model[HAIKU];
        assert_eq!(counts.input, 46);
        assert_eq!(counts.output, 1007);
        assert_eq!(counts.cache_read, 121_339);
        assert_eq!(counts.cache_write5m, 34_067);
        assert_eq!(counts.cache_write1h, 31_098);
    }

    #[test]
    fn without_the_subagent_files_their_tokens_are_missing() {
        let root = tempfile::tempdir().unwrap();
        lay_out_session(root.path());
        let main_only = &find_session_files(root.path(), SESSION)[..1];

        let counts = session_tokens(main_only, 0)[HAIKU];

        assert_eq!(counts.output, 558);
    }
}
