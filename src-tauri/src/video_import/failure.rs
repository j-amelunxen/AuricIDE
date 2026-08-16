//! Turning tool output into something a person can act on.
//!
//! `uv` and `parakeet-mlx` fail the way command-line Python tools fail: a
//! forty-line traceback, a `rich` box drawn with Unicode borders, an ANSI
//! colour code every few characters. Pasting that into the UI is what made
//! local transcription feel broken even when the fix was one sentence long.
//!
//! So the raw output never becomes the message. It is classified into one
//! plain sentence, and the output itself is kept — trimmed and de-decorated —
//! behind a fold, with the full log on disk for when the sentence is not
//! enough.

/// Which command produced the output, so the fallback sentence can still say
/// something true when no rule matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Install,
    Transcribe,
}

impl Stage {
    fn fallback(self) -> &'static str {
        match self {
            Stage::Install => "Installing the local transcription runtime failed.",
            Stage::Transcribe => "Local transcription failed.",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureReport {
    /// One sentence. Never contains tool output — that is the whole point.
    pub summary: String,
    /// The tail of the tool output, stripped of ANSI and box drawing. Shown
    /// only if the reader asks for it.
    pub details: String,
}

/// Longest output tail worth keeping in memory for the UI fold. The full text
/// goes to a log file; this is the part that gets rendered.
const DETAIL_LINES: usize = 40;
const DETAIL_CHARS: usize = 4_000;

/// Rules are ordered: the first match wins, so the specific causes must come
/// before the general ones. Each pattern is matched case-insensitively against
/// the combined stdout+stderr.
const RULES: &[(&[&str], &str)] = &[
    // A broken tool environment. Reproducible by letting anything else on the
    // machine touch the shared uv tool directory mid-run, which is exactly how
    // this surfaced: `ModuleNotFoundError: No module named 'librosa.filters'`.
    (
        &["modulenotfounderror", "no module named", "importerror"],
        "The local transcription runtime is incomplete or was modified while in use. Run Setup again to rebuild it.",
    ),
    // parakeet-mlx shells out to ffmpeg for decoding and says so itself.
    (
        &["ffmpeg is not installed", "ffprobe is not installed"],
        "ffmpeg was not found. Install it (for example with 'brew install ffmpeg') and run the check again.",
    ),
    (
        &[
            "no interpreter found",
            "requires-python",
            "requires python",
            "no such python",
        ],
        "No suitable Python was found. The local runtime needs Python 3.10 or newer.",
    ),
    (
        &["no solution found", "distribution not found", "no matching distribution"],
        "The runtime's dependencies could not be resolved on this machine.",
    ),
    (
        &["no space left on device", "disk quota exceeded"],
        "There is not enough free disk space to install the local runtime.",
    ),
    (
        &[
            "error sending request",
            "connection refused",
            "connection reset",
            "temporary failure in name resolution",
            "failed to lookup address",
            "timed out",
            "too many requests",
            "429 client error",
            "503 server error",
        ],
        "The download failed. Check the network connection and try again.",
    ),
    (
        &["permission denied", "operation not permitted", "read-only file system"],
        "The runtime directory could not be written to.",
    ),
];

/// Classify tool output into one actionable sentence plus foldable detail.
pub fn describe_failure(stage: Stage, raw: &str) -> FailureReport {
    let haystack = raw.to_lowercase();
    let summary = RULES
        .iter()
        .find(|(needles, _)| needles.iter().any(|needle| haystack.contains(needle)))
        .map(|(_, message)| (*message).to_string())
        .unwrap_or_else(|| stage.fallback().to_string());

    FailureReport {
        summary,
        details: readable_details(raw),
    }
}

/// Strip the terminal decoration that makes tool output unreadable in a web
/// view, then keep only the tail — the cause is at the bottom of a traceback,
/// never at the top.
pub fn readable_details(raw: &str) -> String {
    let cleaned = strip_decoration(raw);
    let lines: Vec<&str> = cleaned
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = if lines.len() > DETAIL_LINES {
        &lines[lines.len() - DETAIL_LINES..]
    } else {
        &lines[..]
    };
    let mut text = tail.join("\n");
    if text.chars().count() > DETAIL_CHARS {
        let skip = text.chars().count() - DETAIL_CHARS;
        text = text.chars().skip(skip).collect();
    }
    text
}

/// Remove ANSI escape sequences and the box-drawing characters `rich` uses to
/// frame its error panels. Both survive into a `<p>` as visual noise.
fn strip_decoration(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            // CSI sequences end on a byte in the range @ to ~.
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }
        if is_box_drawing(ch) {
            out.push(' ');
            continue;
        }
        out.push(ch);
    }
    out
}

fn is_box_drawing(ch: char) -> bool {
    matches!(ch, '\u{2500}'..='\u{257f}' | '\u{2580}'..='\u{259f}')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule the whole module exists for.
    #[test]
    fn summary_never_carries_tool_output() {
        let traceback = "Traceback (most recent call last):\n  File \"/opt/x/cli.py\", line 348, in transcribe\nModuleNotFoundError: No module named 'librosa.filters'";
        let report = describe_failure(Stage::Transcribe, traceback);
        assert!(!report.summary.contains("Traceback"));
        assert!(!report.summary.contains("librosa"));
        assert!(!report.summary.contains("File \""));
        assert!(report.summary.ends_with('.'));
    }

    #[test]
    fn broken_environment_asks_for_a_rerun_of_setup() {
        let report = describe_failure(
            Stage::Transcribe,
            "ModuleNotFoundError: No module named 'rich._emoji_codes'",
        );
        assert!(report.summary.contains("Run Setup again"));
    }

    #[test]
    fn missing_ffmpeg_names_ffmpeg() {
        let report = describe_failure(
            Stage::Transcribe,
            "Error transcribing file /tmp/a.wav: FFmpeg is not installed or not in your PATH.",
        );
        assert!(report.summary.contains("ffmpeg"));
        assert!(report.summary.contains("brew install ffmpeg"));
    }

    #[test]
    fn python_mismatch_names_the_required_version() {
        let report = describe_failure(
            Stage::Install,
            "error: No interpreter found for Python >=3.10 in managed installations or search path",
        );
        assert!(report.summary.contains("3.10"));
    }

    #[test]
    fn network_trouble_is_not_reported_as_a_broken_runtime() {
        let report = describe_failure(
            Stage::Install,
            "error sending request for url (https://pypi.org/simple/mlx/)",
        );
        assert!(report.summary.contains("network"));
    }

    #[test]
    fn unrecognised_output_still_yields_a_sentence_about_the_right_stage() {
        let install = describe_failure(Stage::Install, "something nobody has seen before");
        let transcribe = describe_failure(Stage::Transcribe, "something nobody has seen before");
        assert!(install.summary.contains("Installing"));
        assert!(transcribe.summary.contains("transcription failed"));
        assert_ne!(install.summary, transcribe.summary);
    }

    /// The cause of a Python failure is the last line, so the tail is what we
    /// keep when the output is longer than the fold.
    #[test]
    fn details_keep_the_end_of_a_long_traceback() {
        let mut raw = String::new();
        for index in 0..200 {
            raw.push_str(&format!("  File \"/opt/frame{index}.py\", line {index}\n"));
        }
        raw.push_str("ValueError: the actual cause\n");
        let details = readable_details(&raw);
        assert!(details.contains("ValueError: the actual cause"));
        assert!(!details.contains("frame0.py"));
        assert!(details.lines().count() <= DETAIL_LINES);
    }

    #[test]
    fn details_drop_ansi_and_box_drawing() {
        let raw = "\u{1b}[31m╭─ Error ─╮\u{1b}[0m\n│ File not found │\n╰─────────╯";
        let details = readable_details(raw);
        assert!(details.contains("File not found"));
        assert!(!details.contains('\u{1b}'));
        assert!(!details.contains('╭'));
        assert!(!details.contains('─'));
    }

    #[test]
    fn empty_output_produces_empty_details_not_a_panic() {
        let report = describe_failure(Stage::Install, "");
        assert_eq!(report.details, "");
        assert!(!report.summary.is_empty());
    }
}
