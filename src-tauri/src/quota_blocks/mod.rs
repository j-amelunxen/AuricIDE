//! Short-term memory for provider and model-family quota exhaustion.
//!
//! When an agent ends, `agents/quota_detection.rs` scans the tail of its console
//! for a quota or rate-limit message, or for the CLI switching it from the
//! requested model to a fallback, and records a temporary [`QuotaBlock`] with an
//! expiry timestamp. A block can also be set by hand over the control socket.
//!
//! Until a block expires or is cleared, a supervisor's spawn of an affected model
//! is refused with `quota_blocked`, `list_projects` marks the model in `catalog`,
//! and `balancing.next` skips providers whose allowed models are all blocked.
//! Spawns outside a supervisor (the UI, the conductor, outside clients, link jobs)
//! are not checked against blocks.

pub mod matcher;
pub mod reset_time;
pub mod store;

use crate::providers::normalize_provider_id;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// What part of a provider a quota block covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QuotaBlockScope {
    /// Every model offered by the provider (e.g. account/plan-wide limit).
    Provider,
    /// A vendor/model family prefix on a multi-family provider (e.g. `"claude-"`
    /// on `antigravity`, matching `claude-opus-5-5-*` and `claude-sonnet-5-5-*`
    /// while leaving `gemini-*` unblocked).
    Family { prefix: String },
    /// One specific model ID.
    Model { model: String },
}

/// Why a quota block was recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaBlockReason {
    QuotaExhausted,
    RateLimited,
    SilentModelFallback,
    Manual,
}

impl QuotaBlockReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::QuotaExhausted => "quota_exhausted",
            Self::RateLimited => "rate_limited",
            Self::SilentModelFallback => "silent_model_fallback",
            Self::Manual => "manual",
        }
    }
}

/// One active or persisted quota block entry in `<app_data_dir>/quota-blocks.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBlock {
    /// Deterministic identifier (`<provider>:provider`, `<provider>:family:<prefix>`,
    /// or `<provider>:model:<model>`).
    pub id: String,
    pub provider: String,
    pub scope: QuotaBlockScope,
    pub reason: QuotaBlockReason,
    pub detail: String,
    /// ISO-8601 UTC timestamp when the block was recorded.
    pub detected_at: String,
    /// ISO-8601 UTC timestamp when the block expires automatically.
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_agent_id: Option<String>,
}

/// Compact block marker attached to a model in `list_projects` `catalog`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBlockInfo {
    pub reason: String,
    pub until: String,
}

impl QuotaBlock {
    /// Deterministic key for deduplicating/upserting blocks of the same target.
    pub fn make_id(provider: &str, scope: &QuotaBlockScope) -> String {
        let provider = normalize_provider_id(provider);
        match scope {
            QuotaBlockScope::Provider => format!("{provider}:provider"),
            QuotaBlockScope::Family { prefix } => {
                format!("{provider}:family:{}", prefix.trim().to_ascii_lowercase())
            }
            QuotaBlockScope::Model { model } => format!("{provider}:model:{}", model.trim()),
        }
    }

    /// Parses `expires_at` and returns whether it is strictly after `now`.
    pub fn is_active_at(&self, now: DateTime<Utc>) -> bool {
        DateTime::parse_from_rfc3339(&self.expires_at)
            .map(|dt| dt.with_timezone(&Utc) > now)
            .unwrap_or(false)
    }

    /// Whether this block covers `model` on `provider` (ignoring expiry).
    pub fn matches_model(&self, provider: &str, model: &str) -> bool {
        if normalize_provider_id(&self.provider) != normalize_provider_id(provider) {
            return false;
        }
        match &self.scope {
            QuotaBlockScope::Provider => true,
            QuotaBlockScope::Family { prefix } => model
                .to_ascii_lowercase()
                .starts_with(&prefix.to_ascii_lowercase()),
            QuotaBlockScope::Model { model: blocked } => model == blocked,
        }
    }

    /// Summary attached to a blocked model in `list_projects` `catalog`.
    pub fn to_model_block_info(&self) -> ModelBlockInfo {
        let reason = if self.detail.trim().is_empty() {
            self.reason.as_str().to_string()
        } else {
            format!("{}: {}", self.reason.as_str(), self.detail)
        };
        ModelBlockInfo {
            reason,
            until: self.expires_at.clone(),
        }
    }

    /// Human-readable description of a block refusal for a supervisor's spawn.
    pub fn refusal_message(&self, model: &str) -> String {
        let scope_desc = match &self.scope {
            QuotaBlockScope::Provider => format!("Provider '{}'", self.provider),
            QuotaBlockScope::Family { prefix } => {
                format!(
                    "Model '{model}' (family '{prefix}*' on provider '{}')",
                    self.provider
                )
            }
            QuotaBlockScope::Model { .. } => {
                format!("Model '{model}' on provider '{}'", self.provider)
            }
        };
        format!(
            "{scope_desc} is quota-blocked until {} ({}: {}).",
            self.expires_at,
            self.reason.as_str(),
            self.detail
        )
    }
}

const MULTI_WORD_FAMILY_PREFIXES: [&str; 2] = ["gpt-oss-", "deepseek-r1-"];

/// Extracts the vendor/model family prefix (including trailing `-`) from a model ID,
/// e.g. `"claude-"` from `"claude-sonnet-5-5-high"` or `"gemini-"` from
/// `"gemini-3.8-flash-medium"`.
pub fn model_family_prefix(model: &str) -> Option<String> {
    let lower = model.trim().to_ascii_lowercase();
    for known in MULTI_WORD_FAMILY_PREFIXES {
        if lower.starts_with(known) {
            return Some(known.to_string());
        }
    }
    let idx = lower.find('-')?;
    if idx == 0 {
        return None;
    }
    Some(lower[..=idx].to_string())
}

/// Whether `provider` mixes multiple upstream model families (such as `antigravity`
/// offering both `claude-*` and `gemini-*`).
pub fn is_multi_family_provider(provider: &str, catalog_models: &[String]) -> bool {
    let norm = normalize_provider_id(provider);
    if matches!(norm.as_str(), "antigravity" | "agy" | "opencode" | "cursor") {
        return true;
    }
    let families: BTreeSet<String> = catalog_models
        .iter()
        .filter_map(|m| model_family_prefix(m))
        .collect();
    families.len() >= 2
}

/// Chooses the appropriate block scope when a specific model hits quota or falls
/// back: `Family` on multi-family providers, `Model` otherwise.
pub fn scope_for_model(provider: &str, model: &str, catalog_models: &[String]) -> QuotaBlockScope {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
        return QuotaBlockScope::Provider;
    }
    if is_multi_family_provider(provider, catalog_models) {
        if let Some(prefix) = model_family_prefix(trimmed) {
            return QuotaBlockScope::Family { prefix };
        }
    }
    QuotaBlockScope::Model {
        model: trimmed.to_string(),
    }
}

/// Parses a human/tool scope pattern (`None` / `"*"` → `Provider`, `"claude-*"`
/// or `"claude-"` → `Family`, `"claude-sonnet-5-5-high"` → `Model`).
pub fn parse_scope_pattern(pattern: Option<&str>) -> QuotaBlockScope {
    let Some(raw) = pattern.map(str::trim).filter(|s| !s.is_empty()) else {
        return QuotaBlockScope::Provider;
    };
    if raw == "*" || raw.eq_ignore_ascii_case("all") || raw.eq_ignore_ascii_case("provider") {
        return QuotaBlockScope::Provider;
    }
    if let Some(stripped) = raw.strip_suffix('*') {
        let base = stripped.trim().to_ascii_lowercase();
        if base.is_empty() {
            return QuotaBlockScope::Provider;
        }
        let prefix = if base.ends_with('-') {
            base
        } else {
            format!("{base}-")
        };
        return QuotaBlockScope::Family { prefix };
    }
    if raw.ends_with('-') {
        return QuotaBlockScope::Family {
            prefix: raw.to_ascii_lowercase(),
        };
    }
    QuotaBlockScope::Model {
        model: raw.to_string(),
    }
}

/// Finds the active block covering `(provider, model)` with the latest expiry.
pub fn find_block_for_model<'a>(
    blocks: &'a [QuotaBlock],
    provider: &str,
    model: &str,
) -> Option<&'a QuotaBlock> {
    blocks
        .iter()
        .filter(|b| b.matches_model(provider, model))
        .max_by(|a, b| a.expires_at.cmp(&b.expires_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn extracts_family_prefix_and_detects_multi_family_providers() {
        assert_eq!(
            model_family_prefix("claude-sonnet-5-5-high").as_deref(),
            Some("claude-")
        );
        assert_eq!(
            model_family_prefix("claude-opus-5-5-thinking").as_deref(),
            Some("claude-")
        );
        assert_eq!(
            model_family_prefix("gemini-3.8-flash-medium").as_deref(),
            Some("gemini-")
        );
        assert_eq!(
            model_family_prefix("gpt-oss-120b-medium").as_deref(),
            Some("gpt-oss-")
        );
        assert_eq!(model_family_prefix("sonnet"), None);

        let agy_catalog = vec![
            "claude-opus-5-5-thinking".to_string(),
            "claude-sonnet-5-5-high".to_string(),
            "gemini-3.8-flash-medium".to_string(),
        ];
        assert!(is_multi_family_provider("antigravity", &agy_catalog));
        assert_eq!(
            scope_for_model("antigravity", "claude-sonnet-5-5-high", &agy_catalog),
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );

        let claude_catalog = vec![
            "opus".to_string(),
            "sonnet".to_string(),
            "haiku".to_string(),
        ];
        assert!(!is_multi_family_provider("claude", &claude_catalog));
        assert_eq!(
            scope_for_model("claude", "opus", &claude_catalog),
            QuotaBlockScope::Model {
                model: "opus".to_string()
            }
        );
    }

    #[test]
    fn parses_manual_scope_patterns_and_matches_models() {
        assert_eq!(parse_scope_pattern(None), QuotaBlockScope::Provider);
        assert_eq!(parse_scope_pattern(Some("")), QuotaBlockScope::Provider);
        assert_eq!(parse_scope_pattern(Some("*")), QuotaBlockScope::Provider);
        assert_eq!(
            parse_scope_pattern(Some("claude-*")),
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
        assert_eq!(
            parse_scope_pattern(Some("claude-")),
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
        assert_eq!(
            parse_scope_pattern(Some("claude-opus-5-5-thinking")),
            QuotaBlockScope::Model {
                model: "claude-opus-5-5-thinking".to_string()
            }
        );

        let now = Utc.with_ymd_and_hms(2026, 10, 23, 18, 0, 0).unwrap();
        let family_block = QuotaBlock {
            id: QuotaBlock::make_id(
                "antigravity",
                &QuotaBlockScope::Family {
                    prefix: "claude-".to_string(),
                },
            ),
            provider: "antigravity".to_string(),
            scope: QuotaBlockScope::Family {
                prefix: "claude-".to_string(),
            },
            reason: QuotaBlockReason::SilentModelFallback,
            detail: "Switched to Gemini 3.8 Flash (Medium)".to_string(),
            detected_at: "2026-10-23T17:50:00Z".to_string(),
            expires_at: "2026-10-23T19:00:00Z".to_string(),
            source_agent_id: Some("agent-7".to_string()),
        };

        assert!(family_block.is_active_at(now));
        assert!(family_block.matches_model("antigravity", "claude-sonnet-5-5-high"));
        assert!(family_block.matches_model("antigravity", "claude-opus-5-5-thinking"));
        assert!(!family_block.matches_model("antigravity", "gemini-3.8-flash-medium"));
        assert!(!family_block.matches_model("claude", "claude-sonnet-5-5-high"));

        let after_expiry = Utc.with_ymd_and_hms(2026, 10, 23, 19, 0, 0).unwrap();
        assert!(!family_block.is_active_at(after_expiry));
    }
}
