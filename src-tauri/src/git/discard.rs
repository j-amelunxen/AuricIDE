use git2::{Repository, StatusOptions};
use std::fs;
use std::path::Path;

pub fn git_discard_impl(repo_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut opts = StatusOptions::new();
    opts.pathspec(file_path)
        .include_untracked(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let status = statuses
        .iter()
        .next()
        .map(|s| s.status())
        .unwrap_or(git2::Status::CURRENT);

    let full_path = Path::new(repo_path).join(file_path);

    if status.contains(git2::Status::WT_NEW) {
        // Untracked file — delete from disk
        fs::remove_file(&full_path)
            .map_err(|e| format!("Failed to delete untracked file: {}", e))?;
    } else if status.contains(git2::Status::INDEX_NEW) {
        // Staged new file — unstage (reset index entry to HEAD, which has no such file) then delete
        repo.reset_default(None, [Path::new(file_path)].iter().copied())
            .map_err(|e| format!("Failed to unstage: {}", e))?;
        if full_path.exists() {
            fs::remove_file(&full_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
    } else {
        // Modified or deleted tracked file — restore from HEAD
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.path(file_path).force();
        repo.checkout_head(Some(&mut checkout_opts))
            .map_err(|e| format!("Failed to discard changes: {}", e))?;
    }

    Ok(())
}
