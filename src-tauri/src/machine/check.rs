use serde::Serialize;

/// One line of an environment report: what a feature needed, what the machine
/// has, and the one command that fixes the difference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub label: String,
    pub ok: bool,
    /// What is actually on this machine, when we could determine it.
    pub found: Option<String>,
    pub requirement: String,
    /// One sentence. Never tool output.
    pub detail: String,
    /// A single command the reader can copy, when one exists.
    pub fix: Option<String>,
}

impl Check {
    pub fn ok(
        id: &str,
        label: &str,
        requirement: &str,
        found: impl Into<String>,
        detail: &str,
    ) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            ok: true,
            found: Some(found.into()),
            requirement: requirement.to_string(),
            detail: detail.to_string(),
            fix: None,
        }
    }

    pub fn failed(
        id: &str,
        label: &str,
        requirement: &str,
        found: Option<String>,
        detail: &str,
        fix: Option<&str>,
    ) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            ok: false,
            found,
            requirement: requirement.to_string(),
            detail: detail.to_string(),
            fix: fix.map(str::to_string),
        }
    }
}
