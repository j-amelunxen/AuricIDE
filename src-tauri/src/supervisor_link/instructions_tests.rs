use super::*;
use crate::supervisor_link::test_support::{draw_kind, Project};

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

fn kind(instructions: Option<&str>, global: Option<&str>) -> JobKind {
    JobKind {
        instructions: instructions.map(str::to_string),
        global_instructions: global.map(str::to_string),
        ..draw_kind()
    }
}

struct Setup {
    project: Project,
    app: tempfile::TempDir,
}

impl Setup {
    fn new() -> Self {
        let setup = Self {
            project: Project::new(),
            app: tempfile::tempdir().unwrap(),
        };
        std::fs::create_dir_all(setup.dir()).unwrap();
        setup
    }

    fn dir(&self) -> PathBuf {
        self.app.path().join("job-kinds")
    }

    fn resolve(&self, kind: &JobKind) -> Result<Instructions, Unusable> {
        resolve(
            kind,
            &self.project.root,
            self.project.path(),
            Some(&self.dir()),
        )
    }
}

#[test]
fn the_size_cap_is_the_fixture() {
    let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
    assert_eq!(
        fixtures["globalInstructions"]["maxBytes"],
        MAX_INSTRUCTIONS_BYTES
    );
}

#[test]
fn the_project_file_wins_when_the_project_has_it() {
    let s = Setup::new();
    std::fs::write(s.dir().join("draw.md"), "global").unwrap();
    let both = kind(Some("docs/agents/draw.md"), Some("draw.md"));
    assert_eq!(
        s.resolve(&both),
        Ok(Instructions::GlobalText("global".into()))
    );
    s.project.write("docs/agents/draw.md", "project");
    assert_eq!(
        s.resolve(&both),
        Ok(Instructions::ProjectFile("docs/agents/draw.md".into()))
    );
}

#[test]
fn a_global_file_is_read_by_name_or_absolute_path() {
    let s = Setup::new();
    std::fs::create_dir_all(s.dir().join("kinds")).unwrap();
    std::fs::write(s.dir().join("kinds/draw.md"), "by name").unwrap();
    assert_eq!(
        s.resolve(&kind(None, Some("kinds/draw.md"))),
        Ok(Instructions::GlobalText("by name".into()))
    );
    let elsewhere = tempfile::tempdir().unwrap();
    let file = elsewhere.path().join("draw.md");
    std::fs::write(&file, "absolute").unwrap();
    assert_eq!(
        s.resolve(&kind(None, Some(file.to_str().unwrap()))),
        Ok(Instructions::GlobalText("absolute".into()))
    );
}

#[test]
fn a_missing_global_file_is_refused_without_naming_its_path() {
    let s = Setup::new();
    let hidden_path = "/opt/private-place/draw.md";
    let error = s.resolve(&kind(None, Some(hidden_path))).unwrap_err();
    assert!(!error.0.contains("private-place"), "{}", error.0);
    assert!(error.0.contains("global instructions"));
    let none = s.resolve(&kind(Some("docs/none.md"), None)).unwrap_err();
    assert!(none.0.contains("docs/none.md"));
}

#[cfg(unix)]
#[test]
fn a_name_under_job_kinds_cannot_leave_it_through_a_symlink() {
    let s = Setup::new();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    std::fs::write(&target, "do not read").unwrap();
    std::os::unix::fs::symlink(&target, s.dir().join("draw.md")).unwrap();
    assert!(s.resolve(&kind(None, Some("draw.md"))).is_err());
    // Without a job-kinds directory a bare name resolves nowhere.
    assert!(resolve(
        &kind(None, Some("draw.md")),
        &s.project.root,
        s.project.path(),
        None
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn a_project_file_cannot_leave_the_project_through_a_symlink() {
    let s = Setup::new();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("secret.md");
    std::fs::write(&target, "do not read").unwrap();
    std::fs::create_dir_all(s.project.root.join("docs/agents")).unwrap();
    std::os::unix::fs::symlink(&target, s.project.root.join("docs/agents/draw.md")).unwrap();
    assert!(s.resolve(&kind(Some("docs/agents/draw.md"), None)).is_err());
}

#[test]
fn a_global_file_must_be_small_utf8_and_a_file() {
    let s = Setup::new();
    let big = vec![b'a'; MAX_INSTRUCTIONS_BYTES as usize + 1];
    std::fs::write(s.dir().join("big.md"), big).unwrap();
    std::fs::write(s.dir().join("binary.md"), [0xff, 0xfe, 0x00]).unwrap();
    std::fs::create_dir_all(s.dir().join("folder.md")).unwrap();
    for name in ["big.md", "binary.md", "folder.md", "missing.md"] {
        assert!(s.resolve(&kind(None, Some(name))).is_err(), "{name}");
    }
}
