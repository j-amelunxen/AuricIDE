//! How a message reaches an agent's TUI as one piece and gets submitted.
//!
//! Writing `text` + Enter to the PTY in one go is what a human typing would
//! produce only for a few characters. Anything longer arrives at the TUI as a
//! burst, and Claude Code treats a burst as a paste: the Enter at its end
//! becomes part of the pasted text instead of submitting it, and a burst that
//! spans several reads is cut into several pastes that lose characters at the
//! seams. Measured against Claude Code 2.1.302 in a real PTY: one-line text of
//! 59 bytes plus `\r` submits, 119 bytes does not, and any line break turns
//! the whole message into a paste. Unbracketed messages of 3 kB lost words at
//! every 1 kB read boundary.
//!
//! The fix is the terminal's own answer to the same problem: bracketed paste.
//! A TUI that wants it says so with `ESC[?2004h`; text then wrapped in
//! `ESC[200~` … `ESC[201~` is taken as one paste, exactly, and an Enter after
//! the closing marker is a key press again. The same measurement submitted
//! 8 kB messages intact, with Enter in the same write.

/// The longest message that is still written as plain keystrokes. Short
/// answers stay key presses on purpose: a permission menu reads `1` or `y` as
/// a key, and a paste would not select anything there.
pub const KEYSTROKE_MAX_BYTES: usize = 32;

const PASTE_START: &str = "\x1b[200~";
const PASTE_END: &str = "\x1b[201~";
const MODE_ON: &str = "\x1b[?2004h";
const MODE_OFF: &str = "\x1b[?2004l";

/// What to write to the PTY for `text`, with Enter after it when `enter`.
/// `bracketed_paste` is whether the TUI has switched bracketed paste on
/// (`BracketedPasteTracker`). Without it, the text goes out as typed: a TUI
/// that did not ask for paste markers would show them as literal characters.
pub fn compose_message(text: &str, enter: bool, bracketed_paste: bool) -> String {
    let as_paste =
        bracketed_paste && (text.len() > KEYSTROKE_MAX_BYTES || text.contains(['\n', '\r']));
    let mut data = if as_paste {
        // A marker inside the text would end the paste early and turn the
        // rest into key presses.
        let body = text.replace(PASTE_START, "").replace(PASTE_END, "");
        format!("{PASTE_START}{body}{PASTE_END}")
    } else {
        text.to_string()
    };
    if enter {
        data.push_str(crate::control_socket::ENTER);
    }
    data
}

/// Follows whether a TUI has bracketed paste switched on, from its raw output.
/// The last `ESC[?2004h` or `ESC[?2004l` wins; a sequence split across two
/// output batches is still seen, because the tail of each batch is carried.
#[derive(Debug, Default)]
pub struct BracketedPasteTracker {
    on: bool,
    carry: String,
}

impl BracketedPasteTracker {
    pub fn is_on(&self) -> bool {
        self.on
    }

    pub fn push(&mut self, data: &str) {
        let mut window = std::mem::take(&mut self.carry);
        window.push_str(data);
        let on = window.rfind(MODE_ON);
        let off = window.rfind(MODE_OFF);
        match (on, off) {
            (Some(on), Some(off)) => self.on = on > off,
            (Some(_), None) => self.on = true,
            (None, Some(_)) => self.on = false,
            (None, None) => {}
        }
        // Enough to complete a sequence that starts at the very end.
        let keep = MODE_ON.len() - 1;
        let mut start = window.len().saturating_sub(keep);
        while !window.is_char_boundary(start) {
            start += 1;
        }
        self.carry = window[start..].to_string();
    }
}

/// A message from the IDE's own composers, written the way `send_input` on
/// the control socket writes it, so both reach the agent alike.
#[tauri::command]
pub async fn agent_send_message(
    agent_id: String,
    text: String,
    enter: bool,
    terminals: tauri::State<'_, crate::commands::TerminalState>,
    buffers: tauri::State<'_, super::output_buffer::OutputBuffersState>,
) -> Result<(), String> {
    let data = compose_message(&text, enter, buffers.bracketed_paste(&agent_id));
    crate::commands::write_to_session(&terminals, &format!("agent-{agent_id}"), &data).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_answer_stays_keystrokes_even_with_bracketed_paste_on() {
        assert_eq!(compose_message("1", true, true), "1\r");
        assert_eq!(
            compose_message("Yes, go ahead", true, true),
            "Yes, go ahead\r"
        );
        assert_eq!(compose_message("", true, true), "\r");
    }

    #[test]
    fn a_long_or_multi_line_message_is_one_bracketed_paste_then_enter() {
        let long = "x".repeat(KEYSTROKE_MAX_BYTES + 1);
        assert_eq!(
            compose_message(&long, true, true),
            format!("\x1b[200~{long}\x1b[201~\r")
        );
        assert_eq!(
            compose_message("line one\nline two", true, true),
            "\x1b[200~line one\nline two\x1b[201~\r"
        );
        assert_eq!(
            compose_message("line one\nline two", false, true),
            "\x1b[200~line one\nline two\x1b[201~"
        );
    }

    #[test]
    fn without_bracketed_paste_the_text_is_written_as_typed() {
        assert_eq!(
            compose_message("line one\nline two", true, false),
            "line one\nline two\r"
        );
    }

    #[test]
    fn paste_markers_inside_the_text_cannot_end_the_paste_early() {
        let text = "before\x1b[201~\rafter, long enough to be pasted";
        assert_eq!(
            compose_message(text, true, true),
            "\x1b[200~before\rafter, long enough to be pasted\x1b[201~\r"
        );
    }

    #[test]
    fn the_tracker_follows_the_last_mode_switch() {
        let mut tracker = BracketedPasteTracker::default();
        assert!(!tracker.is_on());
        tracker.push("\x1b[?1004h\x1b[?2004hprompt");
        assert!(tracker.is_on());
        tracker.push("plain output without any mode switch");
        assert!(tracker.is_on());
        tracker.push("\x1b[?2004h…\x1b[?2004l bye");
        assert!(!tracker.is_on());
    }

    #[test]
    fn the_tracker_sees_a_switch_split_across_two_batches() {
        let mut tracker = BracketedPasteTracker::default();
        tracker.push("text\x1b[?20");
        assert!(!tracker.is_on());
        tracker.push("04h");
        assert!(tracker.is_on());
    }

    #[test]
    fn the_carried_tail_never_splits_a_multi_byte_character() {
        let mut tracker = BracketedPasteTracker::default();
        tracker.push("❯❯❯❯");
        tracker.push("\x1b[?2004h");
        assert!(tracker.is_on());
    }
}
