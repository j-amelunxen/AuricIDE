//! Prices runs that were booked without a price, once the price list knows
//! their model.
//!
//! A run is booked with `cost_usd = NULL` when a model it used is missing from
//! the price list. Adding the model later does not reach those rows by itself:
//! the price is fixed when the run is booked. This pass reads each such run's
//! evidence again, prices it with the current list and writes the price, and
//! only the price. The tokens stay what was booked; a run whose evidence no
//! longer adds up to them is left alone rather than rewritten.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;

use super::claude::{find_session_files, session_tokens_between};
use super::record::{price_models, PriceLists};
use crate::cc_usage::pricing::TokenCounts;
use crate::providers::TranscriptFormat;

const CLAUDE_PROJECTS_DIR: &str = ".claude/projects";

/// Turn timestamps are whole seconds and the CLI stamps a turn before it
/// exits, so a turn of the run is never more than this past `finished_at`.
const FINISH_SLACK_SECS: i64 = 5;

/// What one pass did, for the sentence the settings screen shows.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepriceReport {
    /// Runs booked from a transcript or rollout that still had no price.
    pub unpriced: usize,
    /// Of those, the ones that have a price now.
    pub repriced: usize,
    /// The price list still does not know one of their models.
    pub still_unpriced: usize,
    /// The transcript is gone, or the provider no longer says where to look.
    pub missing_evidence: usize,
    /// The evidence no longer adds up to the booked tokens.
    pub changed_evidence: usize,
    /// Every model that still has no price, so the screen can name them.
    pub unpriced_models: Vec<String>,
}

/// The booked facts a run is priced from again.
struct Unpriced {
    id: String,
    provider: String,
    model: Option<String>,
    session_id: Option<String>,
    started_at: String,
    finished_at: String,
    booked: TokenCounts,
}

fn load_unpriced(conn: &Connection) -> Result<Vec<Unpriced>, String> {
    // `cli` rows carry the CLI's own figure and `none` rows have nothing to
    // price from; only an estimate can be priced again.
    let mut statement = conn
        .prepare(
            "SELECT id, provider, model, session_id, started_at, finished_at, input_tokens,
                    output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
             FROM pm_agent_usage
             WHERE cost_usd IS NULL AND cost_source = 'estimated'",
        )
        .map_err(|e| format!("Failed to read unpriced runs: {e}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(Unpriced {
                id: row.get(0)?,
                provider: row.get(1)?,
                model: row.get(2)?,
                session_id: row.get(3)?,
                started_at: row.get(4)?,
                finished_at: row.get(5)?,
                booked: TokenCounts {
                    input: row.get::<_, i64>(6)?.max(0) as u64,
                    output: row.get::<_, i64>(7)?.max(0) as u64,
                    cache_read: row.get::<_, i64>(8)?.max(0) as u64,
                    // Codex books every cache write at the 5-minute rate
                    // (`RolloutUsage::to_counts`); Claude rows are read again.
                    cache_write5m: row.get::<_, i64>(9)?.max(0) as u64,
                    thinking: row.get::<_, i64>(10)?.max(0) as u64,
                    ..Default::default()
                },
            })
        })
        .map_err(|e| format!("Failed to read unpriced runs: {e}"))?;
    rows.collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to read unpriced runs: {e}"))
}

fn parse_time(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

/// Whether the evidence read now is the evidence the run was booked from.
fn same_tokens(read: &TokenCounts, booked: &TokenCounts) -> bool {
    read.input == booked.input
        && read.output == booked.output
        && read.cache_read == booked.cache_read
        && read.cache_write5m + read.cache_write1h == booked.cache_write5m
}

enum Evidence {
    Found(BTreeMap<String, TokenCounts>),
    Missing,
    Changed,
}

/// A Claude run's tokens per model, read from its transcript the way the
/// booking read it, bounded by when the run ended.
fn claude_evidence(home: &Path, run: &Unpriced) -> Evidence {
    let (Some(session_id), Some(started), Some(finished)) = (
        run.session_id.as_deref(),
        parse_time(&run.started_at),
        parse_time(&run.finished_at),
    ) else {
        return Evidence::Missing;
    };
    let files = find_session_files(&home.join(CLAUDE_PROJECTS_DIR), session_id);
    if files.is_empty() {
        return Evidence::Missing;
    }
    let by_model = session_tokens_between(
        &files,
        started.timestamp(),
        finished.timestamp() + FINISH_SLACK_SECS,
    );
    let read = by_model
        .values()
        .fold(TokenCounts::default(), |mut sum, counts| {
            sum += *counts;
            sum
        });
    if same_tokens(&read, &run.booked) {
        Evidence::Found(by_model)
    } else {
        Evidence::Changed
    }
}

/// A Codex run is booked from one rollout with one model, and every column
/// the price needs is on the row, so nothing has to be read again.
fn codex_evidence(run: &Unpriced) -> Evidence {
    match &run.model {
        Some(model) => Evidence::Found(BTreeMap::from([(model.clone(), run.booked)])),
        None => Evidence::Missing,
    }
}

/// Prices every unpriced estimate of one project and writes the ones that now
/// have a price. `format_of` names a provider's transcript format, the same
/// lookup a spawn uses; a provider that no longer declares one is skipped.
pub fn reprice_unpriced(
    conn: &mut Connection,
    home: &Path,
    format_of: impl Fn(&str) -> Option<TranscriptFormat>,
    prices: &PriceLists,
) -> Result<RepriceReport, String> {
    let runs = load_unpriced(conn)?;
    let mut report = RepriceReport {
        unpriced: runs.len(),
        ..Default::default()
    };
    let mut still_unknown = BTreeSet::new();
    let mut priced_rows = Vec::new();

    for run in &runs {
        let (evidence, plugin) = match format_of(&run.provider) {
            Some(TranscriptFormat::ClaudeJsonl) => (claude_evidence(home, run), prices.claude),
            Some(TranscriptFormat::CodexRollout) => (codex_evidence(run), prices.codex),
            None => (Evidence::Missing, None),
        };
        let by_model = match evidence {
            Evidence::Found(by_model) => by_model,
            Evidence::Missing => {
                report.missing_evidence += 1;
                continue;
            }
            Evidence::Changed => {
                report.changed_evidence += 1;
                continue;
            }
        };
        // Priced by the day the run started, exactly as the booking did.
        let day = run.started_at.get(..10).unwrap_or_default();
        let priced = price_models(plugin, &by_model, day);
        match priced.cost_usd {
            Some(cost) => priced_rows.push((run.id.clone(), cost)),
            None => {
                report.still_unpriced += 1;
                still_unknown.extend(priced.unpriced);
            }
        }
    }

    // One transaction: a pass that fails halfway leaves every row as it was.
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start the repricing: {e}"))?;
    for (id, cost) in &priced_rows {
        tx.execute(
            "UPDATE pm_agent_usage SET cost_usd = ?1, unpriced_models = NULL
             WHERE id = ?2 AND cost_usd IS NULL",
            params![cost, id],
        )
        .map_err(|e| format!("Failed to write the price of run {id}: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to save the repricing: {e}"))?;

    report.repriced = priced_rows.len();
    report.unpriced_models = still_unknown.into_iter().collect();
    Ok(report)
}

#[cfg(test)]
#[path = "reprice_tests.rs"]
mod tests;
