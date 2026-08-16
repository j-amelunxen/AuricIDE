//! Reading Claude Code's transcripts and turning them into billable turns.
//!
//! The corpus is large — thousands of JSONL files, gigabytes in total — and it
//! is read on demand, so three things keep it from being slow:
//!
//! * **Files are skipped by modification time.** A file untouched since before
//!   the oldest requested window cannot hold a record inside it. This is the
//!   only reason a 30-day report does not read 30 months of transcripts.
//! * **Lines are filtered before they are parsed.** A substring check for
//!   `"usage"` rejects the overwhelming majority — user turns, tool results,
//!   summaries — for the price of a memchr rather than a JSON parse.
//! * **Files are parsed in parallel, aggregated once.** Parsing is the
//!   expensive half and it is embarrassingly parallel; deduplication is not,
//!   so it happens afterwards, on one thread, over the surviving turns.
//!
//! The deliberate imprecision is the first one: a transcript whose mtime has
//! been rewritten backwards — restored from a backup, copied without
//! preserving times — is invisible to a report whose window starts after that
//! time. `SKEW_ALLOWANCE_SECS` buys a day of slack; beyond that the file is
//! genuinely assumed to be old.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::pricing::TokenCounts;

/// How far a file's modification time may lag the records inside it before we
/// stop trusting it as a skip signal.
const SKEW_ALLOWANCE_SECS: i64 = 24 * 60 * 60;

/// One assistant turn that consumed tokens.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    /// Unix seconds.
    pub at: i64,
    /// Verbatim from the transcript — normalization belongs to the manifest.
    pub model: String,
    /// Absolute path of the working directory the turn ran in.
    pub project_path: String,
    pub session_id: String,
    /// `message.id` + `requestId`. `None` when the transcript carried neither,
    /// which means this turn cannot be recognized as a duplicate of another.
    pub dedup_key: Option<String>,
    /// A sub-agent's turn rather than the main thread's.
    pub is_sidechain: bool,
    /// Fast mode bills at its own rate.
    pub is_fast: bool,
    pub counts: TokenCounts,
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RawRecord {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    message: Option<RawMessage>,
    #[serde(rename = "requestId", default)]
    request_id: Option<String>,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(rename = "isSidechain", default)]
    is_sidechain: bool,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<RawUsage>,
}

#[derive(Debug, Deserialize)]
struct RawUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    /// The undifferentiated total. Present alongside `cache_creation` in
    /// current transcripts and alone in older ones.
    #[serde(default)]
    cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation: Option<RawCacheCreation>,
    #[serde(default)]
    output_tokens_details: Option<RawOutputDetails>,
    #[serde(default)]
    server_tool_use: Option<RawServerToolUse>,
    #[serde(default)]
    speed: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCacheCreation {
    #[serde(default)]
    ephemeral_5m_input_tokens: u64,
    #[serde(default)]
    ephemeral_1h_input_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct RawOutputDetails {
    #[serde(default)]
    thinking_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct RawServerToolUse {
    #[serde(default)]
    web_search_requests: u64,
    #[serde(default)]
    web_fetch_requests: u64,
}

/// The model string Claude Code writes for turns that never hit the API.
const SYNTHETIC_MODEL: &str = "<synthetic>";

/// Turns one transcript line into a billable turn, or nothing.
///
/// Nothing is the common case: user turns, tool results, summaries and
/// meta-records all reach here and none of them cost anything.
pub fn turn_from_line(line: &str) -> Option<Turn> {
    // Cheap rejection before the parser sees the line. Every assistant turn
    // that cost something carries a usage block, so a line without the word
    // cannot be one.
    if !line.contains("\"usage\"") {
        return None;
    }

    let record: RawRecord = serde_json::from_str(line).ok()?;
    if record.r#type.as_deref() != Some("assistant") {
        return None;
    }

    let message = record.message?;
    let usage = message.usage?;
    let model = message.model?;
    if model == SYNTHETIC_MODEL {
        return None;
    }

    let at = parse_timestamp(record.timestamp.as_deref()?)?;
    let counts = counts_from(&usage);
    if counts.is_empty() {
        return None;
    }

    // Both halves are needed: the same message id can appear under two request
    // ids on a retry, and the same request id under two message ids after a
    // fallback. Either alone would collapse turns that really did both happen.
    let dedup_key = match (message.id.as_deref(), record.request_id.as_deref()) {
        (Some(message_id), Some(request_id)) => Some(format!("{message_id}:{request_id}")),
        _ => None,
    };

    Some(Turn {
        at,
        model,
        project_path: record.cwd.unwrap_or_default(),
        session_id: record.session_id.unwrap_or_default(),
        dedup_key,
        is_sidechain: record.is_sidechain,
        is_fast: usage.speed.as_deref() == Some("fast"),
        counts,
    })
}

fn counts_from(usage: &RawUsage) -> TokenCounts {
    // The split by TTL is what we want, because the two are priced differently.
    // Older transcripts only carry the combined figure; attributing all of it
    // to the five-minute TTL is the cheaper of the two guesses, so a report
    // built from old records understates rather than inflates.
    let (write5m, write1h) = match &usage.cache_creation {
        Some(split) => (
            split.ephemeral_5m_input_tokens,
            split.ephemeral_1h_input_tokens,
        ),
        None => (usage.cache_creation_input_tokens.unwrap_or(0), 0),
    };

    let tools = usage.server_tool_use.as_ref();

    TokenCounts {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_write5m: write5m,
        cache_write1h: write1h,
        cache_read: usage.cache_read_input_tokens,
        thinking: usage
            .output_tokens_details
            .as_ref()
            .map(|details| details.thinking_tokens)
            .unwrap_or(0),
        web_search_requests: tools.map(|t| t.web_search_requests).unwrap_or(0),
        web_fetch_requests: tools.map(|t| t.web_fetch_requests).unwrap_or(0),
    }
}

fn parse_timestamp(raw: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc).timestamp())
}

// ---------------------------------------------------------------------------
// Walking the corpus
// ---------------------------------------------------------------------------

/// Every transcript under `roots` that could hold a record at or after
/// `since`, newest first.
///
/// Sorting matters for the parallel split below: without it one worker can end
/// up with every large file.
pub fn transcripts_since(roots: &[PathBuf], since: i64) -> Vec<PathBuf> {
    let cutoff = since - SKEW_ALLOWANCE_SECS;
    let mut found: Vec<(i64, PathBuf)> = Vec::new();

    for root in roots {
        if !root.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let modified = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|since_epoch| since_epoch.as_secs() as i64)
                // A file whose mtime is unreadable is read rather than skipped:
                // missing data is worse than a slow report.
                .unwrap_or(i64::MAX);
            if modified < cutoff {
                continue;
            }
            found.push((modified, path.to_path_buf()));
        }
    }

    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Every billable turn in one file at or after `since`.
pub fn turns_in_file(path: &Path, since: i64) -> Vec<Turn> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::with_capacity(1 << 16, file);
    let mut turns = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        if let Some(turn) = turn_from_line(&line) {
            if turn.at >= since {
                turns.push(turn);
            }
        }
    }
    turns
}

/// How much work a scan did, so the report can say so rather than implying it
/// read everything.
#[derive(Debug, Default, Clone, Copy)]
pub struct ScanStats {
    pub files_scanned: usize,
    pub turns_read: usize,
    pub duplicates_dropped: usize,
}

/// Every billable turn at or after `since`, deduplicated, oldest first.
pub fn collect_turns(roots: &[PathBuf], since: i64) -> (Vec<Turn>, ScanStats) {
    let files = transcripts_since(roots, since);
    let mut stats = ScanStats {
        files_scanned: files.len(),
        ..Default::default()
    };
    if files.is_empty() {
        return (Vec::new(), stats);
    }

    let workers = std::thread::available_parallelism()
        .map(|count| count.get().clamp(1, 8))
        .unwrap_or(1)
        .min(files.len());

    // Round-robin rather than chunking: the files are sorted by age, and a
    // contiguous split would hand one worker all of today's large sessions.
    let mut collected: Vec<Turn> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|offset| {
                let slice = &files;
                scope.spawn(move || {
                    let mut turns = Vec::new();
                    for path in slice.iter().skip(offset).step_by(workers) {
                        turns.extend(turns_in_file(path, since));
                    }
                    turns
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .flatten()
            .collect()
    });

    stats.turns_read = collected.len();

    // Oldest first, so buckets and "first seen" ordering downstream need no
    // second sort. Stable, so two turns sharing a timestamp keep file order.
    collected.sort_by_key(|turn| turn.at);

    let mut seen: HashSet<String> = HashSet::new();
    let mut deduplicated = Vec::with_capacity(collected.len());
    for turn in collected {
        if let Some(key) = &turn.dedup_key {
            if !seen.insert(key.clone()) {
                stats.duplicates_dropped += 1;
                continue;
            }
        }
        deduplicated.push(turn);
    }

    (deduplicated, stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A realistic assistant record. Values are deliberately distinct so a
    /// field read into the wrong slot shows up as a wrong number.
    fn assistant_line(at: &str, model: &str, message_id: &str, request_id: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{at}","requestId":"{request_id}","sessionId":"session-1","cwd":"/tmp/workspace/alpha","isSidechain":false,
            "message":{{"id":"{message_id}","role":"assistant","model":"{model}",
            "usage":{{"input_tokens":11,"output_tokens":22,"cache_read_input_tokens":55,
            "cache_creation":{{"ephemeral_5m_input_tokens":33,"ephemeral_1h_input_tokens":44}},
            "output_tokens_details":{{"thinking_tokens":7}},
            "server_tool_use":{{"web_search_requests":2,"web_fetch_requests":1}},
            "speed":"standard"}}}}}}"#
        )
        .replace('\n', "")
    }

    #[test]
    fn an_assistant_turn_yields_every_token_class() {
        let turn = turn_from_line(&assistant_line(
            "2026-08-16T10:00:00.000Z",
            "claude-opus-5",
            "msg_1",
            "req_1",
        ))
        .expect("a billable turn");

        assert_eq!(turn.model, "claude-opus-5");
        assert_eq!(turn.counts.input, 11);
        assert_eq!(turn.counts.output, 22);
        assert_eq!(turn.counts.cache_write5m, 33);
        assert_eq!(turn.counts.cache_write1h, 44);
        assert_eq!(turn.counts.cache_read, 55);
        assert_eq!(turn.counts.thinking, 7);
        assert_eq!(turn.counts.web_search_requests, 2);
        assert_eq!(turn.counts.web_fetch_requests, 1);
        assert_eq!(turn.project_path, "/tmp/workspace/alpha");
        assert_eq!(turn.session_id, "session-1");
        assert_eq!(turn.dedup_key.as_deref(), Some("msg_1:req_1"));
        assert!(!turn.is_fast);
    }

    #[test]
    fn a_user_turn_is_not_billable() {
        let line = r#"{"type":"user","timestamp":"2026-08-16T10:00:00.000Z","message":{"role":"user","content":"hi"}}"#;
        assert!(turn_from_line(line).is_none());
    }

    #[test]
    fn a_synthetic_turn_never_reached_the_api() {
        // Claude Code writes these for locally-generated messages. Counting
        // them would put tokens on the report that were never billed.
        let line = assistant_line("2026-08-16T10:00:00.000Z", "<synthetic>", "msg_x", "req_x");
        assert!(turn_from_line(&line).is_none());
    }

    #[test]
    fn a_turn_that_consumed_nothing_is_dropped() {
        let line = r#"{"type":"assistant","timestamp":"2026-08-16T10:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":0,"output_tokens":0}}}"#;
        assert!(turn_from_line(line).is_none());
    }

    #[test]
    fn a_malformed_line_is_skipped_rather_than_fatal() {
        // A half-written final line is normal in a session that is still
        // running; it must cost that line and nothing else.
        assert!(turn_from_line(r#"{"type":"assistant","usage"#).is_none());
        assert!(turn_from_line("").is_none());
    }

    #[test]
    fn an_older_transcript_without_the_ttl_split_still_counts_its_cache_writes() {
        // The combined field is all older records carry. Ignoring it would
        // silently drop the largest token class in a cached agent run.
        let line = r#"{"type":"assistant","timestamp":"2026-08-16T10:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":900}}}"#;
        let turn = turn_from_line(line).expect("a billable turn");
        assert_eq!(turn.counts.cache_write5m, 900);
        assert_eq!(turn.counts.cache_write1h, 0);
    }

    #[test]
    fn fast_mode_is_recognised_from_the_usage_block() {
        let line = r#"{"type":"assistant","timestamp":"2026-08-16T10:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1,"speed":"fast"}}}"#;
        assert!(turn_from_line(line).expect("a turn").is_fast);
    }

    #[test]
    fn a_turn_without_both_ids_carries_no_dedup_key() {
        // Better to count it twice than to collapse two real turns that merely
        // share the one id they do have.
        let line = r#"{"type":"assistant","timestamp":"2026-08-16T10:00:00.000Z","message":{"id":"msg_1","model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1}}}"#;
        assert!(turn_from_line(line).expect("a turn").dedup_key.is_none());
    }

    fn write_transcript(dir: &Path, name: &str, lines: &[String]) -> PathBuf {
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        path
    }

    #[test]
    fn the_same_turn_written_to_two_transcripts_is_counted_once() {
        // Resumed and forked sessions can land the same API call in more than
        // one file. Counting it twice would inflate every figure on the report.
        let dir = tempfile::tempdir().unwrap();
        let line = assistant_line(
            "2026-08-16T10:00:00.000Z",
            "claude-opus-5",
            "msg_1",
            "req_1",
        );
        write_transcript(dir.path(), "a.jsonl", &[line.clone()]);
        write_transcript(dir.path(), "b.jsonl", &[line]);

        let (turns, stats) = collect_turns(&[dir.path().to_path_buf()], 0);
        assert_eq!(turns.len(), 1);
        assert_eq!(stats.turns_read, 2);
        assert_eq!(stats.duplicates_dropped, 1);
    }

    #[test]
    fn two_distinct_turns_survive_deduplication() {
        let dir = tempfile::tempdir().unwrap();
        write_transcript(
            dir.path(),
            "a.jsonl",
            &[
                assistant_line(
                    "2026-08-16T10:00:00.000Z",
                    "claude-opus-5",
                    "msg_1",
                    "req_1",
                ),
                assistant_line(
                    "2026-08-16T11:00:00.000Z",
                    "claude-opus-5",
                    "msg_2",
                    "req_2",
                ),
            ],
        );

        let (turns, stats) = collect_turns(&[dir.path().to_path_buf()], 0);
        assert_eq!(turns.len(), 2);
        assert_eq!(stats.duplicates_dropped, 0);
    }

    #[test]
    fn turns_come_back_oldest_first() {
        let dir = tempfile::tempdir().unwrap();
        write_transcript(
            dir.path(),
            "a.jsonl",
            &[
                assistant_line("2026-08-16T12:00:00.000Z", "claude-opus-5", "m2", "r2"),
                assistant_line("2026-08-16T09:00:00.000Z", "claude-opus-5", "m1", "r1"),
            ],
        );

        let (turns, _) = collect_turns(&[dir.path().to_path_buf()], 0);
        assert!(turns[0].at < turns[1].at);
    }

    #[test]
    fn a_turn_before_the_window_is_left_out() {
        let dir = tempfile::tempdir().unwrap();
        write_transcript(
            dir.path(),
            "a.jsonl",
            &[
                assistant_line("2026-08-10T10:00:00.000Z", "claude-opus-5", "m1", "r1"),
                assistant_line("2026-08-16T10:00:00.000Z", "claude-opus-5", "m2", "r2"),
            ],
        );

        let since = parse_timestamp("2026-08-15T00:00:00.000Z").unwrap();
        let (turns, _) = collect_turns(&[dir.path().to_path_buf()], since);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].dedup_key.as_deref(), Some("m2:r2"));
    }

    #[test]
    fn a_freshly_written_transcript_is_never_skipped_by_its_mtime() {
        // The mtime filter is the one thing between this feature and reading
        // gigabytes on every open, so the case it must never get wrong is the
        // file that was written a moment ago.
        let dir = tempfile::tempdir().unwrap();
        write_transcript(
            dir.path(),
            "a.jsonl",
            &[assistant_line(
                "2026-08-16T10:00:00.000Z",
                "claude-opus-5",
                "m1",
                "r1",
            )],
        );

        let far_future = chrono::Utc::now().timestamp() + 365 * 24 * 60 * 60;
        let found = transcripts_since(&[dir.path().to_path_buf()], far_future);
        assert!(
            found.is_empty(),
            "a window a year out has nothing to read here"
        );

        let now = chrono::Utc::now().timestamp();
        let found = transcripts_since(&[dir.path().to_path_buf()], now);
        assert_eq!(
            found.len(),
            1,
            "today's file must be read for today's window"
        );
    }

    #[test]
    fn a_missing_root_is_empty_rather_than_an_error() {
        let (turns, stats) = collect_turns(&[PathBuf::from("/nonexistent/usage/root")], 0);
        assert!(turns.is_empty());
        assert_eq!(stats.files_scanned, 0);
    }

    #[test]
    fn files_are_read_in_parallel_without_losing_turns() {
        // The round-robin split is easy to get wrong in a way that drops a
        // file rather than failing, so count what comes back.
        let dir = tempfile::tempdir().unwrap();
        for index in 0..25 {
            write_transcript(
                dir.path(),
                &format!("s{index}.jsonl"),
                &[assistant_line(
                    "2026-08-16T10:00:00.000Z",
                    "claude-opus-5",
                    &format!("m{index}"),
                    &format!("r{index}"),
                )],
            );
        }

        let (turns, stats) = collect_turns(&[dir.path().to_path_buf()], 0);
        assert_eq!(stats.files_scanned, 25);
        assert_eq!(turns.len(), 25);
    }
}
