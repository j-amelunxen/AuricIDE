//! An agent's latest complete report, read from the transcript its CLI writes
//! rather than from the terminal (`docs/design-agent-control.md`,
//! "read_report"; model: `verification/lean/AuricIDE/AgentReport.lean`).
//!
//! The console of a TUI is what the screen did, redraws and spinners included;
//! the transcript is what the model said. A report here is the text of the last
//! finished turn: nothing is cleaned up or guessed, and a turn that has not
//! ended, or a provider that keeps no transcript we can read, is "no report",
//! never the console instead.

use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// How much of a transcript's end is looked at. A last turn further back than
/// this is reported as none rather than read at the cost of the whole file.
pub const REPORT_SCAN_BYTES: u64 = 8 * 1024 * 1024;

/// Where a report came from (`reportSources` in `agentControl.fixtures.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportSource {
    /// The CLI's own result object, once a headless run ended.
    CliResult,
    ClaudeTranscript,
    CodexRollout,
}

/// Why there is no report (`reportMissingReasons`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportMissing {
    /// The provider keeps no transcript this reader knows, or the agent runs
    /// outside a project, where no usage capture exists.
    ProviderUnsupported,
    /// A transcript is expected, but none can be told to be this agent's.
    TranscriptMissing,
    /// The transcript exists and no turn has ended yet.
    NoReportYet,
    /// The run is over and only its console is left, which is not a report.
    ConsoleOnly,
}

/// What looking for an agent's report found.
#[derive(Debug, Clone, PartialEq)]
pub enum ReportLookup {
    Found {
        report: AgentReport,
        source: ReportSource,
    },
    Missing(ReportMissing),
}

/// What the CLI recorded as the end of a turn.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentReport {
    /// Stable for one turn: a new id is a new report.
    pub id: String,
    pub text: String,
    /// RFC 3339, as the transcript states it.
    pub at: Option<String>,
}

/// One transcript line, reduced to what the extraction decides on. The same
/// shape in the Lean model, so its vectors replay against the real parser.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnLine {
    pub message_id: String,
    /// The line says the turn is over.
    pub ends_turn: bool,
    pub text: String,
    pub at: Option<String>,
}

/// The newest message whose lines say its turn ended and whose text is not
/// blank. A message spans several lines, one per content block, so its text is
/// gathered from all of them, in order; a turn that ended without text leaves
/// the report before it standing.
pub fn latest_report(lines: &[TurnLine]) -> Option<AgentReport> {
    let mut candidates = lines.iter().rev().filter(|line| line.ends_turn);
    candidates.find_map(|last| {
        let parts: Vec<&str> = lines
            .iter()
            .filter(|line| line.message_id == last.message_id)
            .map(|line| line.text.as_str())
            .filter(|text| !text.trim().is_empty())
            .collect();
        (!parts.is_empty()).then(|| AgentReport {
            id: last.message_id.clone(),
            text: parts.join("\n"),
            at: last.at.clone(),
        })
    })
}

#[derive(Deserialize)]
struct ClaudeLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "isSidechain", default)]
    is_sidechain: bool,
    #[serde(rename = "isApiErrorMessage", default)]
    is_api_error: bool,
    timestamp: Option<String>,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    stop_reason: Option<String>,
    #[serde(default)]
    content: Vec<ClaudeBlock>,
}

#[derive(Deserialize)]
struct ClaudeBlock {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

/// Claude Code's transcript: one line per content block, the same `message.id`
/// on each. `end_turn` is the model finishing; a `tool_use` turn goes on. The
/// CLI's own `<synthetic>` messages and API errors are not the agent's words,
/// and sidechains are its subagents'.
pub fn claude_turn_lines(text: &str) -> Vec<TurnLine> {
    text.lines()
        .filter_map(|line| serde_json::from_str::<ClaudeLine>(line).ok())
        .filter(|line| line.kind.as_deref() == Some("assistant"))
        .filter(|line| !line.is_sidechain && !line.is_api_error)
        .filter_map(|line| {
            let message = line.message?;
            if message.model.as_deref() == Some("<synthetic>") {
                return None;
            }
            let body: Vec<String> = message
                .content
                .into_iter()
                .filter(|block| block.kind.as_deref() == Some("text"))
                .filter_map(|block| block.text)
                .collect();
            Some(TurnLine {
                message_id: message.id?,
                ends_turn: message.stop_reason.as_deref() == Some("end_turn"),
                text: body.join("\n"),
                at: line.timestamp,
            })
        })
        .collect()
}

#[derive(Deserialize)]
struct RolloutLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    payload: Option<RolloutPayload>,
}

#[derive(Deserialize)]
struct RolloutPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    id: Option<String>,
    role: Option<String>,
    phase: Option<String>,
    last_agent_message: Option<String>,
    turn_id: Option<String>,
    #[serde(default)]
    content: Vec<ClaudeBlock>,
}

/// Codex's rollout: an assistant message with phase `final_answer` closes a
/// turn, `commentary` does not. `task_complete` repeats it as
/// `last_agent_message`, the one form a rollout without phases has.
pub fn codex_turn_lines(text: &str) -> Vec<TurnLine> {
    text.lines()
        .filter_map(|line| serde_json::from_str::<RolloutLine>(line).ok())
        .filter_map(|line| {
            let at = line.timestamp;
            let payload = line.payload?;
            match (line.kind.as_deref(), payload.kind.as_deref()) {
                (Some("response_item"), Some("message"))
                    if payload.role.as_deref() == Some("assistant")
                        && payload.phase.as_deref() == Some("final_answer") =>
                {
                    let body: Vec<String> = payload
                        .content
                        .into_iter()
                        .filter(|block| block.kind.as_deref() == Some("output_text"))
                        .filter_map(|block| block.text)
                        .collect();
                    Some(TurnLine {
                        message_id: payload.id?,
                        ends_turn: true,
                        text: body.join("\n"),
                        at,
                    })
                }
                (Some("event_msg"), Some("task_complete")) => Some(TurnLine {
                    message_id: payload.turn_id?,
                    ends_turn: true,
                    text: payload.last_agent_message?,
                    at,
                }),
                _ => None,
            }
        })
        .collect()
}

/// The end of a transcript as text, cut at a line start when the file is
/// longer than the window, because the first line of the window is then a
/// fragment. A last line still being written fails to parse and is skipped.
pub fn read_tail(path: &Path, window: u64) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    let start = length.saturating_sub(window);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    if start == 0 {
        return Ok(text.into_owned());
    }
    Ok(text
        .split_once('\n')
        .map_or_else(String::new, |(_, rest)| rest.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, ends_turn: bool, text: &str) -> TurnLine {
        TurnLine {
            message_id: id.into(),
            ends_turn,
            text: text.into(),
            at: None,
        }
    }

    /// `verification/contracts/agent-report-v1.jsonl`, generated by the Lean
    /// model. The `finished` half replays in `control_socket/tests.rs`.
    #[test]
    fn the_real_extraction_replays_the_lean_corpus() {
        let corpus = include_str!("../../../verification/contracts/agent-report-v1.jsonl");
        let vectors: Vec<serde_json::Value> = corpus
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .filter(|vector: &serde_json::Value| vector["kind"] == "latest")
            .collect();
        assert!(
            vectors.len() > 600,
            "the corpus was cut short: {}",
            vectors.len()
        );
        for vector in vectors {
            let lines: Vec<TurnLine> = vector["lines"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| {
                    line(
                        l["id"].as_str().unwrap(),
                        l["ends"].as_bool().unwrap(),
                        l["text"].as_str().unwrap(),
                    )
                })
                .collect();
            let got = latest_report(&lines)
                .map(|r| serde_json::json!({ "id": r.id, "text": r.text }))
                .unwrap_or(serde_json::Value::Null);
            assert_eq!(got, vector["report"], "{}", vector["name"]);
        }
    }

    /// The real transcripts of this machine, the only place their format is
    /// checked against what it is rather than our idea of it. Prints counts,
    /// never text. `cargo test --lib reads_this_machines_transcripts -- --ignored --nocapture`
    #[test]
    #[ignore = "reads the real ~/.claude transcripts of this machine"]
    fn reads_this_machines_transcripts() {
        let root = dirs::home_dir().unwrap().join(".claude/projects");
        let (mut files, mut with_report, mut whole_reads) = (0, 0, 0);
        for project in std::fs::read_dir(root).unwrap().flatten() {
            let Ok(entries) = std::fs::read_dir(project.path()) else {
                continue;
            };
            for entry in entries.flatten().take(5) {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let raw = std::fs::read_to_string(&path).unwrap_or_default();
                let ended_with_text = raw.lines().any(|line| {
                    let value: serde_json::Value = serde_json::from_str(line).unwrap_or_default();
                    value["type"] == "assistant"
                        && value["isSidechain"] != true
                        && value["message"]["stop_reason"] == "end_turn"
                        && value["message"]["model"] != "<synthetic>"
                        && value["isApiErrorMessage"] != true
                        && value["message"]["content"]
                            .as_array()
                            .is_some_and(|blocks| {
                                blocks.iter().any(|b| {
                                    b["type"] == "text"
                                        && !b["text"].as_str().unwrap_or("").trim().is_empty()
                                })
                            })
                });
                let tail = read_tail(&path, REPORT_SCAN_BYTES).unwrap();
                let report = latest_report(&claude_turn_lines(&tail));
                files += 1;
                if raw.len() as u64 <= REPORT_SCAN_BYTES {
                    whole_reads += 1;
                    assert_eq!(report.is_some(), ended_with_text, "{}", path.display());
                }
                if let Some(report) = report {
                    with_report += 1;
                    assert!(!report.text.trim().is_empty());
                    assert!(!report.id.is_empty());
                }
            }
        }
        println!("{files} transcripts, {whole_reads} read whole, {with_report} with a report");
        assert!(
            with_report > 0,
            "no report in any transcript: the format moved"
        );
    }

    #[test]
    fn a_turn_still_going_is_no_report() {
        assert_eq!(
            latest_report(&[line("a", false, "Let me look at that.")]),
            None
        );
        assert_eq!(latest_report(&[]), None);
    }

    #[test]
    fn the_newest_finished_turn_wins_and_a_later_tool_turn_does_not_replace_it() {
        let report = latest_report(&[
            line("a", true, "first"),
            line("b", true, "second"),
            line("c", false, "working again"),
        ])
        .unwrap();
        assert_eq!(report.id, "b");
        assert_eq!(report.text, "second");
    }

    #[test]
    fn a_message_is_gathered_over_its_lines() {
        // The real shape: a thinking line, then the text line, both end_turn.
        let report = latest_report(&[line("a", true, ""), line("a", true, "the text")]).unwrap();
        assert_eq!(report.text, "the text");
        let parts = latest_report(&[line("a", false, "one"), line("a", true, "two")]).unwrap();
        assert_eq!(parts.text, "one\ntwo");
    }

    #[test]
    fn a_turn_that_ended_without_text_leaves_the_report_before_it() {
        let report = latest_report(&[line("a", true, "said"), line("b", true, "  \n")]).unwrap();
        assert_eq!(report.id, "a");
        assert_eq!(latest_report(&[line("b", true, " ")]), None);
    }

    fn claude(id: &str, stop: &str, block: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-01-02T03:04:05Z","isSidechain":false,"message":{{"id":"{id}","model":"m","stop_reason":"{stop}","content":[{block}]}}}}"#
        )
    }

    #[test]
    fn claude_lines_take_only_the_models_own_finished_text() {
        let text = [
            claude("a", "tool_use", r#"{"type":"text","text":"checking"}"#),
            claude("a", "tool_use", r#"{"type":"tool_use","name":"Read"}"#),
            claude("b", "end_turn", r#"{"type":"thinking","thinking":"hidden"}"#),
            claude("b", "end_turn", r#"{"type":"text","text":"The report."}"#),
            r#"{"type":"assistant","isSidechain":true,"message":{"id":"s","model":"m","stop_reason":"end_turn","content":[{"type":"text","text":"a subagent"}]}}"#.to_string(),
            r#"{"type":"assistant","message":{"id":"y","model":"<synthetic>","stop_reason":"end_turn","content":[{"type":"text","text":"No response requested."}]}}"#.to_string(),
            r#"{"type":"assistant","isApiErrorMessage":true,"message":{"id":"e","model":"m","stop_reason":"end_turn","content":[{"type":"text","text":"API Error"}]}}"#.to_string(),
            r#"{"type":"user","message":{"id":"u","content":[{"type":"text","text":"the task"}]}}"#.to_string(),
            r#"{"type":"assistant","mess"#.to_string(),
        ]
        .join("\n");
        let report = latest_report(&claude_turn_lines(&text)).unwrap();
        assert_eq!(report.id, "b");
        assert_eq!(report.text, "The report.");
        assert_eq!(report.at.as_deref(), Some("2026-01-02T03:04:05Z"));
    }

    #[test]
    fn codex_commentary_is_not_a_report_and_the_final_answer_is() {
        let commentary = r#"{"type":"response_item","payload":{"type":"message","id":"m1","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"looking"}]}}"#;
        let answer = r#"{"type":"response_item","timestamp":"t","payload":{"type":"message","id":"m2","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done."}]}}"#;
        assert_eq!(latest_report(&codex_turn_lines(commentary)), None);
        let both = format!("{commentary}\n{answer}\n{commentary}");
        let report = latest_report(&codex_turn_lines(&both)).unwrap();
        assert_eq!((report.id.as_str(), report.text.as_str()), ("m2", "Done."));
    }

    #[test]
    fn a_codex_rollout_without_phases_answers_from_task_complete() {
        let text = r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","last_agent_message":"All set."}}"#;
        let report = latest_report(&codex_turn_lines(text)).unwrap();
        assert_eq!(
            (report.id.as_str(), report.text.as_str()),
            ("t1", "All set.")
        );
    }

    #[test]
    fn the_tail_starts_at_a_line_and_a_short_file_is_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        std::fs::write(&path, "first line\nsecond\nthird\n").unwrap();
        assert_eq!(
            read_tail(&path, 1024).unwrap(),
            "first line\nsecond\nthird\n"
        );
        assert_eq!(read_tail(&path, 10).unwrap(), "third\n");
        assert!(read_tail(&dir.path().join("none"), 10).is_err());
    }
}
