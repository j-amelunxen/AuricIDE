//! When an agent's console counts as waiting on an answer, for readers
//! outside the webview: a supervisor's `await_result` with `untilInput`
//! (`docs/design-agent-control.md`, "Supervisor scope").
//!
//! The frontend's attention model asks the same question in
//! `src/lib/agents/awaitingInput.ts`. Both read the patterns and the line
//! rules from `awaitingInput.fixtures.json`, so an agent the panel flags as
//! needing input is the agent a supervisor is woken for.

use regex::{Regex, RegexBuilder};
use serde::Deserialize;
use std::sync::OnceLock;

const FIXTURES: &str = include_str!("../../../src/lib/agents/awaitingInput.fixtures.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rules {
    scanned_lines: usize,
    patterns: Vec<String>,
}

struct Compiled {
    scanned_lines: usize,
    patterns: Vec<Regex>,
}

fn rules() -> &'static Compiled {
    static RULES: OnceLock<Compiled> = OnceLock::new();
    RULES.get_or_init(|| {
        // Compiled into the binary and covered by the fixture test below, so
        // a broken file fails the build's tests, not a supervisor at runtime.
        let rules: Rules = serde_json::from_str(FIXTURES).expect("awaitingInput.fixtures.json");
        let patterns = rules
            .patterns
            .iter()
            .map(|source| {
                RegexBuilder::new(source)
                    .case_insensitive(true)
                    .build()
                    .expect("awaitingInput pattern")
            })
            .collect();
        Compiled {
            scanned_lines: rules.scanned_lines,
            patterns,
        }
    })
}

/// True when the tail of an agent's cleaned console looks like a prompt
/// waiting for an answer. `text` is console output with ANSI already removed,
/// as `OutputBuffers` keeps it.
pub fn awaits_input(text: &str) -> bool {
    let rules = rules();
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<String> = normalized
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| line.chars().any(char::is_alphanumeric))
        .collect();
    let start = lines.len().saturating_sub(rules.scanned_lines);
    lines[start..]
        .iter()
        .any(|line| rules.patterns.iter().any(|pattern| pattern.is_match(line)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;
    use serde_json::Value;

    #[test]
    fn every_case_in_the_shared_fixture_holds() {
        let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
        let cases = fixtures["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let text = strip_ansi(case["text"].as_str().unwrap());
            assert_eq!(
                awaits_input(&text),
                case["expected"].as_bool().unwrap(),
                "{name}"
            );
        }
    }
}
