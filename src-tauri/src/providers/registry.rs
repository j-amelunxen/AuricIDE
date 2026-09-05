use super::crush::CrushProvider;
use super::dynamic::DynamicProvider;
use super::types::*;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::Manager;

/// The one provider compiled into the binary. Every other provider comes from a
/// user-supplied `dynamic-providers/*.json`, so this id is the fallback a fresh
/// install always has and no config file may claim it.
pub const RESERVED_PROVIDER_ID: &str = "crush";

pub struct ProviderRegistry {
    // Interior mutability so providers can be imported at runtime (the packaged
    // app ships without dynamic-providers/, so users bring their own configs).
    pub(crate) providers: RwLock<HashMap<String, Arc<dyn AgentProvider>>>,
    pub(crate) default_id: RwLock<String>,
    /// Where imported configs are persisted (app_data_dir/dynamic-providers).
    pub(crate) import_dir: Option<PathBuf>,
}

impl ProviderRegistry {
    pub fn new(app: Option<&tauri::AppHandle>) -> Self {
        let mut providers: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();

        // Add Crush as fallback/default if no others are present (or keep it always)
        providers.insert(RESERVED_PROVIDER_ID.to_string(), Arc::new(CrushProvider));

        // Load Dynamic Providers
        let mut search_paths = vec![
            PathBuf::from("dynamic-providers"),
            PathBuf::from("../dynamic-providers"),
        ];

        if let Some(app) = app {
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                search_paths.push(app_data_dir.join("dynamic-providers"));
            }
            if let Ok(resource_dir) = app.path().resource_dir() {
                search_paths.push(resource_dir.join("dynamic-providers"));
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                search_paths.push(exe_dir.join("dynamic-providers"));
            }
        }

        providers.extend(Self::load_configs_from(&search_paths));

        // Determine default ID. First dynamic provider we find? Or claude?
        // Usually, pick the first dynamic one, or fallback to crush.
        let default_id = if providers.contains_key("claude") {
            "claude".to_string()
        } else if providers.len() > 1 {
            // Find any key that isn't crush
            providers
                .keys()
                .find(|&k| k != "crush")
                .cloned()
                .unwrap_or_else(|| "crush".to_string())
        } else {
            "crush".to_string()
        };

        let import_dir = app.and_then(|a| {
            a.path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("dynamic-providers"))
        });

        Self {
            providers: RwLock::new(providers),
            default_id: RwLock::new(default_id),
            import_dir,
        }
    }

    /// Scan `dirs` for `*.json` provider configs. Later directories win over
    /// earlier ones for the same id, which is the order `new()` has always used.
    ///
    /// A file that fails to parse is reported on stderr and skipped, so one bad
    /// config never costs the user the rest of them. A config claiming the
    /// built-in id is skipped too — see `RESERVED_PROVIDER_ID`.
    pub fn load_configs_from(dirs: &[PathBuf]) -> HashMap<String, Arc<dyn AgentProvider>> {
        let mut loaded: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();

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
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                match serde_json::from_str::<ProviderConfig>(&content) {
                    Ok(config) => {
                        let id = config.id.clone();
                        if id == RESERVED_PROVIDER_ID {
                            eprintln!(
                                "Ignoring {:?}: \"{}\" is a built-in provider id",
                                path, RESERVED_PROVIDER_ID
                            );
                            continue;
                        }
                        loaded.insert(id, Arc::new(DynamicProvider::new(config)));
                    }
                    Err(e) => {
                        eprintln!("Failed to parse provider config {:?}: {}", path, e)
                    }
                }
            }
        }

        loaded
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentProvider>> {
        self.providers.read().unwrap().get(id).cloned()
    }

    pub fn default_provider(&self) -> Arc<dyn AgentProvider> {
        let default_id = self.default_id.read().unwrap().clone();
        let providers = self.providers.read().unwrap();
        providers
            .get(&default_id)
            .or_else(|| providers.values().next())
            .expect("registry always has at least the crush provider")
            .clone()
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        let default_id = self.default_id.read().unwrap().clone();
        let providers = self.providers.read().unwrap();
        let mut infos: Vec<ProviderInfo> = providers.values().map(|p| p.info()).collect();
        infos.sort_by(|a, b| {
            if a.id == default_id {
                std::cmp::Ordering::Less
            } else if b.id == default_id {
                std::cmp::Ordering::Greater
            } else {
                a.id.cmp(&b.id)
            }
        });
        infos
    }

    /// Import a dynamic provider config at runtime: validate JSON, persist it to
    /// the import dir, and register it live. Returns the imported provider's info.
    pub fn import_provider(&self, json: &str) -> Result<ProviderInfo, String> {
        let config: ProviderConfig =
            serde_json::from_str(json).map_err(|e| format!("Invalid provider config: {}", e))?;
        let id = config.id.trim().to_string();
        if id.is_empty() {
            return Err("Provider config is missing an \"id\"".to_string());
        }
        if id == RESERVED_PROVIDER_ID {
            return Err(format!(
                "\"{}\" is a built-in provider id and cannot be overwritten",
                RESERVED_PROVIDER_ID
            ));
        }

        // Persist so the import survives a restart.
        if let Some(dir) = &self.import_dir {
            fs::create_dir_all(dir).map_err(|e| format!("Could not create provider dir: {}", e))?;
            fs::write(dir.join(format!("{}.json", id)), json)
                .map_err(|e| format!("Could not save provider: {}", e))?;
        }

        let provider = Arc::new(DynamicProvider::new(config));
        let info = provider.info();
        self.providers.write().unwrap().insert(id.clone(), provider);
        // A freshly-imported claude becomes the default (matches startup logic).
        if id == "claude" {
            *self.default_id.write().unwrap() = "claude".to_string();
        }
        Ok(info)
    }
}

pub type ProviderRegistryState = Arc<ProviderRegistry>;

pub fn new_provider_registry(app: Option<&tauri::AppHandle>) -> ProviderRegistryState {
    Arc::new(ProviderRegistry::new(app))
}
