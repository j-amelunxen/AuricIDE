//! The Tauri commands of `llm`; `lib.rs` registers them.

use crate::app_config::AppCredentialsState;
use crate::database::DatabaseState;
use crate::llm::{self, LlmRequest, LlmResponse};

#[tauri::command]
pub async fn llm_call(
    request: LlmRequest,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<LlmResponse, String> {
    llm::llm_call_impl(request, db_state, credentials).await
}
