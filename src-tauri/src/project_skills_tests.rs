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
        "---\nname: changelog\ndescription: Summarises recent changes\n---\nBody\n",
    );
    let front = parse_frontmatter(&path);
    assert_eq!(front.name.as_deref(), Some("changelog"));
    assert_eq!(
        front.description.as_deref(),
        Some("Summarises recent changes")
    );
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
        &dir.path().join(".claude/commands/changelog.md"),
        "---\nname: Changelog\n---\n",
    );
    write(
        &dir.path().join(".claude/skills/seo/SKILL.md"),
        "---\ndescription: SEO\n---\n",
    );

    let found = collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project);

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].invocation, "/changelog");
    assert_eq!(found[0].name, "Changelog");
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
    assert!(collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project).is_empty());
}

#[test]
fn skips_non_matching_extensions_and_dotfiles() {
    let dir = tempfile::tempdir().unwrap();
    write(&dir.path().join(".claude/commands/notes.txt"), "");
    write(&dir.path().join(".claude/commands/.hidden.md"), "");
    write(&dir.path().join(".claude/commands/.drafts/wip.md"), "");
    write(&dir.path().join(".claude/skills/.hidden/SKILL.md"), "");

    assert!(collect_from_root(dir.path(), &[claude_rule()], ProjectSkillScope::Project).is_empty());
}

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
