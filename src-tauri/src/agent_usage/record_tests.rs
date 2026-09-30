use super::*;
use crate::agent_usage::claude::parse_result;
use crate::agent_usage::codex::CodexTokens;

const RESULT: &str = include_str!("fixtures/claude-result.json");
const HAIKU: &str = "claude-haiku-4-5-20251001";

fn claude_prices() -> UsagePlugin {
    serde_json::from_str(crate::cc_usage::manifest::BUILT_IN_CLAUDE_CODE).unwrap()
}

fn codex_prices() -> UsagePlugin {
    serde_json::from_str(super::super::CODEX_PRICING).unwrap()
}

fn at(text: &str) -> DateTime<Utc> {
    text.parse().unwrap()
}

fn facts(provider: &str, headless: bool) -> RunFacts {
    RunFacts {
        agent_id: "agent-7".into(),
        provider: provider.into(),
        requested_model: "haiku".into(),
        headless,
        ticket_id: Some("ticket-1".into()),
        goal_id: None,
        run_kind: RunKind::Ticket,
        run_source: RunSource::Conductor,
        session_id: Some("9c5f6f43-fd2c-469e-868d-0f2918f324f3".into()),
        ticket_status_at_start: Some("open".into()),
        started_at: at("2026-09-30T10:00:00Z"),
    }
}

fn end(outcome: Outcome) -> RunEnd {
    RunEnd {
        finished_at: at("2026-09-30T10:00:12.500Z"),
        outcome,
    }
}

fn build(facts: &RunFacts, outcome: Outcome, evidence: &Evidence) -> UsageRecord {
    let (claude, codex) = (claude_prices(), codex_prices());
    build_record(
        "row-1".into(),
        facts,
        &end(outcome),
        evidence,
        &PriceLists {
            claude: Some(&claude),
            codex: Some(&codex),
        },
    )
}

fn captured_transcript() -> BTreeMap<String, TokenCounts> {
    BTreeMap::from([(
        HAIKU.to_string(),
        TokenCounts {
            input: 46,
            output: 1007,
            cache_read: 121_339,
            cache_write5m: 34_067,
            cache_write1h: 31_098,
            ..Default::default()
        },
    )])
}

fn rollout(model: &str) -> RolloutUsage {
    RolloutUsage {
        session_id: Some("01a0f1ef-8a2f-7a73-9006-386b97777a5a".into()),
        model: Some(model.into()),
        tokens: CodexTokens {
            input_tokens: 54_286,
            cached_input_tokens: 26_880,
            cache_write_input_tokens: 0,
            output_tokens: 132,
            reasoning_output_tokens: 0,
        },
    }
}

fn assert_close(actual: Option<f64>, expected: f64) {
    let actual = actual.expect("a cost");
    assert!(
        (actual - expected).abs() < 1e-6,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn a_headless_claude_run_is_booked_at_the_clis_own_figures() {
    let evidence = Evidence {
        cli_result: parse_result(RESULT),
        claude_transcript: Some(captured_transcript()),
        ..Default::default()
    };

    let row = build(&facts("claude", true), Outcome::Success, &evidence);

    assert_eq!(row.cost_source, CostSource::Cli);
    assert_close(row.cost_usd, 0.12199465);
    assert_eq!(
        (
            row.input_tokens,
            row.output_tokens,
            row.cache_read_tokens,
            row.cache_write_tokens
        ),
        (46, 1007, 121_339, 65_165)
    );
    assert_eq!(row.reasoning_tokens, 698);
    assert_eq!(row.model.as_deref(), Some(HAIKU));
    assert_eq!(row.num_turns, Some(1));
    assert_eq!(row.outcome, Outcome::Success);
}

#[test]
fn the_transcript_estimate_sits_next_to_the_cli_cost_as_the_benchmark() {
    let evidence = Evidence {
        cli_result: parse_result(RESULT),
        claude_transcript: Some(captured_transcript()),
        ..Default::default()
    };

    let row = build(&facts("claude", true), Outcome::Success, &evidence);

    assert_close(row.estimate_cost_usd, 0.12199465);
    assert_eq!(row.estimate_input_tokens, Some(46));
    assert_eq!(row.estimate_output_tokens, Some(1007));
    assert_eq!(row.estimate_cache_read_tokens, Some(121_339));
    assert_eq!(row.estimate_cache_write_tokens, Some(65_165));
}

#[test]
fn without_a_transcript_a_headless_run_has_no_benchmark() {
    let evidence = Evidence {
        cli_result: parse_result(RESULT),
        ..Default::default()
    };

    let row = build(&facts("claude", true), Outcome::Success, &evidence);

    assert_eq!(row.estimate_cost_usd, None);
    assert_eq!(row.estimate_output_tokens, None);
    assert_close(row.cost_usd, 0.12199465);
}

#[test]
fn a_result_flagged_as_error_turns_a_clean_exit_into_an_error() {
    let evidence = Evidence {
        cli_result: parse_result(r#"{"type":"result","is_error":true}"#),
        ..Default::default()
    };

    let row = build(&facts("claude", true), Outcome::Success, &evidence);

    assert_eq!(row.outcome, Outcome::Error);
}

#[test]
fn an_interactive_claude_run_is_priced_from_its_transcript() {
    let evidence = Evidence {
        claude_transcript: Some(captured_transcript()),
        ..Default::default()
    };

    let row = build(&facts("claude", false), Outcome::Success, &evidence);

    assert_eq!(row.cost_source, CostSource::Estimated);
    assert_close(row.cost_usd, 0.12199465);
    assert_eq!(row.cache_write_tokens, 65_165);
    assert_eq!(row.model.as_deref(), Some(HAIKU));
    assert_eq!(row.estimate_cost_usd, None, "nothing to benchmark against");
}

#[test]
fn a_model_without_a_price_keeps_its_tokens_and_is_named() {
    let mut transcript = captured_transcript();
    transcript.insert(
        "claude-unheard-of-9".into(),
        TokenCounts {
            output: 2000,
            ..Default::default()
        },
    );
    let evidence = Evidence {
        claude_transcript: Some(transcript),
        ..Default::default()
    };

    let row = build(&facts("claude", false), Outcome::Success, &evidence);

    assert_eq!(
        row.cost_usd, None,
        "a partial sum would look like the whole price"
    );
    assert_eq!(row.cost_source, CostSource::Estimated);
    assert_eq!(
        row.unpriced_models,
        Some(vec!["claude-unheard-of-9".to_string()])
    );
    assert_eq!(row.output_tokens, 3007);
    assert_eq!(
        row.model.as_deref(),
        Some("claude-unheard-of-9"),
        "most output"
    );
}

#[test]
fn a_codex_run_is_priced_from_its_rollout() {
    let evidence = Evidence {
        rollout: Some(rollout("gpt-5.6-sol")),
        rollout_match: Some(MatchKind::Exact),
        ..Default::default()
    };

    let row = build(&facts("codex", true), Outcome::Success, &evidence);

    // 27406 plain x 4.00 + 26880 cached x 0.40 + 132 out x 20.00, per million
    assert_close(row.cost_usd, 0.123016);
    assert_eq!(row.cost_source, CostSource::Estimated);
    assert_eq!(row.input_tokens, 27_406);
    assert_eq!(row.cache_read_tokens, 26_880);
    assert_eq!(row.output_tokens, 132);
    assert_eq!(row.model.as_deref(), Some("gpt-5.6-sol"));
    assert_eq!(row.match_kind, MatchKind::Exact);
    assert_eq!(
        row.session_id.as_deref(),
        Some("01a0f1ef-8a2f-7a73-9006-386b97777a5a")
    );
}

#[test]
fn a_rollout_found_by_guessing_says_so() {
    let evidence = Evidence {
        rollout: Some(rollout("gpt-5.6-sol")),
        rollout_match: Some(MatchKind::Heuristic),
        ..Default::default()
    };

    let row = build(&facts("codex", false), Outcome::Success, &evidence);

    assert_eq!(row.match_kind, MatchKind::Heuristic);
}

#[test]
fn a_codex_model_without_a_price_has_tokens_but_no_cost() {
    let evidence = Evidence {
        rollout: Some(rollout("gpt-9-future")),
        ..Default::default()
    };

    let row = build(&facts("codex", true), Outcome::Success, &evidence);

    assert_eq!(row.cost_usd, None);
    assert_eq!(row.unpriced_models, Some(vec!["gpt-9-future".to_string()]));
    assert_eq!(row.output_tokens, 132);
}

#[test]
fn a_price_list_that_could_not_load_prices_nothing_instead_of_pricing_zero() {
    let evidence = Evidence {
        rollout: Some(rollout("gpt-5.6-sol")),
        ..Default::default()
    };

    let row = build_record(
        "r".into(),
        &facts("codex", true),
        &end(Outcome::Success),
        &evidence,
        &PriceLists {
            claude: None,
            codex: None,
        },
    );

    assert_eq!(row.cost_usd, None);
    assert_eq!(row.unpriced_models, Some(vec!["gpt-5.6-sol".to_string()]));
}

#[test]
fn a_run_with_no_evidence_still_records_when_and_how_it_ended() {
    let row = build(&facts("gemini", true), Outcome::Error, &Evidence::default());

    assert_eq!(row.cost_source, CostSource::None);
    assert_eq!(row.cost_usd, None);
    assert_eq!(row.input_tokens + row.output_tokens, 0);
    assert_eq!(row.duration_ms, 12_500);
    assert_eq!(row.outcome, Outcome::Error);
    assert_eq!(row.started_at, "2026-09-30T10:00:00.000Z");
    assert_eq!(row.finished_at, "2026-09-30T10:00:12.500Z");
    assert_eq!(
        row.model.as_deref(),
        Some("haiku"),
        "the requested model stands in"
    );
}

#[test]
fn a_killed_run_keeps_the_tokens_spent_before_the_kill() {
    let evidence = Evidence {
        claude_transcript: Some(captured_transcript()),
        ..Default::default()
    };

    let row = build(&facts("claude", true), Outcome::Killed, &evidence);

    assert_eq!(row.outcome, Outcome::Killed);
    assert_eq!(row.output_tokens, 1007);
}

#[test]
fn a_session_id_read_from_the_output_fills_in_where_we_passed_none() {
    let mut codex_facts = facts("codex", false);
    codex_facts.session_id = None;
    let evidence = Evidence {
        sniffed_session_id: Some("01a0f1ef-8a2f-7a73-9006-386b97777a5a".into()),
        ..Default::default()
    };

    let row = build(&codex_facts, Outcome::Success, &evidence);

    assert_eq!(
        row.session_id.as_deref(),
        Some("01a0f1ef-8a2f-7a73-9006-386b97777a5a")
    );
}

#[test]
fn the_row_serialises_as_the_frontends_camel_case_shape() {
    let row = build(
        &facts("claude", true),
        Outcome::Success,
        &Evidence::default(),
    );

    let json = serde_json::to_value(&row).unwrap();

    assert_eq!(json["runKind"], "ticket");
    assert_eq!(json["runSource"], "conductor");
    assert_eq!(json["costSource"], "none");
    assert_eq!(json["matchKind"], "exact");
    assert_eq!(json["ticketStatusAtStart"], "open");
    assert_eq!(json["durationMs"], 12_500);
    assert!(
        json.get("modelUsageJson").is_none(),
        "not part of the row shape"
    );
}

#[test]
fn the_run_kind_is_derived_when_the_frontend_sent_none() {
    let derive = |explicit, review, ticket, goal| RunKind::resolve(explicit, review, ticket, goal);

    assert_eq!(
        derive(None, Some("t"), Some("t"), Some("g")),
        RunKind::Review
    );
    assert_eq!(derive(None, None, Some("t"), Some("g")), RunKind::Ticket);
    assert_eq!(derive(None, None, None, Some("g")), RunKind::Goal);
    assert_eq!(derive(None, None, None, None), RunKind::Other);
    assert_eq!(
        derive(Some("goal"), None, Some("t"), None),
        RunKind::Goal,
        "explicit wins"
    );
    assert_eq!(
        derive(Some("nonsense"), None, Some("t"), None),
        RunKind::Ticket
    );
}

#[test]
fn an_unknown_or_missing_run_source_is_other() {
    assert_eq!(RunSource::resolve(Some("schedule")), RunSource::Schedule);
    assert_eq!(RunSource::resolve(Some("carrier-pigeon")), RunSource::Other);
    assert_eq!(RunSource::resolve(None), RunSource::Other);
}
