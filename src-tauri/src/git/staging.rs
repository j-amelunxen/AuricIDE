use git2::Repository;
use std::path::Path;

pub fn git_stage_impl(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| "Cannot stage in a bare repository".to_string())?;

    for path in paths {
        if workdir.join(path).exists() {
            index
                .add_path(Path::new(path))
                .map_err(|e| format!("Failed to stage {}: {}", path, e))?;
        } else {
            index
                .remove_path(Path::new(path))
                .map_err(|e| format!("Failed to stage {}: {}", path, e))?;
        }
    }

    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    Ok(())
}

pub fn git_unstage_impl(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    repo.reset_default(
        head.as_ref().map(|t| t.as_object()),
        paths.iter().map(Path::new),
    )
    .map_err(|e| format!("Failed to unstage: {}", e))?;

    Ok(())
}

pub fn git_commit_impl(repo_path: &str, message: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;

    if let Some(head_tree) = repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
        if head_tree.id() == tree_oid {
            return Err("Nothing to commit".to_string());
        }
    }

    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = repo.signature().map_err(|e| {
        format!(
            "Failed to get git signature: {}. Please configure git user.name and user.email.",
            e
        )
    })?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Failed to commit: {}", e))?;

    Ok(oid.to_string())
}

/// Pushes the current branch to `origin`, trying the SSH agent, the default
/// key files and the configured credential helper in that order. Sets the
/// upstream on first push so later pushes (and the branch display) know
/// where home is.
pub fn git_push_impl(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let head = repo
        .head()
        .map_err(|e| format!("Failed to read HEAD: {}", e))?;
    let branch_name = head
        .shorthand()
        .filter(|_| head.is_branch())
        .ok_or_else(|| "Detached HEAD — check out a branch before pushing".to_string())?
        .to_string();

    let mut remote = repo
        .find_remote("origin")
        .map_err(|_| "No 'origin' remote configured for this repository".to_string())?;

    // git2 re-asks the callback after every failed credential, which loops
    // forever if we keep proposing the same one — bail after a few tries
    // with a message that names the fix instead of hanging the UI.
    let attempts = std::cell::Cell::new(0u32);
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        let attempt = attempts.get();
        attempts.set(attempt + 1);
        if attempt > 4 {
            return Err(git2::Error::from_str(
                "no accepted credentials (tried SSH agent, key files and credential helper)",
            ));
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if attempt == 0 {
                if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
            if let Ok(home) = std::env::var("HOME") {
                for key in ["id_ed25519", "id_rsa"] {
                    let path = std::path::Path::new(&home).join(".ssh").join(key);
                    if path.exists() {
                        if let Ok(cred) = git2::Cred::ssh_key(user, None, &path, None) {
                            return Ok(cred);
                        }
                    }
                }
            }
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = git2::Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        git2::Cred::default()
    });

    let mut options = git2::PushOptions::new();
    options.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    remote
        .push(&[&refspec], Some(&mut options))
        .map_err(|e| format!("Push failed: {}", e))?;

    // Best-effort: the push itself succeeded, a missing upstream note is a
    // cosmetic follow-up, not a failure.
    if let Ok(mut branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
        if branch.upstream().is_err() {
            let _ = branch.set_upstream(Some(&format!("origin/{branch_name}")));
        }
    }

    Ok(())
}
