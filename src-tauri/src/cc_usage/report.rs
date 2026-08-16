//! Turning a flat list of billable turns into the thing the panel renders.
//!
//! One pass over the turns fills every window at once. The windows nest — a
//! turn inside the last 24 hours is also inside the last 30 days — so walking
//! the list once per window would read the same turns four times for no gain.
//!
//! Two rules hold throughout, and both exist so a number on screen can always
//! be traced back to a rate:
//!
//! * **A turn is priced by the day it happened**, not by today's price list.
//!   Introductory pricing is real and a 30-day report can span its end.
//! * **A model the price list has never heard of still contributes tokens, and
//!   contributes no cost.** Its name is carried out on `unpricedModels`, so a
//!   total that is missing money says so instead of quietly being wrong.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::manifest::{rate_on, UsagePlugin};
use super::pricing::{cache_saving_of, cost_of, TokenCounts};
use super::scan::{ScanStats, Turn};

/// One reporting period, and how finely it is bucketed for the chart.
#[derive(Debug, Clone, Copy)]
pub struct WindowSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub hours: i64,
    /// Chosen so every window renders as roughly 24–30 bars. A 30-day window
    /// bucketed hourly would be 720 bars in a panel a few hundred pixels wide.
    pub bucket_seconds: i64,
}

/// The four periods the panel offers.
pub const WINDOWS: [WindowSpec; 4] = [
    WindowSpec {
        id: "24h",
        label: "24 hours",
        hours: 24,
        bucket_seconds: 60 * 60,
    },
    WindowSpec {
        id: "3d",
        label: "3 days",
        hours: 72,
        bucket_seconds: 3 * 60 * 60,
    },
    WindowSpec {
        id: "7d",
        label: "7 days",
        hours: 168,
        bucket_seconds: 6 * 60 * 60,
    },
    WindowSpec {
        id: "30d",
        label: "30 days",
        hours: 720,
        bucket_seconds: 24 * 60 * 60,
    },
];

/// How many rows get a sparkline. The panel shows eight; a couple spare keeps
/// the series available if it ever shows more, without serializing a time
/// series for all several hundred projects.
const SERIES_ROWS: usize = 12;

/// The oldest instant any report needs.
///
/// Twice the widest window, because every window is reported against the
/// period immediately before it — a 30-day figure with nothing to compare it
/// to is a number the reader cannot judge. This doubles the scan, which is
/// what the 60-second cache is for.
pub fn earliest_start(now: i64) -> i64 {
    now - 2 * WINDOWS.iter().map(|window| window.hours).max().unwrap_or(0) * 3600
}

// ---------------------------------------------------------------------------
// The shape that crosses IPC
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub counts: TokenCounts,
    pub cost: f64,
    /// What the prompt cache saved — see `pricing::cache_saving_of`. Reported
    /// beside the cost rather than netted into it, because a cost that already
    /// had a saving subtracted could not be checked against a rate.
    pub cache_saving: f64,
    pub messages: u64,
}

impl Aggregate {
    fn add(&mut self, counts: &TokenCounts, cost: f64, cache_saving: f64) {
        self.counts += *counts;
        self.cost += cost;
        self.cache_saving += cache_saving;
        self.messages += 1;
    }
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedAggregate {
    /// The raw identity — a normalized model id, or a project's absolute path.
    pub key: String,
    /// What to show: the manifest's label, or the project directory's name.
    pub label: String,
    pub aggregate: Aggregate,
    pub sessions: u64,
    /// Only meaningful for models: no rate was found, so `cost` is zero and
    /// understates the window.
    #[serde(default)]
    pub unpriced: bool,
    /// Cost per bucket, aligned index-for-index with the window's `buckets`.
    ///
    /// This is what makes the breakdown a set of small multiples rather than a
    /// ranked list: every row is the same shape over the same axis, so a
    /// spike in one is directly comparable to a spike in another. Empty on
    /// rows past `SERIES_ROWS`, which the panel does not draw.
    #[serde(default)]
    pub series: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub starts_at: i64,
    pub cost: f64,
    pub tokens: u64,
    pub messages: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowReport {
    pub id: String,
    pub label: String,
    pub hours: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub bucket_seconds: i64,
    pub totals: Aggregate,
    /// Costliest first.
    pub models: Vec<NamedAggregate>,
    /// Costliest first.
    pub projects: Vec<NamedAggregate>,
    /// One entry per bucket across the whole window, gaps included as zeroes —
    /// a chart that skips quiet hours misreports the shape of a day.
    pub buckets: Vec<Bucket>,
    pub sessions: u64,
    pub sidechain_messages: u64,
    /// Models seen in this window with no rate in the price list.
    pub unpriced_models: Vec<String>,
    /// The same length of time, immediately before this window.
    ///
    /// Answers "compared to what?" — the question a bare total cannot.
    ///
    /// `None` when the transcripts do not reach back across the whole earlier
    /// period. That distinction is the point: a history that only starts
    /// halfway through the comparison window would report the missing half as
    /// idle, and every figure from a new install would read as a surge.
    pub previous: Option<Aggregate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub plugin_id: String,
    pub plugin_name: String,
    pub currency: String,
    pub generated_at: i64,
    pub windows: Vec<WindowReport>,
    pub files_scanned: usize,
    pub turns_read: usize,
    pub duplicates_dropped: usize,
    pub scan_ms: u64,
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/// One breakdown row while it is still being filled.
#[derive(Default)]
struct RowAccumulator {
    row: NamedAggregate,
    sessions: HashSet<String>,
    /// Cost per bucket start. Sparse — turned into a dense vector aligned with
    /// the window's buckets only for the rows that get drawn.
    series: BTreeMap<i64, f64>,
}

#[derive(Default)]
struct Accumulator {
    totals: Aggregate,
    models: HashMap<String, RowAccumulator>,
    projects: HashMap<String, RowAccumulator>,
    buckets: BTreeMap<i64, Bucket>,
    sessions: HashSet<String>,
    sidechain_messages: u64,
    unpriced: HashSet<String>,
}

/// The period before a window. Only totals — nobody asks for last week's
/// per-project breakdown, and carrying one would double the report for nothing.
#[derive(Default)]
struct PreviousAccumulator {
    totals: Aggregate,
    sessions: HashSet<String>,
    /// Whether the scan actually reached this far back.
    covered: bool,
}

/// A turn's cost, and the model identity it should be filed under.
struct Priced {
    key: String,
    label: String,
    cost: f64,
    cache_saving: f64,
    unpriced: bool,
}

fn price(plugin: &UsagePlugin, turn: &Turn) -> Priced {
    let normalized = super::manifest::normalize_model_id(&turn.model);
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

    let (cost, cache_saving) = match rate_on(rates, &day) {
        Some(rate) => (
            cost_of(
                &turn.counts,
                rate,
                &plugin.pricing.cache,
                &plugin.pricing.server_tools,
            ),
            cache_saving_of(&turn.counts, rate, &plugin.pricing.cache),
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
///
/// The path is what the transcript records; the directory name is what the
/// user calls the project. The full path stays on `key` so two projects with
/// the same folder name are still two rows.
fn project_label(path: &str) -> String {
    if path.is_empty() {
        return "No project".to_string();
    }
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[allow(clippy::too_many_arguments)]
fn file_into(
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
///
/// The series is built against `bucket_starts` rather than against the row's
/// own keys, so every row is the same length over the same axis. A row whose
/// series was only as long as its own activity would compress its quiet
/// stretches and make an occasional project look continuously busy.
fn finish(slot: HashMap<String, RowAccumulator>, bucket_starts: &[i64]) -> Vec<NamedAggregate> {
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

    // Costliest first, and by tokens where cost cannot separate them — which
    // is exactly the unpriced rows, whose cost is zero by construction.
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

    // Only the drawn rows keep their series. Several hundred projects times
    // thirty buckets is a lot of JSON for bars nobody renders.
    for row in rows.iter_mut().skip(SERIES_ROWS) {
        row.series.clear();
    }
    rows
}

/// Every window, filled from one pass over `turns`.
///
/// `turns` need not be sorted; buckets are keyed by instant, not by order.
pub fn build_report(
    plugin: &UsagePlugin,
    turns: &[Turn],
    now: i64,
    stats: ScanStats,
    scan_ms: u64,
) -> UsageReport {
    let mut accumulators: Vec<Accumulator> =
        WINDOWS.iter().map(|_| Accumulator::default()).collect();
    // The oldest turn on disk, which is what actually bounds how far back a
    // comparison can honestly reach. The scan range does not: it is always
    // twice the widest window, so testing against it would be tautological and
    // would claim a comparison for history that is not there.
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
            // A clock that ran backwards, or a transcript copied from a
            // machine ahead of this one. Bucketing it would put a bar in the
            // future; counting it in totals would make them disagree with the
            // chart.
            continue;
        }
        let priced = price(plugin, turn);

        for (index, window) in WINDOWS.iter().enumerate() {
            let starts_at = now - window.hours * 3600;
            if turn.at < starts_at {
                // Still worth having if it lands in the period before this
                // window — that is the comparison the window is reported
                // against.
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

            // Every bucket in the window, quiet ones included. A chart built
            // only from the buckets that have data compresses idle stretches
            // and makes a burst look like steady work.
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

            // The one axis every row's series is drawn against.
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
                // A period the history does not span is `None`, never a zero:
                // "no comparison available" and "nothing happened then" are
                // different findings and must not render the same.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cc_usage::manifest::BUILT_IN_CLAUDE_CODE;

    const HOUR: i64 = 3600;
    const NOW: i64 = 1_787_400_000;

    fn plugin() -> UsagePlugin {
        serde_json::from_str(BUILT_IN_CLAUDE_CODE).unwrap()
    }

    fn turn(at: i64, model: &str, project: &str, session: &str) -> Turn {
        Turn {
            at,
            model: model.to_string(),
            project_path: project.to_string(),
            session_id: session.to_string(),
            dedup_key: None,
            is_sidechain: false,
            is_fast: false,
            counts: TokenCounts {
                input: 1_000_000,
                output: 1_000_000,
                ..Default::default()
            },
        }
    }

    fn build(turns: &[Turn]) -> UsageReport {
        build_report(&plugin(), turns, NOW, ScanStats::default(), 0)
    }

    fn window<'a>(report: &'a UsageReport, id: &str) -> &'a WindowReport {
        report
            .windows
            .iter()
            .find(|window| window.id == id)
            .expect("window")
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-6,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn all_four_windows_are_reported() {
        let report = build(&[]);
        let ids: Vec<&str> = report.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, vec!["24h", "3d", "7d", "30d"]);
    }

    #[test]
    fn the_windows_nest_so_a_recent_turn_counts_in_every_one() {
        // 24h ⊂ 3d ⊂ 7d ⊂ 30d. A turn an hour ago belongs in all four; if it
        // only landed in the narrowest, the wider windows would understate.
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        for id in ["24h", "3d", "7d", "30d"] {
            assert_eq!(window(&report, id).totals.messages, 1, "window {id}");
        }
    }

    #[test]
    fn an_older_turn_only_reaches_the_wider_windows() {
        let report = build(&[turn(NOW - 100 * HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        assert_eq!(window(&report, "24h").totals.messages, 0);
        assert_eq!(window(&report, "3d").totals.messages, 0);
        assert_eq!(window(&report, "7d").totals.messages, 1);
        assert_eq!(window(&report, "30d").totals.messages, 1);
    }

    #[test]
    fn a_turn_older_than_every_window_is_absent_everywhere() {
        let report = build(&[turn(NOW - 800 * HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        for id in ["24h", "3d", "7d", "30d"] {
            assert_eq!(window(&report, id).totals.messages, 0, "window {id}");
        }
    }

    #[test]
    fn cost_uses_the_models_own_rate() {
        // 1M input + 1M output of Opus 5 is $5 + $25.
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        assert_close(window(&report, "24h").totals.cost, 30.0);

        // The same tokens on Haiku are $1 + $5. If both priced the same, the
        // model column would be decoration.
        let report = build(&[turn(NOW - HOUR, "claude-haiku-4-5", "/tmp/alpha", "s1")]);
        assert_close(window(&report, "24h").totals.cost, 6.0);
    }

    #[test]
    fn an_unpriced_model_keeps_its_tokens_and_is_named() {
        // The failure this prevents is a total that is quietly missing money.
        let report = build(&[turn(NOW - HOUR, "claude-unknown-9", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.counts.billable(), 2_000_000);
        assert_close(window.totals.cost, 0.0);
        assert_eq!(window.unpriced_models, vec!["claude-unknown-9"]);
        assert!(window.models[0].unpriced);
    }

    #[test]
    fn a_known_model_is_never_marked_unpriced() {
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        assert!(window.unpriced_models.is_empty());
        assert!(!window.models[0].unpriced);
    }

    #[test]
    fn fast_mode_is_a_separate_row_at_its_own_price() {
        let mut fast = turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1");
        fast.is_fast = true;
        let standard = turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1");

        let report = build(&[fast, standard]);
        let window = window(&report, "24h");
        // $10 + $50 for the fast turn, $5 + $25 for the standard one.
        assert_close(window.totals.cost, 90.0);
        assert_eq!(window.models.len(), 2, "fast must not hide inside standard");
        assert!(window.models.iter().any(|row| row.label.contains("Fast")));
    }

    #[test]
    fn models_and_projects_are_ordered_by_cost() {
        let report = build(&[
            turn(NOW - HOUR, "claude-haiku-4-5", "/tmp/cheap", "s1"),
            turn(NOW - HOUR, "claude-opus-5", "/tmp/expensive", "s2"),
        ]);
        let window = window(&report, "24h");
        assert_eq!(window.models[0].key, "claude-opus-5");
        assert_eq!(window.projects[0].label, "expensive");
    }

    #[test]
    fn a_project_is_labelled_by_its_directory_but_keyed_by_its_path() {
        // Two checkouts of the same repository are two projects; collapsing
        // them by name would merge unrelated work.
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/one/shared", "s1"),
            turn(NOW - HOUR, "claude-opus-5", "/tmp/two/shared", "s2"),
        ]);
        let window = window(&report, "24h");
        assert_eq!(window.projects.len(), 2);
        assert!(window.projects.iter().all(|row| row.label == "shared"));
    }

    #[test]
    fn a_turn_with_no_working_directory_still_appears() {
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "", "s1")]);
        assert_eq!(window(&report, "24h").projects[0].label, "No project");
    }

    #[test]
    fn sessions_are_counted_once_however_many_turns_they_have() {
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 2 * HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 3 * HOUR, "claude-opus-5", "/tmp/alpha", "s2"),
        ]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.messages, 3);
        assert_eq!(window.sessions, 2);
    }

    #[test]
    fn sidechain_turns_are_counted_in_the_total_and_flagged() {
        // A sub-agent's tokens are billed like any other, so leaving them out
        // would understate the bill. Reporting them separately is what makes
        // an expensive fan-out visible.
        let mut sidechain = turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1");
        sidechain.is_sidechain = true;
        let report = build(&[
            sidechain,
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
        ]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.messages, 2);
        assert_eq!(window.sidechain_messages, 1);
        assert_close(window.totals.cost, 60.0);
    }

    #[test]
    fn every_bucket_in_the_window_is_present_including_the_quiet_ones() {
        // A chart that only carries the busy buckets makes an idle night look
        // like continuous work.
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        assert_eq!(window.buckets.len(), 24);
        assert_eq!(window.buckets.iter().filter(|b| b.messages > 0).count(), 1);
        assert!(window
            .buckets
            .windows(2)
            .all(|pair| pair[0].starts_at < pair[1].starts_at));
    }

    #[test]
    fn bucket_totals_agree_with_the_window_total() {
        let turns: Vec<Turn> = (1..=10)
            .map(|hour| turn(NOW - hour * HOUR, "claude-opus-5", "/tmp/alpha", "s1"))
            .collect();
        let report = build(&turns);
        let window = window(&report, "24h");
        let bucketed: u64 = window.buckets.iter().map(|bucket| bucket.messages).sum();
        let cost: f64 = window.buckets.iter().map(|bucket| bucket.cost).sum();
        assert_eq!(bucketed, window.totals.messages);
        assert_close(cost, window.totals.cost);
    }

    #[test]
    fn the_thirty_day_window_buckets_by_day() {
        let report = build(&[]);
        let window = window(&report, "30d");
        assert_eq!(window.bucket_seconds, 24 * 3600);
        assert_eq!(window.buckets.len(), 30);
    }

    #[test]
    fn a_turn_stamped_in_the_future_is_left_out_entirely() {
        // Otherwise the chart grows a bar past "now" and the totals stop
        // agreeing with the buckets.
        let report = build(&[turn(NOW + HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.messages, 0);
        assert!(window.buckets.iter().all(|bucket| bucket.messages == 0));
    }

    #[test]
    fn model_rows_sum_to_the_window_total() {
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - HOUR, "claude-haiku-4-5", "/tmp/beta", "s2"),
            turn(NOW - HOUR, "claude-sonnet-5", "/tmp/beta", "s2"),
        ]);
        let window = window(&report, "24h");
        let cost: f64 = window.models.iter().map(|row| row.aggregate.cost).sum();
        let messages: u64 = window.models.iter().map(|row| row.aggregate.messages).sum();
        assert_close(cost, window.totals.cost);
        assert_eq!(messages, window.totals.messages);

        // And so do the project rows — the two breakdowns partition the same
        // turns, so a disagreement means one of them is dropping something.
        let by_project: f64 = window.projects.iter().map(|row| row.aggregate.cost).sum();
        assert_close(by_project, window.totals.cost);
    }

    #[test]
    fn the_cache_saving_accumulates_beside_the_cost() {
        // The two must stay separable: a cost with the saving already netted
        // off could not be checked against a published rate, and a saving
        // folded into the cost would make a cached run look free.
        let mut cached = turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1");
        cached.counts = TokenCounts {
            cache_read: 1_000_000,
            ..Default::default()
        };
        let report = build(&[cached]);
        let window = window(&report, "24h");
        assert_close(window.totals.cost, 0.5);
        assert_close(window.totals.cache_saving, 4.5);
        assert_close(window.models[0].aggregate.cache_saving, 4.5);
    }

    #[test]
    fn an_unpriced_model_reports_no_cache_saving_either() {
        // Claiming a saving against a rate we do not have would be a number
        // invented out of nothing.
        let mut cached = turn(NOW - HOUR, "claude-unknown-9", "/tmp/alpha", "s1");
        cached.counts = TokenCounts {
            cache_read: 1_000_000,
            ..Default::default()
        };
        let report = build(&[cached]);
        assert_close(window(&report, "24h").totals.cache_saving, 0.0);
    }

    #[test]
    fn the_scan_reaches_back_far_enough_to_compare_the_widest_window() {
        // Twice the widest window, not once: every window is reported against
        // the period before it, and a 30-day figure needs 60 days of history
        // to have something to be compared with.
        assert_eq!(earliest_start(NOW), NOW - 1440 * HOUR);
    }

    #[test]
    fn a_window_is_reported_against_the_period_before_it() {
        // "Compared to what?" — a bare total cannot answer it. The 60-hour
        // turn is there to make the history span the comparison period; only
        // the 30-hour one falls inside it.
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 30 * HOUR, "claude-opus-5", "/tmp/alpha", "s2"),
            turn(NOW - 60 * HOUR, "claude-opus-5", "/tmp/alpha", "s3"),
        ]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.messages, 1);
        let previous = window.previous.as_ref().expect("the 24 h before");
        assert_eq!(previous.messages, 1);
        assert_close(previous.cost, 30.0);
    }

    #[test]
    fn a_quiet_earlier_period_is_zero_rather_than_absent() {
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 60 * HOUR, "claude-opus-5", "/tmp/alpha", "s2"),
        ]);
        let previous = window(&report, "24h").previous.as_ref().expect("covered");
        assert_eq!(previous.messages, 0);
        assert_close(previous.cost, 0.0);
    }

    #[test]
    fn a_history_too_short_to_compare_offers_no_comparison() {
        // The failure this prevents: a two-day-old install reporting its 30-day
        // window against an "empty" earlier month and showing a vast increase
        // that is really just the absence of data. Absent and quiet must not
        // render the same.
        let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        assert!(window(&report, "24h").previous.is_none());
        assert!(window(&report, "30d").previous.is_none());
    }

    #[test]
    fn no_turns_at_all_offers_no_comparison_either() {
        let report = build(&[]);
        assert!(report
            .windows
            .iter()
            .all(|window| window.previous.is_none()));
    }

    #[test]
    fn a_turn_older_than_the_comparison_period_is_in_neither() {
        // 50 hours back is outside both the 24 h window and the 24 h before it,
        // and it is old enough for the comparison to be offered at all.
        let report = build(&[turn(NOW - 50 * HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        assert_eq!(window.totals.messages, 0);
        assert_eq!(window.previous.as_ref().expect("covered").messages, 0);
    }

    #[test]
    fn every_row_carries_a_series_the_length_of_the_window() {
        // Small multiples only work on a shared axis: a row whose series was
        // only as long as its own activity would compress its quiet stretches.
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 5 * HOUR, "claude-haiku-4-5", "/tmp/beta", "s2"),
        ]);
        let window = window(&report, "24h");
        for row in window.models.iter().chain(window.projects.iter()) {
            assert_eq!(
                row.series.len(),
                window.buckets.len(),
                "row {} must span the whole window",
                row.key
            );
        }
    }

    #[test]
    fn a_rows_series_sums_to_its_own_cost() {
        let report = build(&[
            turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
            turn(NOW - 5 * HOUR, "claude-opus-5", "/tmp/alpha", "s1"),
        ]);
        let row = &window(&report, "24h").models[0];
        let summed: f64 = row.series.iter().sum();
        assert_close(summed, row.aggregate.cost);
    }

    #[test]
    fn a_rows_series_lines_up_with_the_windows_buckets() {
        // Index-for-index, or a spike in a row would be drawn at the wrong
        // time relative to the chart above it.
        let report = build(&[turn(NOW - 3 * HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
        let window = window(&report, "24h");
        let row = &window.models[0];
        let spike = row
            .series
            .iter()
            .position(|cost| *cost > 0.0)
            .expect("one spike");
        assert!(window.buckets[spike].cost > 0.0);
        assert_close(window.buckets[spike].cost, row.series[spike]);
    }

    #[test]
    fn rows_past_the_drawn_ones_carry_no_series() {
        // Several hundred projects times thirty buckets is a lot of JSON for
        // bars nobody renders.
        let turns: Vec<Turn> = (0..SERIES_ROWS + 5)
            .map(|index| turn(NOW - HOUR, "claude-opus-5", &format!("/tmp/p{index}"), "s1"))
            .collect();
        let report = build(&turns);
        let window = window(&report, "24h");
        assert!(window.projects.len() > SERIES_ROWS);
        assert!(!window.projects[0].series.is_empty());
        assert!(window.projects[SERIES_ROWS].series.is_empty());
    }
}
