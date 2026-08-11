use crate::database::{kv_get, DatabaseState};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub parts: Vec<LlmContentPart>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmContentPart {
    Text {
        text: String,
    },
    ImageUrl {
        #[serde(rename = "imageUrl")]
        image_url: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub messages: Vec<LlmMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub project_path: String,
    /// Which model config to use: "judge" reads a separate, independently
    /// configured provider so an LLM review runs on a different model than the
    /// implementer. Anything else (incl. None) uses the default settings. The
    /// client never passes a raw namespace — the role maps to a fixed one here.
    pub role: Option<String>,
}

/// Maps a request role to the KV namespace its provider settings live in.
/// Pure and total: an unknown role falls back to the default namespace.
fn settings_namespace(role: Option<&str>) -> &'static str {
    match role {
        Some("judge") => "judge_llm_settings",
        _ => "llm_settings",
    }
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

fn openai_messages(messages: &[LlmMessage]) -> serde_json::Value {
    serde_json::Value::Array(
        messages
            .iter()
            .map(|message| {
                if message.parts.is_empty() {
                    serde_json::json!({ "role": message.role, "content": message.content })
                } else {
                    let mut content = vec![serde_json::json!({
                        "type": "text",
                        "text": message.content
                    })];
                    for part in &message.parts {
                        content.push(match part {
                            LlmContentPart::Text { text } => {
                                serde_json::json!({ "type": "text", "text": text })
                            }
                            LlmContentPart::ImageUrl { image_url } => serde_json::json!({
                                "type": "image_url",
                                "image_url": { "url": image_url }
                            }),
                        });
                    }
                    serde_json::json!({ "role": message.role, "content": content })
                }
            })
            .collect(),
    )
}

fn is_mistral_provider(base_url: &str, model: &str) -> bool {
    let base_url = base_url.to_ascii_lowercase();
    let model = model.to_ascii_lowercase();

    base_url.contains("mistral.ai")
        || model.starts_with("mistralai/")
        || [
            "mistral",
            "ministral",
            "magistral",
            "codestral",
            "devstral",
            "pixtral",
        ]
        .iter()
        .any(|family| model.contains(family))
}

fn openai_request_body(
    request: &LlmRequest,
    base_url: &str,
    model: &str,
    reasoning_enabled: bool,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": openai_messages(&request.messages),
    });

    // `reasoning` is an OpenRouter extension, not part of the OpenAI-compatible
    // contract. Mistral rejects unknown request fields with HTTP 422, so omit it
    // for Mistral models/endpoints and whenever reasoning is disabled.
    if reasoning_enabled && !is_mistral_provider(base_url, model) {
        body["reasoning"] = serde_json::json!({ "enabled": true });
    }

    if let Some(t) = request.temperature {
        body["temperature"] = serde_json::Value::from(t);
    }
    if let Some(m) = request.max_tokens {
        body["max_tokens"] = serde_json::Value::from(m);
    }

    body
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

        let namespace = settings_namespace(request.role.as_deref());
        let base_url = kv_get(conn, namespace, "base_url")?
            .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string());
        // A missing api_key IS the block: a judge namespace with no key makes
        // this return Err, surfacing upstream as a failed check, never a silent pass.
        let api_key = kv_get(conn, namespace, "api_key")?
            .ok_or_else(|| format!("API key not configured for '{}'", namespace))?;
        let model = kv_get(conn, namespace, "model")?
            .unwrap_or_else(|| "moonshotai/kimi-k2-thinking".to_string());
        let reasoning_enabled = kv_get(conn, namespace, "reasoning_enabled")?
            .map(|v| v == "true")
            .unwrap_or(true); // Default to true for Kimi Thinking

        (base_url, api_key, model, reasoning_enabled)
    };

    // 2. Prepare OpenAI request
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let base_url_trimmed = base_url.trim().trim_end_matches('/');
    let url = if base_url_trimmed.ends_with("/chat/completions") {
        base_url_trimmed.to_string()
    } else {
        format!("{}/chat/completions", base_url_trimmed)
    };

    let body = openai_request_body(&request, &base_url, &model, reasoning_enabled);

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

#[cfg(test)]
mod tests {
    use super::{
        is_mistral_provider, openai_messages, openai_request_body, settings_namespace,
        LlmContentPart, LlmMessage, LlmRequest,
    };

    fn request(role: Option<&str>) -> LlmRequest {
        LlmRequest {
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: "Say pong".to_string(),
                parts: vec![],
            }],
            temperature: Some(0.2),
            max_tokens: Some(10),
            project_path: "/project".to_string(),
            role: role.map(str::to_string),
        }
    }

    #[test]
    fn role_maps_to_a_fixed_namespace() {
        assert_eq!(settings_namespace(Some("judge")), "judge_llm_settings");
        assert_eq!(settings_namespace(Some("default")), "llm_settings");
        assert_eq!(settings_namespace(None), "llm_settings");
        // Unknown roles fall back to default, never an arbitrary namespace.
        assert_eq!(settings_namespace(Some("../secrets")), "llm_settings");
    }

    #[test]
    fn multimodal_parts_map_to_openai_content_without_dropping_the_prompt() {
        let messages = openai_messages(&[LlmMessage {
            role: "user".to_string(),
            content: "Transcript context".to_string(),
            parts: vec![LlmContentPart::ImageUrl {
                image_url: "data:image/jpeg;base64,eA==".to_string(),
            }],
        }]);
        assert_eq!(messages[0]["content"][0]["text"], "Transcript context");
        assert_eq!(
            messages[0]["content"][1]["image_url"]["url"],
            "data:image/jpeg;base64,eA=="
        );
    }

    #[test]
    fn recognizes_direct_and_openrouter_mistral_models() {
        assert!(is_mistral_provider(
            "https://api.mistral.ai/v1",
            "mistral-small-latest"
        ));
        assert!(is_mistral_provider(
            "https://openrouter.ai/api/v1",
            "mistralai/mistral-small-3.2-24b-instruct"
        ));
        assert!(is_mistral_provider(
            "http://localhost:11434/v1",
            "codestral-latest"
        ));
        assert!(!is_mistral_provider(
            "https://openrouter.ai/api/v1",
            "moonshotai/kimi-k2-thinking"
        ));
    }

    #[test]
    fn omits_reasoning_extension_for_mistral_for_default_and_judge_requests() {
        for role in [None, Some("judge")] {
            let body = openai_request_body(
                &request(role),
                "https://api.mistral.ai/v1",
                "mistral-small-latest",
                true,
            );
            assert!(body.get("reasoning").is_none());
            assert_eq!(body["max_tokens"], 10);
        }
    }

    #[test]
    fn only_sends_reasoning_extension_when_enabled() {
        let enabled = openai_request_body(
            &request(None),
            "https://openrouter.ai/api/v1",
            "moonshotai/kimi-k2-thinking",
            true,
        );
        assert_eq!(enabled["reasoning"]["enabled"], true);

        let disabled = openai_request_body(
            &request(None),
            "https://openrouter.ai/api/v1",
            "moonshotai/kimi-k2-thinking",
            false,
        );
        assert!(disabled.get("reasoning").is_none());
    }
}
