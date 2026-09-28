//! `list_projects`: which projects the IDE knows, and enough about each for a
//! caller to pick one (`docs/design-agent-control.md`, `ProjectEntry`).
//!
//! Cheap by design: no project database is opened. Per project it checks one
//! path for existence and, unless the user described the project, reads at
//! most three small files for the description.

use super::protocol::{DescriptionSource, ProjectEntry};
use crate::agents::{AgentInfo, AgentStatus};
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

pub const DESCRIPTION_MAX_CHARS: usize = 200;
/// Only the start of a file is read; a description sits at the top.
const DESCRIPTION_READ_BYTES: u64 = 64 * 1024;

/// What the IDE's own stores say, gathered by the caller.
#[derive(Default)]
pub struct ProjectSources {
    /// `(path, name, opened_at)` in stored order.
    pub recent: Vec<(String, String, u64)>,
    /// `(path, name, the user's own description)` in stored order.
    pub starred: Vec<(String, String, Option<String>)>,
    /// Folders the frontend watches: the open project.
    pub open: Vec<String>,
    pub agents: Vec<AgentInfo>,
}

/// A description and where it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct Described {
    pub text: String,
    pub source: DescriptionSource,
}

/// What the folder says: whether it is initialised, and its description.
pub struct FolderFacts {
    pub initialized: bool,
    pub description: Option<Described>,
}

/// One entry per path: starred ones first, then recent ones, then watched ones
/// in neither list. The open project is the one the frontend watches —
/// `useFileWatcher` watches exactly `rootPath` — so that is what `isOpen` means.
pub fn list_projects(
    sources: ProjectSources,
    inspect: impl Fn(&Path, Option<&str>) -> FolderFacts,
) -> Vec<ProjectEntry> {
    let key = |path: &str| path.trim_end_matches('/').to_string();
    let starred_paths: HashSet<String> = sources.starred.iter().map(|(p, _, _)| key(p)).collect();
    let user_description = |path: &str| {
        sources
            .starred
            .iter()
            .find(|(p, _, _)| key(p) == key(path))
            .and_then(|(_, _, description)| description.as_deref())
    };
    let open: HashSet<String> = sources.open.iter().map(|p| key(p)).collect();
    let opened_at = |path: &str| {
        sources
            .recent
            .iter()
            .find(|(p, _, _)| key(p) == key(path))
            .map(|(_, _, at)| *at)
    };
    let running_in = |path: &str| {
        sources
            .agents
            .iter()
            .filter(|a| a.status == AgentStatus::Running)
            .filter(|a| a.project_path.as_deref().map(key).as_deref() == Some(&key(path)))
            .count()
    };

    let candidates = sources
        .starred
        .iter()
        .map(|(p, n, _)| (p.clone(), n.clone()))
        .chain(
            sources
                .recent
                .iter()
                .map(|(p, n, _)| (p.clone(), n.clone())),
        )
        .chain(sources.open.iter().map(|p| (p.clone(), String::new())));
    let mut seen = HashSet::new();
    let mut projects = Vec::new();
    for (path, name) in candidates {
        if !seen.insert(key(&path)) {
            continue;
        }
        let facts = inspect(Path::new(&path), user_description(&path));
        let (description, description_source) = match facts.description {
            Some(described) => (Some(described.text), Some(described.source)),
            None => (None, None),
        };
        projects.push(ProjectEntry {
            starred: starred_paths.contains(&key(&path)),
            is_open: open.contains(&key(&path)),
            initialized: facts.initialized,
            last_opened_at: opened_at(&path),
            running_agents: running_in(&path),
            description,
            description_source,
            name: if name.is_empty() {
                project_name(&path)
            } else {
                name
            },
            path,
        });
    }
    projects
}

pub fn project_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Look at the folder on disk: `.auric/project.db`, and — only when the user
/// gave no description — the three files one may be derived from. Nothing
/// else is read.
pub fn inspect_folder(dir: &Path, user: Option<&str>) -> FolderFacts {
    let initialized = dir.join(".auric").join("project.db").is_file();
    if let Some(described) = describe_user(user) {
        return FolderFacts {
            initialized,
            description: Some(described),
        };
    }
    let read = |name: &str| read_head(&dir.join(name));
    FolderFacts {
        initialized,
        description: describe(
            None,
            read("README.md").as_deref(),
            read("package.json").as_deref(),
            read("Cargo.toml").as_deref(),
        ),
    }
}

fn read_head(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(DESCRIPTION_READ_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// A user's description, trimmed and otherwise verbatim: they wrote it, and
/// the store already capped it when it was saved. Blank counts as none.
fn describe_user(user: Option<&str>) -> Option<Described> {
    let text = user?.trim();
    (!text.is_empty()).then(|| Described {
        text: text.to_string(),
        source: DescriptionSource::User,
    })
}

/// What the project is for: the user's own description when set, else the
/// README's first prose paragraph, else the `description` of package.json,
/// else of Cargo.toml. A derived text is cut at a word boundary to at most
/// `DESCRIPTION_MAX_CHARS` characters including the ellipsis.
pub fn describe(
    user: Option<&str>,
    readme: Option<&str>,
    package_json: Option<&str>,
    cargo_toml: Option<&str>,
) -> Option<Described> {
    if let Some(described) = describe_user(user) {
        return Some(described);
    }
    let derived = |text: Option<String>, source| text.map(|text| (text, source));
    derived(readme.and_then(readme_paragraph), DescriptionSource::Readme)
        .or_else(|| {
            derived(
                package_json.and_then(package_description),
                DescriptionSource::Package,
            )
        })
        .or_else(|| {
            derived(
                cargo_toml.and_then(cargo_description),
                DescriptionSource::Cargo,
            )
        })
        .map(|(text, source)| (collapse_whitespace(&text), source))
        .filter(|(text, _)| !text.is_empty())
        .map(|(text, source)| Described {
            text: truncate_words(&text, DESCRIPTION_MAX_CHARS),
            source,
        })
}

fn readme_paragraph(readme: &str) -> Option<String> {
    let mut paragraph: Vec<String> = Vec::new();
    for line in readme.lines() {
        let line = line.trim();
        let skipped = line.starts_with('#')
            || line.starts_with('<')
            || line.starts_with("[![")
            || line.starts_with("![");
        if line.is_empty() || skipped {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        let flat = flatten_markdown(line);
        if !flat.trim().is_empty() {
            paragraph.push(flat);
        }
    }
    (!paragraph.is_empty()).then(|| paragraph.join(" "))
}

/// `[text](url)` → `text`, and emphasis and code markers dropped.
fn flatten_markdown(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let link = after.find("](").and_then(|close| {
            let url_end = after[close + 2..].find(')')?;
            Some((close, close + 2 + url_end + 1))
        });
        match link {
            Some((close, end)) => {
                out.push_str(&after[..close]);
                rest = &after[end..];
            }
            None => {
                out.push('[');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.replace("**", "")
        .replace("__", "")
        .replace(['`', '*'], "")
}

fn package_description(package_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(package_json).ok()?;
    Some(value.get("description")?.as_str()?.to_string())
}

/// `description = "…"` in the `[package]` table. A line scan rather than a
/// TOML parser: one string key is all this needs.
fn cargo_description(cargo_toml: &str) -> Option<String> {
    let mut in_package = false;
    for line in cargo_toml.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_package = line == "[package]";
            continue;
        }
        if !in_package {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() == "description" {
            let value = value.trim();
            return value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .map(|v| v.replace("\\\"", "\""));
        }
    }
    None
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_words(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out = String::new();
    let mut len = 0;
    for word in text.split(' ') {
        let sep = usize::from(!out.is_empty());
        let word_len = word.chars().count();
        // +1 for the ellipsis that follows.
        if len + sep + word_len + 1 > max_chars {
            break;
        }
        if sep == 1 {
            out.push(' ');
        }
        out.push_str(word);
        len += sep + word_len;
    }
    if out.is_empty() {
        // One word longer than the limit: cut inside it.
        out = text.chars().take(max_chars - 1).collect();
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixtures() -> Value {
        serde_json::from_str(super::super::protocol::tests::FIXTURES).unwrap()
    }

    #[test]
    fn every_fixture_description_case_holds() {
        let fixtures = fixtures();
        let block = &fixtures["projectDescription"];
        assert_eq!(block["maxChars"], DESCRIPTION_MAX_CHARS as u64);
        assert_eq!(
            block["userMaxChars"],
            crate::recent_projects::USER_DESCRIPTION_MAX_CHARS as u64
        );
        let sources: Vec<Value> = [
            DescriptionSource::User,
            DescriptionSource::Readme,
            DescriptionSource::Package,
            DescriptionSource::Cargo,
        ]
        .iter()
        .map(|source| serde_json::to_value(source).unwrap())
        .collect();
        assert_eq!(Value::Array(sources), block["sources"]);
        let cases = block["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let actual = describe(
                case["user"].as_str(),
                case["readme"].as_str(),
                case["packageJson"].as_str(),
                case["cargoToml"].as_str(),
            );
            let text = actual.as_ref().map(|d| d.text.as_str());
            assert_eq!(text, case["expected"].as_str(), "{name}");
            let source = actual
                .as_ref()
                .map(|d| serde_json::to_value(d.source).unwrap());
            assert_eq!(
                source.unwrap_or(Value::Null),
                case["expectedSource"],
                "{name}: source"
            );
            if let Some(d) = actual.filter(|d| d.source != DescriptionSource::User) {
                assert!(d.text.chars().count() <= DESCRIPTION_MAX_CHARS, "{name}");
            }
        }
    }

    #[test]
    fn a_single_overlong_word_is_cut_inside_it() {
        let word = "x".repeat(300);
        let cut = truncate_words(&word, 10);
        assert_eq!(cut.chars().count(), 10);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn inspecting_a_folder_reads_its_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!inspect_folder(dir.path(), None).initialized);
        assert_eq!(inspect_folder(dir.path(), None).description, None);

        std::fs::create_dir(dir.path().join(".auric")).unwrap();
        std::fs::write(dir.path().join(".auric/project.db"), b"").unwrap();
        std::fs::write(
            dir.path().join("Cargo.toml"),
            "[package]\ndescription = \"A tool\"\n",
        )
        .unwrap();
        let facts = inspect_folder(dir.path(), None);
        assert!(facts.initialized);
        assert_eq!(
            facts.description,
            Some(Described {
                text: "A tool".into(),
                source: DescriptionSource::Cargo
            })
        );
        let own = inspect_folder(dir.path(), Some(" Mine "));
        assert_eq!(own.description.map(|d| d.text).as_deref(), Some("Mine"));
    }

    fn running(id: &str, project: &str, status: AgentStatus) -> AgentInfo {
        AgentInfo {
            id: id.into(),
            status,
            project_path: Some(project.into()),
            ..super::super::protocol::tests::sample_agent()
        }
    }

    #[test]
    fn entries_merge_all_sources_and_count_running_agents() {
        let sources = ProjectSources {
            recent: vec![
                ("/w/recent".into(), "recent".into(), 111),
                ("/w/both".into(), "both".into(), 222),
            ],
            starred: vec![("/w/both".into(), "both".into(), Some("user words".into()))],
            open: vec!["/w/recent/".into(), "/w/unlisted".into()],
            agents: vec![
                running("a1", "/w/recent", AgentStatus::Running),
                running("a2", "/w/recent/", AgentStatus::Running),
                running("a3", "/w/recent", AgentStatus::Idle),
                running("a4", "/w/both", AgentStatus::Running),
            ],
        };
        let projects = list_projects(sources, |path, user| FolderFacts {
            initialized: path == Path::new("/w/both"),
            description: describe_user(user),
        });
        assert_eq!(projects[0].description.as_deref(), Some("user words"));
        assert_eq!(
            projects[0].description_source,
            Some(DescriptionSource::User)
        );
        assert_eq!(projects[1].description_source, None);
        let summary: Vec<_> = projects
            .iter()
            .map(|p| {
                (
                    p.path.as_str(),
                    p.starred,
                    p.is_open,
                    p.initialized,
                    p.last_opened_at,
                    p.running_agents,
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("/w/both", true, false, true, Some(222), 1),
                ("/w/recent", false, true, false, Some(111), 2),
                ("/w/unlisted", false, true, false, None, 0),
            ]
        );
        assert_eq!(projects[2].name, "unlisted");
    }
}
