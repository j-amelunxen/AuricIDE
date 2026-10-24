//! Monthly JSONL log of finished agent tasks (`tasks-YYYY-MM.jsonl`).
//!
//! Each agent run shown on the timeline (`supervisorTimeline.ts`) leaves one
//! JSON object on a single line when it ends (exit, kill, or app shutdown),
//! split by calendar month of `finished_at` so a month's work can be read for
//! billing without scanning one unbounded file.
//!
//! Opt-in and off by default: the switch (`auric.task-log.enabled`) and the
//! optional custom folder (`auric.task-log.dir`) live in `localStorage` and
//! are mirrored into `<app_data_dir>/webview-prefs.json`. Like `usage_limits`,
//! this module reads that mirror directly rather than keeping a second copy.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::agent_usage::record::Outcome;
use crate::agents::{AgentInfo, AgentRole};

/// The `APP_CONFIG_KEYS.taskLogEnabled` entry from `src/lib/config/appConfig.ts`.
pub const ENABLED_PREF_KEY: &str = "auric.task-log.enabled";

/// The `APP_CONFIG_KEYS.taskLogDir` entry from `src/lib/config/appConfig.ts`.
pub const DIR_PREF_KEY: &str = "auric.task-log.dir";

/// Subdirectory inside `<app_data_dir>` when no custom folder is configured.
pub const DEFAULT_SUBDIR: &str = "task-logs";

/// Matches `BAR_LABEL_MAX` in `src/lib/agents/supervisorTimeline.ts`: a first
/// line up to 48 characters is a task caption; a longer one is a launch prompt
/// and falls back to the agent's name.
const TITLE_MAX_CHARS: usize = 48;

/// One finished task line in `tasks-YYYY-MM.jsonl`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogEntry {
    pub title: String,
    pub agent_id: String,
    pub name: String,
    pub role: AgentRole,
    pub provider: String,
    pub model: String,
    pub status: Outcome,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

/// Optional token and cost numbers when a run had usage evidence.
#[derive(Debug, Clone, Default)]
pub struct TaskUsageSummary {
    pub model: Option<String>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

impl TaskUsageSummary {
    pub fn from_usage_record(record: &crate::agent_usage::record::UsageRecord) -> Self {
        let has_tokens = record.input_tokens > 0 || record.output_tokens > 0;
        Self {
            model: record.model.clone(),
            cost_usd: record.cost_usd,
            input_tokens: has_tokens.then_some(record.input_tokens),
            output_tokens: has_tokens.then_some(record.output_tokens),
        }
    }

    pub fn from_cli_result(cli: &crate::agent_usage::claude::CliResult) -> Self {
        let counts = cli.total_counts();
        let has_tokens = counts.input > 0 || counts.output > 0;
        Self {
            model: None,
            cost_usd: cli.cost_usd(),
            input_tokens: has_tokens.then_some(counts.input),
            output_tokens: has_tokens.then_some(counts.output),
        }
    }
}

/// Reads whether task logging is enabled in `webview-prefs.json`.
pub fn enabled_in(prefs: &BTreeMap<String, String>) -> bool {
    prefs.get(ENABLED_PREF_KEY).map(String::as_str) == Some("true")
}

/// Resolves the directory where monthly JSONL files are written.
/// Uses the trimmed `auric.task-log.dir` preference when non-empty, otherwise
/// `<app_data_dir>/task-logs`.
pub fn resolve_log_dir(prefs: &BTreeMap<String, String>, app_data_dir: &Path) -> PathBuf {
    match prefs
        .get(DIR_PREF_KEY)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(custom) => PathBuf::from(custom),
        None => app_data_dir.join(DEFAULT_SUBDIR),
    }
}

/// File name for the month of `finished_at` (`tasks-YYYY-MM.jsonl`).
pub fn monthly_file_name(finished_at: DateTime<Utc>) -> String {
    format!("tasks-{}.jsonl", finished_at.format("%Y-%m"))
}

/// Full path to the monthly JSONL file inside `log_dir`.
pub fn monthly_file_path(log_dir: &Path, finished_at: DateTime<Utc>) -> PathBuf {
    log_dir.join(monthly_file_name(finished_at))
}

/// Derives the human-readable task title the same way `timelineBarLabel` in
/// `src/lib/agents/supervisorTimeline.ts` does.
pub fn task_title(name: &str, current_task: Option<&str>) -> String {
    let first = current_task
        .and_then(|task| task.lines().next())
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    if first.is_empty() || first.chars().count() > TITLE_MAX_CHARS {
        name.to_string()
    } else {
        first
    }
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Builds a `TaskLogEntry` from an `AgentInfo`, its finish time and outcome,
/// and any usage numbers gathered for the run.
pub fn build_entry(
    info: &AgentInfo,
    finished_at: DateTime<Utc>,
    status: Outcome,
    usage: Option<&TaskUsageSummary>,
) -> TaskLogEntry {
    let started_at = DateTime::from_timestamp_millis(info.started_at as i64).unwrap_or(finished_at);
    let duration_ms = (finished_at - started_at).num_milliseconds().max(0);
    let model = usage
        .and_then(|u| u.model.clone())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| info.model.clone());
    TaskLogEntry {
        title: task_title(&info.name, info.current_task.as_deref()),
        agent_id: info.id.clone(),
        name: info.name.clone(),
        role: info.role,
        provider: info.provider.clone(),
        model,
        status,
        started_at: rfc3339(started_at),
        finished_at: rfc3339(finished_at),
        duration_ms,
        project_path: info.project_path.clone(),
        cwd: info.repo_path.clone(),
        spawned_by_agent_id: info.spawned_by_agent_id.clone(),
        ticket_id: info.spawned_by_ticket_id.clone(),
        goal_id: info.spawned_by_goal_id.clone(),
        cost_usd: usage.and_then(|u| u.cost_usd),
        input_tokens: usage.and_then(|u| u.input_tokens),
        output_tokens: usage.and_then(|u| u.output_tokens),
    }
}

/// Appends `entry` as one JSON line to `tasks-YYYY-MM.jsonl` in `log_dir`,
/// creating `log_dir` if needed.
pub fn append_entry(
    log_dir: &Path,
    finished_at: DateTime<Utc>,
    entry: &TaskLogEntry,
) -> Result<PathBuf, String> {
    fs::create_dir_all(log_dir).map_err(|e| format!("Failed to create task log dir: {e}"))?;
    let path = monthly_file_path(log_dir, finished_at);
    let mut line =
        serde_json::to_string(entry).map_err(|e| format!("Failed to serialize task log: {e}"))?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open task log {}: {e}", path.display()))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write task log {}: {e}", path.display()))?;
    Ok(path)
}

/// Checks `webview-prefs.json` in `app_data_dir` and, when enabled, appends
/// `entry` to the configured or default monthly JSONL file.
pub fn record_finished_task_in(
    app_data_dir: &Path,
    info: &AgentInfo,
    finished_at: DateTime<Utc>,
    status: Outcome,
    usage: Option<&TaskUsageSummary>,
) -> Result<Option<PathBuf>, String> {
    let prefs =
        crate::webview_prefs::read_prefs(&crate::webview_prefs::prefs_path_in(app_data_dir));
    if !enabled_in(&prefs) {
        return Ok(None);
    }
    let log_dir = resolve_log_dir(&prefs, app_data_dir);
    let entry = build_entry(info, finished_at, status, usage);
    append_entry(&log_dir, finished_at, &entry).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_agent() -> AgentInfo {
        AgentInfo {
            id: "agent-7".to_string(),
            name: "SoftwareDev".to_string(),
            model: "opus".to_string(),
            provider: "claude".to_string(),
            status: crate::agents::AgentStatus::Running,
            current_task: Some("Draft the pricing page".to_string()),
            started_at: 1_761_240_000_000, // 2025-10-23T17:20:00Z
            last_activity_at: Some(1_761_240_060_000),
            project_path: Some("/Users/dev/project".to_string()),
            repo_path: Some("/Users/dev/project".to_string()),
            spawned_by_ticket_id: Some("ticket-1".to_string()),
            spawned_by_goal_id: Some("goal-2".to_string()),
            headless: false,
            role: AgentRole::Worker,
            spawned_by_agent_id: Some("agent-1".to_string()),
            supervisor_key: None,
            extra_mcp_servers: Vec::new(),
        }
    }

    #[test]
    fn off_by_default_and_enabled_only_when_pref_is_true() {
        let mut prefs = BTreeMap::new();
        assert!(!enabled_in(&prefs));

        prefs.insert(ENABLED_PREF_KEY.to_string(), "false".to_string());
        assert!(!enabled_in(&prefs));

        prefs.insert(ENABLED_PREF_KEY.to_string(), "yes".to_string());
        assert!(!enabled_in(&prefs));

        prefs.insert(ENABLED_PREF_KEY.to_string(), "true".to_string());
        assert!(enabled_in(&prefs));
    }

    #[test]
    fn uses_default_subdir_when_custom_dir_is_absent_or_blank() {
        let app_data = Path::new("/Users/dev/Library/Application Support/com.auricide.ide");
        let mut prefs = BTreeMap::new();
        assert_eq!(
            resolve_log_dir(&prefs, app_data),
            app_data.join("task-logs")
        );

        prefs.insert(DIR_PREF_KEY.to_string(), "   ".to_string());
        assert_eq!(
            resolve_log_dir(&prefs, app_data),
            app_data.join("task-logs")
        );

        prefs.insert(DIR_PREF_KEY.to_string(), " /Users/dev/billing ".to_string());
        assert_eq!(
            resolve_log_dir(&prefs, app_data),
            PathBuf::from("/Users/dev/billing")
        );
    }

    #[test]
    fn names_files_by_year_and_month_of_finish_timestamp() {
        let oct = Utc.with_ymd_and_hms(2026, 10, 23, 19, 58, 0).unwrap();
        let nov = Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 5).unwrap();

        assert_eq!(monthly_file_name(oct), "tasks-2026-10.jsonl");
        assert_eq!(monthly_file_name(nov), "tasks-2026-11.jsonl");
        assert_eq!(
            monthly_file_path(Path::new("/logs"), oct),
            PathBuf::from("/logs/tasks-2026-10.jsonl")
        );
    }

    #[test]
    fn derives_task_title_like_the_timeline_bar_caption() {
        assert_eq!(
            task_title("SoftwareDev", Some("  Fix billing\nDetails here")),
            "Fix billing"
        );
        assert_eq!(task_title("SoftwareDev", Some("   ")), "SoftwareDev");
        assert_eq!(task_title("SoftwareDev", None), "SoftwareDev");
        let long_prompt =
            "You are the AuricIDE supervisor. You orchestrate agents in other projects.";
        assert_eq!(task_title("SoftwareDev", Some(long_prompt)), "SoftwareDev");
    }

    #[test]
    fn builds_entry_with_duration_provider_model_and_optional_usage() {
        let info = sample_agent();
        let finished = DateTime::from_timestamp_millis(1_761_240_125_000).unwrap();
        let usage = TaskUsageSummary {
            model: Some("claude-opus-4-6".to_string()),
            cost_usd: Some(0.42),
            input_tokens: Some(12_000),
            output_tokens: Some(3_400),
        };

        let entry = build_entry(&info, finished, Outcome::Success, Some(&usage));

        assert_eq!(entry.title, "Draft the pricing page");
        assert_eq!(entry.agent_id, "agent-7");
        assert_eq!(entry.name, "SoftwareDev");
        assert_eq!(entry.provider, "claude");
        assert_eq!(entry.model, "claude-opus-4-6");
        assert_eq!(entry.duration_ms, 125_000);
        assert_eq!(entry.status, Outcome::Success);
        assert_eq!(entry.cost_usd, Some(0.42));
        assert_eq!(entry.input_tokens, Some(12_000));
        assert_eq!(entry.output_tokens, Some(3_400));
        assert_eq!(entry.project_path.as_deref(), Some("/Users/dev/project"));
        assert_eq!(entry.ticket_id.as_deref(), Some("ticket-1"));
        assert_eq!(entry.goal_id.as_deref(), Some("goal-2"));
        assert_eq!(entry.spawned_by_agent_id.as_deref(), Some("agent-1"));
    }

    #[test]
    fn rotates_files_across_months_and_appends_valid_jsonl_lines() {
        let dir = tempfile::tempdir().unwrap();
        let info = sample_agent();
        let oct = Utc.with_ymd_and_hms(2026, 10, 31, 23, 59, 0).unwrap();
        let nov = Utc.with_ymd_and_hms(2026, 11, 1, 0, 1, 0).unwrap();

        let first = build_entry(&info, oct, Outcome::Success, None);
        let mut second_info = info.clone();
        second_info.id = "agent-8".to_string();
        second_info.current_task = Some("Second task in October".to_string());
        let second = build_entry(&second_info, oct, Outcome::Error, None);

        let mut nov_info = info.clone();
        nov_info.id = "agent-9".to_string();
        nov_info.current_task = Some("November billing export".to_string());
        let third = build_entry(&nov_info, nov, Outcome::Killed, None);

        let oct_path = append_entry(dir.path(), oct, &first).unwrap();
        append_entry(dir.path(), oct, &second).unwrap();
        let nov_path = append_entry(dir.path(), nov, &third).unwrap();

        assert_eq!(oct_path, dir.path().join("tasks-2026-10.jsonl"));
        assert_eq!(nov_path, dir.path().join("tasks-2026-11.jsonl"));

        let oct_lines: Vec<TaskLogEntry> = fs::read_to_string(&oct_path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(oct_lines, vec![first, second]);

        let nov_lines: Vec<TaskLogEntry> = fs::read_to_string(&nov_path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(nov_lines, vec![third]);
    }

    #[test]
    fn records_from_prefs_only_when_enabled_and_honors_custom_dir() {
        let app_data = tempfile::tempdir().unwrap();
        let custom_dir = tempfile::tempdir().unwrap();
        let info = sample_agent();
        let finished = Utc.with_ymd_and_hms(2026, 10, 23, 20, 0, 0).unwrap();

        // Disabled by default -> writes nothing
        assert_eq!(
            record_finished_task_in(app_data.path(), &info, finished, Outcome::Success, None)
                .unwrap(),
            None
        );

        // Enable with default dir
        let mut prefs = BTreeMap::new();
        prefs.insert(ENABLED_PREF_KEY.to_string(), "true".to_string());
        crate::webview_prefs::write_prefs_atomic(
            &crate::webview_prefs::prefs_path_in(app_data.path()),
            &prefs,
        )
        .unwrap();

        let default_written =
            record_finished_task_in(app_data.path(), &info, finished, Outcome::Success, None)
                .unwrap()
                .unwrap();
        assert_eq!(
            default_written,
            app_data.path().join("task-logs/tasks-2026-10.jsonl")
        );
        assert!(default_written.exists());

        // Configure custom dir
        prefs.insert(
            DIR_PREF_KEY.to_string(),
            custom_dir.path().to_string_lossy().into_owned(),
        );
        crate::webview_prefs::write_prefs_atomic(
            &crate::webview_prefs::prefs_path_in(app_data.path()),
            &prefs,
        )
        .unwrap();

        let custom_written =
            record_finished_task_in(app_data.path(), &info, finished, Outcome::Success, None)
                .unwrap()
                .unwrap();
        assert_eq!(
            custom_written,
            custom_dir.path().join("tasks-2026-10.jsonl")
        );
        assert!(custom_written.exists());
    }
}
