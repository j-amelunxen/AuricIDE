use chrono::{DateTime, Utc};
use std::collections::{BTreeMap, HashMap, HashSet};

use super::types::*;
use crate::cc_usage::manifest::{rate_on, UsagePlugin};
use crate::cc_usage::pricing::{cache_saving_of, cost_of};
use crate::cc_usage::scan::{ScanStats, Turn};

/// One breakdown row while it is still being filled.
#[derive(Default)]
pub struct RowAccumulator {
    pub row: NamedAggregate,
    pub sessions: HashSet<String>,
    /// Cost per bucket start. Sparse — turned into a dense vector aligned with
    /// the window's buckets only for the rows that get drawn.
    pub series: BTreeMap<i64, f64>,
}

#[derive(Default)]
pub struct Accumulator {
    pub totals: Aggregate,
    pub models: HashMap<String, RowAccumulator>,
    pub projects: HashMap<String, RowAccumulator>,
    pub buckets: BTreeMap<i64, Bucket>,
    pub sessions: HashSet<String>,
    pub sidechain_messages: u64,
    pub unpriced: HashSet<String>,
}

/// The period before a window. Only totals — nobody asks for last week's
/// per-project breakdown, and carrying one would double the report for nothing.
#[derive(Default)]
pub struct PreviousAccumulator {
    pub totals: Aggregate,
    pub sessions: HashSet<String>,
    /// Whether the scan actually reached this far back.
    pub covered: bool,
}

/// A turn's cost, and the model identity it should be filed under.
pub struct Priced {
    pub key: String,
    pub label: String,
    pub cost: f64,
    pub cache_saving: f64,
    pub unpriced: bool,
}

pub fn price(plugin: &UsagePlugin, turn: &Turn) -> Priced {
    let normalized = crate::cc_usage::manifest::normalize_model_id(&turn.model);
    let Some(model) = plugin.model_for(&turn.model) else {
        return Priced {
            key: normalized.clone(),
            label: normalized,
            cost: 0.0,
            cache_saving: 0.0,
            unpriced: true,
        };
    };

    // Fast mode is the same model at a different price. Falling back to the
    // standard rates when a model has none declared is right: it means the
    // model has no separate fast pricing, not that the turn was free.
    let rates = match (turn.is_fast, &model.fast_rates) {
        (true, Some(fast)) => fast,
        _ => &model.rates,
    };

    let day = DateTime::<Utc>::from_timestamp(turn.at, 0)
        .map(|moment| moment.format("%Y-%m-%d").to_string())
        .unwrap_or_default();

    // A model may price its cached tokens differently from the rest of the
    // price list; `cache_multipliers` falls back to the shared set.
    let cache = model.cache_multipliers(&plugin.pricing.cache);

    let (cost, cache_saving) = match rate_on(rates, &day) {
        Some(rate) => (
            cost_of(&turn.counts, rate, cache, &plugin.pricing.server_tools),
            cache_saving_of(&turn.counts, rate, cache),
        ),
        None => (0.0, 0.0),
    };

    // Fast mode gets its own key, not just its own label. Sharing the model's
    // key would fold two different prices into one row whose cost no longer
    // divides by its tokens — the row would be arithmetically unexplainable.
    let (key, label) = if turn.is_fast {
        (
            format!("{}#fast", model.id),
            format!("{} (Fast)", model.label),
        )
    } else {
        (model.id.clone(), model.label.clone())
    };

    Priced {
        key,
        label,
        cost,
        cache_saving,
        unpriced: false,
    }
}

/// The name to show for a project, given its absolute path.
pub fn project_label(path: &str) -> String {
    if path.is_empty() {
        return "No project".to_string();
    }
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[allow(clippy::too_many_arguments)]
pub fn file_into(
    slot: &mut HashMap<String, RowAccumulator>,
    key: String,
    label: String,
    unpriced: bool,
    turn: &Turn,
    cost: f64,
    cache_saving: f64,
    bucket_start: i64,
) {
    let entry = slot.entry(key.clone()).or_insert_with(|| RowAccumulator {
        row: NamedAggregate {
            key,
            label,
            aggregate: Aggregate::default(),
            sessions: 0,
            unpriced,
            series: Vec::new(),
        },
        ..Default::default()
    });
    entry.row.aggregate.add(&turn.counts, cost, cache_saving);
    if !turn.session_id.is_empty() {
        entry.sessions.insert(turn.session_id.clone());
    }
    *entry.series.entry(bucket_start).or_insert(0.0) += cost;
}

/// Ranked rows, with a dense series on the ones that get drawn.
pub fn finish(slot: HashMap<String, RowAccumulator>, bucket_starts: &[i64]) -> Vec<NamedAggregate> {
    let mut rows: Vec<NamedAggregate> = slot
        .into_values()
        .map(|entry| {
            let mut row = entry.row;
            row.sessions = entry.sessions.len() as u64;
            row.series = bucket_starts
                .iter()
                .map(|start| entry.series.get(start).copied().unwrap_or(0.0))
                .collect();
            row
        })
        .collect();

    rows.sort_by(|a, b| {
        b.aggregate
            .cost
            .partial_cmp(&a.aggregate.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.aggregate
                    .counts
                    .billable()
                    .cmp(&a.aggregate.counts.billable())
            })
            .then_with(|| a.key.cmp(&b.key))
    });

    for row in rows.iter_mut().skip(SERIES_ROWS) {
        row.series.clear();
    }
    rows
}

/// Every window, filled from one pass over `turns`.
pub fn build_report(
    plugin: &UsagePlugin,
    turns: &[Turn],
    now: i64,
    stats: ScanStats,
    scan_ms: u64,
) -> UsageReport {
    let mut accumulators: Vec<Accumulator> =
        WINDOWS.iter().map(|_| Accumulator::default()).collect();
    let oldest = turns.iter().map(|turn| turn.at).min();
    let mut previous: Vec<PreviousAccumulator> = WINDOWS
        .iter()
        .map(|window| PreviousAccumulator {
            covered: oldest
                .map(|first| first <= now - 2 * window.hours * 3600)
                .unwrap_or(false),
            ..Default::default()
        })
        .collect();

    for turn in turns {
        if turn.at > now {
            continue;
        }
        let priced = price(plugin, turn);

        for (index, window) in WINDOWS.iter().enumerate() {
            let starts_at = now - window.hours * 3600;
            if turn.at < starts_at {
                let previous_start = starts_at - window.hours * 3600;
                if turn.at >= previous_start {
                    let earlier = &mut previous[index];
                    earlier
                        .totals
                        .add(&turn.counts, priced.cost, priced.cache_saving);
                    if !turn.session_id.is_empty() {
                        earlier.sessions.insert(turn.session_id.clone());
                    }
                }
                continue;
            }
            let accumulator = &mut accumulators[index];

            accumulator
                .totals
                .add(&turn.counts, priced.cost, priced.cache_saving);
            if turn.is_sidechain {
                accumulator.sidechain_messages += 1;
            }
            if !turn.session_id.is_empty() {
                accumulator.sessions.insert(turn.session_id.clone());
            }
            if priced.unpriced {
                accumulator.unpriced.insert(priced.label.clone());
            }

            let offset = (turn.at - starts_at) / window.bucket_seconds;
            let bucket_start = starts_at + offset * window.bucket_seconds;

            file_into(
                &mut accumulator.models,
                priced.key.clone(),
                priced.label.clone(),
                priced.unpriced,
                turn,
                priced.cost,
                priced.cache_saving,
                bucket_start,
            );
            file_into(
                &mut accumulator.projects,
                turn.project_path.clone(),
                project_label(&turn.project_path),
                false,
                turn,
                priced.cost,
                priced.cache_saving,
                bucket_start,
            );

            let bucket = accumulator.buckets.entry(bucket_start).or_insert(Bucket {
                starts_at: bucket_start,
                cost: 0.0,
                tokens: 0,
                messages: 0,
            });
            bucket.cost += priced.cost;
            bucket.tokens += turn.counts.billable();
            bucket.messages += 1;
        }
    }

    let windows = WINDOWS
        .iter()
        .zip(accumulators)
        .zip(previous)
        .map(|((window, accumulator), earlier)| {
            let starts_at = now - window.hours * 3600;
            let mut unpriced_models: Vec<String> = accumulator.unpriced.into_iter().collect();
            unpriced_models.sort();

            let mut buckets = Vec::new();
            let mut cursor = starts_at;
            while cursor < now {
                buckets.push(accumulator.buckets.get(&cursor).cloned().unwrap_or(Bucket {
                    starts_at: cursor,
                    cost: 0.0,
                    tokens: 0,
                    messages: 0,
                }));
                cursor += window.bucket_seconds;
            }

            let bucket_starts: Vec<i64> = buckets.iter().map(|bucket| bucket.starts_at).collect();

            WindowReport {
                id: window.id.to_string(),
                label: window.label.to_string(),
                hours: window.hours,
                starts_at,
                ends_at: now,
                bucket_seconds: window.bucket_seconds,
                totals: accumulator.totals,
                models: finish(accumulator.models, &bucket_starts),
                projects: finish(accumulator.projects, &bucket_starts),
                buckets,
                sessions: accumulator.sessions.len() as u64,
                sidechain_messages: accumulator.sidechain_messages,
                unpriced_models,
                previous: earlier.covered.then_some(earlier.totals),
            }
        })
        .collect();

    UsageReport {
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        currency: plugin.pricing.currency.clone(),
        generated_at: now,
        windows,
        files_scanned: stats.files_scanned,
        turns_read: stats.turns_read,
        duplicates_dropped: stats.duplicates_dropped,
        scan_ms,
    }
}
