//! "Waiting on purpose": a supervisor tells the IDE that one of its agents is
//! parked until something outside it happens (a deploy, a human), so stall
//! detection stops repeating itself for that agent.
//!
//! A mark silences the stall watchdog (`control_socket/stall_watchdog.rs`) and
//! the frontend's "Stalled?" chip. It ends by itself at `until`, when the agent
//! prints something new, when it raises a question or shows a prompt, and when
//! it finishes. The contract is `docs/design-agent-control.md` ("Waiting on
//! purpose"); marks live in `<app_data_dir>/agent-waiting.json`, so an IDE
//! restart keeps them.

use crate::supervisor::write_json_atomic;
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const WAITING_FILE_NAME: &str = "agent-waiting.json";
/// Tauri event: the marks changed; the payload is the whole list.
pub const CHANGED_EVENT: &str = "agent-waiting-changed";
/// Used when `until` is left out.
pub const DEFAULT_WAIT_MS: u64 = 2 * 60 * 60 * 1000;
/// The longest a mark may last; a longer one is refused, not shortened.
pub const MAX_WAIT_MS: u64 = 24 * 60 * 60 * 1000;
pub const REASON_MAX_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitingMark {
    pub agent_id: String,
    /// The supervisor that set it; only that one may clear it.
    pub supervisor_id: String,
    pub reason: String,
    /// Milliseconds since the epoch.
    pub until_ms: u64,
    pub marked_at_ms: u64,
    /// Output generation and question count the mark was set against. Not
    /// persisted: after a restart the first tick takes the current ones.
    #[serde(skip)]
    pub baseline_generation: Option<u64>,
    #[serde(skip)]
    pub baseline_questions: Option<u64>,
}

impl WaitingMark {
    pub fn until_iso(&self) -> String {
        iso(self.until_ms)
    }
}

pub fn iso(ms: u64) -> String {
    Utc.timestamp_millis_opt(ms as i64)
        .single()
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// `until` as the caller wrote it: an RFC 3339 time, or a duration such as
/// `90m`, `2h`, `1h30m`. Left out it is two hours; more than 24 h is refused.
pub fn resolve_until(raw: Option<&str>, now_ms: u64) -> Result<u64, String> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(now_ms + DEFAULT_WAIT_MS);
    };
    let until = match parse_duration_ms(raw) {
        Some(duration) => now_ms.saturating_add(duration),
        None => DateTime::parse_from_rfc3339(raw)
            .map_err(|_| {
                format!(
                    "until \"{raw}\" is neither an ISO 8601 time (2026-11-07T18:00:00Z) \
                     nor a duration (90m, 2h, 1h30m)"
                )
            })?
            .timestamp_millis()
            .max(0) as u64,
    };
    if until <= now_ms {
        return Err("until must be in the future".into());
    }
    if until - now_ms > MAX_WAIT_MS {
        return Err("until is more than 24 hours away; a mark lasts at most 24 h".into());
    }
    Ok(until)
}

/// `90m`, `2h`, `1h30m`, `45s`: digits followed by h, m or s, in that order.
fn parse_duration_ms(raw: &str) -> Option<u64> {
    let mut total = 0u64;
    let mut digits = String::new();
    let mut seen = false;
    for ch in raw.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }
        let unit = match ch.to_ascii_lowercase() {
            'h' => 3_600_000,
            'm' => 60_000,
            's' => 1_000,
            _ => return None,
        };
        let count: u64 = digits.parse().ok()?;
        digits.clear();
        total = total.saturating_add(count.saturating_mul(unit));
        seen = true;
    }
    (seen && digits.is_empty() && total > 0).then_some(total)
}

pub fn check_reason(reason: &str) -> Result<String, String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("reason must not be empty".into());
    }
    if reason.chars().count() > REASON_MAX_CHARS {
        return Err(format!("reason is at most {REASON_MAX_CHARS} characters"));
    }
    Ok(reason.to_string())
}

/// The marks in memory, with the file they are kept in.
#[derive(Default)]
pub struct WaitingMarks {
    loaded: bool,
    marks: Vec<WaitingMark>,
}

#[derive(Serialize, Deserialize)]
struct WaitingFile {
    version: u32,
    marks: Vec<WaitingMark>,
}

pub fn path_in(app_data: &Path) -> PathBuf {
    app_data.join(WAITING_FILE_NAME)
}

/// Marks in the file that are still running out in the future. A missing or
/// unreadable file is no marks: the worst case is a stall notice, never a lost
/// agent.
pub fn read_active(app_data: &Path, now_ms: u64) -> Vec<WaitingMark> {
    let Ok(raw) = std::fs::read_to_string(path_in(app_data)) else {
        return Vec::new();
    };
    let Ok(file) = serde_json::from_str::<WaitingFile>(&raw) else {
        return Vec::new();
    };
    if file.version != 1 {
        return Vec::new();
    }
    file.marks
        .into_iter()
        .filter(|mark| mark.until_ms > now_ms)
        .collect()
}

impl WaitingMarks {
    /// Reads the file once; later calls keep what is in memory.
    pub fn ensure_loaded(&mut self, app_data: Option<&Path>, now_ms: u64) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        if let Some(dir) = app_data {
            self.marks = read_active(dir, now_ms);
        }
    }

    pub fn get(&self, agent_id: &str) -> Option<&WaitingMark> {
        self.marks.iter().find(|mark| mark.agent_id == agent_id)
    }

    pub fn get_mut(&mut self, agent_id: &str) -> Option<&mut WaitingMark> {
        self.marks.iter_mut().find(|mark| mark.agent_id == agent_id)
    }

    pub fn all(&self) -> &[WaitingMark] {
        &self.marks
    }

    /// A new mark replaces an earlier one on the same agent.
    pub fn set(&mut self, mark: WaitingMark) {
        self.marks
            .retain(|existing| existing.agent_id != mark.agent_id);
        self.marks.push(mark);
    }

    pub fn remove(&mut self, agent_id: &str) -> bool {
        let before = self.marks.len();
        self.marks.retain(|mark| mark.agent_id != agent_id);
        self.marks.len() != before
    }

    pub fn retain(&mut self, keep: impl Fn(&WaitingMark) -> bool) -> bool {
        let before = self.marks.len();
        self.marks.retain(keep);
        self.marks.len() != before
    }

    pub fn persist(&self, app_data: Option<&Path>) {
        let Some(dir) = app_data else { return };
        let file = WaitingFile {
            version: 1,
            marks: self.marks.clone(),
        };
        if let Err(error) = write_json_atomic(&path_in(dir), &file) {
            eprintln!("agent waiting marks not saved: {error}");
        }
    }
}

/// The marks that are still running, for the agent cards. It only reads: the
/// frontend calls it on every change event.
#[tauri::command(async)]
pub fn agent_waiting_list(app: tauri::AppHandle) -> Result<Vec<WaitingMark>, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    Ok(read_active(&dir, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000_000;

    #[test]
    fn until_defaults_to_two_hours() {
        assert_eq!(resolve_until(None, NOW), Ok(NOW + DEFAULT_WAIT_MS));
        assert_eq!(resolve_until(Some("  "), NOW), Ok(NOW + DEFAULT_WAIT_MS));
    }

    #[test]
    fn until_reads_durations_and_iso_times() {
        assert_eq!(resolve_until(Some("90m"), NOW), Ok(NOW + 90 * 60_000));
        assert_eq!(resolve_until(Some("1h30m"), NOW), Ok(NOW + 90 * 60_000));
        assert_eq!(resolve_until(Some("45s"), NOW), Ok(NOW + 45_000));
        let at = iso(NOW + 3_600_000);
        assert_eq!(resolve_until(Some(&at), NOW), Ok(NOW + 3_600_000));
    }

    #[test]
    fn until_refuses_the_past_the_far_future_and_nonsense() {
        assert!(resolve_until(Some(&iso(NOW - 1000)), NOW).is_err());
        assert!(resolve_until(Some("25h"), NOW).is_err());
        assert!(resolve_until(Some(&iso(NOW + MAX_WAIT_MS + 5000)), NOW).is_err());
        assert_eq!(resolve_until(Some("24h"), NOW), Ok(NOW + MAX_WAIT_MS));
        for bad in ["soon", "0m", "h", "5", "2x", "1m1x"] {
            assert!(resolve_until(Some(bad), NOW).is_err(), "{bad}");
        }
    }

    #[test]
    fn reason_is_required_and_bounded() {
        assert!(check_reason("  ").is_err());
        assert!(check_reason(&"x".repeat(REASON_MAX_CHARS + 1)).is_err());
        assert_eq!(check_reason(" deploy ").unwrap(), "deploy");
    }

    #[test]
    fn marks_survive_a_restart_but_not_their_expiry() {
        let dir = tempfile::tempdir().unwrap();
        let mark = |id: &str, until_ms| WaitingMark {
            agent_id: id.into(),
            supervisor_id: "agent-sup".into(),
            reason: "deploy".into(),
            until_ms,
            marked_at_ms: NOW,
            baseline_generation: Some(4),
            baseline_questions: Some(0),
        };
        let mut marks = WaitingMarks::default();
        marks.set(mark("agent-a", NOW + 1000));
        marks.set(mark("agent-b", NOW + 100_000));
        marks.persist(Some(dir.path()));

        let mut again = WaitingMarks::default();
        again.ensure_loaded(Some(dir.path()), NOW + 5000);
        assert!(
            again.get("agent-a").is_none(),
            "expired while the IDE was off"
        );
        let kept = again.get("agent-b").unwrap();
        assert_eq!(kept.reason, "deploy");
        assert_eq!(
            kept.baseline_generation, None,
            "the first tick takes a new baseline"
        );
    }
}
