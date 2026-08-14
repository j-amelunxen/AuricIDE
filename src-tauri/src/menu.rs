//! The native macOS menu, built from the same command manifest the command
//! palette reads (`src/lib/commands/commands.json`).
//!
//! Why the menu exists at all: a native NSMenu is the one surface macOS
//! guarantees to expose semantically. The webview's accessibility tree depends
//! on how the DOM happens to be shaped, but a menu item is always a real
//! `AXMenuItem` with a real title — reachable while a modal holds focus, and
//! reachable by an external driver that only speaks Accessibility.
//!
//! Two consequences shape the design:
//!
//! * **The manifest is embedded at compile time**, not pushed up from the
//!   webview after boot. A menu that only exists once React has mounted is a
//!   menu nothing can rely on during launch.
//! * **The item text is the command's label, verbatim.** That makes the path
//!   an external driver needs (`"Agent > Deploy New Agent"`) derivable from
//!   the manifest alone, with no snapshot of the running app.

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Runtime};

/// The manifest, embedded so the menu is ready before the webview is.
const MANIFEST: &str = include_str!("../../src/lib/commands/commands.json");

#[derive(Debug, Deserialize)]
struct Manifest {
    commands: Vec<CommandSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub id: String,
    pub label: String,
    pub category: String,
    /// Display-only in the palette. Deliberately NOT registered as a menu
    /// accelerator: an accelerator consumes the key before the webview sees
    /// it, which is exactly how ⌘W once closed the window instead of a tab.
    #[serde(default)]
    #[allow(dead_code)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub requires_project: bool,
}

/// Shown in About / Hide / Quit. Must match `productName` in tauri.conf.json,
/// not the Cargo crate name (`auric-ide`), or the menu talks about a different app.
pub const PRODUCT_NAME: &str = "AuricIDE";

/// Submenu titles, in menu-bar order. A category with no title here is a
/// category the menu cannot place, which `commands()` refuses to ignore.
const CATEGORY_TITLES: &[(&str, &str)] = &[
    ("file", "File"),
    ("git", "Git"),
    ("agent", "Agent"),
    ("canvas", "Canvas"),
    ("view", "View"),
    ("markdown", "Markdown"),
    ("help", "Help"),
];

/// Categories that already exist on Tauri's default menu and must be *merged*
/// into that submenu. Creating a second submenu with the same title (Help,
/// File) produces two identically named menus, and axbridge addresses the
/// first — the empty one.
const MERGE_INTO_DEFAULT: &[&str] = &["file", "help"];

/// Rewrites Tauri's crate-name labels so the app menu matches the product.
pub fn display_app_menu_title(raw: &str) -> String {
    raw.replace("auric-ide", PRODUCT_NAME)
}

pub fn submenu_title(category: &str) -> Option<&'static str> {
    CATEGORY_TITLES
        .iter()
        .find(|(key, _)| *key == category)
        .map(|(_, title)| *title)
}

/// Parse the embedded manifest. Panics on a malformed manifest: the file is
/// compiled in, so a failure here is a build-time mistake that must not be
/// smoothed over into a silently smaller menu.
pub fn commands() -> Vec<CommandSpec> {
    let manifest: Manifest = serde_json::from_str(MANIFEST)
        .expect("commands.json is embedded at compile time and must parse");
    manifest.commands
}

/// The `Category > Label` path an external driver uses to reach a command.
/// `scripts/generate-automation-surface.mjs` writes the same paths into
/// `docs/automation-surface.md` from the same manifest; the test below is what
/// keeps those paths addressable (unique) rather than merely present.
#[cfg(test)]
fn menu_path(spec: &CommandSpec) -> String {
    format!(
        "{} > {}",
        submenu_title(&spec.category).unwrap_or(&spec.category),
        spec.label
    )
}

/// Grey out the commands that cannot work without an open project.
///
/// They stay *visible*: a driver that can see a disabled "Commit Changes"
/// learns why it cannot commit, whereas a missing item looks like a command
/// that never existed.
pub fn set_command_states<R: Runtime>(app: &AppHandle<R>, project_open: bool) {
    let Some(menu) = app.menu() else { return };
    let gated: Vec<String> = commands()
        .into_iter()
        .filter(|s| s.requires_project)
        .map(|s| s.id)
        .collect();

    for id in gated {
        if let Some(MenuItemKind::MenuItem(item)) = menu.get(&id) {
            let _ = item.set_enabled(project_open);
        }
    }
}

/// Append the manifest's commands to Tauri's default menu, one submenu per
/// category. `file` merges into the existing File submenu behind a separator;
/// the rest become new top-level submenus.
pub fn extend_with_commands<R: Runtime>(
    handle: &AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let specs = commands();

    // A category with no submenu title would drop its commands out of the menu
    // without a trace, and the generated automation surface would still list
    // them. Say so instead.
    for spec in specs
        .iter()
        .filter(|s| submenu_title(&s.category).is_none())
    {
        eprintln!(
            "menu: command '{}' has category '{}', which has no submenu — it will not appear",
            spec.id, spec.category
        );
    }

    for (category, title) in CATEGORY_TITLES {
        let in_category: Vec<&CommandSpec> =
            specs.iter().filter(|s| s.category == *category).collect();
        if in_category.is_empty() {
            continue;
        }

        let existing = if MERGE_INTO_DEFAULT.contains(category) {
            find_submenu(menu, title)?
        } else {
            None
        };

        match existing {
            Some(submenu) => {
                submenu.append(&tauri::menu::PredefinedMenuItem::separator(handle)?)?;
                for spec in in_category {
                    submenu.append(&item(handle, spec)?)?;
                }
            }
            None => {
                let submenu = Submenu::new(handle, *title, true)?;
                for spec in in_category {
                    submenu.append(&item(handle, spec)?)?;
                }
                menu.append(&submenu)?;
            }
        }
    }

    Ok(())
}

fn item<R: Runtime>(handle: &AppHandle<R>, spec: &CommandSpec) -> tauri::Result<MenuItem<R>> {
    // Enabled at build time; `set_command_states` greys the project-gated ones
    // once the frontend reports whether a project is open. Items stay visible
    // either way, so a caller can see *why* it cannot act instead of hunting
    // for a menu entry that is not there.
    MenuItem::with_id(handle, &spec.id, &spec.label, true, None::<&str>)
}

/// Relabel About / Hide / Quit so they say AuricIDE, not the crate name.
pub fn polish_standard_items<R: Runtime>(menu: &Menu<R>) -> tauri::Result<()> {
    for kind in menu.items()? {
        let MenuItemKind::Submenu(submenu) = kind else {
            continue;
        };
        for item in submenu.items()? {
            match item {
                MenuItemKind::MenuItem(mi) => {
                    if let Ok(text) = mi.text() {
                        let next = display_app_menu_title(&text);
                        if next != text {
                            let _ = mi.set_text(next);
                        }
                    }
                }
                MenuItemKind::Predefined(pi) => {
                    if let Ok(text) = pi.text() {
                        let next = display_app_menu_title(&text);
                        if next != text {
                            let _ = pi.set_text(next);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn find_submenu<R: Runtime>(menu: &Menu<R>, title: &str) -> tauri::Result<Option<Submenu<R>>> {
    for kind in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = kind {
            if submenu.text().map(|t| t == title).unwrap_or(false) {
                return Ok(Some(submenu));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn the_embedded_manifest_parses() {
        assert!(
            !commands().is_empty(),
            "an empty menu would look like a working build"
        );
    }

    #[test]
    fn every_command_id_is_unique() {
        let specs = commands();
        let unique: HashSet<&str> = specs.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            unique.len(),
            specs.len(),
            "duplicate command id in manifest"
        );
    }

    /// axbridge addresses a menu item by its text path and resolves the first
    /// text match. Two identical paths would make `menu "View > X"` act on an
    /// arbitrary one of them — the same ambiguity the CLI now refuses.
    #[test]
    fn every_menu_path_is_unique() {
        let specs = commands();
        let mut seen: HashSet<String> = HashSet::new();
        let mut duplicates: Vec<String> = Vec::new();
        for spec in &specs {
            let path = menu_path(spec);
            if !seen.insert(path.clone()) {
                duplicates.push(path);
            }
        }
        assert!(
            duplicates.is_empty(),
            "ambiguous menu paths: {duplicates:?}"
        );
    }

    #[test]
    fn every_category_has_a_submenu_title() {
        let orphans: Vec<String> = commands()
            .into_iter()
            .filter(|s| submenu_title(&s.category).is_none())
            .map(|s| s.id)
            .collect();
        assert!(
            orphans.is_empty(),
            "commands whose category has no submenu: {orphans:?}"
        );
    }

    #[test]
    fn no_command_has_an_empty_label() {
        let blank: Vec<String> = commands()
            .iter()
            .filter(|s| s.label.trim().is_empty())
            .map(|s| s.id.clone())
            .collect();
        assert!(blank.is_empty(), "commands with no menu text: {blank:?}");
    }

    /// The Rust and TypeScript sides both read this list. Keeping it asserted
    /// on both ends is what makes the shared file a contract rather than a
    /// convention.
    #[test]
    fn the_project_gated_commands_are_the_expected_ones() {
        let mut gated: Vec<String> = commands()
            .iter()
            .filter(|s| s.requires_project)
            .map(|s| s.id.clone())
            .collect();
        gated.sort();
        assert_eq!(
            gated,
            vec![
                "excalidraw.new",
                "excalidraw.sync-all",
                "file.find-in-files",
                "file.import-video",
                "file.new",
                "git.commit",
                "git.compare-with-branch",
                "git.file-history",
                "git.next-hunk",
                "git.prev-hunk",
                "git.stage-all",
                "git.toggle-blame",
                "git.unstage-all",
                "view.toggle-terminal",
            ]
        );
    }

    #[test]
    fn the_debug_binary_plist_uses_the_same_bundle_id_as_the_packaged_app() {
        let plist = include_str!("../Info.plist");
        let conf = include_str!("../tauri.conf.json");
        assert!(
            plist.contains("<string>com.auricide.ide</string>"),
            "dev Info.plist must carry CFBundleIdentifier com.auricide.ide"
        );
        assert!(
            conf.contains("\"identifier\": \"com.auricide.ide\""),
            "tauri.conf.json identifier must stay in lockstep with Info.plist"
        );
    }

    #[test]
    fn app_menu_titles_use_the_product_name_not_the_crate_name() {
        assert_eq!(display_app_menu_title("About auric-ide"), "About AuricIDE");
        assert_eq!(display_app_menu_title("Hide auric-ide"), "Hide AuricIDE");
        assert_eq!(display_app_menu_title("Quit auric-ide"), "Quit AuricIDE");
        assert_eq!(display_app_menu_title("About AuricIDE"), "About AuricIDE");
    }

    /// Phase 2a ships without accelerators on purpose. A menu accelerator wins
    /// against the webview's own keydown handler, so adding one silently
    /// disables the in-app shortcut it duplicates.
    #[test]
    fn no_shortcut_is_registered_as_an_accelerator() {
        // The manifest may carry display strings; `item()` must not pass them
        // to Tauri. Guarded by construction — this test documents the rule and
        // fails loudly if someone starts reading `shortcut` in `item()`.
        let source = include_str!("menu.rs");
        let item_fn = source
            .split("fn item<R: Runtime>")
            .nth(1)
            .expect("item() must exist");
        let body = item_fn.split("\n}").next().unwrap_or("");
        assert!(
            !body.contains("spec.shortcut"),
            "item() must not turn a display shortcut into a menu accelerator"
        );
    }
}
