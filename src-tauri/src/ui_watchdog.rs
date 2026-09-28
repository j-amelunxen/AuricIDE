//! Watches the webview's main thread from the outside.
//!
//! A frozen UI cannot report its own freeze: the JavaScript that would write
//! the report is the thing that is stuck. So Rust sends a `ui-ping` every
//! second and the frontend answers with `ui_pong`. When the answers stop
//! coming, the main thread is blocked, and Rust writes the stall to
//! `<app_log_dir>/freezes.jsonl` itself — with the WebContent processes'
//! CPU and memory sampled while it is still happening.
//!
//! The frontend writes its own, finer-grained lines into the same file
//! (`record_ui_stall`): long tasks down to 200 ms plus the breadcrumbs of what
//! ran just before. The two sources are joined by timestamp in
//! `scripts/freeze-report.mjs`.
//!
//! A hidden window is not measured. WebKit may suspend a page nobody can
//! see, and a suspended page answering late is not a freeze.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

pub const PING_INTERVAL_MS: u64 = 1_000;
/// Delay beyond the normal ping cadence that counts as a stall.
const STALL_THRESHOLD_MS: u64 = 1_000;
/// A stall this long is written while it is still ongoing, so a hang that
/// ends in a force quit still leaves a line behind.
const HANG_REPORT_MS: u64 = 10_000;
const FREEZE_LOG: &str = "freezes.jsonl";

#[derive(Debug, PartialEq, Eq)]
pub enum StallEvent {
    /// The UI answered again after a stall; `duration_ms` is how long it was gone.
    Recovered {
        duration_ms: u64,
        hang_reported: bool,
    },
    /// The UI has not answered for `stalled_ms` and still has not.
    Hanging { stalled_ms: u64 },
}

/// Pure bookkeeping over monotonic milliseconds; the thread around it only
/// supplies the clock.
pub struct StallTracker {
    last_pong_ms: Option<u64>,
    visible: bool,
    hang_reported: bool,
}

impl StallTracker {
    pub fn new() -> Self {
        Self {
            last_pong_ms: None,
            visible: true,
            hang_reported: false,
        }
    }

    /// Time the UI has been silent past its normal cadence, if it is being
    /// measured at all.
    fn overdue_ms(&self, now_ms: u64) -> Option<u64> {
        let last = self.last_pong_ms?;
        if !self.visible {
            return None;
        }
        Some(now_ms.saturating_sub(last).saturating_sub(PING_INTERVAL_MS))
    }

    pub fn on_pong(&mut self, now_ms: u64, visible: bool) -> Option<StallEvent> {
        let event = match self.overdue_ms(now_ms) {
            // A page that just became visible again was not being measured.
            Some(overdue) if visible && overdue > STALL_THRESHOLD_MS => {
                Some(StallEvent::Recovered {
                    duration_ms: overdue,
                    hang_reported: self.hang_reported,
                })
            }
            _ => None,
        };
        self.last_pong_ms = Some(now_ms);
        self.visible = visible;
        self.hang_reported = false;
        event
    }

    pub fn on_tick(&mut self, now_ms: u64) -> Option<StallEvent> {
        let overdue = self.overdue_ms(now_ms)?;
        if self.hang_reported || overdue < HANG_REPORT_MS {
            return None;
        }
        self.hang_reported = true;
        Some(StallEvent::Hanging {
            stalled_ms: overdue,
        })
    }
}

impl Default for StallTracker {
    fn default() -> Self {
        Self::new()
    }
}

pub struct UiWatchdogState {
    tracker: Mutex<StallTracker>,
    started: Instant,
    log_path: Option<PathBuf>,
}

impl UiWatchdogState {
    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebContentSample {
    pub pid: u32,
    pub cpu_percent: f32,
    pub rss_mb: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchdogLine<'a> {
    at_ms: u128,
    source: &'static str,
    kind: &'a str,
    duration_ms: u64,
    /// System-wide: other WebKit pages (Safari) show up here too.
    web_content: Vec<WebContentSample>,
}

/// Parses `ps axo pid=,%cpu=,rss=,command=` and keeps the WebContent
/// processes, busiest first.
pub fn parse_web_content(ps_output: &str) -> Vec<WebContentSample> {
    let mut samples: Vec<WebContentSample> = ps_output
        .lines()
        .filter(|line| line.contains("WebContent"))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some(WebContentSample {
                pid: parts.next()?.parse().ok()?,
                cpu_percent: parts.next()?.parse().ok()?,
                rss_mb: parts.next()?.parse::<u64>().ok()? / 1024,
            })
        })
        .collect();
    samples.sort_by(|a, b| b.cpu_percent.total_cmp(&a.cpu_percent));
    samples
}

fn sample_web_content() -> Vec<WebContentSample> {
    std::process::Command::new("ps")
        .args(["axo", "pid=,%cpu=,rss=,command="])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| parse_web_content(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn append_line(path: &Path, line: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Failed to open freeze log: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Failed to write freeze log: {e}"))
}

fn write_event(path: &Path, event: &StallEvent) {
    let (kind, duration_ms) = match event {
        StallEvent::Recovered { duration_ms, .. } => ("stall", *duration_ms),
        StallEvent::Hanging { stalled_ms } => ("hang", *stalled_ms),
    };
    // A recovery after a reported hang is sampled too late to say anything
    // about the stall; the hang line already carries the sample.
    let web_content = match event {
        StallEvent::Recovered {
            hang_reported: true,
            ..
        } => Vec::new(),
        _ => sample_web_content(),
    };
    let line = WatchdogLine {
        at_ms: unix_ms(),
        source: "watchdog",
        kind,
        duration_ms,
        web_content,
    };
    if let Ok(json) = serde_json::to_string(&line) {
        if let Err(error) = append_line(path, &json) {
            eprintln!("UI watchdog: {error}");
        }
    }
}

/// Registers the state and starts the ping thread. Detection begins with the
/// first pong, so a slow first load is not counted as a stall.
pub fn start(app: &tauri::AppHandle) {
    let log_path = app
        .path()
        .app_log_dir()
        .ok()
        .map(|dir| dir.join(FREEZE_LOG));
    app.manage(UiWatchdogState {
        tracker: Mutex::new(StallTracker::new()),
        started: Instant::now(),
        log_path,
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut seq: u64 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(PING_INTERVAL_MS));
            seq += 1;
            let _ = handle.emit("ui-ping", seq);
            let state = handle.state::<UiWatchdogState>();
            let event = state
                .tracker
                .lock()
                .ok()
                .and_then(|mut tracker| tracker.on_tick(state.now_ms()));
            if let (Some(event), Some(path)) = (event, &state.log_path) {
                write_event(path, &event);
            }
        }
    });
}

#[tauri::command]
pub fn ui_pong(visible: bool, state: tauri::State<'_, UiWatchdogState>) {
    let event = state
        .tracker
        .lock()
        .ok()
        .and_then(|mut tracker| tracker.on_pong(state.now_ms(), visible));
    if let (Some(event), Some(path)) = (event, state.log_path.clone()) {
        // Sampling runs `ps`; keep it off the IPC thread.
        std::thread::spawn(move || write_event(&path, &event));
    }
}

/// The frontend's own stall lines (long tasks + breadcrumbs), one JSON object each.
#[tauri::command]
pub fn record_ui_stall(
    line: String,
    state: tauri::State<'_, UiWatchdogState>,
) -> Result<(), String> {
    let Some(path) = &state.log_path else {
        return Ok(());
    };
    if line.contains('\n') {
        return Err("A stall record must be a single line".to_string());
    }
    append_line(path, &line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracker_with_pong_at(ms: u64) -> StallTracker {
        let mut tracker = StallTracker::new();
        assert_eq!(tracker.on_pong(ms, true), None);
        tracker
    }

    #[test]
    fn a_steady_cadence_is_not_a_stall() {
        let mut tracker = tracker_with_pong_at(0);
        for n in 1..20 {
            assert_eq!(tracker.on_tick(n * 1_000 + 10), None);
            assert_eq!(tracker.on_pong(n * 1_000 + 30, true), None);
        }
    }

    #[test]
    fn nothing_is_measured_before_the_first_pong() {
        let mut tracker = StallTracker::new();
        assert_eq!(tracker.on_tick(60_000), None);
        assert_eq!(tracker.on_pong(60_000, true), None);
    }

    #[test]
    fn a_late_pong_reports_how_long_the_ui_was_gone() {
        let mut tracker = tracker_with_pong_at(1_000);
        assert_eq!(
            tracker.on_pong(5_000, true),
            Some(StallEvent::Recovered {
                duration_ms: 3_000,
                hang_reported: false,
            })
        );
    }

    #[test]
    fn a_hang_is_reported_once_while_it_lasts() {
        let mut tracker = tracker_with_pong_at(0);
        assert_eq!(tracker.on_tick(9_000), None);
        assert_eq!(
            tracker.on_tick(12_000),
            Some(StallEvent::Hanging { stalled_ms: 11_000 })
        );
        assert_eq!(tracker.on_tick(13_000), None);
        assert_eq!(
            tracker.on_pong(20_000, true),
            Some(StallEvent::Recovered {
                duration_ms: 19_000,
                hang_reported: true,
            })
        );
        assert_eq!(tracker.on_tick(21_500), None);
    }

    #[test]
    fn a_hidden_page_is_not_measured() {
        let mut tracker = tracker_with_pong_at(0);
        assert_eq!(tracker.on_pong(500, false), None);
        assert_eq!(tracker.on_tick(60_000), None);
        // Coming back: the silence was the page being suspended, not a freeze.
        assert_eq!(tracker.on_pong(61_000, true), None);
        assert_eq!(
            tracker.on_pong(65_000, true),
            Some(StallEvent::Recovered {
                duration_ms: 3_000,
                hang_reported: false,
            })
        );
    }

    #[test]
    fn web_content_is_parsed_and_sorted_by_cpu() {
        let ps = "  501  3.5  102400 /System/Library/Frameworks/WebKit.framework/com.apple.WebKit.WebContent\n\
                  612  0.0  2048 /usr/bin/something\n\
                  700  101.8  512000 /System/Library/Frameworks/WebKit.framework/com.apple.WebKit.WebContent\n";
        assert_eq!(
            parse_web_content(ps),
            vec![
                WebContentSample {
                    pid: 700,
                    cpu_percent: 101.8,
                    rss_mb: 500,
                },
                WebContentSample {
                    pid: 501,
                    cpu_percent: 3.5,
                    rss_mb: 100,
                },
            ]
        );
    }

    #[test]
    fn lines_are_appended() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs").join(FREEZE_LOG);
        append_line(&path, "{\"a\":1}").unwrap();
        append_line(&path, "{\"a\":2}").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"a\":1}\n{\"a\":2}\n"
        );
    }
}
