use super::types::BlameHunk;
use git2::Repository;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub fn git_blame_impl(repo_path: &str, file_path: &str) -> Result<Vec<BlameHunk>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let full_path = Path::new(repo_path).join(file_path);
    if !full_path.is_file() {
        return Err(format!("File not found: {file_path}"));
    }
    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read {file_path}: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!("Cannot blame binary file: {file_path}"));
    }

    let blame = repo
        .blame_file(Path::new(file_path), None)
        .map_err(|e| format!("Failed to blame {file_path}: {e}"))?;

    let mut cache: HashMap<git2::Oid, (String, String, String)> = HashMap::new();
    let mut hunks = Vec::new();
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (author, timestamp, summary) = if let Some(cached) = cache.get(&oid) {
            cached.clone()
        } else {
            let commit = repo
                .find_commit(oid)
                .map_err(|e| format!("Failed to read blame commit: {e}"))?;
            let author = commit.author().name().unwrap_or("").to_string();
            let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_default();
            let summary = commit.summary().unwrap_or("").to_string();
            cache.insert(oid, (author.clone(), timestamp.clone(), summary.clone()));
            (author, timestamp, summary)
        };
        hunks.push(BlameHunk {
            oid: oid.to_string(),
            author,
            timestamp,
            summary,
            start_line: hunk.final_start_line() as u32,
            line_count: hunk.lines_in_hunk() as u32,
        });
    }
    Ok(merge_consecutive_blame_hunks(hunks))
}

fn merge_consecutive_blame_hunks(hunks: Vec<BlameHunk>) -> Vec<BlameHunk> {
    let mut merged: Vec<BlameHunk> = Vec::new();
    for hunk in hunks {
        if let Some(last) = merged.last_mut() {
            if last.oid == hunk.oid && last.start_line + last.line_count == hunk.start_line {
                last.line_count += hunk.line_count;
                continue;
            }
        }
        merged.push(hunk);
    }
    merged
}
