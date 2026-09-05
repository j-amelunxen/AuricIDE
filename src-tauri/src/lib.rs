mod agent_log;
mod agent_persistence;
mod agents;
mod app_config;
mod cc_usage;
mod clipboard;
pub mod commands;
pub mod crashlog;
mod database;
mod excalidraw;
mod git;
mod ignored_repos;
mod inbox;
mod llm;
mod mcp;
mod memory_report;
#[cfg(target_os = "macos")]
mod menu;
mod notifications;
mod project_icons;
mod project_skills;
mod provider_policy;
mod providers;
mod recent_creations;
mod recent_projects;
mod schedules;
mod themes;
mod usage_limits;
mod utf8_stream;
mod video_import;
mod webview_prefs;

use agents::AgentManagerState;
pub use commands::*;
use database::DatabaseState;
use git::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                crashlog::set_crash_log_dir(log_dir);
            }
            app.manage(providers::new_provider_registry(Some(app.handle())));

            let recent_projects_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("recent-projects.json");
            app.manage(recent_projects::RecentProjectsState::initialize(
                recent_projects_path,
            ));
            // The notification inbox is app-global, not per project: agents run
            // in several repos at once here, and a message must still be waiting
            // when you come back to the project it came from.
            let notifications_db =
                notifications::db_path_in(&app.path().app_data_dir().map_err(|e| e.to_string())?);
            match notifications::init_db(&notifications_db) {
                Ok(conn) => {
                    let handle = app.handle().clone();
                    let watcher = notifications::watch_inbox(&notifications_db, move || {
                        let _ = handle.emit("notifications-changed", ());
                    })
                    .map_err(|error| {
                        eprintln!("Notification inbox watcher unavailable: {error}");
                        error
                    })
                    .ok();
                    app.manage(notifications::NotificationsState {
                        conn: std::sync::Mutex::new(conn),
                        watcher: std::sync::Mutex::new(watcher),
                    });
                    spawn_schedule_runner(app.handle().clone());
                }
                // A missing inbox must not stop the IDE from opening. The
                // commands then fail loudly per call instead.
                Err(error) => eprintln!("Notification inbox unavailable: {error}"),
            }

            // The GTD inbox is app-global for the same reason: a captured
            // thought does not yet belong to any one project.
            let task_inbox_db =
                inbox::db_path_in(&app.path().app_data_dir().map_err(|e| e.to_string())?);
            match inbox::init_db(&task_inbox_db) {
                Ok(conn) => {
                    app.manage(inbox::InboxState {
                        conn: std::sync::Mutex::new(conn),
                        attachments_dir: inbox::attachments_dir_in(
                            &app.path().app_data_dir().map_err(|e| e.to_string())?,
                        ),
                    });
                }
                // A missing inbox must not stop the IDE from opening either.
                Err(error) => eprintln!("Task inbox unavailable: {error}"),
            }

            // The agent activity log is app-global for the same reason. Only
            // the path is settled here: the store opens its database on first
            // use, so a user who leaves history off never gets a file.
            app.manage(agent_log::AgentLogState::new(agent_log::db_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            )));

            // The webview's own localStorage is scoped by data store and page
            // origin, neither of which matches between the dev binary and the
            // bundled app. Mirroring it here puts it on the same footing as
            // everything else the backend keeps: one file, one identifier.
            let webview_prefs_path = webview_prefs::prefs_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            );
            app.manage(webview_prefs::WebviewPrefsState::new(webview_prefs_path));

            // Credentials are application-wide too, but they stay out of the
            // mirror above: that store exists to copy whatever the webview puts
            // in localStorage, and an API key does not belong in a second copy
            // inside a WebKit database. This one is written by Rust at 0600.
            let credentials_path = app_config::credentials_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            );
            app.manage(app_config::AppCredentialsState::new(credentials_path));

            // CLI quota readings for the status bar. The service reads its own
            // on/off switch out of the mirror above on every call, so nothing
            // here decides whether it runs — only where it keeps its state.
            app.manage(usage_limits::UsageLimitsService::new(
                app.path().app_data_dir().map_err(|e| e.to_string())?,
            ));
            usage_limits::install_claude_watcher(app.handle());
            usage_limits::spawn_usage_limits_runner(app.handle().clone());

            // Historical spend, read from the CLIs' own transcripts. Separate
            // from the quota above on purpose: that one is a fuel gauge, this
            // one is a logbook, and neither can be derived from the other.
            app.manage(cc_usage::CcUsageService::new(
                app.path().app_data_dir().ok(),
                app.path().resource_dir().ok(),
                app.path().home_dir().map_err(|e| e.to_string())?,
            ));

            let starred_projects_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("starred-projects.json");
            app.manage(recent_projects::StarredProjectsState::initialize(
                starred_projects_path,
            ));

            // Restart persistence: agents running when the app last quit are
            // loaded as "interrupted" and offered for resume in the frontend.
            let persistence_path = app
                .path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("active-agents.json"));
            let persistence = agent_persistence::new_agent_persistence_state(persistence_path);
            // Seed the agent id counter past restored ids so a new spawn never
            // reuses the id of an interrupted agent still shown in the UI.
            let max_restored = persistence
                .lock()
                .map(|p| p.max_agent_number())
                .unwrap_or(0);
            app.manage(persistence);
            if max_restored > 0 {
                let manager_state = app.state::<AgentManagerState>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    let mut manager = manager_state.lock().await;
                    manager.counter = manager.counter.max(max_restored);
                });
            }

            // Pre-resolve the login-shell environment in the background so the
            // first agent spawn doesn't pay for it (see agents::warm_shell_env_cache).
            tauri::async_runtime::spawn(agents::warm_shell_env_cache());
            Ok(())
        })
        .manage(DatabaseState {
            connections: Mutex::new(HashMap::new()),
        })
        .manage(agents::new_agent_manager_state())
        .manage(mcp::McpServerState::new())
        .manage(Arc::new(recent_creations::RecentCreations::default()))
        .manage(WatcherState {
            watchers: Mutex::new(HashMap::new()),
        })
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            exists,
            is_dir,
            list_all_files,
            get_project_files_info,
            search_in_files,
            read_file,
            read_file_base64,
            write_file,
            copy_file,
            delete_file,
            create_directory,
            move_path,
            save_temp_image,
            save_image_to_path,
            get_scratch_dir,
            check_cli_status,
            clipboard::clipboard_write_text,
            clipboard::clipboard_read_text,
            watch_directory,
            unwatch_directory,
            shell_spawn,
            shell_write,
            shell_resize,
            git_status,
            git_discover_repos,
            git_projects_dirty,
            git_branch_info,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_push,
            git_log_since,
            git_discard,
            git_list_branches,
            git_blame,
            git_diff_commit,
            git_diff_ref_files,
            git_diff_file_ref,
            git_worktree_add,
            git_worktree_list,
            git_worktree_remove,
            git_default_branch,
            git_worktree_merge_into_default,
            list_agents,
            spawn_agent,
            kill_agent,
            kill_agents_for_repo,
            rename_agent,
            list_interrupted_agents,
            resume_interrupted_agent,
            discard_interrupted_agent,
            list_providers,
            import_provider,
            list_themes,
            import_theme,
            get_prompt_template,
            get_system_memory,
            init_project_db,
            db_get,
            db_set,
            db_delete,
            db_list,
            db_export,
            db_import,
            close_project_db,
            pm_save,
            pm_load,
            pm_load_history,
            pm_clear,
            pm_latest_ticket_review,
            agent_prompt_history_add,
            agent_prompt_history_list,
            blueprints_save,
            blueprints_load,
            blueprints_clear,
            requirements_save,
            requirements_load,
            requirements_clear,
            notifications_dispatch,
            notifications_list,
            notifications_mark_read,
            notifications_mark_all_read,
            notifications_answer,
            notifications_unread_count,
            notifications_clear,
            notifications_delete,
            inbox_list,
            inbox_add,
            inbox_update,
            inbox_dismiss,
            inbox_assign,
            inbox_unassign,
            inbox_attach,
            inbox_attach_text,
            inbox_detach,
            inbox_set_ticket_status,
            projects_pm_overview,
            agent_log_append,
            agent_log_load,
            agent_log_prune,
            agent_log_purge,
            schedules_list,
            schedules_upsert,
            schedules_delete,
            schedules_set_enabled,
            schedules_preview,
            goals_save,
            goals_load,
            goals_clear,
            append_metrics_log,
            report_frontend_crash,
            list_crash_logs,
            read_crash_log,
            llm_call,
            excalidraw_test_connection,
            excalidraw_list_collections,
            excalidraw_list_scenes,
            excalidraw_get_scene_content,
            excalidraw_scene_url,
            start_mcp,
            stop_mcp,
            mcp_status,
            set_menu_command_states,
            recent_projects::recent_projects_list,
            recent_projects::recent_projects_import,
            recent_projects::recent_projects_add,
            recent_projects::recent_projects_remove,
            recent_projects::starred_projects_list,
            recent_projects::starred_projects_import,
            recent_projects::starred_projects_add,
            recent_projects::starred_projects_remove,
            recent_projects::starred_projects_update_settings,
            webview_prefs::webview_prefs_sync,
            webview_prefs::webview_prefs_set,
            webview_prefs::webview_prefs_remove,
            app_config::app_credential_list,
            app_config::app_credential_set,
            usage_limits::usage_limits_read,
            usage_limits::usage_limits_refresh,
            cc_usage::cc_usage_plugins,
            cc_usage::cc_usage_report,
            project_skills::project_skills_list,
            project_icons::project_icon_candidates,
            video_import::video_import_analyze_media,
            video_import::video_import_preflight,
            video_import::video_import_install_local,
            video_import::video_import_save_process,
            video_import::video_import_clear
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(agents::cleanup_all_agents(app));
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|handle| {
            use tauri::menu::{Menu, MenuItem, MenuItemKind};

            let menu = Menu::default(handle)?;
            for item in menu.items()? {
                let MenuItemKind::Submenu(submenu) = item else {
                    continue;
                };
                let is_file_menu = submenu.text().map(|t| t == "File").unwrap_or(false);
                for (position, sub_item) in submenu.items()?.iter().enumerate() {
                    let is_close_window = match sub_item {
                        MenuItemKind::Predefined(predefined) => predefined
                            .text()
                            .map(|t| t == "Close Window")
                            .unwrap_or(false),
                        _ => false,
                    };
                    if !is_close_window {
                        continue;
                    }
                    submenu.remove_at(position)?;
                    if is_file_menu {
                        submenu.insert(
                            &MenuItem::with_id(
                                handle,
                                "close_tab",
                                "Close Tab",
                                true,
                                Some("CmdOrCtrl+W"),
                            )?,
                            position,
                        )?;
                        submenu.insert(
                            &MenuItem::with_id(
                                handle,
                                "close_window",
                                "Close Window",
                                true,
                                Some("Shift+CmdOrCtrl+W"),
                            )?,
                            position + 1,
                        )?;
                    }
                    break;
                }
            }
            menu::extend_with_commands(handle, &menu)?;
            menu::polish_standard_items(&menu)?;

            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "close_tab" => {
                    let _ = app.emit("menu:close-tab", ());
                }
                "close_window" => {
                    let focused = app
                        .webview_windows()
                        .into_values()
                        .find(|w| w.is_focused().unwrap_or(false));
                    if let Some(window) = focused {
                        let _ = window.close();
                    }
                }
                other if other.contains('.') => {
                    let _ = app.emit("menu:command", other);
                }
                _ => {}
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
