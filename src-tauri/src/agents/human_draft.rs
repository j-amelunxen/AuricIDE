//! Whether a person is halfway through a message in an agent's console.
//!
//! The IDE types into an agent's input box on its own in two places: the
//! supervisor pingback (`control_socket/pingback.rs`) and an automatic message
//! (`agent_send_message` with `automatic`, e.g. a task from a reminder that
//! started without a click). Typed while the human has a draft there, the text
//! joins the draft and the Enter submits both. So every keystroke the human
//! sends (`shell_write`, `agent_send_message`) is observed here, both hold
//! back while a draft is open, and automatic text is never observed: it is
//! not the human's.
//!
//! "Open" is read from the keystrokes alone, not from the screen: printable
//! text opens a draft, Enter or Ctrl-C closes it. Clearing a draft by other
//! means (Esc, deleting it character by character) is not recognised, so a
//! draft counts as open only for `DRAFT_HOLD` after the last keystroke.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long an untouched draft still holds the pingback
/// (`limits.pingbackDraftHoldMs`).
pub const DRAFT_HOLD: Duration = Duration::from_secs(180);

#[derive(Default)]
pub struct HumanDrafts {
    /// Agent id → last keystroke that left a draft open.
    open: Mutex<HashMap<String, Instant>>,
}

pub type HumanDraftsState = Arc<HumanDrafts>;

impl HumanDrafts {
    /// Notes what the human just sent to `agent_id`'s console.
    pub fn observe(&self, agent_id: &str, data: &str, now: Instant) {
        let mut open = self.open.lock().unwrap_or_else(|p| p.into_inner());
        let (closed, after) = match data.rfind(['\r', '\n', '\x03']) {
            Some(at) => (true, &data[at + 1..]),
            None => (false, data),
        };
        if has_text(after) {
            open.insert(agent_id.to_string(), now);
        } else if closed {
            open.remove(agent_id);
        } else if let Some(touched) = open.get_mut(agent_id) {
            // Backspace, arrows: still editing the same draft.
            *touched = now;
        }
    }

    /// Whether `agent_id` has a draft touched within `DRAFT_HOLD`.
    pub fn drafting(&self, agent_id: &str, now: Instant) -> bool {
        self.open
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(agent_id)
            .is_some_and(|touched| now.saturating_duration_since(*touched) < DRAFT_HOLD)
    }
}

/// Printable text, ignoring escape sequences (arrows, bracketed paste
/// markers) and control characters.
fn has_text(data: &str) -> bool {
    let mut chars = data.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // CSI: ESC [ params final-byte; anything else: ESC plus one char.
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if ('\x40'..='\x7e').contains(&c) {
                        break;
                    }
                }
            }
        } else if !c.is_control() {
            return true;
        }
    }
    false
}

/// The agent id behind a terminal session id, for agents' consoles only.
pub fn agent_of_session(session_id: &str) -> Option<&str> {
    session_id.strip_prefix("agent-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_opens_a_draft_and_enter_or_ctrl_c_closes_it() {
        let drafts = HumanDrafts::default();
        let t = Instant::now();
        drafts.observe("a", "h", t);
        drafts.observe("a", "i", t);
        assert!(drafts.drafting("a", t));
        drafts.observe("a", "\r", t);
        assert!(!drafts.drafting("a", t));
        drafts.observe("a", "oops", t);
        drafts.observe("a", "\x03", t);
        assert!(!drafts.drafting("a", t));
        assert!(!drafts.drafting("b", t), "per agent");
    }

    #[test]
    fn text_after_the_last_enter_is_a_new_draft() {
        let drafts = HumanDrafts::default();
        let t = Instant::now();
        drafts.observe("a", "send this\rand start", t);
        assert!(drafts.drafting("a", t));
    }

    #[test]
    fn keys_without_text_open_nothing_but_keep_a_draft_alive() {
        let drafts = HumanDrafts::default();
        let t = Instant::now();
        drafts.observe("a", "\x1b[A\x1b[B\x7f", t);
        assert!(
            !drafts.drafting("a", t),
            "arrows and backspace are not a draft"
        );
        drafts.observe("a", "x", t);
        let later = t + DRAFT_HOLD - Duration::from_secs(1);
        drafts.observe("a", "\x1b[D", later);
        assert!(drafts.drafting("a", later + Duration::from_secs(2)));
    }

    #[test]
    fn a_paste_is_text_and_an_untouched_draft_stops_holding() {
        let drafts = HumanDrafts::default();
        let t = Instant::now();
        drafts.observe("a", "\x1b[200~pasted\x1b[201~", t);
        assert!(drafts.drafting("a", t));
        assert!(!drafts.drafting("a", t + DRAFT_HOLD));
    }

    #[test]
    fn only_agent_consoles_are_tracked() {
        assert_eq!(agent_of_session("agent-agent-7"), Some("agent-7"));
        assert_eq!(agent_of_session("shell-1"), None);
    }

    #[test]
    fn the_hold_matches_the_contract() {
        let fixtures: serde_json::Value =
            serde_json::from_str(crate::control_socket::protocol::tests::FIXTURES).unwrap();
        assert_eq!(
            fixtures["limits"]["pingbackDraftHoldMs"],
            DRAFT_HOLD.as_millis() as u64
        );
    }
}
