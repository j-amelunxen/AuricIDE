//! What a usage plugin declares, and where its declaration is read from.
//!
//! The plugin describes a *source* (where the raw records live) and a *price
//! list* (how to turn tokens into money). Nothing here parses records — that is
//! `scan.rs` — and nothing here multiplies anything — that is `pricing.rs`.
//!
//! The scan order deliberately mirrors `providers.rs`, because the two are the
//! same idea: a directory of JSON files, later directories winning over earlier
//! ones for the same `id`. The one difference is that `claude-code` ships
//! compiled into the binary. A provider the user does not have is a provider
//! they cannot use; a price list they do not have is a feature that silently
//! reports nothing, so this one has to exist on a fresh clone.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The manifest compiled into the binary, so a fresh install can already read
/// its own usage. A file with the same `id` in any scanned directory replaces
/// it wholesale — that is how a price change is applied without a release.
///
/// It lives beside this file rather than in `usage-plugins/` because that
/// directory is user-local and git-ignored, exactly like `dynamic-providers/`.
/// Reading the default out of it would make a fresh clone fail to compile.
pub const BUILT_IN_CLAUDE_CODE: &str = include_str!("default-manifest.json");

/// Only this shape of source is understood today. An unknown value fails the
/// file rather than being skipped, so a typo cannot leave a plugin that loads
/// but reports nothing.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SourceSpec {
    /// Claude Code's own transcripts: one JSONL file per session.
    ClaudeJsonl {
        /// Directories to walk. `~` is expanded against the user's home.
        roots: Vec<String>,
    },
}

/// One price, optionally only valid before a date.
///
/// `until` exists because introductory pricing is real: Sonnet 5 bills at
/// $2/$10 through 2026-08-31 and $3/$15 after. A report that spans the boundary
/// has to price each record by the day it happened, not by today's rate.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rate {
    /// Exclusive upper bound as `YYYY-MM-DD`. Absent means "from then on".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    pub input_per_m_tok: f64,
    pub output_per_m_tok: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    pub label: String,
    /// Other strings the same model appears under. Older Claude Code versions
    /// wrote bare `opus` / `sonnet` / `haiku`, and dated ids show up too.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Ordered; the first entry whose `until` still covers the record wins.
    pub rates: Vec<Rate>,
    /// Fast mode is a different price for the same model, not a different
    /// model — the transcript records it as `usage.speed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fast_rates: Option<Vec<Rate>>,
}

/// How a cached token is priced relative to a fresh input token.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheMultipliers {
    pub write5m: f64,
    pub write1h: f64,
    pub read: f64,
}

/// Anthropic-hosted tools bill per request rather than per token, so they
/// cannot ride the token maths and get their own rates.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerToolRates {
    pub web_search_per_thousand: f64,
    pub web_fetch_per_thousand: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingSpec {
    pub currency: String,
    pub cache: CacheMultipliers,
    #[serde(default)]
    pub server_tools: ServerToolRates,
    pub models: Vec<ModelSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePlugin {
    pub id: String,
    pub name: String,
    pub manifest_version: u32,
    pub source: SourceSpec,
    pub pricing: PricingSpec,
}

impl UsagePlugin {
    /// The model entry a transcript's model string belongs to.
    ///
    /// Matching is on the normalized string (see [`normalize_model_id`]) and
    /// covers ids and aliases alike. `None` means the price list has never
    /// heard of it — the caller must still count its tokens and say so, rather
    /// than dropping the record or pricing it at zero.
    pub fn model_for(&self, raw: &str) -> Option<&ModelSpec> {
        let normalized = normalize_model_id(raw);
        self.pricing.models.iter().find(|model| {
            model.id == normalized || model.aliases.iter().any(|alias| alias == &normalized)
        })
    }

    /// Where this plugin's records live, with `~` already expanded.
    pub fn roots(&self, home: &Path) -> Vec<PathBuf> {
        let SourceSpec::ClaudeJsonl { roots } = &self.source;
        roots.iter().map(|root| expand_home(root, home)).collect()
    }
}

/// Strips the decorations Claude Code appends to a model string.
///
/// `claude-opus-5[1m]` is the 1M-context variant of the same model at the same
/// price, so the suffix must not produce a second, unpriced model. Case is
/// folded because the string is written by several different code paths.
pub fn normalize_model_id(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_suffix = match trimmed.find('[') {
        Some(index) => &trimmed[..index],
        None => trimmed,
    };
    without_suffix.trim().to_lowercase()
}

/// The rate in force on `day` (`YYYY-MM-DD`).
///
/// Entries are scanned in order and the first whose `until` is still ahead of
/// the day wins; an entry without `until` matches everything, so it belongs
/// last. A list whose every entry has expired falls back to the final entry,
/// because reporting no price at all for a model we do have a price list for
/// would be worse than reporting a stale one.
pub fn rate_on<'a>(rates: &'a [Rate], day: &str) -> Option<&'a Rate> {
    rates
        .iter()
        .find(|rate| match &rate.until {
            Some(until) => day < until.as_str(),
            None => true,
        })
        .or_else(|| rates.last())
}

fn expand_home(raw: &str, home: &Path) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    if raw == "~" {
        return home.to_path_buf();
    }
    PathBuf::from(raw)
}

/// Every plugin that is available, built-in first and files layered over it.
///
/// A file that fails to parse is reported on stderr and skipped, exactly as a
/// provider config is: one bad file must not cost the user the others, and the
/// built-in must survive a broken override of itself.
pub fn load_plugins(dirs: &[PathBuf]) -> Vec<UsagePlugin> {
    let mut loaded: HashMap<String, UsagePlugin> = HashMap::new();

    match serde_json::from_str::<UsagePlugin>(BUILT_IN_CLAUDE_CODE) {
        Ok(plugin) => {
            loaded.insert(plugin.id.clone(), plugin);
        }
        // Unreachable unless the shipped file and these types disagree, which
        // `the_built_in_manifest_parses` is here to catch first.
        Err(error) => eprintln!("CC usage: the built-in manifest is unreadable: {error}"),
    }

    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Ok(contents) = fs::read_to_string(&path) else {
                continue;
            };
            match serde_json::from_str::<UsagePlugin>(&contents) {
                Ok(plugin) => {
                    loaded.insert(plugin.id.clone(), plugin);
                }
                Err(error) => {
                    eprintln!("CC usage: failed to parse usage plugin {path:?}: {error}")
                }
            }
        }
    }

    let mut plugins: Vec<UsagePlugin> = loaded.into_values().collect();
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    plugins
}

/// The directories scanned for plugin files, in increasing precedence.
pub fn search_paths(app_data_dir: Option<&Path>, resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("usage-plugins"),
        PathBuf::from("../usage-plugins"),
    ];
    if let Some(dir) = app_data_dir {
        paths.push(dir.join("usage-plugins"));
    }
    if let Some(dir) = resource_dir {
        paths.push(dir.join("usage-plugins"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("usage-plugins"));
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built_in() -> UsagePlugin {
        serde_json::from_str(BUILT_IN_CLAUDE_CODE).expect("the shipped manifest must parse")
    }

    #[test]
    fn the_built_in_manifest_parses() {
        let plugin = built_in();
        assert_eq!(plugin.id, "claude-code");
        assert_eq!(plugin.pricing.currency, "USD");
        assert!(
            plugin.pricing.models.len() >= 5,
            "a price list this short cannot cover the models in use"
        );
    }

    #[test]
    fn the_context_suffix_is_not_a_different_model() {
        // `claude-opus-5[1m]` bills at the same rate as `claude-opus-5`; if the
        // suffix survived normalization the 1M-context traffic would fall out
        // of the price list and be reported as unpriced.
        assert_eq!(normalize_model_id("claude-opus-5[1m]"), "claude-opus-5");
        assert_eq!(normalize_model_id("opus[1m]"), "opus");
        assert_eq!(normalize_model_id("  Claude-Opus-5 "), "claude-opus-5");
    }

    #[test]
    fn short_and_dated_model_names_resolve_to_the_same_entry() {
        let plugin = built_in();
        let by_id = plugin.model_for("claude-haiku-4-5").expect("id");
        let by_alias = plugin.model_for("haiku").expect("alias");
        let by_dated = plugin
            .model_for("claude-haiku-4-5-20251001")
            .expect("dated alias");
        assert_eq!(by_id.id, by_alias.id);
        assert_eq!(by_id.id, by_dated.id);
    }

    #[test]
    fn an_unknown_model_resolves_to_nothing_rather_than_a_default() {
        // Guessing a price for a model we have never seen would put a number
        // on the report that nobody can trace back to a rate.
        let plugin = built_in();
        assert!(plugin.model_for("claude-something-9").is_none());
        assert!(plugin.model_for("<synthetic>").is_none());
    }

    #[test]
    fn a_record_is_priced_by_the_day_it_happened() {
        let plugin = built_in();
        let sonnet = plugin.model_for("claude-sonnet-5").expect("sonnet 5");

        let intro = rate_on(&sonnet.rates, "2026-08-16").expect("intro rate");
        assert_eq!(intro.input_per_m_tok, 2.0);

        let standard = rate_on(&sonnet.rates, "2026-09-01").expect("standard rate");
        assert_eq!(standard.input_per_m_tok, 3.0);

        // The boundary is exclusive: the last day of the introductory period
        // still bills at the introductory price.
        assert_eq!(
            rate_on(&sonnet.rates, "2026-08-31")
                .unwrap()
                .input_per_m_tok,
            2.0
        );
    }

    #[test]
    fn a_single_open_ended_rate_applies_to_every_day() {
        let plugin = built_in();
        let opus = plugin.model_for("claude-opus-5").expect("opus 5");
        for day in ["2025-01-01", "2026-08-16", "2030-12-31"] {
            assert_eq!(rate_on(&opus.rates, day).unwrap().input_per_m_tok, 5.0);
        }
    }

    #[test]
    fn a_file_replaces_the_built_in_of_the_same_id() {
        // This is the point of the whole mechanism: a price change lands as a
        // file, without a release.
        let dir = tempfile::tempdir().unwrap();
        let mut plugin = built_in();
        plugin.pricing.models[0].rates[0].input_per_m_tok = 99.0;
        fs::write(
            dir.path().join("claude-code.json"),
            serde_json::to_string(&plugin).unwrap(),
        )
        .unwrap();

        let loaded = load_plugins(&[dir.path().to_path_buf()]);
        assert_eq!(loaded.len(), 1, "the override must not add a second plugin");
        assert_eq!(loaded[0].pricing.models[0].rates[0].input_per_m_tok, 99.0);
    }

    #[test]
    fn a_broken_file_costs_only_itself() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("broken.json"), "{ not json").unwrap();

        let loaded = load_plugins(&[dir.path().to_path_buf()]);
        assert_eq!(
            loaded.len(),
            1,
            "the built-in must survive an unparseable neighbour"
        );
        assert_eq!(loaded[0].id, "claude-code");
    }

    #[test]
    fn a_second_plugin_is_added_rather_than_merged() {
        let dir = tempfile::tempdir().unwrap();
        let mut other = built_in();
        other.id = "other-cli".to_string();
        other.name = "Other CLI".to_string();
        fs::write(
            dir.path().join("other.json"),
            serde_json::to_string(&other).unwrap(),
        )
        .unwrap();

        let loaded = load_plugins(&[dir.path().to_path_buf()]);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "claude-code");
        assert_eq!(loaded[1].id, "other-cli");
    }

    #[test]
    fn roots_expand_against_the_home_directory() {
        let plugin = built_in();
        let roots = plugin.roots(Path::new("/Users/example"));
        assert_eq!(
            roots,
            vec![PathBuf::from("/Users/example/.claude/projects")]
        );
    }

    #[test]
    fn an_unknown_source_type_fails_the_file() {
        // Skipping the unknown field instead would produce a plugin that loads
        // and then reports nothing, with no line anywhere saying why.
        let json = r#"{
            "id": "x", "name": "X", "manifestVersion": 1,
            "source": {"type": "sqlite", "roots": []},
            "pricing": {"currency": "USD", "cache": {"write5m": 1.25, "write1h": 2.0, "read": 0.1}, "models": []}
        }"#;
        assert!(serde_json::from_str::<UsagePlugin>(json).is_err());
    }
}
