//! The Tauri commands of `providers`; `lib.rs` registers them.

use crate::providers::{ProviderInfo, ProviderRegistryState};

#[tauri::command]
pub fn list_providers(state: tauri::State<'_, ProviderRegistryState>) -> Vec<ProviderInfo> {
    state.list_providers()
}

#[tauri::command]
pub fn import_provider(
    json: String,
    state: tauri::State<'_, ProviderRegistryState>,
) -> Result<ProviderInfo, String> {
    state.import_provider(&json)
}
