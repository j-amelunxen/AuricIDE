use crate::cc_usage::pricing::TokenCounts;
use serde::{Deserialize, Serialize};

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
pub const SERIES_ROWS: usize = 12;

/// The oldest instant any report needs.
///
/// Twice the widest window, because every window is reported against the
/// period immediately before it — a 30-day figure with nothing to compare it
/// to is a number the reader cannot judge. This doubles the scan, which is
/// what the 60-second cache is for.
pub fn earliest_start(now: i64) -> i64 {
    now - 2 * WINDOWS.iter().map(|window| window.hours).max().unwrap_or(0) * 3600
}

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
    pub fn add(&mut self, counts: &TokenCounts, cost: f64, cache_saving: f64) {
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
