use crate::database::{kv_get, DatabaseState};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub messages: Vec<LlmMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmResponse {
    pub content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: LlmMessage,
}

pub async fn llm_call_impl(
    request: LlmRequest,
    db_state: State<'_, DatabaseState>,
) -> Result<LlmResponse, String> {
    // 1. Get settings from DB
    let (base_url, api_key, model, reasoning_enabled) = {
        let connections = db_state.connections.lock().unwrap();
        let conn = connections
            .get(&request.project_path)
            .ok_or("Database not initialized for this project")?;

        let base_url = kv_get(conn, "llm_settings", "base_url")?
            .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string());
        let api_key =
            kv_get(conn, "llm_settings", "api_key")?.ok_or("LLM API Key not configured")?;
        let model = kv_get(conn, "llm_settings", "model")?
            .unwrap_or_else(|| "moonshotai/kimi-k2-thinking".to_string());
        let reasoning_enabled = kv_get(conn, "llm_settings", "reasoning_enabled")?
            .map(|v| v == "true")
            .unwrap_or(true); // Default to true for Kimi Thinking

        (base_url, api_key, model, reasoning_enabled)
    };

    // 2. Prepare OpenAI request
    let client = Client::new();
    let base_url_trimmed = base_url.trim().trim_end_matches('/');
    let url = if base_url_trimmed.ends_with("/chat/completions") {
        base_url_trimmed.to_string()
    } else {
        format!("{}/chat/completions", base_url_trimmed)
    };

    let mut body = serde_json::json!({
        "model": model,
        "messages": request.messages,
        "reasoning": {
            "enabled": reasoning_enabled
        }
    });

    if let Some(t) = request.temperature {
        body["temperature"] = serde_json::Value::from(t);
    }
    if let Some(m) = request.max_tokens {
        body["max_tokens"] = serde_json::Value::from(m);
    }

    // 3. Execute request
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "LLM API returned error ({}): {}",
            status, error_text
        ));
    }

    let openai_res: OpenAIResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

    let content = openai_res
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or("No response from LLM")?;

    Ok(LlmResponse { content })
}
