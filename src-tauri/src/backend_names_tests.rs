//! Names the frontend spells too: the prefs Rust reads from the mirrored webview
//! prefs and the events it emits. Both sides read
//! `src/lib/tauri/backendNames.fixtures.json`.

use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../src/lib/tauri/backendNames.fixtures.json"
    ))
    .unwrap()
}

#[test]
fn pref_keys_match_the_frontend() {
    let keys = &fixture()["prefKeys"];
    assert_eq!(keys["taskLogEnabled"], crate::task_log::ENABLED_PREF_KEY);
    assert_eq!(keys["taskLogDir"], crate::task_log::DIR_PREF_KEY);
    assert_eq!(
        keys["cliUsageLimits"],
        crate::usage_limits::ENABLED_PREF_KEY
    );
    assert_eq!(
        keys["recentProjects"],
        crate::recent_projects::types::LEGACY_KEY
    );
    assert_eq!(
        keys["starredProjects"],
        crate::recent_projects::types::LEGACY_STARRED_KEY
    );
}

#[test]
fn event_names_match_the_frontend() {
    let events = &fixture()["events"];
    assert_eq!(
        events["notificationsChanged"],
        crate::notifications::CHANGED_EVENT
    );
    assert_eq!(
        events["usageLimitsChanged"],
        crate::usage_limits::CHANGED_EVENT
    );
    assert_eq!(
        events["fileEvents"],
        crate::commands::watcher_commands::FILE_EVENTS_EVENT
    );
    assert_eq!(
        events["agentWaitingChanged"],
        crate::agent_waiting::CHANGED_EVENT
    );
    assert_eq!(
        events["agentUsageRecorded"],
        crate::agent_usage::capture::USAGE_RECORDED_EVENT
    );
    assert_eq!(
        events["videoImportSetupProgress"],
        crate::video_import::installer::SETUP_PROGRESS_EVENT
    );
    assert_eq!(events["uiPing"], crate::ui_watchdog::PING_EVENT);
    assert_eq!(events["menuCommand"], crate::MENU_COMMAND_EVENT);
    assert_eq!(events["menuCloseTab"], crate::MENU_CLOSE_TAB_EVENT);
    assert_eq!(
        events["agentStatus"],
        crate::agents::types::AGENT_STATUS_EVENT
    );
    assert_eq!(
        fixture()["terminalOutputEventPrefix"],
        crate::commands::terminal_commands::TERMINAL_OUTPUT_EVENT_PREFIX
    );
}

#[test]
fn the_mcp_server_name_and_pruned_folders_match_the_frontend() {
    let names = fixture();
    assert_eq!(names["mcpServerName"], crate::mcp::AURIC_PM_SERVER);
    assert_eq!(
        names["fileListPrunedDirs"],
        serde_json::json!(crate::commands::fs_utils::FILE_LIST_PRUNED_DIRS)
    );
}

#[test]
fn the_id_prefix_that_marks_an_agent_written_schedule_matches_the_frontend() {
    assert_eq!(
        fixture()["mcpScheduleIdPrefix"],
        crate::schedules::database::MCP_SCHEDULE_ID_PREFIX
    );
}

#[test]
fn launch_grant_limits_and_run_statuses_match_the_frontend() {
    let names = fixture();
    assert_eq!(
        names["launchGrantLimits"]["maxConcurrent"],
        crate::notifications::operations::MAX_GRANT_CONCURRENT
    );
    assert_eq!(
        names["launchGrantLimits"]["maxBudget"],
        crate::notifications::operations::MAX_GRANT_BUDGET
    );
    assert_eq!(
        names["launchRunStatuses"],
        serde_json::json!(crate::notifications::operations::LAUNCH_RUN_STATUSES)
    );
}

#[test]
fn quick_access_limits_match_the_frontend() {
    let names = fixture();
    let limits = &names["quickAccessLimits"];
    assert_eq!(limits["dockMax"], crate::recent_projects::types::DOCK_MAX);
    assert_eq!(
        limits["badgeMaxChars"],
        crate::recent_projects::types::BADGE_MAX_CHARS
    );
}

#[test]
fn credential_namespaces_match_the_frontend() {
    use crate::app_config::namespaces;
    let names = &fixture()["credentialNamespaces"];
    assert_eq!(names["llm"], namespaces::LLM);
    assert_eq!(names["judge"], namespaces::JUDGE);
    assert_eq!(names["excalidraw"], namespaces::EXCALIDRAW);
    assert_eq!(names["videoImport"], namespaces::VIDEO_IMPORT);
    assert_eq!(names["pushover"], crate::delivery::PUSHOVER_NAMESPACE);
}

#[test]
fn ticket_statuses_and_priorities_match_the_frontend() {
    let names = fixture();
    assert_eq!(
        names["ticketStatuses"],
        serde_json::json!(crate::inbox::VALID_TICKET_STATUSES)
    );
    assert_eq!(
        names["priorities"],
        serde_json::json!(crate::inbox::VALID_PRIORITIES)
    );
}

#[test]
fn the_schedule_vocabulary_matches_the_frontend() {
    use crate::schedules::vocabulary;
    let words = &fixture()["scheduleVocabulary"];
    assert_eq!(
        words["specKinds"],
        serde_json::json!([vocabulary::CRON, vocabulary::EVERY])
    );
    assert_eq!(
        words["everyUnits"],
        serde_json::json!(vocabulary::EVERY_UNITS)
    );
    assert_eq!(
        words["catchUps"],
        serde_json::json!([vocabulary::COALESCE, vocabulary::SKIP, vocabulary::ALL])
    );
}
