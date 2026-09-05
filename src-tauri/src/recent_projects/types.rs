use serde::{Deserialize, Serialize};

/// Additive fields do NOT bump this — `#[serde(default)]` already makes old
/// files readable and new files are ignored field-wise by older builds. Bump it
/// only for the first breaking change (a rename, a retype, a semantic shift),
/// at which point the readers grow a `match` on it. Note it is shared with the
/// recent-projects store, so a bump stamps both files.
pub const STORE_VERSION: u32 = 1;
pub const MAX_RECENT_PROJECTS: usize = 50;
/// Kept separate from MAX_RECENT_PROJECTS even though both are 50: a dropped
/// starred record now costs the user an icon and a list of launch presets.
pub const MAX_STARRED_PROJECTS: usize = 50;
pub const MAX_SKILLS_PER_PROJECT: usize = 20;
pub const MAX_COMBOS_PER_PROJECT: usize = 20;
pub const MAX_STEPS_PER_COMBO: usize = 8;
pub const WHEEL_SLOT_COUNT: usize = 6;
pub const LEGACY_KEY: &str = "auric-recent-projects";
pub const LEGACY_STARRED_KEY: &str = "auric-starred-projects";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
}

/// A user-chosen tile mark. The backend is storage, not policy: it never renders
/// an icon, so `kind` stays an opaque string instead of a serde enum. An enum
/// would make an unknown kind written by a newer build fail to deserialize — and
/// here a single field error fails the WHOLE file, which quarantines it and
/// costs the user every star. Forward compatibility beats Rust-side
/// exhaustiveness. The frontend narrows this and falls back to generated
/// initials for anything it does not recognise.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconOverride {
    pub kind: String,
    pub value: String,
}

/// A named launch preset for one project: a recurring task in two clicks.
/// `permission_mode` is a String rather than an enum because the legal values
/// come from the provider registry, and dynamic providers are importable at
/// runtime — there is no closed set to encode.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessSkill {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headless: Option<bool>,
    /// A prompt skill from Auric's application-wide library. The prompt and
    /// label above are retained as a fallback snapshot if it is later deleted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auric_skill_id: Option<String>,
}

/// An ordered chain of launch presets. Ending one step starts the next.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessCombo {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub steps: Vec<QuickAccessSkill>,
}

/// The per-project Quick Access settings, as one blob. They live INSIDE the
/// starred record on purpose: unstarring a project drops its settings with it,
/// which is the behaviour without any cleanup logic to get wrong.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StarredProjectSettings {
    #[serde(default)]
    pub icon: Option<ProjectIconOverride>,
    #[serde(default)]
    pub skills: Vec<QuickAccessSkill>,
    #[serde(default)]
    pub combos: Vec<QuickAccessCombo>,
    /// Missing means "keep the record's wheel, then drop ids that left skills".
    #[serde(default)]
    pub wheel_slots: Option<Vec<Option<String>>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StarredProject {
    pub path: String,
    pub name: String,
    pub starred_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<ProjectIconOverride>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<QuickAccessSkill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub combos: Vec<QuickAccessCombo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wheel_slots: Vec<Option<String>>,
}

impl StarredProject {
    /// Takes settings from `other` for any field this record has empty.
    ///
    /// This matters on the recovery path: after a quarantine the backend
    /// rebuilds bare records from legacy scraping, and the frontend then sends
    /// its localStorage copy — which still carries the icon and the skills.
    /// First-wins would throw away the very thing being recovered.
    pub fn absorb(&mut self, other: StarredProject) {
        if self.icon.is_none() {
            self.icon = other.icon;
        }
        // Whole-list fill, never an element-wise union: a union would
        // resurrect skills the user deliberately deleted.
        if self.skills.is_empty() {
            self.skills = other.skills;
        }
        if self.combos.is_empty() {
            self.combos = other.combos;
        }
        if self.wheel_slots.is_empty() {
            self.wheel_slots = other.wheel_slots;
        }
        if self.name.trim().is_empty() {
            self.name = other.name;
        }
        // "Pinned since" is the earliest claim, and it drives the sort.
        self.starred_at = self.starred_at.min(other.starred_at);
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecentProjectsFile {
    pub version: u32,
    pub projects: Vec<RecentProject>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StarredProjectsFile {
    pub version: u32,
    pub projects: Vec<StarredProject>,
}
