//! Removing terminal escape sequences from captured output.
//!
//! One definition for every place that turns a PTY or tool stream into text a
//! person reads: agent console reads over the control socket, and the failure
//! details of a video import.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    /// After ESC, waiting for the character that says what follows.
    Esc,
    /// `ESC ( B`, `ESC ) 0` and the like: intermediates, then one final.
    EscIntermediate,
    /// `ESC [ … final`.
    Csi,
    /// `ESC ] …` (and DCS/SOS/PM/APC), ended by BEL or `ESC \`.
    String,
    /// ESC inside a string: `\` ends it.
    StringEsc,
}

/// A streaming escape-sequence remover. State carries across `push` calls, so
/// a sequence split between two PTY reads is removed as a whole instead of
/// leaking its tail into the second read.
///
/// - `escapes_only` removes CSI, OSC/DCS strings, charset designations and the
///   two-character `ESC x` forms, and keeps every other character.
/// - `console` also drops C0/C1 control characters except `\n` and `\t`, and
///   turns `\r\n` and a lone `\r` into `\n` — also across calls.
#[derive(Debug, Clone)]
pub struct AnsiStripper {
    state: State,
    console: bool,
    /// The last character emitted in `console` mode was a `\r` turned into
    /// `\n`; a `\n` right after it belongs to the same line break.
    after_cr: bool,
}

impl AnsiStripper {
    pub fn escapes_only() -> Self {
        Self {
            state: State::Ground,
            console: false,
            after_cr: false,
        }
    }

    pub fn console() -> Self {
        Self {
            console: true,
            ..Self::escapes_only()
        }
    }

    /// Append the cleaned form of `input` to `out`.
    pub fn push(&mut self, input: &str, out: &mut String) {
        for ch in input.chars() {
            self.state = match self.state {
                State::Ground => {
                    if ch == '\u{1b}' {
                        State::Esc
                    } else {
                        self.ground(ch, out);
                        State::Ground
                    }
                }
                State::Esc => match ch {
                    '[' => State::Csi,
                    ']' | 'P' | 'X' | '^' | '_' => State::String,
                    '\u{20}'..='\u{2f}' => State::EscIntermediate,
                    _ => State::Ground,
                },
                State::EscIntermediate => match ch {
                    '\u{20}'..='\u{2f}' => State::EscIntermediate,
                    _ => State::Ground,
                },
                State::Csi => match ch {
                    '\u{40}'..='\u{7e}' => State::Ground,
                    _ => State::Csi,
                },
                State::String => match ch {
                    '\u{07}' => State::Ground,
                    '\u{1b}' => State::StringEsc,
                    _ => State::String,
                },
                State::StringEsc => match ch {
                    '\\' => State::Ground,
                    _ => State::String,
                },
            };
        }
    }

    fn ground(&mut self, ch: char, out: &mut String) {
        if !self.console {
            out.push(ch);
            return;
        }
        match ch {
            '\r' => {
                out.push('\n');
                self.after_cr = true;
                return;
            }
            '\n' if self.after_cr => {}
            '\n' | '\t' => out.push(ch),
            _ if ch.is_control() => return,
            _ => out.push(ch),
        }
        self.after_cr = false;
    }
}

/// Remove escape sequences from a complete text, keeping every other
/// character. A sequence cut off at the end is dropped rather than printed.
pub fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    AnsiStripper::escapes_only().push(raw, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn console(chunks: &[&str]) -> String {
        let mut stripper = AnsiStripper::console();
        let mut out = String::new();
        for chunk in chunks {
            stripper.push(chunk, &mut out);
        }
        out
    }

    #[test]
    fn removes_colour_and_cursor_sequences() {
        assert_eq!(
            strip_ansi("\u{1b}[31mred\u{1b}[0m \u{1b}[2K\u{1b}[1Gok"),
            "red ok"
        );
    }

    #[test]
    fn removes_window_title_sequences_with_either_terminator() {
        assert_eq!(strip_ansi("\u{1b}]0;claude\u{07}hi"), "hi");
        assert_eq!(strip_ansi("\u{1b}]2;title\u{1b}\\hi"), "hi");
    }

    #[test]
    fn removes_charset_designations_whole() {
        assert_eq!(strip_ansi("\u{1b}(Bplain\u{1b})0 text"), "plain text");
    }

    #[test]
    fn removes_two_byte_escapes_and_keeps_line_breaks() {
        assert_eq!(strip_ansi("a\u{1b}=b\r\nc\n"), "ab\r\nc\n");
    }

    #[test]
    fn drops_a_sequence_cut_off_at_the_end() {
        assert_eq!(strip_ansi("done\u{1b}[3"), "done");
        assert_eq!(strip_ansi("done\u{1b}]0;tit"), "done");
    }

    #[test]
    fn keeps_non_ascii_text() {
        assert_eq!(strip_ansi("\u{1b}[1mÄrger ✓\u{1b}[0m"), "Ärger ✓");
    }

    #[test]
    fn console_removes_a_sequence_split_across_pushes() {
        assert_eq!(console(&["ok\u{1b}[3", "8;5;12mgo"]), "okgo");
        assert_eq!(console(&["a\u{1b}]0;ti", "tle\u{1b}", "\\b"]), "ab");
        assert_eq!(console(&["x\u{1b}", "(Bz"]), "xz");
    }

    #[test]
    fn console_drops_control_characters_but_keeps_newline_and_tab() {
        assert_eq!(console(&["a\u{0f}b\u{07}\u{08}\tc\n\u{7f}"]), "ab\tc\n");
    }

    #[test]
    fn console_turns_every_carriage_return_into_one_newline() {
        assert_eq!(console(&["a\r\nb\rc"]), "a\nb\nc");
        assert_eq!(
            console(&["a\r", "\nb"]),
            "a\nb",
            "split \\r\\n is one break"
        );
        assert_eq!(console(&["a\r\u{1b}[K\nb"]), "a\nb");
        assert_eq!(console(&["a\n\nb"]), "a\n\nb");
    }
}
