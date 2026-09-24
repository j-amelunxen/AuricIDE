use crate::providers::ProviderProjectBinding;
use std::path::{Path, PathBuf};

/// Immutable, validated identity of the project an agent may access through MCP.
///
/// This is deliberately independent of the process working directory: an agent
/// can execute in a worktree while its MCP tools remain bound to the logical
/// Auric project database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProjectBinding {
    project_root: PathBuf,
    database_path: PathBuf,
}

impl ResolvedProjectBinding {
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn environment(&self) -> Vec<(String, String)> {
        vec![
            (
                "AURIC_PROJECT_ROOT".to_string(),
                self.project_root().to_string_lossy().into_owned(),
            ),
            (
                "AURIC_MCP_DB_PATH".to_string(),
                self.database_path().to_string_lossy().into_owned(),
            ),
        ]
    }

    pub fn provider_binding(&self) -> ProviderProjectBinding {
        ProviderProjectBinding::new(
            self.project_root().to_string_lossy(),
            self.database_path().to_string_lossy(),
        )
    }
}

/// Resolve the binding supplied by the caller. `None` is a deliberate
/// projectless agent and never falls back to cwd or another piece of UI state.
pub fn resolve_project_binding(
    project_path: Option<&str>,
) -> Result<Option<ResolvedProjectBinding>, String> {
    let Some(project_path) = project_path else {
        return Ok(None);
    };

    let root = Path::new(project_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project path '{project_path}': {error}"))?;
    if !root.is_dir() {
        return Err(format!(
            "Project path '{}' is not a directory",
            root.display()
        ));
    }

    let requested_database_path = root.join(".auric").join("project.db");
    if !requested_database_path.is_file() {
        return Err(format!(
            "Project '{}' is not initialized: missing {}",
            root.display(),
            requested_database_path.display()
        ));
    }
    let database_path = requested_database_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project database: {error}"))?;
    if !database_path.starts_with(&root) {
        return Err(format!(
            "Project database '{}' escapes project root '{}'",
            database_path.display(),
            root.display()
        ));
    }

    Ok(Some(ResolvedProjectBinding {
        database_path,
        project_root: root,
    }))
}
