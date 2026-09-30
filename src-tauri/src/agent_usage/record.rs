//! The row one finished agent run leaves in `pm_agent_usage`, and how it is
//! assembled from whatever evidence the run produced.
//!
//! Pure: no files, no clock, no database. What was read from disk arrives as
//! [`Evidence`], so the rules that matter (which source wins, what is
//! unpriced, what a kill means) are tested without a process.

use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use super::claude::CliResult;
use super::codex::RolloutUsage;
use crate::cc_usage::manifest::UsagePlugin;
use crate::cc_usage::pricing::{price_bundle, TokenCounts};

macro_rules! text_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }

            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

text_enum!(RunKind { Ticket => "ticket", Goal => "goal", Review => "review", Other => "other" });
text_enum!(RunSource { Ui => "ui", Conductor => "conductor", Schedule => "schedule", Mcp => "mcp", Other => "other" });
text_enum!(Outcome { Success => "success", Error => "error", Killed => "killed" });
text_enum!(CostSource { Cli => "cli", Estimated => "estimated", None => "none" });
text_enum!(MatchKind { Exact => "exact", Heuristic => "heuristic" });

impl RunKind {
    /// What the frontend said, or when it said nothing what the ids imply:
    /// a review beats a ticket beats a goal.
    pub fn resolve(
        explicit: Option<&str>,
        review_of_ticket: Option<&str>,
        ticket: Option<&str>,
        goal: Option<&str>,
    ) -> Self {
        if let Some(kind) = explicit.and_then(Self::parse) {
            return kind;
        }
        if review_of_ticket.is_some() {
            Self::Review
        } else if ticket.is_some() {
            Self::Ticket
        } else if goal.is_some() {
            Self::Goal
        } else {
            Self::Other
        }
    }
}

impl RunSource {
    pub fn resolve(explicit: Option<&str>) -> Self {
        explicit.and_then(Self::parse).unwrap_or(Self::Other)
    }
}

/// One row of `pm_agent_usage`; the JSON shape is `AgentUsageRow`
/// (`src/lib/tauri/agentUsage.ts`, contract in `docs/design-agent-usage.md`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: String,
    pub agent_id: String,
    pub ticket_id: Option<String>,
    pub goal_id: Option<String>,
    pub run_kind: RunKind,
    pub run_source: RunSource,
    pub provider: String,
    pub model: Option<String>,
    pub headless: bool,
    pub session_id: Option<String>,
    pub ticket_status_at_start: Option<String>,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: i64,
    pub outcome: Outcome,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub reasoning_tokens: u64,
    pub cost_usd: Option<f64>,
    pub cost_source: CostSource,
    pub match_kind: MatchKind,
    pub estimate_cost_usd: Option<f64>,
    pub estimate_input_tokens: Option<u64>,
    pub estimate_output_tokens: Option<u64>,
    pub estimate_cache_read_tokens: Option<u64>,
    pub estimate_cache_write_tokens: Option<u64>,
    pub unpriced_models: Option<Vec<String>>,
    /// Kept in the database for a breakdown; the frontend row has no use for it.
    #[serde(skip_serializing, default)]
    pub model_usage_json: Option<String>,
    pub num_turns: Option<u64>,
}

/// Everything known about a run before its evidence is read.
#[derive(Debug, Clone)]
pub struct RunFacts {
    pub agent_id: String,
    pub provider: String,
    pub requested_model: String,
    pub headless: bool,
    pub ticket_id: Option<String>,
    pub goal_id: Option<String>,
    pub run_kind: RunKind,
    pub run_source: RunSource,
    /// The id we passed with `--session-id`, when the provider takes one.
    pub session_id: Option<String>,
    pub ticket_status_at_start: Option<String>,
    pub started_at: DateTime<Utc>,
}

/// What was read after the run ended.
#[derive(Debug, Default)]
pub struct Evidence {
    pub cli_result: Option<CliResult>,
    /// Per model, from the Claude transcript files.
    pub claude_transcript: Option<BTreeMap<String, TokenCounts>>,
    pub rollout: Option<RolloutUsage>,
    pub rollout_match: Option<MatchKind>,
    /// Read from Codex's output; ours is in [`RunFacts`].
    pub sniffed_session_id: Option<String>,
}

pub struct RunEnd {
    pub finished_at: DateTime<Utc>,
    pub outcome: Outcome,
}

/// A list that could not be loaded is `None`: every model of that provider
/// is then unpriced, which the row says, instead of being priced at zero.
pub struct PriceLists<'a> {
    pub claude: Option<&'a UsagePlugin>,
    pub codex: Option<&'a UsagePlugin>,
}

/// Tokens and money for a set of models, priced by day.
struct Priced {
    counts: TokenCounts,
    cost_usd: Option<f64>,
    unpriced: Vec<String>,
}

fn price_models(
    plugin: Option<&UsagePlugin>,
    by_model: &BTreeMap<String, TokenCounts>,
    day: &str,
) -> Priced {
    let mut counts = TokenCounts::default();
    let mut cost = 0.0;
    let mut unpriced = Vec::new();
    for (model, model_counts) in by_model {
        counts += *model_counts;
        match plugin.and_then(|list| price_bundle(list, model, day, model_counts)) {
            Some(price) => cost += price,
            None => unpriced.push(model.clone()),
        }
    }
    // A partial sum would read as the whole price, so one unknown model makes
    // the whole figure unknown; its tokens are still counted.
    let cost_usd = unpriced.is_empty().then_some(cost);
    Priced {
        counts,
        cost_usd,
        unpriced,
    }
}

/// The model that produced most of the output, which is what the row names.
fn dominant_model(by_model: &BTreeMap<String, TokenCounts>) -> Option<String> {
    by_model
        .iter()
        .max_by_key(|(_, counts)| counts.output)
        .map(|(model, _)| model.clone())
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn build_record(
    id: String,
    facts: &RunFacts,
    end: &RunEnd,
    evidence: &Evidence,
    prices: &PriceLists,
) -> UsageRecord {
    let day = facts.started_at.format("%Y-%m-%d").to_string();
    let mut record = UsageRecord {
        id,
        agent_id: facts.agent_id.clone(),
        ticket_id: facts.ticket_id.clone(),
        goal_id: facts.goal_id.clone(),
        run_kind: facts.run_kind,
        run_source: facts.run_source,
        provider: facts.provider.clone(),
        model: Some(facts.requested_model.clone()),
        headless: facts.headless,
        session_id: facts
            .session_id
            .clone()
            .or_else(|| evidence.sniffed_session_id.clone()),
        ticket_status_at_start: facts.ticket_status_at_start.clone(),
        started_at: rfc3339(facts.started_at),
        finished_at: rfc3339(end.finished_at),
        duration_ms: (end.finished_at - facts.started_at)
            .num_milliseconds()
            .max(0),
        outcome: end.outcome,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        cost_usd: None,
        cost_source: CostSource::None,
        match_kind: MatchKind::Exact,
        estimate_cost_usd: None,
        estimate_input_tokens: None,
        estimate_output_tokens: None,
        estimate_cache_read_tokens: None,
        estimate_cache_write_tokens: None,
        unpriced_models: None,
        model_usage_json: None,
        num_turns: None,
    };

    let claude_estimate = evidence.claude_transcript.as_ref().map(|by_model| {
        (
            price_models(prices.claude, by_model, &day),
            dominant_model(by_model),
        )
    });

    if let Some(result) = &evidence.cli_result {
        apply_counts(&mut record, result.total_counts());
        record.cost_usd = result.cost_usd();
        record.cost_source = CostSource::Cli;
        record.num_turns = result.num_turns;
        record.model_usage_json = result.model_usage_json.clone();
        record.session_id = result.session_id.clone().or(record.session_id);
        let by_model: BTreeMap<String, TokenCounts> = result
            .models
            .iter()
            .map(|(model, tokens)| (model.clone(), tokens.counts))
            .collect();
        record.model = dominant_model(&by_model).or(record.model);
        if result.is_error && record.outcome == Outcome::Success {
            record.outcome = Outcome::Error;
        }
        if let Some((estimate, _)) = &claude_estimate {
            record.estimate_cost_usd = estimate.cost_usd;
            record.estimate_input_tokens = Some(estimate.counts.input);
            record.estimate_output_tokens = Some(estimate.counts.output);
            record.estimate_cache_read_tokens = Some(estimate.counts.cache_read);
            record.estimate_cache_write_tokens =
                Some(estimate.counts.cache_write5m + estimate.counts.cache_write1h);
        }
    } else if let Some((estimate, model)) = claude_estimate {
        apply_counts(&mut record, estimate.counts);
        record.cost_usd = estimate.cost_usd;
        record.cost_source = CostSource::Estimated;
        record.unpriced_models = (!estimate.unpriced.is_empty()).then_some(estimate.unpriced);
        record.model = model.or(record.model);
    } else if let Some(rollout) = &evidence.rollout {
        let model = rollout
            .model
            .clone()
            .unwrap_or_else(|| facts.requested_model.clone());
        let by_model = BTreeMap::from([(model.clone(), rollout.tokens.to_counts())]);
        let priced = price_models(prices.codex, &by_model, &day);
        apply_counts(&mut record, priced.counts);
        record.cost_usd = priced.cost_usd;
        record.cost_source = CostSource::Estimated;
        record.unpriced_models = (!priced.unpriced.is_empty()).then_some(priced.unpriced);
        record.match_kind = evidence.rollout_match.unwrap_or(MatchKind::Exact);
        record.model = Some(model);
        record.session_id = rollout.session_id.clone().or(record.session_id);
    }
    record
}

fn apply_counts(record: &mut UsageRecord, counts: TokenCounts) {
    record.input_tokens = counts.input;
    record.output_tokens = counts.output;
    record.cache_read_tokens = counts.cache_read;
    record.cache_write_tokens = counts.cache_write5m + counts.cache_write1h;
    record.reasoning_tokens = counts.thinking;
}

#[cfg(test)]
#[path = "record_tests.rs"]
mod tests;
