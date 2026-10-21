//! The data behind the git graph browser: every branch walked as one DAG,
//! the refs that label it, and one commit's detail. Contract and reasoning:
//! `docs/design-git-graph.md`. Layout is the frontend's; this only hands over
//! commits in topological order with their parents.

use super::diff::name_status_from_delta;
use super::merge::operation_name;
use super::refs_ops::{find_commit, refuse};
use super::types::*;
use git2::{BranchType, Commit, Oid, Reference, Repository, Sort};

const MIN_PAGE: usize = 1;
const MAX_PAGE: usize = 500;

const HEADS: &str = "refs/heads/";
const REMOTES: &str = "refs/remotes/";
const TAGS: &str = "refs/tags/";

/// The commit a ref names, peeling annotated tags. None for a tag that
/// points at a tree or blob and for a ref that does not resolve.
fn peeled_commit<'r>(reference: &Reference<'r>) -> Option<Commit<'r>> {
    reference.peel_to_commit().ok()
}

fn is_remote_head(name: &str) -> bool {
    name.starts_with(REMOTES) && name.ends_with("/HEAD")
}

fn graph_commit(commit: &Commit) -> GraphCommit {
    let author = commit.author();
    GraphCommit {
        oid: commit.id().to_string(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        summary: commit.summary().unwrap_or("").to_string(),
        author_name: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer_time: commit.time().seconds(),
    }
}

/// HEAD (if born) plus every branch, remote branch and tag that names a commit.
fn push_all_tips(repo: &Repository, walk: &mut git2::Revwalk) -> Result<(), String> {
    if let Some(head) = repo.head().ok().and_then(|h| h.target()) {
        walk.push(head)
            .map_err(|e| format!("Failed to start at HEAD: {e}"))?;
    }
    let references = repo
        .references()
        .map_err(|e| format!("Failed to list refs: {e}"))?;
    for reference in references.flatten() {
        let Some(name) = reference.name() else {
            continue;
        };
        let is_tip = [HEADS, REMOTES, TAGS].iter().any(|p| name.starts_with(p));
        if !is_tip || is_remote_head(name) {
            continue;
        }
        if let Some(commit) = peeled_commit(&reference) {
            walk.push(commit.id())
                .map_err(|e| format!("Failed to walk {name}: {e}"))?;
        }
    }
    Ok(())
}

/// One page of the all-branches walk. An unborn or missing repository is an
/// empty page, like `git_log_since_impl`.
pub fn git_graph_log_impl(repo_path: &str, skip: usize, limit: usize) -> Result<GraphPage, String> {
    let empty = GraphPage {
        commits: Vec::new(),
        has_more: false,
    };
    let Ok(repo) = Repository::open(repo_path) else {
        return Ok(empty);
    };
    let limit = limit.clamp(MIN_PAGE, MAX_PAGE);
    let mut walk = repo
        .revwalk()
        .map_err(|e| format!("Failed to walk history: {e}"))?;
    push_all_tips(&repo, &mut walk)?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| format!("Failed to sort history: {e}"))?;

    let mut commits = Vec::with_capacity(limit);
    let mut has_more = false;
    for oid in walk.skip(skip) {
        let oid = oid.map_err(|e| format!("Failed to read commit id: {e}"))?;
        if commits.len() == limit {
            has_more = true;
            break;
        }
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Failed to read commit: {e}"))?;
        commits.push(graph_commit(&commit));
    }
    Ok(GraphPage { commits, has_more })
}

/// How far a local branch is from its upstream, and the upstream's name.
struct UpstreamPosition {
    name: String,
    ahead: usize,
    behind: usize,
}

fn upstream_position(repo: &Repository, local: Oid, name: &str) -> Option<UpstreamPosition> {
    let branch = repo.find_branch(name, BranchType::Local).ok()?;
    let upstream = branch.upstream().ok()?;
    let upstream_oid = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local, upstream_oid).ok()?;
    Some(UpstreamPosition {
        name: upstream.name().ok()??.to_string(),
        ahead,
        behind,
    })
}

fn ref_entry(repo: &Repository, reference: &Reference, current: Option<&str>) -> Option<GitRef> {
    let name = reference.name()?;
    let target = peeled_commit(reference)?.id();
    let (kind, shorthand) = if let Some(short) = name.strip_prefix(HEADS) {
        ("local", short)
    } else if let Some(short) = name.strip_prefix(REMOTES) {
        ("remote", short)
    } else {
        ("tag", name.strip_prefix(TAGS)?)
    };
    let position = (kind == "local")
        .then(|| upstream_position(repo, target, shorthand))
        .flatten();
    Some(GitRef {
        name: name.to_string(),
        shorthand: shorthand.to_string(),
        kind: kind.to_string(),
        target: target.to_string(),
        upstream: position.as_ref().map(|p| p.name.clone()),
        ahead: position.as_ref().map(|p| p.ahead as u32),
        behind: position.as_ref().map(|p| p.behind as u32),
        is_current: kind == "local" && current == Some(name),
    })
}

/// head, current local, other local, remote, tag; each group by name.
fn sort_rank(entry: &GitRef) -> u8 {
    match (entry.kind.as_str(), entry.is_current) {
        ("head", _) => 0,
        ("local", true) => 1,
        ("local", false) => 2,
        ("remote", _) => 3,
        _ => 4,
    }
}

pub fn git_refs_impl(repo_path: &str) -> Result<GitRefs, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {e}"))?;
    let head = repo.head().ok();
    let head_oid = head.as_ref().and_then(|h| h.target());
    let head_detached = head_oid.is_some() && repo.head_detached().unwrap_or(false);
    let current = head
        .as_ref()
        .filter(|_| !head_detached)
        .and_then(|h| h.name());

    let mut refs: Vec<GitRef> = repo
        .references()
        .map_err(|e| format!("Failed to list refs: {e}"))?
        .flatten()
        .filter(|r| r.name().is_some_and(|n| !is_remote_head(n)))
        .filter_map(|r| ref_entry(&repo, &r, current))
        .collect();
    if let Some(oid) = head_oid {
        refs.push(GitRef {
            name: "HEAD".to_string(),
            shorthand: "HEAD".to_string(),
            kind: "head".to_string(),
            target: oid.to_string(),
            upstream: None,
            ahead: None,
            behind: None,
            is_current: false,
        });
    }
    refs.sort_by(|a, b| (sort_rank(a), &a.name).cmp(&(sort_rank(b), &b.name)));

    Ok(GitRefs {
        refs,
        head_detached,
        head_oid: head_oid.map(|o| o.to_string()),
        operation: operation_name(repo.state()).to_string(),
    })
}

/// Full message and the files one commit changed, against one of its parents
/// (`parent_index`) or the empty tree for a root.
pub fn git_commit_detail_impl(
    repo_path: &str,
    oid: &str,
    parent_index: usize,
) -> Result<CommitDetail, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {e}"))?;
    let commit = find_commit(&repo, oid)?;
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to read commit tree: {e}"))?;
    let parent_tree = match commit.parent_count() {
        0 => None,
        count if parent_index < count => {
            commit.parent(parent_index).ok().and_then(|p| p.tree().ok())
        }
        _ => {
            return Err(refuse(
                "not_found",
                "This commit has no parent with that number.",
            ))
        }
    };
    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to diff commit: {e}"))?;
    let (author, committer) = (commit.author(), commit.committer());
    Ok(CommitDetail {
        oid: commit.id().to_string(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        message: commit.message().unwrap_or("").trim_end().to_string(),
        author_name: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer_name: committer.name().unwrap_or("").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        committer_time: committer.when().seconds(),
        files: diff.deltas().filter_map(name_status_from_delta).collect(),
    })
}
