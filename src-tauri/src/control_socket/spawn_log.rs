//! One line per agent a supervisor started, so "why did it take that model"
//! can be answered after the fact (`docs/design-agent-control.md`,
//! "Supervisor scope"). Append-only JSON lines at
//! `<app_data_dir>/supervisor-spawns.jsonl`, mode 0600, like the link
//! policy's audit log. A line that cannot be written costs the record, never
//! the spawn.

use serde::Serialize;
use std::io::Write;
use std::path::Path;

pub const SPAWN_LOG_FILE_NAME: &str = "supervisor-spawns.jsonl";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnLogEntry {
    pub at: String,
    pub supervisor_id: String,
    pub agent_id: Option<String>,
    pub project_path: String,
    pub provider: String,
    pub model: String,
    pub rank: Option<i64>,
    /// The server chose the model because the spawn named none.
    pub picked: bool,
    pub model_reason: Option<String>,
}

pub fn append(dir: &Path, entry: &SpawnLogEntry) {
    let Ok(mut line) = serde_json::to_vec(entry) else {
        return;
    };
    line.push(b'\n');
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = std::fs::create_dir_all(dir)
        .and_then(|_| options.open(dir.join(SPAWN_LOG_FILE_NAME)))
        .and_then(|mut file| file.write_all(&line));
    if let Err(error) = written {
        eprintln!("Control socket: could not write the supervisor spawn log: {error}");
    }
}
