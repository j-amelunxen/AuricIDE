//! What one agent run cost: tokens and USD, recorded when the run ends.
//!
//! The contract is `docs/design-agent-usage.md`. Exact where the CLI tells us
//! (Claude's result object), read from the transcript where it does not, and
//! only the USD figure is ever ours.

pub mod capture;
pub mod claude;
pub mod codex;
pub mod holdback;
pub mod launch;
pub mod record;
pub mod reprice;
pub mod store;

#[cfg(test)]
mod real_cli_tests;

/// Codex is priced from its own list, compiled in like the Claude one
/// (`cc_usage/default-manifest.json`), in the same schema.
pub const CODEX_PRICING: &str = include_str!("codex-pricing.json");

use record::UsageRecord;

/// Every recorded run of the project, newest first. A folder that is not an
/// initialised project has none.
fn load_for_project(project_path: &str) -> Result<Vec<UsageRecord>, String> {
    match store::open_existing(std::path::Path::new(project_path))? {
        Some(conn) => store::load(&conn),
        None => Ok(Vec::new()),
    }
}

/// `#[tauri::command(async)]` so the read runs off the main thread.
#[tauri::command(async)]
pub fn agent_usage_load(project_path: String) -> Result<Vec<UsageRecord>, String> {
    load_for_project(&project_path)
}

/// Prices the project's runs that were booked without a price, with the price
/// lists as they are on disk now — an entry added since launch counts.
#[tauri::command(async)]
pub fn agent_usage_reprice(
    app: tauri::AppHandle,
    providers: tauri::State<'_, crate::providers::ProviderRegistryState>,
    project_path: String,
) -> Result<reprice::RepriceReport, String> {
    use tauri::Manager;

    let Some(mut conn) = store::open_existing(std::path::Path::new(&project_path))? else {
        return Ok(reprice::RepriceReport::default());
    };
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("No home directory: {e}"))?;
    let claude = app
        .try_state::<crate::cc_usage::CcUsageService>()
        .and_then(|service| service.plugin_from_disk("claude-code"));
    let registry = providers.inner().clone();
    reprice::reprice_unpriced(
        &mut conn,
        &home,
        |provider| {
            registry
                .get(provider)
                .and_then(|p| p.usage_config())
                .and_then(|usage| usage.transcript)
                .map(|transcript| transcript.format)
        },
        &record::PriceLists {
            claude: claude.as_ref(),
            codex: capture::codex_price_list(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_that_is_not_a_project_has_no_usage_and_stays_untouched() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(
            load_for_project(dir.path().to_str().unwrap()).unwrap(),
            vec![]
        );
        assert!(!dir.path().join(".auric").exists());
    }

    #[test]
    fn a_projects_recorded_runs_are_loaded_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        crate::database::init_db(path).unwrap();
        let conn = store::open_existing(dir.path()).unwrap().unwrap();
        for (id, started) in [
            ("old", "2026-09-30T08:00:00.000Z"),
            ("new", "2026-09-30T09:00:00.000Z"),
        ] {
            conn.execute(
                "INSERT INTO pm_agent_usage (id, agent_id, run_kind, run_source, provider,
                    started_at, finished_at, duration_ms, outcome, cost_source)
                 VALUES (?1, 'a', 'other', 'ui', 'claude', ?2, ?2, 0, 'success', 'none')",
                rusqlite::params![id, started],
            )
            .unwrap();
        }

        let ids: Vec<String> = load_for_project(path)
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();

        assert_eq!(ids, ["new", "old"]);
    }
}
