//! Provider CLI quota/rate-limit signal matcher and silent model-fallback detector.
//!
//! Patterns are collected from the local provider CLI binaries (`agy`, `claude`,
//! `grok`) and documented provider APIs (`codex`, `gemini`). Where a CLI's exact
//! wording is assumed rather than extracted from a binary, the table marks it so
//! new patterns can be appended in one place.

use super::reset_time::parse_reset_time;
pub use super::reset_time::resolve_manual_until;
use super::{scope_for_model, QuotaBlock, QuotaBlockReason, QuotaBlockScope};
use crate::providers::normalize_provider_id;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use regex::Regex;
use std::sync::OnceLock;

/// Minimal model descriptor from the provider catalog, used to recognise when a
/// CLI prints a human label (`"Gemini 3.8 Flash (Medium)"`) or model ID that
/// differs from the model the agent was spawned with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogModelRef {
    pub id: String,
    pub label: String,
}

/// Context for scanning one agent's console text.
pub struct DetectionContext<'a> {
    pub provider: &'a str,
    /// The model ID requested at spawn (`None` when `"auto"` or unknown).
    pub spawned_model: Option<&'a str>,
    pub catalog: &'a [CatalogModelRef],
    pub source_agent_id: Option<&'a str>,
    pub now: DateTime<Utc>,
    pub default_ttl_minutes: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuleScopeTarget {
    /// Block the entire provider (account/plan-wide limit).
    Provider,
    /// Block the spawned model (or its family on multi-family providers).
    SpawnedModelOrProvider,
}

struct QuotaPatternRule {
    /// `None`: generic fallback rule matching any provider.
    providers: Option<&'static [&'static str]>,
    /// Case-insensitive substring that triggers this rule.
    needle: &'static str,
    reason: QuotaBlockReason,
    target: RuleScopeTarget,
}

/// Extensible table of provider quota / rate-limit signals.
///
/// Verified rules were extracted from local CLI binaries (`agy`, `claude`, `grok`);
/// assumed rules cover standard OpenAI / Google API responses (`codex`, `gemini`).
const QUOTA_RULES: &[QuotaPatternRule] = &[
    // ── Antigravity (`agy` binary, VERIFIED) ────────────────────────────────
    QuotaPatternRule {
        providers: Some(&["antigravity", "agy"]),
        needle: "you have exhausted your quota on this model",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: Some(&["antigravity", "agy"]),
        needle: "is out of quota until",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: Some(&["antigravity", "agy"]),
        needle: "quota exhausted",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: Some(&["antigravity", "agy"]),
        needle: "plan quota is used up",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    // ── Claude Code (`claude` binary, VERIFIED) ─────────────────────────────
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "usage limit reached",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "reached your weekly usage limit",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "of your 5-hour usage limit",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "wait for your usage limit to reset",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "your usage limit resets",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["claude"]),
        needle: "rate limited (429)",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::Provider,
    },
    // ── Grok CLI (`grok` binary, VERIFIED) ──────────────────────────────────
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "hit the rate limit for your plan",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "you hit your free usage limit",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "usage balance exhausted",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "run out of credits",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "out of credits",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "subagent stopped waiting out rate limits",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["grok"]),
        needle: "previous model is no longer available and could not be switched",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    // ── Codex CLI (`codex`, ASSUMED CLI / OpenAI API) ───────────────────────
    QuotaPatternRule {
        providers: Some(&["codex"]),
        needle: "usage_limit_reached",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["codex"]),
        needle: "you've hit your usage limit",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["codex"]),
        needle: "insufficient_quota",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::Provider,
    },
    QuotaPatternRule {
        providers: Some(&["codex"]),
        needle: "rate_limit_exceeded",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::Provider,
    },
    // ── Gemini CLI & Generic Fallback (ASSUMED standard APIs) ───────────────
    QuotaPatternRule {
        providers: None,
        needle: "resource_exhausted",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: None,
        needle: "quota exceeded",
        reason: QuotaBlockReason::QuotaExhausted,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: None,
        needle: "ratelimitexceeded",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
    QuotaPatternRule {
        providers: None,
        needle: "429 too many requests",
        reason: QuotaBlockReason::RateLimited,
        target: RuleScopeTarget::SpawnedModelOrProvider,
    },
];

/// Scans cleaned console text (a headless answer is printed there too) for quota
/// exhaustion, rate limits, or a model fallback. The first matching line decides.
pub fn detect_in_text(ctx: &DetectionContext<'_>, text: &str) -> Option<QuotaBlock> {
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(block) = detect_quota_line(ctx, line) {
            return Some(block);
        }
        if let Some(block) = detect_silent_fallback_line(ctx, line) {
            return Some(block);
        }
    }
    None
}

fn detect_quota_line(ctx: &DetectionContext<'_>, line: &str) -> Option<QuotaBlock> {
    let provider = normalize_provider_id(ctx.provider);
    let lower = line.to_ascii_lowercase();

    let rule = QUOTA_RULES.iter().find(|r| {
        let provider_ok = r
            .providers
            .map_or(true, |list| list.contains(&provider.as_str()));
        provider_ok && lower.contains(r.needle)
    })?;

    let catalog_ids: Vec<String> = ctx.catalog.iter().map(|c| c.id.clone()).collect();
    let explicit_model = extract_named_model_in_quota_line(line);
    let target_model = explicit_model.as_deref().or_else(|| {
        ctx.spawned_model
            .filter(|m| !m.eq_ignore_ascii_case("auto"))
    });

    let scope = match (rule.target, target_model) {
        (RuleScopeTarget::Provider, _) if explicit_model.is_none() => QuotaBlockScope::Provider,
        (_, Some(model)) => {
            if super::is_multi_family_provider(&provider, &catalog_ids) {
                scope_for_model(&provider, model, &catalog_ids)
            } else if explicit_model.is_some() {
                QuotaBlockScope::Model {
                    model: model.to_string(),
                }
            } else {
                QuotaBlockScope::Provider
            }
        }
        (_, None) => QuotaBlockScope::Provider,
    };

    Some(build_block(
        ctx,
        &provider,
        scope,
        rule.reason,
        sanitize_excerpt(line),
        line,
    ))
}

fn extract_named_model_in_quota_line(line: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)\bmodel\s+['\x22]?([a-z0-9._-]+)['\x22]?\s+is\s+out\s+of\s+quota")
            .expect("valid regex")
    });
    re.captures(line)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

fn normalize_model_token(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' {
            out.push(ch.to_ascii_lowercase());
            prev_space = false;
        } else if !prev_space && !out.is_empty() {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

fn matches_catalog_entry(candidate: &str, entry: &CatalogModelRef) -> bool {
    let norm = normalize_model_token(candidate);
    !norm.is_empty()
        && (norm == normalize_model_token(&entry.id) || norm == normalize_model_token(&entry.label))
}

fn detect_silent_fallback_line(ctx: &DetectionContext<'_>, line: &str) -> Option<QuotaBlock> {
    let spawned = ctx
        .spawned_model
        .map(str::trim)
        .filter(|m| !m.is_empty() && !m.eq_ignore_ascii_case("auto"))?;

    let spawned_entry = ctx
        .catalog
        .iter()
        .find(|c| matches_catalog_entry(spawned, c));

    let switched_to = extract_switched_model_target(line)
        .or_else(|| extract_tui_model_banner_target(line, ctx.catalog, spawned, spawned_entry))?;

    // If the switched target matches the spawned model ID or its human label, it is not a fallback.
    if normalize_model_token(&switched_to) == normalize_model_token(spawned)
        || spawned_entry.is_some_and(|e| matches_catalog_entry(&switched_to, e))
    {
        return None;
    }

    // Verify that the switched target corresponds to another known model in the catalog.
    let matched_other = ctx
        .catalog
        .iter()
        .find(|c| matches_catalog_entry(&switched_to, c));
    if !ctx.catalog.is_empty() && matched_other.is_none() {
        return None;
    }

    let display_target = matched_other
        .map(|c| c.label.as_str())
        .unwrap_or(switched_to.as_str());
    let provider = normalize_provider_id(ctx.provider);
    let catalog_ids: Vec<String> = ctx.catalog.iter().map(|c| c.id.clone()).collect();
    let scope = scope_for_model(&provider, spawned, &catalog_ids);
    let detail = format!("Fell back from {spawned} to {display_target}");

    Some(build_block(
        ctx,
        &provider,
        scope,
        QuotaBlockReason::SilentModelFallback,
        detail,
        line,
    ))
}

fn extract_switched_model_target(line: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:model\s+(?:set|switched|changed)\s+to|(?:you\s+)?switched(?:\s+you)?\s+to(?:\s+the\s+model)?|falling\s+back\s+to|fell\s+back\s+to)\s+([^\r\n;]+)",
        )
        .expect("valid regex")
    });
    let raw = re.captures(line)?.get(1)?.as_str().trim();
    let cleaned = raw.trim_matches(|c: char| c == '"' || c == '\'' || c == '.');
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// Recognises a TUI status bar or header label that names another catalog model
/// (e.g. `"Model: Gemini 3.8 Flash medium"` or `"│ Gemini 3.8 Flash medium │"`).
fn extract_tui_model_banner_target(
    line: &str,
    catalog: &[CatalogModelRef],
    spawned: &str,
    spawned_entry: Option<&CatalogModelRef>,
) -> Option<String> {
    if catalog.is_empty() {
        return None;
    }
    let norm_line = normalize_model_token(line);
    let spawned_norm = normalize_model_token(spawned);
    if norm_line.contains(&spawned_norm) {
        return None;
    }
    if let Some(entry) = spawned_entry {
        if norm_line.contains(&normalize_model_token(&entry.label)) {
            return None;
        }
    }
    let looks_like_status_banner = line.contains('│')
        || line.contains('╭')
        || line.contains('╰')
        || line.contains('●')
        || line.to_ascii_lowercase().contains("model:")
        || line.to_ascii_lowercase().starts_with("using ");
    if !looks_like_status_banner {
        return None;
    }
    for entry in catalog {
        let label_norm = normalize_model_token(&entry.label);
        let id_norm = normalize_model_token(&entry.id);
        if (!label_norm.is_empty() && norm_line.contains(&label_norm))
            || (!id_norm.is_empty() && norm_line.contains(&id_norm))
        {
            return Some(entry.label.clone());
        }
    }
    None
}

fn build_block(
    ctx: &DetectionContext<'_>,
    provider: &str,
    scope: QuotaBlockScope,
    reason: QuotaBlockReason,
    detail: String,
    raw_line: &str,
) -> QuotaBlock {
    let expires_dt = parse_reset_time(raw_line, ctx.now).unwrap_or_else(|| {
        let ttl = i64::from(ctx.default_ttl_minutes.max(1));
        ctx.now + Duration::minutes(ttl)
    });
    QuotaBlock {
        id: QuotaBlock::make_id(provider, &scope),
        provider: provider.to_string(),
        scope,
        reason,
        detail,
        detected_at: ctx.now.to_rfc3339_opts(SecondsFormat::Secs, true),
        expires_at: expires_dt.to_rfc3339_opts(SecondsFormat::Secs, true),
        source_agent_id: ctx.source_agent_id.map(str::to_string),
    }
}

fn sanitize_excerpt(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= 140 {
        trimmed.to_string()
    } else {
        let head: String = trimmed.chars().take(137).collect();
        format!("{head}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_agy_catalog() -> Vec<CatalogModelRef> {
        vec![
            CatalogModelRef {
                id: "claude-opus-5-5-thinking".to_string(),
                label: "Claude Opus 5.5 (Thinking)".to_string(),
            },
            CatalogModelRef {
                id: "claude-sonnet-5-5-high".to_string(),
                label: "Claude Sonnet 5.5 (High)".to_string(),
            },
            CatalogModelRef {
                id: "gemini-4-argon-high".to_string(),
                label: "Gemini 4 Argon (High)".to_string(),
            },
            CatalogModelRef {
                id: "gemini-3.8-flash-medium".to_string(),
                label: "Gemini 3.8 Flash (Medium)".to_string(),
            },
        ]
    }

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 23, 16, 0, 0).unwrap()
    }

    #[test]
    fn detects_antigravity_quota_exhaustion_and_parses_until_time() {
        let catalog = sample_agy_catalog();
        let ctx = DetectionContext {
            provider: "antigravity",
            spawned_model: Some("claude-sonnet-5-5-high"),
            catalog: &catalog,
            source_agent_id: Some("agent-12"),
            now: fixed_now(),
            default_ttl_minutes: 60,
        };

        let block = detect_in_text(
            &ctx,
            "Error: model claude-sonnet-5-5-high is out of quota until 2026-10-23T18:30:00Z; pick another",
        )
        .expect("should detect agy model quota message");

        assert_eq!(block.provider, "antigravity");
        assert_eq!(
            block.scope,
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
        assert_eq!(block.reason, QuotaBlockReason::QuotaExhausted);
        assert_eq!(block.expires_at, "2026-10-23T18:30:00Z");
        assert_eq!(block.source_agent_id.as_deref(), Some("agent-12"));
    }

    #[test]
    fn detects_antigravity_silent_model_fallback_to_gemini() {
        let catalog = sample_agy_catalog();
        let ctx = DetectionContext {
            provider: "antigravity",
            spawned_model: Some("claude-sonnet-5-5-high"),
            catalog: &catalog,
            source_agent_id: Some("agent-15"),
            now: fixed_now(),
            default_ttl_minutes: 60,
        };

        // Verified agy string: "Model set to %s" or TUI status bar showing the fallback model label
        let block = detect_in_text(&ctx, "Model set to Gemini 3.8 Flash (Medium)")
            .expect("should detect silent model switch on agy");

        assert_eq!(block.provider, "antigravity");
        assert_eq!(
            block.scope,
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
        assert_eq!(block.reason, QuotaBlockReason::SilentModelFallback);
        assert_eq!(block.expires_at, "2026-10-23T17:00:00Z");
        assert!(block.detail.contains("claude-sonnet-5-5-high"));
        assert!(block.detail.contains("Gemini 3.8 Flash (Medium)"));

        // Also matches TUI status bar / label without parentheses ("Gemini 3.8 Flash medium")
        let banner_block = detect_in_text(&ctx, "│ agy ● Gemini 3.8 Flash medium │")
            .expect("should detect TUI status bar fallback model label");
        assert_eq!(banner_block.reason, QuotaBlockReason::SilentModelFallback);
        assert_eq!(
            banner_block.scope,
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
    }

    #[test]
    fn does_not_flag_silent_fallback_when_console_names_the_spawned_model() {
        let catalog = sample_agy_catalog();
        let ctx = DetectionContext {
            provider: "antigravity",
            spawned_model: Some("claude-sonnet-5-5-high"),
            catalog: &catalog,
            source_agent_id: Some("agent-15"),
            now: fixed_now(),
            default_ttl_minutes: 60,
        };

        assert!(detect_in_text(&ctx, "Model set to Claude Sonnet 5.5 (High)").is_none());
        assert!(detect_in_text(&ctx, "Using model claude-sonnet-5-5-high").is_none());
    }

    #[test]
    fn detects_claude_grok_codex_and_gemini_quota_signals() {
        let now = fixed_now();
        let claude_ctx = DetectionContext {
            provider: "claude",
            spawned_model: Some("sonnet"),
            catalog: &[],
            source_agent_id: Some("agent-2"),
            now,
            default_ttl_minutes: 60,
        };
        let claude_block = detect_in_text(
            &claude_ctx,
            "Usage limit reached — your usage limit resets in 2h 15m.",
        )
        .expect("should detect claude usage limit");
        assert_eq!(claude_block.scope, QuotaBlockScope::Provider);
        assert_eq!(claude_block.expires_at, "2026-10-23T18:15:00Z");

        let grok_ctx = DetectionContext {
            provider: "grok",
            spawned_model: Some("grok-4-20"),
            catalog: &[],
            source_agent_id: None,
            now,
            default_ttl_minutes: 60,
        };
        let grok_block = detect_in_text(
            &grok_ctx,
            "You've hit the rate limit for your plan. Upgrade your account or try again later.",
        )
        .expect("should detect grok plan rate limit");
        assert_eq!(grok_block.scope, QuotaBlockScope::Provider);
        assert_eq!(grok_block.expires_at, "2026-10-23T17:00:00Z");

        let codex_ctx = DetectionContext {
            provider: "codex",
            spawned_model: Some("gpt-5.4"),
            catalog: &[],
            source_agent_id: None,
            now,
            default_ttl_minutes: 60,
        };
        let codex_block = detect_in_text(
            &codex_ctx,
            "Error 429: usage_limit_reached: You've hit your usage limit.",
        )
        .expect("should detect codex usage limit");
        assert_eq!(codex_block.scope, QuotaBlockScope::Provider);

        let gemini_ctx = DetectionContext {
            provider: "gemini",
            spawned_model: Some("gemini-2.5-pro"),
            catalog: &[],
            source_agent_id: None,
            now,
            default_ttl_minutes: 60,
        };
        let gemini_block = detect_in_text(
            &gemini_ctx,
            "GaxiosError: RESOURCE_EXHAUSTED: Quota exceeded for quota metric",
        )
        .expect("should detect gemini resource exhausted");
        assert_eq!(gemini_block.scope, QuotaBlockScope::Provider);
    }

    #[test]
    fn resolves_manual_until_from_iso_or_hhmm_or_duration() {
        let now = fixed_now(); // 16:00 UTC
        let by_iso = resolve_manual_until(Some("2026-10-23T20:00:00Z"), None, 60, now).unwrap();
        assert_eq!(
            by_iso,
            Utc.with_ymd_and_hms(2026, 10, 23, 20, 0, 0).unwrap()
        );

        let by_duration = resolve_manual_until(None, Some(90), 60, now).unwrap();
        assert_eq!(
            by_duration,
            Utc.with_ymd_and_hms(2026, 10, 23, 17, 30, 0).unwrap()
        );

        let by_default = resolve_manual_until(None, None, 60, now).unwrap();
        assert_eq!(
            by_default,
            Utc.with_ymd_and_hms(2026, 10, 23, 17, 0, 0).unwrap()
        );

        let by_hhmm = resolve_manual_until(Some("20:00"), None, 60, now).unwrap();
        assert!(by_hhmm > now);
    }
}
