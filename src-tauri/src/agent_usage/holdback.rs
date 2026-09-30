//! Keeps the console prose when a headless Claude run ends in JSON.
//!
//! `claude -p --output-format json` prints one JSON object as its last stdout
//! line. Shown as it arrives, the terminal, the feed, the error digest and the
//! control socket would all read that blob instead of an answer. So the output
//! passes through here: lines that do not start with `{` go on untouched, as
//! they arrive; a line that does is held back and, when the run ends, replaced
//! by the answer text and one summary line. A held line that is not a result
//! object is emitted exactly as it came.

use super::claude::{parse_result, CliResult};

const CRLF: &str = "\r\n";
const TOKENS_PER_K: f64 = 1_000.0;
const TOKENS_PER_M: f64 = 1_000_000.0;
/// Below a cent two decimals would print `$0.00` for a run that cost something.
const CENT: f64 = 0.01;

#[derive(Debug)]
pub struct ResultHoldback {
    at_line_start: bool,
    holding: bool,
    /// The most recent line that started with `{`.
    held: Option<String>,
    result: Option<CliResult>,
}

impl Default for ResultHoldback {
    fn default() -> Self {
        Self {
            at_line_start: true,
            holding: false,
            held: None,
            result: None,
        }
    }
}

impl ResultHoldback {
    /// What to show now for `text`, which may start or end mid-line.
    pub fn push(&mut self, text: &str) -> String {
        let mut shown = String::new();
        for segment in text.split_inclusive('\n') {
            // Only the last line of the stream can be the result, so a held
            // line that something follows was not it: show it, in order.
            if !self.holding && !segment.trim().is_empty() {
                if let Some(earlier) = self.held.take() {
                    shown.push_str(&earlier);
                }
            }
            if !self.holding && self.at_line_start && segment.starts_with('{') {
                self.held = Some(String::new());
                self.holding = true;
            }
            if self.holding {
                if let Some(held) = self.held.as_mut() {
                    held.push_str(segment);
                }
                self.holding = !segment.ends_with('\n');
            } else {
                shown.push_str(segment);
            }
            self.at_line_start = segment.ends_with('\n');
        }
        shown
    }

    /// What to show once the stream has ended.
    pub fn finish(&mut self) -> String {
        self.holding = false;
        let Some(held) = self.held.take() else {
            return String::new();
        };
        match parse_result(&held) {
            Some(result) => {
                let shown = render(&result);
                self.result = Some(result);
                shown
            }
            None => held,
        }
    }

    /// The result object that `finish` recognised, if any.
    pub fn take_result(&mut self) -> Option<CliResult> {
        self.result.take()
    }
}

fn render(result: &CliResult) -> String {
    let mut shown = result.answer.replace("\r\n", "\n").replace('\n', CRLF);
    if !shown.is_empty() && !shown.ends_with(CRLF) {
        shown.push_str(CRLF);
    }
    shown.push_str(&summary_line(result));
    shown.push_str(CRLF);
    shown
}

fn summary_line(result: &CliResult) -> String {
    let mut parts = vec![format_tokens(result.total_counts().billable())];
    if let Some(cost) = result.cost_usd() {
        parts.push(format_cost(cost));
    }
    if let Some(turns) = result.num_turns {
        parts.push(format!(
            "{turns} {}",
            if turns == 1 { "turn" } else { "turns" }
        ));
    }
    format!("— {}", parts.join(" · "))
}

fn format_tokens(tokens: u64) -> String {
    let count = tokens as f64;
    if count >= TOKENS_PER_M {
        format!("{:.1}M tokens", count / TOKENS_PER_M)
    } else if count >= TOKENS_PER_K {
        format!("{:.1}k tokens", count / TOKENS_PER_K)
    } else {
        format!("{tokens} tokens")
    }
}

fn format_cost(cost: f64) -> String {
    if cost >= CENT {
        format!("${cost:.2}")
    } else {
        format!("${cost:.4}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESULT_LINE: &str = include_str!("fixtures/claude-result.json");

    fn run(chunks: &[&str]) -> (String, Option<CliResult>) {
        let mut holdback = ResultHoldback::default();
        let mut shown = String::new();
        for chunk in chunks {
            shown.push_str(&holdback.push(chunk));
        }
        shown.push_str(&holdback.finish());
        (shown, holdback.take_result())
    }

    #[test]
    fn prose_passes_through_as_it_arrives() {
        let mut holdback = ResultHoldback::default();

        assert_eq!(holdback.push("working on it\r\n"), "working on it\r\n");
        assert_eq!(holdback.push("half a li"), "half a li");
        assert_eq!(holdback.push("ne\r\n"), "ne\r\n");
        assert_eq!(holdback.finish(), "");
    }

    #[test]
    fn the_result_object_is_replaced_by_its_answer_and_a_summary() {
        let (shown, result) = run(&["progress\r\n", RESULT_LINE.trim_end(), "\r\n"]);

        assert_eq!(
            shown,
            "progress\r\nhello\r\n— 187.6k tokens · $0.12 · 1 turn\r\n"
        );
        assert_eq!(result.expect("recognised").cost_usd(), Some(0.12199465));
    }

    #[test]
    fn a_result_split_over_many_chunks_is_still_held_back_whole() {
        let line = RESULT_LINE.trim_end();
        let (first, rest) = line.split_at(30);
        let (middle, last) = rest.split_at(200);
        let mut holdback = ResultHoldback::default();

        let shown_while_running = [
            holdback.push(first),
            holdback.push(middle),
            holdback.push(last),
            holdback.push("\r\n"),
        ]
        .concat();

        assert_eq!(
            shown_while_running, "",
            "no part of the JSON reaches the console"
        );
        assert!(holdback.finish().starts_with("hello"));
    }

    #[test]
    fn the_result_line_without_a_final_newline_is_still_recognised() {
        let (shown, result) = run(&[RESULT_LINE.trim_end()]);

        assert!(shown.starts_with("hello\r\n"));
        assert!(result.is_some());
    }

    #[test]
    fn a_broken_object_is_emitted_raw_and_unchanged() {
        let (shown, result) = run(&["{\"type\":\"result\",\"resu", "\r\n"]);

        assert_eq!(shown, "{\"type\":\"result\",\"resu\r\n");
        assert!(result.is_none());
    }

    #[test]
    fn a_json_object_that_is_not_a_result_is_emitted_raw() {
        let (shown, result) = run(&["{\"type\":\"assistant\"}\r\n"]);

        assert_eq!(shown, "{\"type\":\"assistant\"}\r\n");
        assert!(result.is_none());
    }

    #[test]
    fn only_a_line_start_can_begin_a_held_line() {
        let (shown, result) = run(&["a brace { in prose\r\n", "and } another\r\n"]);

        assert_eq!(shown, "a brace { in prose\r\nand } another\r\n");
        assert!(result.is_none());
    }

    #[test]
    fn of_two_object_lines_the_earlier_one_is_shown_raw_and_the_last_is_the_result() {
        let (shown, result) = run(&["{\"note\":1}\r\n", RESULT_LINE.trim_end(), "\r\n"]);

        assert!(shown.starts_with("{\"note\":1}\r\nhello\r\n"));
        assert!(result.is_some());
    }

    #[test]
    fn a_held_line_is_shown_in_order_as_soon_as_another_line_follows_it() {
        let mut holdback = ResultHoldback::default();

        assert_eq!(holdback.push("{\"note\":1}\r\n"), "");
        assert_eq!(holdback.push("after\r\n"), "{\"note\":1}\r\nafter\r\n");
        assert_eq!(holdback.push(RESULT_LINE.trim_end()), "");
        assert!(holdback.finish().starts_with("hello"));
    }

    #[test]
    fn blank_lines_after_the_result_do_not_release_it() {
        let (shown, result) = run(&[RESULT_LINE.trim_end(), "\r\n", "\r\n", "  \r\n"]);

        assert!(result.is_some());
        assert!(shown.starts_with("\r\n\r\n  \r\nhello") || shown.contains("hello\r\n\u{2014}"));
        assert!(!shown.contains("\"type\":\"result\""));
    }

    #[test]
    fn an_answer_with_line_breaks_keeps_them_as_terminal_line_breaks() {
        let line = r#"{"type":"result","result":"one\ntwo","num_turns":3}"#;

        let (shown, _) = run(&[line, "\r\n"]);

        assert_eq!(shown, "one\r\ntwo\r\n— 0 tokens · 3 turns\r\n");
    }

    #[test]
    fn the_summary_scales_tokens_and_keeps_sub_cent_costs_visible() {
        assert_eq!(format_tokens(842), "842 tokens");
        assert_eq!(format_tokens(12_345), "12.3k tokens");
        assert_eq!(format_tokens(2_500_000), "2.5M tokens");
        assert_eq!(format_cost(0.4213), "$0.42");
        assert_eq!(format_cost(0.0012), "$0.0012");
    }
}
