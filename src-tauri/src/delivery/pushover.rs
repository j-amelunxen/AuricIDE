use reqwest::StatusCode;

use super::policy::AttemptResult;
use super::types::{OutboxItem, PushoverConfig};

pub const PUSHOVER_MESSAGES_ENDPOINT: &str = "https://api.pushover.net/1/messages.json";
const MAX_TITLE_BYTES: usize = 250;
const MAX_MESSAGE_BYTES: usize = 1024;

#[derive(Debug)]
pub struct SendFailure {
    pub result: AttemptResult,
    pub message: String,
}

#[derive(Clone)]
pub struct PushoverClient {
    client: reqwest::Client,
}

impl Default for PushoverClient {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("static Pushover client configuration"),
        }
    }
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn message(item: &OutboxItem) -> String {
    let mut parts = Vec::new();
    if let Some(body) = item.body.as_deref().filter(|body| !body.trim().is_empty()) {
        parts.push(body.to_string());
    }
    let context = [item.project_name.as_deref(), item.origin.as_deref()]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    if !context.is_empty() {
        parts.push(context);
    }
    if parts.is_empty() {
        parts.push(item.title.clone());
    }
    truncate_utf8(&parts.join("\n\n"), MAX_MESSAGE_BYTES)
}

pub fn classify_status(status: StatusCode) -> AttemptResult {
    if status.is_success() {
        AttemptResult::Delivered
    } else if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        AttemptResult::Retryable
    } else {
        AttemptResult::PermanentFailure
    }
}

impl PushoverClient {
    pub async fn send(
        &self,
        config: &PushoverConfig,
        item: &OutboxItem,
    ) -> Result<(), SendFailure> {
        let title = truncate_utf8(&item.title, MAX_TITLE_BYTES);
        let message = message(item);
        let response = self
            .client
            .post(PUSHOVER_MESSAGES_ENDPOINT)
            .form(&[
                ("token", config.api_token.as_str()),
                ("user", config.user_key.as_str()),
                ("title", title.as_str()),
                ("message", message.as_str()),
            ])
            .send()
            .await
            .map_err(|error| SendFailure {
                result: AttemptResult::Retryable,
                message: error.to_string(),
            })?;
        let status = response.status();
        let result = classify_status(status);
        if result == AttemptResult::Delivered {
            Ok(())
        } else {
            Err(SendFailure {
                result,
                message: format!("Pushover returned HTTP {}", status.as_u16()),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_rate_limits_and_server_failures_are_retryable() {
        assert_eq!(classify_status(StatusCode::OK), AttemptResult::Delivered);
        assert_eq!(
            classify_status(StatusCode::BAD_REQUEST),
            AttemptResult::PermanentFailure
        );
        assert_eq!(
            classify_status(StatusCode::UNAUTHORIZED),
            AttemptResult::PermanentFailure
        );
        assert_eq!(
            classify_status(StatusCode::TOO_MANY_REQUESTS),
            AttemptResult::Retryable
        );
        assert_eq!(
            classify_status(StatusCode::BAD_GATEWAY),
            AttemptResult::Retryable
        );
    }

    #[test]
    fn truncation_never_splits_a_utf8_character() {
        let long = "🙂".repeat(300);
        let truncated = truncate_utf8(&long, MAX_MESSAGE_BYTES);
        assert!(truncated.len() <= MAX_MESSAGE_BYTES);
        assert!(truncated.chars().all(|character| character == '🙂'));
    }

    #[test]
    fn title_only_notifications_still_have_a_required_message() {
        let item = OutboxItem {
            id: 1,
            notification_uid: "n".into(),
            title: "Agent needs attention".into(),
            body: None,
            severity: "warn".into(),
            project_name: None,
            origin: None,
            attempts: 1,
        };

        assert_eq!(message(&item), "Agent needs attention");
    }
}
