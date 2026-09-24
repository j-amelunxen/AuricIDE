use std::collections::BTreeMap;

pub const PUSHOVER_NAMESPACE: &str = "pushover_settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Success,
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "success" => Self::Success,
            "warn" => Self::Warn,
            "error" => Self::Error,
            _ => Self::Info,
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Success | Self::Info => 0,
            Self::Warn => 1,
            Self::Error => 2,
        }
    }

    pub fn meets(self, minimum: Self) -> bool {
        self.rank() >= minimum.rank()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushoverConfig {
    pub enabled: bool,
    pub api_token: String,
    pub user_key: String,
    pub minimum_severity: Severity,
}

impl PushoverConfig {
    pub fn from_namespace(values: BTreeMap<String, String>) -> Self {
        Self {
            enabled: values.get("enabled").map(String::as_str) == Some("true"),
            api_token: values.get("api_token").cloned().unwrap_or_default(),
            user_key: values.get("user_key").cloned().unwrap_or_default(),
            minimum_severity: Severity::parse(
                values
                    .get("minimum_severity")
                    .map(String::as_str)
                    .unwrap_or("warn"),
            ),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.api_token.trim().is_empty() && !self.user_key.trim().is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxItem {
    pub id: i64,
    pub notification_uid: String,
    pub title: String,
    pub body: Option<String>,
    pub severity: String,
    pub project_name: Option<String>,
    pub origin: Option<String>,
    pub attempts: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pushover_is_disabled_and_warn_or_higher_by_default() {
        let config = PushoverConfig::from_namespace(BTreeMap::new());
        assert!(!config.enabled);
        assert!(!config.is_configured());
        assert_eq!(config.minimum_severity, Severity::Warn);
        assert!(!Severity::Info.meets(config.minimum_severity));
        assert!(Severity::Warn.meets(config.minimum_severity));
        assert!(Severity::Error.meets(config.minimum_severity));
    }
}
