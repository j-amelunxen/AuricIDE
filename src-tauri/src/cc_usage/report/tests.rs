use super::builder::*;
use super::types::*;
use crate::cc_usage::manifest::{UsagePlugin, BUILT_IN_CLAUDE_CODE};
use crate::cc_usage::pricing::TokenCounts;
use crate::cc_usage::scan::{ScanStats, Turn};

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
    let report = build(&[turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
    assert_close(window(&report, "24h").totals.cost, 30.0);

    let report = build(&[turn(NOW - HOUR, "claude-haiku-4-5", "/tmp/alpha", "s1")]);
    assert_close(window(&report, "24h").totals.cost, 6.0);
}

#[test]
fn an_unpriced_model_keeps_its_tokens_and_is_named() {
    let report = build(&[turn(NOW - HOUR, "claude-unknown-9", "/tmp/alpha", "s1")]);
    let window = window(&report, "24h");
    assert_eq!(window.totals.counts.billable(), 2_000_000);
    assert_close(window.totals.cost, 0.0);
    assert_eq!(window.unpriced_models, vec!["claude-unknown-9"]);
    assert!(window.models[0].unpriced);
}

#[test]
fn a_models_own_cache_multipliers_win_over_the_price_lists() {
    let mut cached = turn(NOW - HOUR, "claude-fable-5-1", "/tmp/alpha", "s1");
    cached.counts = TokenCounts {
        cache_read: 1_000_000,
        ..Default::default()
    };
    let report = build(&[cached]);
    assert_close(window(&report, "24h").totals.cost, 10.0 * 0.025);
}

#[test]
fn a_model_without_its_own_multipliers_uses_the_price_lists() {
    let mut cached = turn(NOW - HOUR, "claude-opus-5", "/tmp/alpha", "s1");
    cached.counts = TokenCounts {
        cache_read: 1_000_000,
        ..Default::default()
    };
    let report = build(&[cached]);
    assert_close(window(&report, "24h").totals.cost, 5.0 * 0.1);
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

    let by_project: f64 = window.projects.iter().map(|row| row.aggregate.cost).sum();
    assert_close(by_project, window.totals.cost);
}

#[test]
fn the_cache_saving_accumulates_beside_the_cost() {
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
    assert_eq!(earliest_start(NOW), NOW - 1440 * HOUR);
}

#[test]
fn a_window_is_reported_against_the_period_before_it() {
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
    let report = build(&[turn(NOW - 50 * HOUR, "claude-opus-5", "/tmp/alpha", "s1")]);
    let window = window(&report, "24h");
    assert_eq!(window.totals.messages, 0);
    assert_eq!(window.previous.as_ref().expect("covered").messages, 0);
}

#[test]
fn every_row_carries_a_series_the_length_of_the_window() {
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
    let turns: Vec<Turn> = (0..SERIES_ROWS + 5)
        .map(|index| turn(NOW - HOUR, "claude-opus-5", &format!("/tmp/p{index}"), "s1"))
        .collect();
    let report = build(&turns);
    let window = window(&report, "24h");
    assert!(window.projects.len() > SERIES_ROWS);
    assert!(!window.projects[0].series.is_empty());
    assert!(window.projects[SERIES_ROWS].series.is_empty());
}
