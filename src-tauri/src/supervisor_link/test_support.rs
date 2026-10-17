//! A throwaway project folder with a repository, shared by the link's tests.

use super::policy::{DocumentType, IndexFile, JobKind, LinkPolicy, ProjectConfig};
use git2::{Oid, Repository};
use std::path::PathBuf;

pub struct Project {
    _dir: tempfile::TempDir,
    pub root: PathBuf,
}

/// The document type the tests use: `docs/**/*.diagram.json`, named by
/// `meta.title`, with an index.
pub fn diagram_type() -> DocumentType {
    DocumentType {
        name: "diagram".into(),
        globs: vec!["docs/**/*.diagram.json".into()],
        index: Some(IndexFile {
            path: "docs/diagrams.index.json".into(),
            entries_key: "documents".into(),
        }),
        name_field: Some("meta.title".into()),
        description_field: Some("meta.subtitle".into()),
        schema: Some("docs/diagram.schema.json".into()),
    }
}

pub fn draw_kind() -> JobKind {
    JobKind {
        kind: "diagram.draw".into(),
        instructions: "docs/agents/draw.md".into(),
        writes: Vec::new(),
    }
}

impl Project {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        Self { _dir: dir, root }
    }

    pub fn path(&self) -> &str {
        self.root.to_str().unwrap()
    }

    pub fn write(&self, relative: &str, content: &str) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    pub fn config(&self) -> ProjectConfig {
        ProjectConfig {
            document_types: vec![diagram_type()],
            job_kinds: vec![draw_kind()],
        }
    }

    pub fn policy(&self) -> LinkPolicy {
        LinkPolicy {
            projects: [(self.path().to_string(), self.config())].into(),
            ..LinkPolicy::default()
        }
    }

    pub fn init_repo(&self) -> Repository {
        let repo = Repository::init(&self.root).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test Person").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        repo
    }

    pub fn commit_all(&self, repo: &Repository, message: &str) -> Oid {
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = repo.signature().unwrap();
        let parents: Vec<git2::Commit> = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .into_iter()
            .collect();
        let parents: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .unwrap()
    }
}
