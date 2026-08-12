use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path};
use walkdir::WalkDir;

/// A single enormous SKILL.md must cost a header's worth of reading, not a
/// file's worth. `lines().take(...)` bounds this by construction.
const FRONTMATTER_MAX_LINES: usize = 200;
const MAX_PROJECT_SKILLS: usize = 500;
/// Namespacing is realistically one level deep; three is generous.
const MAX_COMMAND_DEPTH: usize = 3;
const NAMESPACE_SEPARATOR: &str = ":";

/// Where to look, supplied by the frontend rather than baked in.
///
/// Which directory layout applies depends on which agent CLI the user runs, so
/// this scanner deliberately knows no conventions of its own. Supporting
/// another agent is a settings entry, not a change here.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceRule {
    pub id: String,
    #[serde(default)]
    pub commands_dir: Option<String>,
    #[serde(default)]
    pub skills_dir: Option<String>,
    #[serde(default)]
    pub manifest: Option<String>,
    #[serde(default)]
    pub extension: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSkillSource {
    Command,
    Skill,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSkillScope {
    Project,
    User,
}

/// Serialize only — never read back from disk, so unlike `StarredProject` this
/// type carries no backward-compatibility obligation and real enums are fine.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkill {
    /// What the user types, e.g. "/blogartikel" or "/frontend:component".
    pub invocation: String,
    pub name: String,
    pub description: Option<String>,
    pub source: ProjectSkillSource,
    pub scope: ProjectSkillScope,
    pub path: String,
    pub source_id: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
}

fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if value.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn assign(target: &mut Frontmatter, key: &str, value: String) {
    let value = value.trim().to_string();
    if value.is_empty() {
        return;
    }
    match key {
        // First occurrence wins — a duplicate key is malformed input, not an
        // override.
        "name" if target.name.is_none() => target.name = Some(value),
        "description" if target.description.is_none() => target.description = Some(value),
        _ => {}
    }
}

/// Reads the leading `---` block and pulls out the two scalar keys we use.
///
/// Deliberately NOT a YAML parser. Frontmatter in the wild is `key: value`
/// scalars plus the occasional folded block; anchors, flow maps and multi-doc
/// streams do not occur. A miss here costs a missing subtitle in a picker,
/// which does not justify a YAML dependency — and the only maintained options
/// are heavier than this whole feature.
fn parse_frontmatter(path: &Path) -> Frontmatter {
    let Ok(file) = fs::File::open(path) else {
        return Frontmatter::default();
    };
    let mut lines = BufReader::new(file)
        .lines()
        .take(FRONTMATTER_MAX_LINES)
        .map_while(Result::ok);

    // Must open with `---` (tolerating a UTF-8 BOM); anything else is a
    // body-only file, which is common and fine.
    match lines.next() {
        Some(first) if first.trim_start_matches('\u{feff}').trim() == "---" => {}
        _ => return Frontmatter::default(),
    }

    let mut found = Frontmatter::default();
    let mut pending: Option<(String, Vec<String>)> = None;

    for line in lines {
        let trimmed = line.trim_end();
        if trimmed.trim() == "---" || trimmed.trim() == "..." {
            break;
        }
        let is_continuation = line.starts_with(' ') || line.starts_with('\t');
        if let Some((key, parts)) = pending.as_mut() {
            if is_continuation && !trimmed.trim().is_empty() {
                parts.push(trimmed.trim().to_string());
                continue;
            }
            let joined = parts.join(" ");
            let key = key.clone();
            assign(&mut found, &key, joined);
            pending = None;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        // `>`, `>-` and `|` open a block scalar whose content sits on the
        // following indented lines.
        if value.is_empty() || value.starts_with('>') || value.starts_with('|') {
            pending = Some((key, Vec::new()));
        } else {
            assign(&mut found, &key, unquote(value).to_string());
        }
    }
    if let Some((key, parts)) = pending {
        assign(&mut found, &key, parts.join(" "));
    }
    found
}

/// Source directories come from user input, so an absolute path or a `..`
/// segment would let a rule read outside the project entirely. Such a rule is
/// dropped; the rest of the scan carries on.
fn safe_relative_dir(root: &Path, dir: Option<&String>) -> Option<std::path::PathBuf> {
    let dir = dir?.trim();
    if dir.is_empty() {
        return None;
    }
    let candidate = Path::new(dir);
    if candidate.is_absolute() {
        return None;
    }
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
    {
        return None;
    }
    Some(root.join(candidate))
}

fn collect_commands(
    dir: &Path,
    rule: &SkillSourceRule,
    scope: ProjectSkillScope,
    out: &mut Vec<ProjectSkill>,
) {
    if !dir.is_dir() {
        return;
    }
    let extension = rule.extension.trim().trim_start_matches('.');
    if extension.is_empty() {
        return;
    }
    for entry in WalkDir::new(dir)
        .max_depth(MAX_COMMAND_DEPTH)
        // A `.claude/commands/self -> ..` symlink would otherwise recurse to
        // the depth cap on every scan.
        .follow_links(false)
        .into_iter()
        // An unreadable entry is skipped, never fatal.
        .filter_map(Result::ok)
    {
        if out.len() >= MAX_PROJECT_SKILLS {
            return;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(extension) {
            continue;
        }
        let Ok(relative) = path.strip_prefix(dir) else {
            continue;
        };
        let mut segments: Vec<String> = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect();
        if segments.iter().any(|segment| segment.starts_with('.')) {
            continue;
        }
        if let Some(last) = segments.last_mut() {
            *last = last
                .strip_suffix(&format!(".{extension}"))
                .unwrap_or(last)
                .to_string();
        }
        let stem = segments.last().cloned().unwrap_or_default();
        if stem.is_empty() {
            continue;
        }
        let front = parse_frontmatter(path);
        out.push(ProjectSkill {
            invocation: format!("/{}", segments.join(NAMESPACE_SEPARATOR)),
            name: front.name.unwrap_or(stem),
            description: front.description,
            source: ProjectSkillSource::Command,
            scope,
            path: path.to_string_lossy().into_owned(),
            source_id: rule.id.clone(),
        });
    }
}

fn collect_skills(
    dir: &Path,
    rule: &SkillSourceRule,
    scope: ProjectSkillScope,
    out: &mut Vec<ProjectSkill>,
) {
    let manifest_name = rule.manifest.as_deref().unwrap_or("SKILL.md").trim();
    if manifest_name.is_empty() {
        return;
    }
    // Missing or unreadable means nothing to offer, never an error.
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        if out.len() >= MAX_PROJECT_SKILLS {
            return;
        }
        let dir_name = entry.file_name().to_string_lossy().into_owned();
        if dir_name.starts_with('.') {
            continue;
        }
        let manifest = entry.path().join(manifest_name);
        if !manifest.is_file() {
            continue;
        }
        let front = parse_frontmatter(&manifest);
        // Some manifests carry no frontmatter at all and open straight into
        // prose. The directory name is authoritative for the invocation
        // regardless, so those still list.
        out.push(ProjectSkill {
            invocation: format!("/{dir_name}"),
            name: front.name.unwrap_or_else(|| dir_name.clone()),
            description: front.description,
            source: ProjectSkillSource::Skill,
            scope,
            path: manifest.to_string_lossy().into_owned(),
            source_id: rule.id.clone(),
        });
    }
}

/// Scans one root against every rule. Takes a path rather than a `tauri::State`
/// so it is testable against a temp directory.
pub fn collect_from_root(
    root: &Path,
    rules: &[SkillSourceRule],
    scope: ProjectSkillScope,
) -> Vec<ProjectSkill> {
    let mut found = Vec::new();
    for rule in rules {
        if let Some(dir) = safe_relative_dir(root, rule.commands_dir.as_ref()) {
            collect_commands(&dir, rule, scope, &mut found);
        }
        if let Some(dir) = safe_relative_dir(root, rule.skills_dir.as_ref()) {
            collect_skills(&dir, rule, scope, &mut found);
        }
    }
    found.sort_by(|a, b| {
        a.invocation
            .cmp(&b.invocation)
            .then(a.source.cmp(&b.source))
            .then(a.path.cmp(&b.path))
    });
    found
}

/// Project definitions first, then whatever the home directory adds that the
/// project did not already define. A project's own answer wins over the
/// generic one when both use the same invocation.
pub fn collect_project_skills(
    project_root: &Path,
    home: Option<&Path>,
    rules: &[SkillSourceRule],
) -> Vec<ProjectSkill> {
    let mut all = collect_from_root(project_root, rules, ProjectSkillScope::Project);
    if let Some(home) = home {
        if home != project_root {
            let taken: std::collections::HashSet<String> =
                all.iter().map(|skill| skill.invocation.clone()).collect();
            let user = collect_from_root(home, rules, ProjectSkillScope::User);
            all.extend(
                user.into_iter()
                    .filter(|skill| !taken.contains(&skill.invocation)),
            );
        }
    }
    all.truncate(MAX_PROJECT_SKILLS);
    all
}

#[tauri::command]
pub fn project_skills_list(
    project_path: String,
    sources: Vec<SkillSourceRule>,
) -> Result<Vec<ProjectSkill>, String> {
    if project_path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    Ok(collect_project_skills(
        Path::new(&project_path),
        dirs::home_dir().as_deref(),
        &sources,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_rule() -> SkillSourceRule {
        SkillSourceRule {
            id: "claude".into(),
            commands_dir: Some(".claude/commands".into()),
            skills_dir: Some(".claude/skills".into()),
            manifest: Some("SKILL.md".into()),
            extension: "md".into(),
        }
    }

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn parses_name_and_description() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        write(
            &path,
            "---\nname: blogartikel\ndescription: Writes a post\n---\nBody\n",
        );
        let front = parse_frontmatter(&path);
        assert_eq!(front.name.as_deref(), Some("blogartikel"));
        assert_eq!(front.description.as_deref(), Some("Writes a post"));
    }

    #[test]
    fn strips_surrounding_quotes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        write(&path, "---\nname: \"quoted, with commas\"\n---\n");
        assert_eq!(
            parse_frontmatter(&path).name.as_deref(),
            Some("quoted, with commas")
        );
    }

    #[test]
    fn joins_a_folded_block_scalar() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        write(
            &path,
            "---\ndescription: >\n  first line\n  second line\nname: x\n---\n",
        );
        let front = parse_frontmatter(&path);
        assert_eq!(front.description.as_deref(), Some("first line second line"));
        assert_eq!(front.name.as_deref(), Some("x"));
    }

    /// Some manifests open straight into prose. That must yield defaults, not
    /// drop the file.
    #[test]
    fn returns_defaults_without_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        write(&path, "# Just prose\n\nname: not frontmatter\n");
        assert_eq!(parse_frontmatter(&path), Frontmatter::default());
    }

    #[test]
    fn returns_defaults_for_unterminated_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        write(&path, "---\nname: still-read\n");
        assert_eq!(parse_frontmatter(&path).name.as_deref(), Some("still-read"));
    }

    #[test]
    fn stops_reading_after_the_line_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        let padding = "\n".repeat(FRONTMATTER_MAX_LINES + 50);
        write(&path, &format!("---{padding}name: too-late\n---\n"));
        assert_eq!(parse_frontmatter(&path).name, None);
    }

    #[test]
    fn lists_commands_and_skills() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join(".claude/commands/blogartikel.md"),
            "---\nname: Blogartikel\n---\n",
        );
        write(
            &dir.path().join(".claude/skills/seo/SKILL.md"),
            "---\ndescription: SEO\n---\n",
        );

        let found = collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project);

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].invocation, "/blogartikel");
        assert_eq!(found[0].name, "Blogartikel");
        assert_eq!(found[1].invocation, "/seo");
        assert_eq!(found[1].name, "seo");
        assert_eq!(found[1].description.as_deref(), Some("SEO"));
    }

    #[test]
    fn namespaces_subdirectory_commands() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join(".claude/commands/frontend/component.md"),
            "",
        );

        let found = collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project);

        assert_eq!(found[0].invocation, "/frontend:component");
        assert_eq!(found[0].name, "component");
    }

    #[test]
    fn returns_empty_without_the_configured_directories() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project).is_empty()
        );
    }

    #[test]
    fn skips_non_matching_extensions_and_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join(".claude/commands/notes.txt"), "");
        write(&dir.path().join(".claude/commands/.hidden.md"), "");
        write(&dir.path().join(".claude/commands/.drafts/wip.md"), "");
        write(&dir.path().join(".claude/skills/.hidden/SKILL.md"), "");

        assert!(
            collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project).is_empty()
        );
    }

    /// A rule pointing outside the project must not read a single file.
    #[test]
    fn rejects_absolute_and_traversing_source_dirs() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("secrets/leak.md"),
            "---\nname: leaked\n---\n",
        );

        for bad in ["/etc", "../secrets", "sub/../../secrets"] {
            let rule = SkillSourceRule {
                id: "bad".into(),
                commands_dir: Some(bad.into()),
                skills_dir: Some(bad.into()),
                manifest: Some("SKILL.md".into()),
                extension: "md".into(),
            };
            let found = collect_from_root(
                &dir.path().join("project"),
                &[rule],
                ProjectSkillScope::Project,
            );
            assert!(found.is_empty(), "{bad} should have been rejected");
        }
    }

    #[test]
    fn scans_every_configured_source() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join(".claude/commands/one.md"), "");
        write(&dir.path().join(".myagent/prompts/two.md"), "");
        let mine = SkillSourceRule {
            id: "mine".into(),
            commands_dir: Some(".myagent/prompts".into()),
            skills_dir: None,
            manifest: None,
            extension: "md".into(),
        };

        let found = collect_from_root(
            dir.path(),
            &[claude_rule(), mine],
            ProjectSkillScope::Project,
        );

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].source_id, "claude");
        assert_eq!(found[1].source_id, "mine");
    }

    #[test]
    fn project_scope_shadows_user_scope() {
        let project = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        write(&project.path().join(".claude/commands/shared.md"), "");
        write(&home.path().join(".claude/commands/shared.md"), "");
        write(&home.path().join(".claude/commands/only-mine.md"), "");

        let found = collect_project_skills(project.path(), Some(home.path()), &[claude_rule()]);

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].invocation, "/shared");
        assert_eq!(found[0].scope, ProjectSkillScope::Project);
        assert_eq!(found[1].invocation, "/only-mine");
        assert_eq!(found[1].scope, ProjectSkillScope::User);
    }

    #[test]
    fn caps_the_number_of_entries() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(MAX_PROJECT_SKILLS + 20) {
            write(&dir.path().join(format!(".claude/commands/c{i}.md")), "");
        }
        let found = collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project);
        assert_eq!(found.len(), MAX_PROJECT_SKILLS);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let commands = dir.path().join(".claude/commands");
        write(&commands.join("real.md"), "");
        std::os::unix::fs::symlink(dir.path(), commands.join("loop")).unwrap();

        let found = collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].invocation, "/real");
    }
}
