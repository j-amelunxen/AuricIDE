//! Codex: the rollout file each session writes, and how to find the one that
//! belongs to an agent we started.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Deserialize;

use super::claude::is_uuid;
use crate::cc_usage::pricing::TokenCounts;

/// How long after the spawn a session may announce itself and still be ours.
const HEURISTIC_WINDOW_AFTER_SPAWN: Duration = Duration::seconds(60);
/// The spawn time is taken just after the process starts, so a session can be
/// stamped a moment before it. Kept small: agents started a few seconds apart
/// in one directory must not take each other's rollout.
const HEURISTIC_WINDOW_BEFORE_SPAWN: Duration = Duration::seconds(1);

const SESSION_ID_MARKER: &str = "session id: ";
const UUID_LEN: usize = 36;
/// Enough of the previous chunk to finish a marker + uuid cut in two.
const SNIFFER_CARRY: usize = SESSION_ID_MARKER.len() + UUID_LEN;
/// The header comes first. An interactive session that never prints one would
/// otherwise be scanned for as long as it runs.
const SNIFFER_GIVES_UP_AFTER_BYTES: usize = 16 * 1024;

/// The counters of `token_count.info.total_token_usage`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct CodexTokens {
    #[serde(default)]
    pub input_tokens: u64,
    /// A subset of `input_tokens` (OpenAI semantics).
    #[serde(default)]
    pub cached_input_tokens: u64,
    #[serde(default)]
    pub cache_write_input_tokens: u64,
    /// Includes the reasoning tokens.
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub reasoning_output_tokens: u64,
}

impl CodexTokens {
    /// Uncached input is what is left of `input_tokens` after the cached part;
    /// cache writes are taken out of it too, because `total_tokens` is
    /// input + output and so counts every prompt token exactly once.
    pub fn to_counts(self) -> TokenCounts {
        let plain = self
            .input_tokens
            .saturating_sub(self.cached_input_tokens)
            .saturating_sub(self.cache_write_input_tokens);
        TokenCounts {
            input: plain,
            output: self.output_tokens,
            cache_read: self.cached_input_tokens,
            cache_write5m: self.cache_write_input_tokens,
            thinking: self.reasoning_output_tokens,
            ..Default::default()
        }
    }
}

/// What a finished session's rollout says.
#[derive(Debug, Clone, PartialEq)]
pub struct RolloutUsage {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub tokens: CodexTokens,
}

#[derive(Debug, Deserialize)]
struct Line {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct TokenCountInfo {
    total_token_usage: CodexTokens,
}

/// Totals of the **last** `token_count`, the model of the last `turn_context`.
/// `None` when the file never reported tokens.
pub fn parse_rollout(text: &str) -> Option<RolloutUsage> {
    let mut usage: Option<RolloutUsage> = None;
    let mut session_id = None;
    let mut model = None;
    let mut tokens = None;
    for line in text.lines() {
        let Ok(parsed) = serde_json::from_str::<Line>(line) else {
            continue;
        };
        match (
            parsed.kind.as_str(),
            parsed.payload.get("type").and_then(|t| t.as_str()),
        ) {
            ("session_meta", _) => {
                session_id = string_at(&parsed.payload, "id");
            }
            ("turn_context", _) => {
                model = string_at(&parsed.payload, "model").or(model);
            }
            ("event_msg", Some("token_count")) => {
                // `info` is null on the token_count that only carries rate limits.
                if let Some(info) = parsed
                    .payload
                    .get("info")
                    .and_then(|info| serde_json::from_value::<TokenCountInfo>(info.clone()).ok())
                {
                    tokens = Some(info.total_token_usage);
                }
            }
            _ => {}
        }
    }
    if let Some(tokens) = tokens {
        usage = Some(RolloutUsage {
            session_id,
            model,
            tokens,
        });
    }
    usage
}

fn string_at(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_string)
}

/// The id from Codex's header line `session id: <uuid>`, if the text has one.
pub fn extract_session_id(text: &str) -> Option<String> {
    let mut rest = text;
    while let Some(at) = rest.find(SESSION_ID_MARKER) {
        rest = &rest[at + SESSION_ID_MARKER.len()..];
        if let Some(candidate) = rest.get(..UUID_LEN) {
            if is_uuid(candidate) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Watches the agent's output for the session id. Output arrives in chunks
/// that can cut the header line anywhere, so a short tail is kept.
#[derive(Debug, Default)]
pub struct SessionIdSniffer {
    found: Option<String>,
    tail: String,
    seen_bytes: usize,
}

impl SessionIdSniffer {
    pub fn push(&mut self, chunk: &str) {
        if self.found.is_some() || self.seen_bytes > SNIFFER_GIVES_UP_AFTER_BYTES {
            return;
        }
        self.seen_bytes += chunk.len();
        let window = format!("{}{}", self.tail, crate::ansi::strip_ansi(chunk));
        self.found = extract_session_id(&window);
        let keep_from = window.len().saturating_sub(SNIFFER_CARRY);
        let keep_from = (keep_from..=window.len())
            .find(|&at| window.is_char_boundary(at))
            .unwrap_or(window.len());
        self.tail = window[keep_from..].to_string();
    }

    pub fn session_id(&self) -> Option<&str> {
        self.found.as_deref()
    }
}

/// `<root>/YYYY/MM/DD`, the folder Codex files a session under by the local
/// date it started on.
fn day_dir(root: &Path, day: NaiveDate) -> PathBuf {
    root.join(day.format("%Y/%m/%d").to_string())
}

/// The days a session started on `start_day` can be filed under: that day and
/// the one after, in case it ran across midnight before writing its file.
fn candidate_days(root: &Path, start_day: NaiveDate) -> [PathBuf; 2] {
    [
        day_dir(root, start_day),
        day_dir(root, start_day + Duration::days(1)),
    ]
}

fn rollouts_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        })
        .collect()
}

/// The rollout whose file name ends in the session id.
pub fn find_rollout_by_session(
    root: &Path,
    session_id: &str,
    start_day: NaiveDate,
) -> Option<PathBuf> {
    if !is_uuid(session_id) {
        return None;
    }
    let suffix = format!("-{session_id}.jsonl");
    candidate_days(root, start_day)
        .iter()
        .flat_map(|dir| rollouts_in(dir))
        .find(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name.ends_with(&suffix))
        })
}

struct SessionMeta {
    cwd: Option<String>,
    started_at: DateTime<Utc>,
}

fn read_session_meta(path: &Path) -> Option<SessionMeta> {
    let first = BufReader::new(fs::File::open(path).ok()?)
        .lines()
        .next()?
        .ok()?;
    let line: Line = serde_json::from_str(&first).ok()?;
    if line.kind != "session_meta" {
        return None;
    }
    let started = string_at(&line.payload, "timestamp")?;
    Some(SessionMeta {
        cwd: string_at(&line.payload, "cwd"),
        started_at: DateTime::parse_from_rfc3339(&started)
            .ok()?
            .with_timezone(&Utc),
    })
}

fn same_directory(a: &str, b: &str) -> bool {
    a == b
        || matches!(
            (fs::canonicalize(a), fs::canonicalize(b)),
            (Ok(a), Ok(b)) if a == b
        )
}

/// The rollout of an interactive session, which prints no id we can rely on:
/// the one started in `cwd` within a minute of the spawn, the closest first.
/// A guess, and recorded as one (`match: heuristic`).
pub fn find_rollout_heuristic(
    root: &Path,
    cwd: &str,
    spawned_at: DateTime<Utc>,
    start_day: NaiveDate,
    claims: &RolloutClaims,
) -> Option<PathBuf> {
    let mut candidates: Vec<(i64, PathBuf)> = candidate_days(root, start_day)
        .iter()
        .flat_map(|dir| rollouts_in(dir))
        .filter_map(|path| {
            let meta = read_session_meta(&path)?;
            let lag = meta.started_at - spawned_at;
            let in_window =
                lag >= -HEURISTIC_WINDOW_BEFORE_SPAWN && lag <= HEURISTIC_WINDOW_AFTER_SPAWN;
            let same_cwd = meta.cwd.as_deref().is_some_and(|c| same_directory(c, cwd));
            (in_window && same_cwd).then(|| (lag.num_milliseconds().abs(), path))
        })
        .collect();
    candidates.sort_by_key(|(distance, _)| *distance);
    candidates
        .into_iter()
        .map(|(_, path)| path)
        .find(|path| claims.claim(path))
}

/// Rollouts already taken by an agent, so two agents in one directory cannot
/// both be given the same session.
#[derive(Debug, Default)]
pub struct RolloutClaims {
    taken: std::sync::Mutex<std::collections::HashSet<PathBuf>>,
}

impl RolloutClaims {
    /// The registry every agent of this app run shares.
    pub fn global() -> &'static RolloutClaims {
        static CLAIMS: std::sync::OnceLock<RolloutClaims> = std::sync::OnceLock::new();
        CLAIMS.get_or_init(RolloutClaims::default)
    }

    /// True when `path` was free and is now taken.
    pub fn claim(&self, path: &Path) -> bool {
        self.taken
            .lock()
            .map(|mut taken| taken.insert(path.to_path_buf()))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLLOUT: &str = include_str!("fixtures/codex-rollout.jsonl");
    const STDERR: &str = include_str!("fixtures/codex-exec-stderr.txt");
    const SESSION: &str = "01a0f1ef-8a2f-7a73-9006-386b97777a5a";

    fn start_day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 30).unwrap()
    }

    fn write_rollout(root: &Path, day: &str, file: &str, meta_ts: &str, cwd: &str) -> PathBuf {
        let dir = root.join(day);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(file);
        let meta = format!(
            r#"{{"type":"session_meta","payload":{{"id":"x","timestamp":"{meta_ts}","cwd":"{cwd}"}}}}"#
        );
        fs::write(&path, format!("{meta}\n")).unwrap();
        path
    }

    #[test]
    fn the_last_token_count_is_the_session_total() {
        let usage = parse_rollout(ROLLOUT).expect("a rollout with tokens");

        assert_eq!(usage.tokens.input_tokens, 54_286);
        assert_eq!(usage.tokens.cached_input_tokens, 26_880);
        assert_eq!(usage.tokens.output_tokens, 132);
        assert_eq!(usage.model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(usage.session_id.as_deref(), Some(SESSION));
    }

    #[test]
    fn cached_input_is_taken_out_of_the_input_it_is_a_subset_of() {
        let counts = parse_rollout(ROLLOUT).unwrap().tokens.to_counts();

        assert_eq!(counts.input, 54_286 - 26_880);
        assert_eq!(counts.cache_read, 26_880);
        assert_eq!(counts.output, 132);
    }

    #[test]
    fn reasoning_stays_inside_output_and_cache_writes_leave_the_plain_input() {
        let tokens = CodexTokens {
            input_tokens: 1_000,
            cached_input_tokens: 300,
            cache_write_input_tokens: 200,
            output_tokens: 50,
            reasoning_output_tokens: 40,
        };

        let counts = tokens.to_counts();

        assert_eq!(counts.input, 500);
        assert_eq!(counts.cache_write5m, 200);
        assert_eq!(counts.output, 50, "reasoning is not added a second time");
        assert_eq!(counts.thinking, 40);
    }

    #[test]
    fn a_rollout_that_never_counted_tokens_has_no_usage() {
        let text = r#"{"type":"session_meta","payload":{"id":"x"}}
{"type":"event_msg","payload":{"type":"token_count","info":null}}"#;
        assert!(parse_rollout(text).is_none());
        assert!(parse_rollout("").is_none());
    }

    #[test]
    fn the_session_id_is_read_from_the_header_the_cli_prints() {
        assert_eq!(extract_session_id(STDERR).as_deref(), Some(SESSION));
        assert_eq!(extract_session_id("session id: not-a-uuid"), None);
        assert_eq!(extract_session_id("nothing here"), None);
    }

    #[test]
    fn the_sniffer_finds_an_id_split_across_chunks_and_wrapped_in_colour() {
        let mut sniffer = SessionIdSniffer::default();
        let line = format!("\u{1b}[2msession id: {SESSION}\u{1b}[0m\r\n");
        let (first, second) = line.split_at(20);

        sniffer.push(first);
        assert_eq!(sniffer.session_id(), None);
        sniffer.push(second);

        assert_eq!(sniffer.session_id(), Some(SESSION));
    }

    #[test]
    fn the_sniffer_keeps_the_first_id_it_saw() {
        let mut sniffer = SessionIdSniffer::default();
        sniffer.push(&format!("session id: {SESSION}\n"));
        sniffer.push("session id: 22222222-2222-2222-2222-222222222222\n");
        assert_eq!(sniffer.session_id(), Some(SESSION));
    }

    #[test]
    fn the_sniffer_stops_looking_once_the_header_is_long_past() {
        let mut sniffer = SessionIdSniffer::default();
        sniffer.push(&"x".repeat(SNIFFER_GIVES_UP_AFTER_BYTES + 1));
        sniffer.push("more output\n");

        sniffer.push(&format!("session id: {SESSION}\n"));

        assert_eq!(sniffer.session_id(), None);
    }

    #[test]
    fn a_rollout_is_found_by_the_uuid_at_the_end_of_its_name() {
        let root = tempfile::tempdir().unwrap();
        let wanted = write_rollout(
            root.path(),
            "2026/09/30",
            &format!("rollout-2026-09-30T12-50-03-{SESSION}.jsonl"),
            "2026-09-30T10:50:03Z",
            "/w",
        );
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-2026-09-30T12-50-03-22222222-2222-2222-2222-222222222222.jsonl",
            "2026-09-30T10:50:03Z",
            "/w",
        );

        assert_eq!(
            find_rollout_by_session(root.path(), SESSION, start_day()),
            Some(wanted)
        );
    }

    #[test]
    fn a_session_that_ran_over_midnight_is_found_in_the_next_days_folder() {
        let root = tempfile::tempdir().unwrap();
        let wanted = write_rollout(
            root.path(),
            "2026/10/01",
            &format!("rollout-2026-10-01T00-00-03-{SESSION}.jsonl"),
            "2026-09-30T22:00:03Z",
            "/w",
        );

        assert_eq!(
            find_rollout_by_session(root.path(), SESSION, start_day()),
            Some(wanted)
        );
        assert_eq!(
            find_rollout_by_session(
                root.path(),
                SESSION,
                NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
            ),
            None,
            "two days are searched, not the whole tree"
        );
    }

    #[test]
    fn the_heuristic_picks_the_closest_session_in_the_same_directory() {
        let root = tempfile::tempdir().unwrap();
        let spawned: DateTime<Utc> = "2026-09-30T10:50:00Z".parse().unwrap();
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-a-1.jsonl",
            "2026-09-30T10:50:30Z",
            "/w",
        );
        let closest = write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-b-2.jsonl",
            "2026-09-30T10:50:02Z",
            "/w",
        );
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-c-3.jsonl",
            "2026-09-30T10:50:01Z",
            "/elsewhere",
        );

        assert_eq!(
            find_rollout_heuristic(
                root.path(),
                "/w",
                spawned,
                start_day(),
                &RolloutClaims::default()
            ),
            Some(closest)
        );
    }

    #[test]
    fn a_rollout_another_agent_already_claimed_is_not_taken_twice() {
        let root = tempfile::tempdir().unwrap();
        let spawned: DateTime<Utc> = "2026-09-30T10:50:00Z".parse().unwrap();
        let first = write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-a-1.jsonl",
            "2026-09-30T10:50:01Z",
            "/w",
        );
        let second = write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-b-2.jsonl",
            "2026-09-30T10:50:02Z",
            "/w",
        );
        let claims = RolloutClaims::default();
        assert!(claims.claim(&first));

        let taken = find_rollout_heuristic(root.path(), "/w", spawned, start_day(), &claims);

        assert_eq!(taken, Some(second), "the closest unclaimed one");
        assert_eq!(
            find_rollout_heuristic(root.path(), "/w", spawned, start_day(), &claims),
            None,
            "a match is claimed at match time"
        );
    }

    #[test]
    fn a_session_that_started_before_the_spawn_is_someone_elses() {
        let root = tempfile::tempdir().unwrap();
        let spawned: DateTime<Utc> = "2026-09-30T10:50:00Z".parse().unwrap();
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-a-1.jsonl",
            "2026-09-30T10:49:57Z",
            "/w",
        );
        let claims = RolloutClaims::default();

        assert_eq!(
            find_rollout_heuristic(root.path(), "/w", spawned, start_day(), &claims),
            None
        );

        let within_skew = write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-b-2.jsonl",
            "2026-09-30T10:49:59.500Z",
            "/w",
        );
        assert_eq!(
            find_rollout_heuristic(root.path(), "/w", spawned, start_day(), &claims),
            Some(within_skew)
        );
    }

    #[test]
    fn the_heuristic_refuses_sessions_outside_the_minute_after_the_spawn() {
        let root = tempfile::tempdir().unwrap();
        let spawned: DateTime<Utc> = "2026-09-30T10:50:00Z".parse().unwrap();
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-late-1.jsonl",
            "2026-09-30T10:51:30Z",
            "/w",
        );
        write_rollout(
            root.path(),
            "2026/09/30",
            "rollout-early-2.jsonl",
            "2026-09-30T10:40:00Z",
            "/w",
        );

        assert_eq!(
            find_rollout_heuristic(
                root.path(),
                "/w",
                spawned,
                start_day(),
                &RolloutClaims::default()
            ),
            None
        );
    }
}
