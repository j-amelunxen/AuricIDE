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
#[path = "scan_tests.rs"]
mod tests;
