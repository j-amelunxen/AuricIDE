//! The supervisor in the macOS menu bar, and its global shortcuts.
//!
//! The frontend owns what the supervisor can launch (its Quick Access presets
//! and the Settings → Skills library), so it sends the finished list through
//! `menu_bar_sync` whenever that list or the two switches change. Rust only
//! draws the menu, registers the shortcuts, and hands every pick back to the
//! main window as `menu-bar-launch` — the same launch path the tile uses, so a
//! skill started from the menu bar runs exactly like one clicked in the app.

use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const LAUNCH_EVENT: &str = "menu-bar-launch";
const TRAY_ID: &str = "auric-supervisor";
const SKILL_PREFIX: &str = "skill:";
const ITEM_START: &str = "start";
const ITEM_OPEN: &str = "open";
const ITEM_SHOW: &str = "show";
/// The menu stays a shortcut list; past this the rest live in the app.
const MAX_MENU_SKILLS: usize = 12;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarSkill {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarConfig {
    pub tray: bool,
    pub shortcuts: bool,
    /// How many supervisors run. Above zero the menu also offers to open one.
    pub running: u32,
    pub skills: Vec<MenuBarSkill>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    /// "Start Supervisor": always a new one, however many run. Neither this
    /// nor a skill: "Open Supervisor", the newest running one comes forward.
    /// A skill always starts a new supervisor too (the frontend's rule).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub new_supervisor: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutFailure {
    pub skill_id: String,
    pub shortcut: String,
    pub reason: String,
}

/// Which skill each registered shortcut starts. Read by the plugin's handler.
#[derive(Default)]
pub struct MenuBarState {
    bindings: Mutex<Vec<(Shortcut, String)>>,
}

/// What a menu item id asks for. `None` means the item is not a launch ("show").
fn launch_for_item(item_id: &str) -> Option<LaunchRequest> {
    match item_id {
        ITEM_START => Some(LaunchRequest {
            skill_id: None,
            new_supervisor: true,
        }),
        ITEM_OPEN => Some(LaunchRequest {
            skill_id: None,
            new_supervisor: false,
        }),
        _ => item_id.strip_prefix(SKILL_PREFIX).map(|id| LaunchRequest {
            skill_id: Some(id.to_string()),
            new_supervisor: false,
        }),
    }
}

/// The supervisor entries below the skills: starting one is always there,
/// opening one only while some run, with the count once there is a choice.
fn supervisor_items(running: u32) -> Vec<(&'static str, String)> {
    let mut items = vec![(ITEM_START, "Start Supervisor".to_string())];
    match running {
        0 => {}
        1 => items.push((ITEM_OPEN, "Open Supervisor".to_string())),
        n => items.push((ITEM_OPEN, format!("Open Supervisor ({n})"))),
    }
    items
}

/// Parses every shortcut once. A malformed one, or one a second skill already
/// claimed, is reported instead of registered — first come, first bound.
fn plan_shortcuts(skills: &[MenuBarSkill]) -> (Vec<(Shortcut, String)>, Vec<ShortcutFailure>) {
    let mut bindings: Vec<(Shortcut, String)> = Vec::new();
    let mut failures = Vec::new();
    for skill in skills {
        let Some(text) = skill
            .shortcut
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let fail = |reason: String| ShortcutFailure {
            skill_id: skill.id.clone(),
            shortcut: text.to_string(),
            reason,
        };
        match Shortcut::from_str(text) {
            Ok(shortcut) if bindings.iter().any(|(bound, _)| *bound == shortcut) => {
                failures.push(fail("another supervisor skill already uses it".into()));
            }
            Ok(shortcut) => bindings.push((shortcut, skill.id.clone())),
            Err(error) => failures.push(fail(error.to_string())),
        }
    }
    (bindings, failures)
}

fn emit_launch<R: Runtime>(app: &AppHandle<R>, request: LaunchRequest) {
    if let Err(error) = app.emit_to("main", LAUNCH_EVENT, request) {
        eprintln!("menu bar: could not reach the main window: {error}");
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The plugin's handler: a pressed shortcut starts the skill bound to it.
pub fn on_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let state = app.state::<MenuBarState>();
    let skill_id = state.bindings.lock().ok().and_then(|bindings| {
        bindings
            .iter()
            .find(|(s, _)| s == shortcut)
            .map(|(_, id)| id.clone())
    });
    if let Some(skill_id) = skill_id {
        emit_launch(
            app,
            LaunchRequest {
                skill_id: Some(skill_id),
                new_supervisor: false,
            },
        );
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, config: &MenuBarConfig) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    if !config.skills.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "header",
            "Supervisor skills",
            false,
            None::<&str>,
        )?)?;
        for skill in config.skills.iter().take(MAX_MENU_SKILLS) {
            // The accelerator is shown, not bound: binding is the plugin's job,
            // and a menu accelerator would only fire while the menu is open.
            let accelerator = if config.shortcuts {
                skill.shortcut.as_deref()
            } else {
                None
            };
            let item = MenuItem::with_id(
                app,
                format!("{SKILL_PREFIX}{}", skill.id),
                &skill.label,
                true,
                accelerator,
            )?;
            menu.append(&item)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for (id, label) in supervisor_items(config.running) {
        menu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        ITEM_SHOW,
        "Show AuricIDE",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

fn sync_tray<R: Runtime>(app: &AppHandle<R>, config: &MenuBarConfig) -> tauri::Result<()> {
    if !config.tray {
        let _ = app.remove_tray_by_id(TRAY_ID);
        return Ok(());
    }
    let menu = build_menu(app, config)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        return tray.set_menu(Some(menu));
    }
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray-template.png"))
        .icon_as_template(true)
        .tooltip("AuricIDE Supervisor")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == ITEM_SHOW {
                show_main_window(app);
            } else if let Some(request) = launch_for_item(id) {
                emit_launch(app, request);
            }
        })
        .build(app)?;
    Ok(())
}

fn sync_shortcuts<R: Runtime>(app: &AppHandle<R>, config: &MenuBarConfig) -> Vec<ShortcutFailure> {
    let manager = app.global_shortcut();
    if let Err(error) = manager.unregister_all() {
        eprintln!("menu bar: could not release the previous shortcuts: {error}");
    }
    let state = app.state::<MenuBarState>();
    if !config.shortcuts {
        if let Ok(mut bindings) = state.bindings.lock() {
            bindings.clear();
        }
        return Vec::new();
    }
    let (planned, mut failures) = plan_shortcuts(&config.skills);
    let mut bound = Vec::with_capacity(planned.len());
    for (shortcut, skill_id) in planned {
        match manager.register(shortcut) {
            Ok(()) => bound.push((shortcut, skill_id)),
            // Usually another app holds it; macOS does not say which.
            Err(error) => failures.push(ShortcutFailure {
                skill_id,
                shortcut: shortcut.into_string(),
                reason: error.to_string(),
            }),
        }
    }
    if let Ok(mut bindings) = state.bindings.lock() {
        *bindings = bound;
    }
    failures
}

/// Rebuilds the menu bar icon and re-registers the shortcuts from `config`.
/// Returns the shortcuts that could not be bound, so the UI can say which.
#[tauri::command]
pub fn menu_bar_sync<R: Runtime>(
    app: AppHandle<R>,
    config: MenuBarConfig,
) -> Result<Vec<ShortcutFailure>, String> {
    sync_tray(&app, &config).map_err(|error| error.to_string())?;
    Ok(sync_shortcuts(&app, &config))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(id: &str, shortcut: Option<&str>) -> MenuBarSkill {
        MenuBarSkill {
            id: id.into(),
            label: id.into(),
            shortcut: shortcut.map(Into::into),
        }
    }

    #[test]
    fn menu_items_map_to_launches() {
        assert_eq!(
            launch_for_item("start"),
            Some(LaunchRequest {
                skill_id: None,
                new_supervisor: true
            })
        );
        assert_eq!(
            launch_for_item("open"),
            Some(LaunchRequest {
                skill_id: None,
                new_supervisor: false
            })
        );
        assert_eq!(
            launch_for_item("skill:auric:vtt"),
            Some(LaunchRequest {
                skill_id: Some("auric:vtt".into()),
                new_supervisor: false
            })
        );
        assert_eq!(launch_for_item("show"), None);
        assert_eq!(launch_for_item("header"), None);
    }

    #[test]
    fn accelerators_from_the_frontend_parse() {
        // The exact strings `acceleratorFromKeyEvent` produces.
        for text in [
            "Control+Alt+KeyV",
            "Shift+Super+Digit1",
            "F5",
            "Alt+Super+Space",
        ] {
            let skills = [skill("a", Some(text))];
            let (bound, failures) = plan_shortcuts(&skills);
            assert!(failures.is_empty(), "{text}: {failures:?}");
            assert_eq!(bound.len(), 1);
        }
    }

    #[test]
    fn a_second_claim_and_a_malformed_shortcut_are_reported_not_bound() {
        let skills = [
            skill("a", Some("Control+Alt+KeyV")),
            skill("b", Some("Control+Alt+KeyV")),
            skill("c", Some("Control+Nonsense")),
            skill("d", None),
            skill("e", Some("  ")),
        ];
        let (bound, failures) = plan_shortcuts(&skills);
        assert_eq!(
            bound.iter().map(|(_, id)| id.as_str()).collect::<Vec<_>>(),
            ["a"]
        );
        assert_eq!(
            failures
                .iter()
                .map(|f| f.skill_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "c"]
        );
    }

    #[test]
    fn launch_request_serializes_like_the_frontend_expects() {
        let json = serde_json::to_value(launch_for_item("skill:p1").unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({ "skillId": "p1" }));
        let json = serde_json::to_value(launch_for_item("start").unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({ "newSupervisor": true }));
        let json = serde_json::to_value(launch_for_item("open").unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({}));
    }

    #[test]
    fn the_menu_and_its_payloads_are_the_contracts() {
        let fixtures: serde_json::Value =
            serde_json::from_str(crate::control_socket::protocol::tests::FIXTURES).unwrap();
        let bar = &fixtures["supervisors"]["menuBar"];
        assert_eq!(bar["launchEvent"], LAUNCH_EVENT);
        let config: MenuBarConfig = serde_json::from_value(bar["config"].clone()).unwrap();
        assert_eq!(serde_json::json!(config.running), bar["config"]["running"]);
        for case in bar["items"].as_array().unwrap() {
            let running = case["running"].as_u64().unwrap() as u32;
            let items = supervisor_items(running);
            let entries = case["entries"].as_array().unwrap();
            assert_eq!(items.len(), entries.len(), "running {running}");
            for ((id, label), entry) in items.iter().zip(entries) {
                assert_eq!(entry["id"], *id);
                assert_eq!(entry["label"], label.as_str());
                let payload = serde_json::to_value(launch_for_item(id).unwrap()).unwrap();
                assert_eq!(payload, entry["payload"], "{id}");
            }
        }
        let skill = &bar["skill"];
        let payload =
            serde_json::to_value(launch_for_item(skill["itemId"].as_str().unwrap()).unwrap())
                .unwrap();
        assert_eq!(payload, skill["payload"]);
    }

    #[test]
    fn start_is_always_offered_and_open_names_how_many_run() {
        assert_eq!(
            supervisor_items(0),
            vec![("start", "Start Supervisor".to_string())]
        );
        assert_eq!(
            supervisor_items(1),
            vec![
                ("start", "Start Supervisor".to_string()),
                ("open", "Open Supervisor".to_string())
            ]
        );
        assert_eq!(
            supervisor_items(3),
            vec![
                ("start", "Start Supervisor".to_string()),
                ("open", "Open Supervisor (3)".to_string())
            ]
        );
        let config: MenuBarConfig = serde_json::from_value(serde_json::json!({
            "tray": true, "shortcuts": false, "running": 2, "skills": []
        }))
        .unwrap();
        assert_eq!(config.running, 2);
    }
}
