//! Live model catalogs from provider CLIs, merged with the static
//! `info.models` metadata in each dynamic-providers JSON.
//!
//! The static list is the fallback and the place ranks / `useFor` /
//! `relativeCost` live. When a CLI can list its models, that list wins for
//! what is offered; a static entry the CLI no longer knows is kept with
//! `available: false` so Settings can mark it without rewriting user policy.

use super::types::{ModelOption, ModelsDiscoveryConfig, ModelsDiscoveryFormat};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Default cache lifetime when a discovery config omits `cacheSeconds`.
pub const DEFAULT_CACHE_SECONDS: u64 = 3600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCatalog {
    fetched_at_unix: u64,
    models: Vec<DiscoveredModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub value: String,
    pub label: String,
}

/// Built-in discovery for known provider ids when the JSON omits
/// `modelsDiscovery`. Keeps a stale checked-in (or gitignored) catalog from
/// being the only source of truth.
pub fn builtin_discovery(provider_id: &str, executable: &str) -> Option<ModelsDiscoveryConfig> {
    match provider_id {
        "antigravity" => Some(ModelsDiscoveryConfig {
            command: executable.to_string(),
            args: vec!["models".into()],
            format: ModelsDiscoveryFormat::TsvIdLabel,
            cache_seconds: DEFAULT_CACHE_SECONDS,
        }),
        "grok" => Some(ModelsDiscoveryConfig {
            command: executable.to_string(),
            args: vec!["models".into()],
            format: ModelsDiscoveryFormat::GrokBullet,
            cache_seconds: DEFAULT_CACHE_SECONDS,
        }),
        "codex" => Some(ModelsDiscoveryConfig {
            command: String::new(),
            args: vec![],
            format: ModelsDiscoveryFormat::CodexCache,
            cache_seconds: DEFAULT_CACHE_SECONDS,
        }),
        _ => None,
    }
}

/// Resolve the models a provider should expose right now.
///
/// `cache_dir` is typically `<app_data_dir>/model-catalog`. Without it, or when
/// discovery fails and no cache exists, the static list is returned unchanged
/// (every entry available).
pub fn resolve_models(
    provider_id: &str,
    executable: &str,
    discovery: Option<&ModelsDiscoveryConfig>,
    static_models: &[ModelOption],
    cache_dir: Option<&Path>,
) -> Vec<ModelOption> {
    let discovery = discovery
        .cloned()
        .or_else(|| builtin_discovery(provider_id, executable));
    let Some(discovery) = discovery else {
        return mark_all_available(static_models);
    };

    let cache_path = cache_dir.map(|dir| dir.join(format!("{provider_id}.json")));
    if let Some(path) = cache_path.as_ref() {
        if let Some(cached) = read_fresh_cache(path, discovery.cache_seconds) {
            return merge_catalog(static_models, &cached.models, provider_id);
        }
    }

    match discover(&discovery) {
        Ok(models) if !models.is_empty() => {
            if let Some(path) = cache_path.as_ref() {
                let _ = write_cache(path, &models);
            }
            merge_catalog(static_models, &models, provider_id)
        }
        Ok(_) | Err(_) => {
            if let Some(path) = cache_path.as_ref() {
                if let Some(stale) = read_cache(path) {
                    return merge_catalog(static_models, &stale.models, provider_id);
                }
            }
            mark_all_available(static_models)
        }
    }
}

fn mark_all_available(static_models: &[ModelOption]) -> Vec<ModelOption> {
    static_models
        .iter()
        .cloned()
        .map(|mut model| {
            model.available = true;
            model
        })
        .collect()
}

/// Merge a live CLI list with static metadata.
///
/// - `auto` from static stays first when present.
/// - Discovered ids are offered (`available: true`); static rank/useFor/cost
///   and label win when the id matches.
/// - Static ids the CLI no longer lists stay in the result with
///   `available: false` (except `auto`).
pub fn merge_catalog(
    static_models: &[ModelOption],
    discovered: &[DiscoveredModel],
    provider_id: &str,
) -> Vec<ModelOption> {
    let static_by_value: HashMap<&str, &ModelOption> = static_models
        .iter()
        .map(|model| (model.value.as_str(), model))
        .collect();

    let mut out: Vec<ModelOption> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(auto) = static_by_value.get("auto") {
        let mut model = (*auto).clone();
        model.available = true;
        out.push(model);
        seen.insert("auto".to_string());
    }

    for discovered in discovered {
        if discovered.value == "auto" || !seen.insert(discovered.value.clone()) {
            continue;
        }
        if let Some(known) = static_by_value.get(discovered.value.as_str()) {
            let mut model = (*known).clone();
            model.available = true;
            if model.label.trim().is_empty() {
                model.label = discovered.label.clone();
            }
            out.push(model);
        } else {
            out.push(ModelOption {
                value: discovered.value.clone(),
                label: if discovered.label.trim().is_empty() {
                    discovered.value.clone()
                } else {
                    discovered.label.clone()
                },
                rank: infer_rank(provider_id, &discovered.value),
                use_for: None,
                relative_cost: None,
                available: true,
            });
        }
    }

    for model in static_models {
        if model.value == "auto" || seen.contains(&model.value) {
            continue;
        }
        let mut unavailable = model.clone();
        unavailable.available = false;
        out.push(unavailable);
    }

    out
}

/// Best-effort size hint for a model the static list does not yet describe.
/// Uncertain ranks are documented in the fix report.
pub fn infer_rank(provider_id: &str, model_id: &str) -> Option<i64> {
    let id = model_id.to_ascii_lowercase();
    match provider_id {
        "antigravity" => {
            if id.contains("argon") || id.contains("opus") {
                Some(3)
            } else if id.contains("sonnet") {
                Some(2)
            } else if id.contains("flash") || id.contains("gpt-oss") {
                Some(1)
            } else {
                None
            }
        }
        "codex" => {
            if id.contains("astra") {
                Some(4)
            } else if id.contains("sol") {
                Some(3)
            } else if id.contains("terra") {
                Some(2)
            } else if id.contains("luna") {
                Some(1)
            } else {
                None
            }
        }
        "grok" => {
            if id.contains("4.7") && id.contains("fast") {
                Some(2)
            } else if id.contains("4.7") {
                Some(3)
            } else if id.contains("4.6") {
                Some(2)
            } else if id.contains("4.5") {
                Some(1)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Refuse a spawn whose model the provider no longer offers.
pub fn refuse_unavailable_model(
    provider_name: &str,
    provider_id: &str,
    model: &str,
    models: &[ModelOption],
) -> Result<(), String> {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed == "auto" {
        return Ok(());
    }
    match models.iter().find(|option| option.value == trimmed) {
        Some(option) if option.is_available() => Ok(()),
        Some(_) => {
            let current = available_values(models);
            Err(format!(
                "Model '{trimmed}' is no longer offered by {provider_name} ({provider_id}). \
                 It stayed in your settings so nothing was rewritten — pick a current model instead. \
                 Available: {}.",
                current.join(", ")
            ))
        }
        None => {
            let current = available_values(models);
            Err(format!(
                "Provider '{provider_id}' does not offer model '{trimmed}'. Available: {}.",
                if current.is_empty() {
                    "(none)".into()
                } else {
                    current.join(", ")
                }
            ))
        }
    }
}

fn available_values(models: &[ModelOption]) -> Vec<String> {
    models
        .iter()
        .filter(|model| model.is_available())
        .map(|model| model.value.clone())
        .collect()
}

pub fn discover(config: &ModelsDiscoveryConfig) -> Result<Vec<DiscoveredModel>, String> {
    match config.format {
        ModelsDiscoveryFormat::TsvIdLabel => {
            let output = run_command(&config.command, &config.args)?;
            Ok(parse_tsv_id_label(&output))
        }
        ModelsDiscoveryFormat::GrokBullet => {
            let output = run_command(&config.command, &config.args)?;
            Ok(parse_grok_bullet(&output))
        }
        ModelsDiscoveryFormat::CodexCache => {
            let path = codex_cache_path()?;
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
            parse_codex_cache(&raw)
        }
    }
}

fn run_command(command: &str, args: &[String]) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("modelsDiscovery.command is empty".into());
    }
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|err| format!("Could not run `{command}`: {err}"))?;
    // Some CLIs print the list on stdout even with a non-zero exit; prefer
    // stdout, fall back to stderr.
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stderr.trim().is_empty() {
        return Ok(stderr);
    }
    if !output.status.success() {
        return Err(format!("`{command}` exited with status {}", output.status));
    }
    Ok(String::new())
}

/// `id\\tlabel` per line (Antigravity `agy models`).
pub fn parse_tsv_id_label(output: &str) -> Vec<DiscoveredModel> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("Fetching ") {
                return None;
            }
            let (value, label) = match line.split_once('\t') {
                Some((value, label)) => (value.trim(), label.trim()),
                None => {
                    let value = line.trim();
                    (value, value)
                }
            };
            if value.is_empty() {
                return None;
            }
            Some(DiscoveredModel {
                value: value.to_string(),
                label: if label.is_empty() {
                    value.to_string()
                } else {
                    label.to_string()
                },
            })
        })
        .collect()
}

/// Grok `grok models` bullet list under "Available models:".
pub fn parse_grok_bullet(output: &str) -> Vec<DiscoveredModel> {
    let mut models = Vec::new();
    let mut in_list = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with("available models") {
            in_list = true;
            continue;
        }
        if !in_list {
            continue;
        }
        let item = trimmed
            .trim_start_matches('*')
            .trim_start_matches('-')
            .trim();
        if item.is_empty() {
            if !models.is_empty() {
                break;
            }
            continue;
        }
        // "grok-4.5 (default)" → grok-4.5
        let value = item
            .split_whitespace()
            .next()
            .unwrap_or(item)
            .trim()
            .to_string();
        if value.is_empty() {
            continue;
        }
        models.push(DiscoveredModel {
            label: value.clone(),
            value,
        });
    }
    models
}

/// Codex `~/.codex/models_cache.json` — only `visibility: "list"` entries.
pub fn parse_codex_cache(raw: &str) -> Result<Vec<DiscoveredModel>, String> {
    #[derive(Deserialize)]
    struct CacheFile {
        models: Vec<CodexModel>,
    }
    #[derive(Deserialize)]
    struct CodexModel {
        slug: String,
        #[serde(default)]
        display_name: String,
        #[serde(default)]
        visibility: String,
    }
    let parsed: CacheFile =
        serde_json::from_str(raw).map_err(|err| format!("Invalid Codex models cache: {err}"))?;
    Ok(parsed
        .models
        .into_iter()
        .filter(|model| model.visibility == "list")
        .map(|model| DiscoveredModel {
            label: if model.display_name.trim().is_empty() {
                model.slug.clone()
            } else {
                model.display_name
            },
            value: model.slug,
        })
        .collect())
}

fn codex_cache_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "HOME is unset".to_string())?;
    Ok(home.join(".codex/models_cache.json"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn read_fresh_cache(path: &Path, cache_seconds: u64) -> Option<CachedCatalog> {
    let cached = read_cache(path)?;
    let age = now_unix().saturating_sub(cached.fetched_at_unix);
    if age <= cache_seconds {
        Some(cached)
    } else {
        None
    }
}

fn read_cache(path: &Path) -> Option<CachedCatalog> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(path: &Path, models: &[DiscoveredModel]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let cached = CachedCatalog {
        fetched_at_unix: now_unix(),
        models: models.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&cached).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn static_model(value: &str, rank: Option<i64>) -> ModelOption {
        ModelOption {
            value: value.into(),
            label: value.into(),
            rank,
            use_for: None,
            relative_cost: None,
            available: true,
        }
    }

    #[test]
    fn agy_tsv_parser_skips_fetch_banner() {
        let raw = "Fetching available models...\n\
gemini-4-argon-high\tGemini 4 Argon (High)\n\
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n";
        let models = parse_tsv_id_label(raw);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].value, "gemini-4-argon-high");
        assert_eq!(models[0].label, "Gemini 4 Argon (High)");
    }

    #[test]
    fn grok_bullet_parser_reads_star_and_dash() {
        let raw = "You are logged in with grok.com.\n\nDefault model: grok-4.5\n\n\
Available models:\n  - grok-4.7\n  - grok-4.7-build-fast\n  * grok-4.5 (default)\n";
        let models = parse_grok_bullet(raw);
        assert_eq!(
            models.iter().map(|m| m.value.as_str()).collect::<Vec<_>>(),
            vec!["grok-4.7", "grok-4.7-build-fast", "grok-4.5"]
        );
    }

    #[test]
    fn codex_cache_keeps_only_list_visibility() {
        let raw = r#"{
          "models": [
            {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list"},
            {"slug":"gpt-reserve","display_name":"Reserve","visibility":"hide"}
          ]
        }"#;
        let models = parse_codex_cache(raw).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].value, "gpt-6-astra");
    }

    #[test]
    fn merge_keeps_stale_static_as_unavailable() {
        let static_models = vec![
            static_model("auto", None),
            static_model("gemini-3.1-pro-high", None),
            ModelOption {
                value: "gemini-3.8-flash-high".into(),
                label: "Gemini 3.8 Flash (High)".into(),
                rank: Some(1),
                use_for: Some("Fast coding.".into()),
                relative_cost: Some(1.0),
                available: true,
            },
        ];
        let discovered = vec![
            DiscoveredModel {
                value: "gemini-4-argon-high".into(),
                label: "Gemini 4 Argon (High)".into(),
            },
            DiscoveredModel {
                value: "gemini-3.8-flash-high".into(),
                label: "Gemini 3.8 Flash (High)".into(),
            },
        ];
        let merged = merge_catalog(&static_models, &discovered, "antigravity");
        assert_eq!(merged[0].value, "auto");
        assert!(merged[0].is_available());
        let argon = merged
            .iter()
            .find(|m| m.value == "gemini-4-argon-high")
            .unwrap();
        assert!(argon.is_available());
        assert_eq!(argon.rank, Some(3)); // inferred
        let flash = merged
            .iter()
            .find(|m| m.value == "gemini-3.8-flash-high")
            .unwrap();
        assert_eq!(flash.rank, Some(1));
        assert_eq!(flash.use_for.as_deref(), Some("Fast coding."));
        let stale = merged
            .iter()
            .find(|m| m.value == "gemini-3.1-pro-high")
            .unwrap();
        assert!(!stale.is_available());
    }

    #[test]
    fn refuse_unavailable_names_current_models() {
        let models = vec![
            static_model("auto", None),
            ModelOption {
                value: "gemini-4-argon-high".into(),
                label: "Argon High".into(),
                rank: Some(3),
                available: true,
                ..Default::default()
            },
            ModelOption {
                value: "gemini-3.1-pro-high".into(),
                label: "Old".into(),
                available: false,
                ..Default::default()
            },
        ];
        let err = refuse_unavailable_model(
            "Antigravity CLI",
            "antigravity",
            "gemini-3.1-pro-high",
            &models,
        )
        .unwrap_err();
        assert!(err.contains("no longer offered"), "{err}");
        assert!(err.contains("gemini-4-argon-high"), "{err}");
        refuse_unavailable_model(
            "Antigravity CLI",
            "antigravity",
            "gemini-4-argon-high",
            &models,
        )
        .unwrap();
        refuse_unavailable_model("Antigravity CLI", "antigravity", "auto", &models).unwrap();
    }

    #[test]
    fn infer_rank_codex_families() {
        assert_eq!(infer_rank("codex", "gpt-6-astra"), Some(4));
        assert_eq!(infer_rank("codex", "gpt-6.1-sol"), Some(3));
        assert_eq!(infer_rank("codex", "gpt-5.6-terra"), Some(2));
        assert_eq!(infer_rank("codex", "gpt-6-luna"), Some(1));
    }
}
