//! A bounded activity signal beside the readable console. Byte offsets remain
//! unchanged: suppressing redraws here must never lose output for readers.
use std::collections::VecDeque;

pub const STALL_NUDGE: &str = "Kurzer Statuscheck: Woran hängst du? Mach weiter, oder nenne deine Frage oder Blockade in einer Zeile.";

#[derive(Default)]
pub struct ProgressOutput {
    line: String,
    seen: VecDeque<String>,
    generation: u64,
}

impl ProgressOutput {
    pub fn push(&mut self, cleaned: &str) {
        for ch in cleaned.chars() {
            if ch == '\n' {
                self.observe();
                self.line.clear();
            } else {
                self.line.push(ch);
                // Bound a CLI's unterminated line, on a UTF-8 boundary.
                if self.line.len() >= 4096 {
                    self.observe();
                    self.line.clear();
                }
            }
        }
    }

    fn observe(&mut self) {
        let line = self.line.trim();
        // Pure decoration, spinner rows (including their changing timers), and
        // the watchdog's own echoed input are not evidence of forward progress.
        if !line.chars().any(char::is_alphanumeric)
            || line.contains(STALL_NUDGE)
            || line
                .chars()
                .next()
                .is_some_and(|ch| "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✶✳✢✻✽·".contains(ch))
            || line.chars().next().is_some_and(|ch| "|/\\".contains(ch))
                && line.chars().nth(1).is_some_and(char::is_whitespace)
            || line.strip_prefix("- ").is_some_and(|rest| {
                ["Working", "Thinking", "Running", "Loading", "Waiting"]
                    .iter()
                    .any(|status| rest.starts_with(status))
            })
            || line.contains("esc to interrupt")
        {
            return;
        }
        let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !self.seen.contains(&normalized) {
            self.generation += 1;
            self.seen.push_back(normalized);
            if self.seen.len() > 256 {
                self.seen.pop_front();
            }
        }
    }

    pub fn generation(&mut self) -> u64 {
        self.observe();
        self.generation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_real_output_not_ascii_spinner_frames() {
        let mut output = ProgressOutput::default();
        output.push("/workspace/first.rs\n");
        let first = output.generation();
        assert!(first > 0);
        output.push("/workspace/second.rs\n");
        assert!(output.generation() > first);
    }

    #[test]
    fn ascii_spinner_timers_are_not_progress() {
        let mut output = ProgressOutput::default();
        for frame in [
            "| Working (1s)\n",
            "/ Working (2s)\n",
            "- Working (3s)\n",
            "\\ Working (4s)\n",
        ] {
            output.push(frame);
        }
        assert_eq!(output.generation(), 0);
    }

    #[test]
    fn redraws_spinners_and_echoed_nudges_are_not_progress() {
        let mut output = ProgressOutput::default();
        output.push("Reading files\nPlan\n");
        let first = output.generation();
        for n in 0..100 {
            output.push(&format!("⠋ Working ({n}s)\nReading files\nPlan\n⠙\n"));
        }
        output.push(STALL_NUDGE);
        output.push("\n");
        assert_eq!(output.generation(), first);
        output.push("Found the bug");
        assert!(
            output.generation() > first,
            "unterminated real output counts"
        );
    }
}
