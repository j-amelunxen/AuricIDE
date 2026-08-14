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

/// What a call needs, after global settings and any project override have been
/// folded together.
struct ResolvedLlmSettings {
    base_url: String,
    api_key: String,
    model: String,
    reasoning_enabled: bool,
}

/// Folds the application-wide settings and the project's overrides into the
/// values a call actually uses.
///
/// Field by field, not all-or-nothing: a project that wants a different model
/// should not have to restate the key to get one. `app_config::resolve_credential`
/// owns the "which one wins" rule, so this and the settings screens cannot come
/// to different conclusions about the same two values.
fn resolve_llm_settings(
    global: &std::collections::BTreeMap<String, String>,
    project: &std::collections::BTreeMap<String, String>,
    namespace: &str,
) -> Result<ResolvedLlmSettings, String> {
    let pick = |key: &str| {
        crate::app_config::resolve_credential(global.get(key).cloned(), project.get(key).cloned())
    };

    // A missing api_key IS the block: a judge namespace with no key makes this
    // return Err, surfacing upstream as a failed check, never a quiet pass.
    let api_key = pick("api_key").ok_or_else(|| {
        format!(
            "No API key configured for '{}'. Set one under Settings → Application → Credentials, \
             or override it for this project under Settings → Project.",
            namespace
        )
    })?;

    Ok(ResolvedLlmSettings {
        base_url: pick("base_url").unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string()),
        api_key,
        model: pick("model").unwrap_or_else(|| "moonshotai/kimi-k2-thinking".to_string()),
        // Default to true for Kimi Thinking.
        reasoning_enabled: pick("reasoning_enabled")
            .map(|value| value == "true")
            .unwrap_or(true),
    })
}

/// The settings fields read for a namespace, in both stores.
const LLM_SETTING_KEYS: [&str; 4] = ["base_url", "api_key", "model", "reasoning_enabled"];

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
    credentials: State<'_, crate::app_config::AppCredentialsState>,
) -> Result<LlmResponse, String> {
    let namespace = settings_namespace(request.role.as_deref());

    // 1. Settings, application-wide first and the project's overrides on top.
    let settings = {
        let global = crate::app_config::read_credentials(credentials.path())
            .remove(namespace)
            .unwrap_or_default();

        // A project without an open database simply overrides nothing. The
        // key lives in the application store now, so an uninitialised project
        // is no longer a reason to refuse the call.
        let project = {
            let connections = db_state.connections.lock().unwrap();
            match connections.get(&request.project_path) {
                Some(conn) => {
                    let mut found = std::collections::BTreeMap::new();
                    for key in LLM_SETTING_KEYS {
                        if let Some(value) = kv_get(conn, namespace, key)? {
                            found.insert(key.to_string(), value);
                        }
                    }
                    found
                }
                None => std::collections::BTreeMap::new(),
            }
        };

        resolve_llm_settings(&global, &project, namespace)?
    };
    let ResolvedLlmSettings {
        base_url,
        api_key,
        model,
        reasoning_enabled,
    } = settings;

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
        is_mistral_provider, openai_messages, openai_request_body, resolve_llm_settings,
        settings_namespace, LlmContentPart, LlmMessage, LlmRequest,
    };
    use std::collections::BTreeMap;

    fn settings(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn a_global_key_serves_a_project_that_configured_nothing() {
        // The point of the whole move: open a new project, the key is already
        // there.
        let global = settings(&[("api_key", "sk-global")]);

        let resolved = resolve_llm_settings(&global, &BTreeMap::new(), "llm_settings")
            .expect("a global key is enough");

        assert_eq!(resolved.api_key, "sk-global");
        assert_eq!(resolved.base_url, "https://openrouter.ai/api/v1");
        assert_eq!(resolved.model, "moonshotai/kimi-k2-thinking");
        assert!(resolved.reasoning_enabled);
    }

    #[test]
    fn a_project_override_wins_field_by_field() {
        // Overriding the model must not force the project to restate the key.
        let global = settings(&[("api_key", "sk-global"), ("model", "global-model")]);
        let project = settings(&[("model", "project-model")]);

        let resolved = resolve_llm_settings(&global, &project, "llm_settings").expect("resolves");

        assert_eq!(resolved.model, "project-model");
        assert_eq!(resolved.api_key, "sk-global");
    }

    #[test]
    fn a_blank_project_field_falls_back_instead_of_overriding_with_nothing() {
        // Clearing a project field means "use the global one again", not "this
        // project has no key".
        let global = settings(&[("api_key", "sk-global")]);
        let project = settings(&[("api_key", "   ")]);

        let resolved = resolve_llm_settings(&global, &project, "llm_settings").expect("resolves");

        assert_eq!(resolved.api_key, "sk-global");
    }

    #[test]
    fn a_missing_key_names_both_places_it_looked() {
        let error = resolve_llm_settings(&BTreeMap::new(), &BTreeMap::new(), "judge_llm_settings")
            .err()
            .expect("no key anywhere must fail");

        // After the split, "not configured" without a location is unactionable:
        // there are now two screens it could mean.
        assert!(error.contains("judge_llm_settings"), "{}", error);
        assert!(error.to_lowercase().contains("application"), "{}", error);
        assert!(error.to_lowercase().contains("project"), "{}", error);
    }

    #[test]
    fn reasoning_can_be_turned_off_per_project() {
        let global = settings(&[("api_key", "sk"), ("reasoning_enabled", "true")]);
        let project = settings(&[("reasoning_enabled", "false")]);

        let resolved = resolve_llm_settings(&global, &project, "llm_settings").expect("resolves");

        assert!(!resolved.reasoning_enabled);
    }

    #[test]
    fn reasoning_stays_on_when_nobody_said_otherwise() {
        let global = settings(&[("api_key", "sk")]);

        let resolved =
            resolve_llm_settings(&global, &BTreeMap::new(), "llm_settings").expect("resolves");

        assert!(resolved.reasoning_enabled);
    }

    #[test]
    fn a_project_key_still_works_on_its_own() {
        // The pre-split arrangement has to keep working — projects that were
        // never migrated hold their key locally and nowhere else.
        let project = settings(&[("api_key", "sk-project")]);

        let resolved = resolve_llm_settings(&BTreeMap::new(), &project, "llm_settings")
            .expect("a project key is enough");

        assert_eq!(resolved.api_key, "sk-project");
    }

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
