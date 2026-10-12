//! The agent terminals in a window of their own.
//!
//! The main window stays the source of truth; the `agents` window is a view
//! of it that can live on a second monitor. This module creates that window
//! and holds the few decisions that used to assume there is only one window:
//! whose `Destroyed` ends the agents, and what Cmd+W closes.
//!
//! The contract is `docs/design-agent-window.md`; labels, command names and
//! event names are pinned by `src/lib/agents/agentWindow.fixtures.json`, which
//! the tests below read.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const AGENT_WINDOW_LABEL: &str = "agents";
/// The app route the agent window loads, without the leading slash.
const AGENT_WINDOW_ROUTE: &str = "agents";
const AGENT_WINDOW_TITLE: &str = "AuricIDE — Agents";
const WINDOW_STATE_EVENT: &str = "agent-window-state";

/// Size on a machine with one monitor, where there is no second screen to fill.
const SINGLE_MONITOR_WIDTH: f64 = 1200.0;
const SINGLE_MONITOR_HEIGHT: f64 = 800.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AgentWindowState {
    pub open: bool,
}

/// A monitor as plain numbers (physical pixels), so the choice below can be
/// tested without a display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl MonitorRect {
    fn of(monitor: &tauri::Monitor) -> Self {
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        }
    }
}

/// The monitor the agent window should fill: the first one the main window is
/// not on. `None` with a single monitor, and also when the main window's
/// monitor is unknown — guessing there could put the agent window on top of
/// the editor it was meant to sit beside.
pub fn other_monitor(monitors: &[MonitorRect], main: Option<MonitorRect>) -> Option<MonitorRect> {
    let main = main?;
    monitors.iter().copied().find(|monitor| *monitor != main)
}

/// What a window's `Destroyed` event means for the rest of the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestroyedAction {
    /// The main window is gone: end the agents and take the agent window along.
    EndAgents,
    /// The agent window is gone: a view was removed, no work ends.
    AnnounceAgentWindowClosed,
    Nothing,
}

pub fn destroyed_action(label: &str) -> DestroyedAction {
    match label {
        MAIN_WINDOW_LABEL => DestroyedAction::EndAgents,
        AGENT_WINDOW_LABEL => DestroyedAction::AnnounceAgentWindowClosed,
        _ => DestroyedAction::Nothing,
    }
}

/// What Cmd+W closes, given the label of the focused window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseTabTarget {
    AgentWindow,
    EditorTab,
}

pub fn close_tab_target(focused_label: Option<&str>) -> CloseTabTarget {
    match focused_label {
        Some(AGENT_WINDOW_LABEL) => CloseTabTarget::AgentWindow,
        _ => CloseTabTarget::EditorTab,
    }
}

/// Tells both windows whether the agent window exists.
pub fn announce_state(app: &AppHandle, open: bool) {
    let _ = app.emit(WINDOW_STATE_EVENT, AgentWindowState { open });
}

/// Takes the agent window down with the main window. `destroy` rather than
/// `close`: a close can be refused by the page, and a window left behind
/// would keep the app alive with nothing to drive it.
pub fn destroy_agent_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(AGENT_WINDOW_LABEL) {
        let _ = window.destroy();
    }
}

fn bring_forward(window: &WebviewWindow) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// The monitor to fill, read from the live windows.
fn target_monitor(app: &AppHandle) -> Option<MonitorRect> {
    let main = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    let monitors: Vec<MonitorRect> = main
        .available_monitors()
        .ok()?
        .iter()
        .map(MonitorRect::of)
        .collect();
    let current = main.current_monitor().ok().flatten();
    other_monitor(&monitors, current.as_ref().map(MonitorRect::of))
}

fn build_agent_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let target = target_monitor(app);
    // Built hidden when it is about to move to another monitor, so it does not
    // flash up on the main one first.
    let builder = WebviewWindowBuilder::new(
        app,
        AGENT_WINDOW_LABEL,
        WebviewUrl::App(AGENT_WINDOW_ROUTE.into()),
    )
    .title(AGENT_WINDOW_TITLE)
    .inner_size(SINGLE_MONITOR_WIDTH, SINGLE_MONITOR_HEIGHT)
    .resizable(true)
    .visible(target.is_none());
    // Same title bar as the main window in `tauri.conf.json`.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 16.0));
    let window = builder.build().map_err(|e| e.to_string())?;

    if let Some(monitor) = target {
        window
            .set_position(tauri::PhysicalPosition::new(monitor.x, monitor.y))
            .map_err(|e| e.to_string())?;
        window.maximize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(window)
}

/// Creates the agent window, or brings the existing one forward.
#[tauri::command]
pub async fn open_agent_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AGENT_WINDOW_LABEL) {
        return bring_forward(&window);
    }
    let window = match build_agent_window(&app) {
        Ok(window) => window,
        Err(error) => {
            // Two opens at once: the second build is refused because the
            // label is taken, and the window it wanted is already there.
            return match app.get_webview_window(AGENT_WINDOW_LABEL) {
                Some(window) => bring_forward(&window),
                None => Err(format!("The agent window could not be opened: {error}")),
            };
        }
    };
    let _ = window.set_focus();
    announce_state(&app, true);
    Ok(())
}

#[tauri::command]
pub async fn focus_agent_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(AGENT_WINDOW_LABEL)
        .ok_or("The agent window is not open.")?;
    bring_forward(&window)
}

#[tauri::command]
pub async fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("The main window is not open.")?;
    bring_forward(&window)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    pub(crate) const FIXTURES: &str =
        include_str!("../../src/lib/agents/agentWindow.fixtures.json");

    pub(crate) fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).unwrap()
    }

    const LEFT: MonitorRect = MonitorRect {
        x: 0,
        y: 0,
        width: 3024,
        height: 1964,
    };
    const RIGHT: MonitorRect = MonitorRect {
        x: 3024,
        y: 0,
        width: 2560,
        height: 1440,
    };
    const ABOVE: MonitorRect = MonitorRect {
        x: 0,
        y: -1440,
        width: 2560,
        height: 1440,
    };

    #[test]
    fn labels_route_and_event_agree_with_the_fixtures() {
        let fixtures = fixtures();
        assert_eq!(fixtures["windows"]["main"], MAIN_WINDOW_LABEL);
        assert_eq!(fixtures["windows"]["agents"], AGENT_WINDOW_LABEL);
        assert_eq!(
            fixtures["windows"]["agentsRoute"],
            format!("/{AGENT_WINDOW_ROUTE}")
        );
        assert_eq!(fixtures["rustEvents"]["windowState"], WINDOW_STATE_EVENT);
    }

    #[test]
    fn the_commands_carry_the_names_the_fixtures_promise() {
        // `generate_handler!` registers a command under its function name, so
        // naming the functions here is what ties the two together: a rename
        // stops this from compiling.
        let _ = (open_agent_window, focus_agent_window, focus_main_window);
        let fixtures = fixtures();
        assert_eq!(fixtures["commands"]["open"], stringify!(open_agent_window));
        assert_eq!(
            fixtures["commands"]["focus"],
            stringify!(focus_agent_window)
        );
        assert_eq!(
            fixtures["commands"]["focusMain"],
            stringify!(focus_main_window)
        );
    }

    #[test]
    fn the_window_state_payload_is_the_fixture_shape() {
        let fixtures = fixtures();
        let cases = fixtures["messages"]["windowState"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let open = case["raw"]["open"].as_bool().unwrap();
            let sent = serde_json::to_value(AgentWindowState { open }).unwrap();
            assert_eq!(sent, case["raw"], "{}", case["name"]);
        }
    }

    #[test]
    fn a_single_monitor_leaves_no_other_one_to_fill() {
        assert_eq!(other_monitor(&[LEFT], Some(LEFT)), None);
        assert_eq!(other_monitor(&[], None), None);
    }

    #[test]
    fn the_agent_window_goes_to_the_monitor_the_main_window_is_not_on() {
        assert_eq!(other_monitor(&[LEFT, RIGHT], Some(LEFT)), Some(RIGHT));
        assert_eq!(other_monitor(&[LEFT, RIGHT], Some(RIGHT)), Some(LEFT));
    }

    #[test]
    fn with_three_monitors_the_first_free_one_is_taken() {
        assert_eq!(
            other_monitor(&[LEFT, RIGHT, ABOVE], Some(LEFT)),
            Some(RIGHT)
        );
        assert_eq!(
            other_monitor(&[LEFT, RIGHT, ABOVE], Some(RIGHT)),
            Some(LEFT)
        );
    }

    #[test]
    fn an_unknown_main_monitor_is_not_guessed_around() {
        assert_eq!(other_monitor(&[LEFT, RIGHT], None), None);
    }

    #[test]
    fn two_monitors_reporting_the_same_rect_count_as_one() {
        // Mirrored displays: there is no second place to put a window.
        assert_eq!(other_monitor(&[LEFT, LEFT], Some(LEFT)), None);
    }

    #[test]
    fn only_the_main_window_ends_the_agents() {
        assert_eq!(
            destroyed_action(MAIN_WINDOW_LABEL),
            DestroyedAction::EndAgents
        );
    }

    #[test]
    fn closing_the_agent_window_ends_no_work() {
        assert_eq!(
            destroyed_action(AGENT_WINDOW_LABEL),
            DestroyedAction::AnnounceAgentWindowClosed
        );
    }

    #[test]
    fn a_window_nobody_knows_ends_no_work_either() {
        assert_eq!(destroyed_action("something-else"), DestroyedAction::Nothing);
        assert_eq!(destroyed_action(""), DestroyedAction::Nothing);
    }

    #[test]
    fn cmd_w_closes_the_agent_window_only_while_it_is_focused() {
        assert_eq!(
            close_tab_target(Some(AGENT_WINDOW_LABEL)),
            CloseTabTarget::AgentWindow
        );
        assert_eq!(
            close_tab_target(Some(MAIN_WINDOW_LABEL)),
            CloseTabTarget::EditorTab
        );
        // No window focused is what the menu saw before there were two.
        assert_eq!(close_tab_target(None), CloseTabTarget::EditorTab);
    }
}
