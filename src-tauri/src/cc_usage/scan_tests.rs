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
    assert!(turn_from_line(r#"{"type":"assistant","usage"#).is_none());
    assert!(turn_from_line("").is_none());
}

#[test]
fn an_older_transcript_without_the_ttl_split_still_counts_its_cache_writes() {
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
