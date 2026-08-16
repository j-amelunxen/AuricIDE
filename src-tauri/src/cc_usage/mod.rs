//! Historical CLI usage — what was actually spent, over 24 hours to 30 days.
//!
//! This is the twin of `usage_limits`, and the two answer different questions
//! that are easy to confuse. `usage_limits` reports **how full the quota
//! window is right now**, live, from the CLI's own status line. This module
//! reports **what has been consumed over a period**, reconstructed from the
//! transcripts Claude Code writes to disk. One is a fuel gauge, the other is a
//! logbook; neither can be derived from the other.
//!
//! It is built as a *plugin* rather than as more built-in surface: what a
//! usage source is — where its records live and what its tokens cost — is
//! declared in `usage-plugins/*.json` (see `manifest.rs`), so a price change
//! is a file and a second agent CLI is a second file. Only the reader for the
//! `claude-jsonl` source shape is compiled in.
//!
//! Reading is on demand and cached briefly. The corpus is gigabytes, so a scan
//! is not free, and a panel that rescans on every re-render would make opening
//! it feel broken.

pub mod manifest;
pub mod pricing;
pub mod report;
pub mod scan;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use manifest::UsagePlugin;
use report::UsageReport;

/// How long a report is reused before the transcripts are read again.
///
/// Short enough that a run finishing while the panel is open shows up on the
/// next refresh; long enough that switching between the four windows — which
/// is one report, not four — never triggers a rescan.
const CACHE_TTL_SECS: i64 = 60;

/// What the frontend needs to name a plugin before any report exists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub currency: String,
    /// False when none of the plugin's roots exist on this machine — the
    /// difference between "you have not used this CLI" and "this plugin is
    /// pointed at a directory that is not here".
    pub available: bool,
}

pub struct CcUsageService {
    plugins: Vec<UsagePlugin>,
    home: PathBuf,
    cache: Mutex<HashMap<String, (i64, UsageReport)>>,
    /// Single-flight. Two panels opening at once must not both walk the corpus.
    scan_lock: tokio::sync::Mutex<()>,
}

impl CcUsageService {
    pub fn new(
        app_data_dir: Option<PathBuf>,
        resource_dir: Option<PathBuf>,
        home: PathBuf,
    ) -> Self {
        let dirs = manifest::search_paths(app_data_dir.as_deref(), resource_dir.as_deref());
        Self {
            plugins: manifest::load_plugins(&dirs),
            home,
            cache: Mutex::new(HashMap::new()),
            scan_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn summaries(&self) -> Vec<PluginSummary> {
        self.plugins
            .iter()
            .map(|plugin| PluginSummary {
                id: plugin.id.clone(),
                name: plugin.name.clone(),
                currency: plugin.pricing.currency.clone(),
                available: plugin.roots(&self.home).iter().any(|root| root.is_dir()),
            })
            .collect()
    }

    fn plugin(&self, id: Option<&str>) -> Option<&UsagePlugin> {
        match id {
            Some(wanted) => self.plugins.iter().find(|plugin| plugin.id == wanted),
            None => self.plugins.first(),
        }
    }

    fn cached(&self, id: &str, now: i64) -> Option<UsageReport> {
        let cache = self.cache.lock().ok()?;
        let (generated_at, report) = cache.get(id)?;
        (now - generated_at < CACHE_TTL_SECS).then(|| report.clone())
    }

    /// Reads the transcripts and builds every window.
    pub async fn report(
        &self,
        id: Option<&str>,
        force: bool,
        now: i64,
    ) -> Result<UsageReport, String> {
        let plugin = self
            .plugin(id)
            .ok_or_else(|| match id {
                Some(wanted) => format!("No usage plugin with id \"{wanted}\""),
                None => "No usage plugin available".to_string(),
            })?
            .clone();

        if !force {
            if let Some(report) = self.cached(&plugin.id, now) {
                return Ok(report);
            }
        }

        let _flight = self.scan_lock.lock().await;
        // Another caller may have finished the scan while this one waited.
        if !force {
            if let Some(report) = self.cached(&plugin.id, now) {
                return Ok(report);
            }
        }

        let roots = plugin.roots(&self.home);
        let since = report::earliest_start(now);

        // The walk is blocking and can take seconds on a large corpus; keeping
        // it on the async runtime's worker would stall every other command.
        let started = std::time::Instant::now();
        let scanned = tokio::task::spawn_blocking(move || scan::collect_turns(&roots, since))
            .await
            .map_err(|error| format!("Usage scan aborted: {error}"))?;
        let elapsed = started.elapsed().as_millis() as u64;

        let (turns, stats) = scanned;
        let built = report::build_report(&plugin, &turns, now, stats, elapsed);

        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(plugin.id.clone(), (now, built.clone()));
        }

        Ok(built)
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn cc_usage_plugins(
    service: tauri::State<'_, CcUsageService>,
) -> Result<Vec<PluginSummary>, String> {
    Ok(service.summaries())
}

#[tauri::command]
pub async fn cc_usage_report(
    service: tauri::State<'_, CcUsageService>,
    plugin_id: Option<String>,
    force: Option<bool>,
) -> Result<UsageReport, String> {
    let now = chrono::Utc::now().timestamp();
    service
        .report(plugin_id.as_deref(), force.unwrap_or(false), now)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn service_with_home(home: PathBuf) -> CcUsageService {
        CcUsageService::new(None, None, home)
    }

    #[test]
    fn the_built_in_plugin_is_available_without_any_files() {
        // A fresh clone has no usage-plugins directory. If the feature needed
        // one, it would be dead on arrival for everyone who never wrote it.
        let dir = tempfile::tempdir().unwrap();
        let service = service_with_home(dir.path().to_path_buf());
        let summaries = service.summaries();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "claude-code");
        assert_eq!(summaries[0].currency, "USD");
    }

    #[test]
    fn a_plugin_whose_roots_are_absent_reports_itself_unavailable() {
        // "You have not used this CLI" and "this plugin points somewhere that
        // does not exist" need to look different to the user.
        let dir = tempfile::tempdir().unwrap();
        let service = service_with_home(dir.path().to_path_buf());
        assert!(!service.summaries()[0].available);

        fs::create_dir_all(dir.path().join(".claude/projects")).unwrap();
        let service = service_with_home(dir.path().to_path_buf());
        assert!(service.summaries()[0].available);
    }

    #[tokio::test]
    async fn an_unknown_plugin_id_is_an_error_rather_than_a_silent_default() {
        // Falling back to the first plugin would report Claude Code's numbers
        // under another plugin's name.
        let dir = tempfile::tempdir().unwrap();
        let service = service_with_home(dir.path().to_path_buf());
        let error = service
            .report(Some("not-a-plugin"), false, 1_787_400_000)
            .await
            .expect_err("unknown id");
        assert!(error.contains("not-a-plugin"), "{error}");
    }

    #[tokio::test]
    async fn a_machine_with_no_transcripts_reports_empty_windows_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        let service = service_with_home(dir.path().to_path_buf());
        let report = service.report(None, false, 1_787_400_000).await.unwrap();
        assert_eq!(report.plugin_id, "claude-code");
        assert_eq!(report.windows.len(), 4);
        assert!(report.windows.iter().all(|w| w.totals.messages == 0));
        assert_eq!(report.files_scanned, 0);
    }

    #[tokio::test]
    async fn a_second_read_inside_the_ttl_reuses_the_first_report() {
        // The corpus is gigabytes; re-walking it because a panel re-rendered
        // is the difference between the feature feeling instant and broken.
        let dir = tempfile::tempdir().unwrap();
        let projects = dir.path().join(".claude/projects");
        fs::create_dir_all(&projects).unwrap();
        let service = service_with_home(dir.path().to_path_buf());

        let now = 1_787_400_000;
        let first = service.report(None, false, now).await.unwrap();

        // Write a transcript *after* the first read. A cached answer cannot
        // have seen it; a fresh scan must.
        fs::write(
            projects.join("s.jsonl"),
            format!(
                r#"{{"type":"assistant","timestamp":"{}","requestId":"r1","sessionId":"s1","cwd":"/tmp/alpha","message":{{"id":"m1","model":"claude-opus-5","usage":{{"input_tokens":1000,"output_tokens":1000}}}}}}"#,
                chrono::DateTime::<chrono::Utc>::from_timestamp(now - 60, 0)
                    .unwrap()
                    .to_rfc3339()
            ),
        )
        .unwrap();

        let cached = service.report(None, false, now + 1).await.unwrap();
        assert_eq!(cached.generated_at, first.generated_at);
        assert_eq!(cached.windows[0].totals.messages, 0);

        let forced = service.report(None, true, now + 2).await.unwrap();
        assert_eq!(
            forced.windows[0].totals.messages, 1,
            "a forced refresh must re-read the transcripts"
        );
    }

    /// The only place the scanner is exercised against a real corpus.
    ///
    /// Everything else in this module runs on transcripts the tests wrote, so
    /// it proves the code agrees with our idea of the format. This one proves
    /// the format is what we think it is, and that the scan is fast enough to
    /// sit behind a click. Ignored because it depends on the machine having
    /// been used; run it with:
    ///
    /// ```text
    /// cargo test cc_usage -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore]
    async fn reads_this_machine() {
        let Some(home) = dirs::home_dir() else {
            eprintln!("no home directory");
            return;
        };
        let service = service_with_home(home);
        let now = chrono::Utc::now().timestamp();

        let started = std::time::Instant::now();
        let report = service.report(None, true, now).await.expect("a report");
        let elapsed = started.elapsed();

        println!(
            "\nscanned {} files, {} turns ({} duplicates) in {:?} (scan {} ms)",
            report.files_scanned,
            report.turns_read,
            report.duplicates_dropped,
            elapsed,
            report.scan_ms,
        );

        for window in &report.windows {
            let comparison = match &window.previous {
                Some(previous) if previous.cost > 0.0 => format!(
                    "{:+.0}% vs the {} before ({:.2})",
                    (window.totals.cost - previous.cost) / previous.cost * 100.0,
                    window.label,
                    previous.cost,
                ),
                Some(_) => "earlier period spent nothing".to_string(),
                None => "history too short to compare".to_string(),
            };
            println!("\n  ({comparison})");
            println!(
                "{:>10}  {:>10.2} {}  {:>12} tokens  {:>5} turns  {:>4} sessions  {:>3} projects",
                window.label,
                window.totals.cost,
                report.currency,
                window.totals.counts.billable(),
                window.totals.messages,
                window.sessions,
                window.projects.len(),
            );
            for model in window.models.iter().take(4) {
                println!(
                    "             {:<18} {:>8.2}  {:>12} tokens{}",
                    model.label,
                    model.aggregate.cost,
                    model.aggregate.counts.billable(),
                    if model.unpriced { "  (unpriced)" } else { "" },
                );
            }
            if !window.unpriced_models.is_empty() {
                println!("             unpriced: {:?}", window.unpriced_models);
            }
        }

        // The windows nest, so their totals must too. A violation here means
        // the one-pass fill is filing turns into the wrong windows — which no
        // synthetic fixture would catch at this scale.
        for pair in report.windows.windows(2) {
            assert!(
                pair[1].totals.counts.billable() >= pair[0].totals.counts.billable(),
                "{} must contain at least what {} does",
                pair[1].label,
                pair[0].label,
            );
        }
    }

    #[tokio::test]
    async fn a_report_past_the_ttl_is_rebuilt() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".claude/projects")).unwrap();
        let service = service_with_home(dir.path().to_path_buf());

        let now = 1_787_400_000;
        service.report(None, false, now).await.unwrap();
        let later = service
            .report(None, false, now + CACHE_TTL_SECS + 1)
            .await
            .unwrap();
        assert_eq!(later.generated_at, now + CACHE_TTL_SECS + 1);
    }
}
