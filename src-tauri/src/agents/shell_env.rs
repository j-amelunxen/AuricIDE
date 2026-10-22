use std::future::Future;
use std::sync::RwLock;
use tokio::sync::OnceCell;

type Env = &'static [(String, String)];

/// The harvested environment, harvested once per process and re-harvestable
/// on request. The `OnceCell` keeps first use single-flight (an interactive
/// `zsh -ilc` is slow); the lock lets "Check Again" swap in a fresh harvest.
struct LoginEnvCache {
    cell: OnceCell<RwLock<Env>>,
}

impl LoginEnvCache {
    const fn new() -> Self {
        Self {
            cell: OnceCell::const_new(),
        }
    }

    async fn slot(&self, resolve: impl Future<Output = Vec<(String, String)>>) -> &RwLock<Env> {
        self.cell
            .get_or_init(|| async { RwLock::new(leak(resolve.await)) })
            .await
    }

    async fn get(&self, resolve: impl Future<Output = Vec<(String, String)>>) -> Env {
        let slot = self.slot(resolve).await;
        *slot.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    async fn refresh(&self, resolve: impl Future<Output = Vec<(String, String)>>) {
        // Harvest first: the slot must keep serving the old environment while
        // the slow shell runs.
        let fresh = leak(resolve.await);
        let slot = self.cell.get_or_init(|| async { RwLock::new(fresh) }).await;
        *slot
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = fresh;
    }
}

/// Callers hold the environment as `&'static` for as long as they spawn, so a
/// replaced harvest cannot be freed under them. Only an explicit "Check Again"
/// replaces it, a few KB each time.
fn leak(env: Vec<(String, String)>) -> Env {
    Box::leak(env.into_boxed_slice())
}

static SHELL_ENV_CACHE: LoginEnvCache = LoginEnvCache::new();

/// Pre-resolves the cached login-shell environment so the first real agent
/// spawn doesn't have to pay for it. Safe to call multiple times.
pub async fn warm_shell_env_cache() {
    cached_login_shell_env().await;
}

pub async fn cached_login_shell_env() -> &'static [(String, String)] {
    SHELL_ENV_CACHE.get(resolve_login_shell_env()).await
}

/// Harvests the login-shell environment again, for the case that the user
/// changed their shell rc files while the app runs (an install that added a
/// PATH line). Agents and probes started afterwards see the new environment.
pub async fn refresh_login_shell_env() {
    SHELL_ENV_CACHE.refresh(resolve_login_shell_env()).await;
}

/// Shell + flags used to harvest the user's shell environment. `.zshrc`
/// (where user PATH entries like `~/.local/bin` or nvm typically live) is
/// only sourced by *interactive* shells — a plain login shell (`-lc`) misses
/// those entries, which made packaged builds fail to find CLIs that dev
/// runs (inheriting the terminal's PATH) found fine.
pub fn login_shell_invocation(interactive: bool) -> Option<(&'static str, &'static str)> {
    if cfg!(target_os = "windows") {
        None
    } else if cfg!(target_os = "macos") {
        Some(("/bin/zsh", if interactive { "-ilc" } else { "-lc" }))
    } else {
        // POSIX sh has no interactive rc convention worth sourcing here.
        Some(("sh", "-lc"))
    }
}

pub async fn resolve_login_shell_env() -> Vec<(String, String)> {
    if cfg!(target_os = "windows") {
        return Vec::new();
    }

    let mut env = harvest_shell_env(true).await;
    // Interactive rc files can misbehave without a TTY — if the harvest
    // produced no usable PATH, retry with a non-interactive login shell.
    if !env.iter().any(|(k, _)| k == "PATH") {
        env = harvest_shell_env(false).await;
    }
    // Never end up with less than the PATH this process inherited: terminal
    // launches (dev) already carry the full user PATH, and if both harvests
    // failed this is the only PATH we have.
    let inherited = std::env::var("PATH").ok();
    apply_inherited_path(&mut env, inherited.as_deref());
    env
}

pub async fn harvest_shell_env(interactive: bool) -> Vec<(String, String)> {
    let Some((shell, flag)) = login_shell_invocation(interactive) else {
        return Vec::new();
    };

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tokio::process::Command::new(shell)
            .arg(flag)
            .arg("command env -0")
            .stdin(std::process::Stdio::null())
            .output(),
    )
    .await;

    match output {
        Ok(Ok(out)) if out.status.success() => parse_env_output(&out.stdout),
        _ => Vec::new(),
    }
}

pub fn parse_env_output(bytes: &[u8]) -> Vec<(String, String)> {
    String::from_utf8_lossy(bytes)
        .split('\0')
        .filter_map(|entry| entry.split_once('='))
        .filter(|(k, _)| is_valid_env_key(k))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Interactive shells may print rc-file noise to stdout before the `env -0`
/// output; only accept entries whose key is a valid env var name.
pub fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Union of both PATH strings, deduplicated, harvested entries first.
pub fn merge_path(harvested: Option<&str>, inherited: Option<&str>) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut merged: Vec<&str> = Vec::new();
    for path in [harvested, inherited].into_iter().flatten() {
        for segment in path.split(':').filter(|s| !s.is_empty()) {
            if seen.insert(segment) {
                merged.push(segment);
            }
        }
    }
    merged.join(":")
}

pub fn apply_inherited_path(env: &mut Vec<(String, String)>, inherited: Option<&str>) {
    let harvested = env
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| v.clone());
    let merged = merge_path(harvested.as_deref(), inherited);
    if merged.is_empty() {
        return;
    }
    if let Some(entry) = env.iter_mut().find(|(k, _)| k == "PATH") {
        entry.1 = merged;
    } else {
        env.push(("PATH".to_string(), merged));
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn path_env(path: &str) -> Vec<(String, String)> {
        vec![("PATH".to_string(), path.to_string())]
    }

    #[tokio::test]
    async fn harvests_once_however_often_it_is_asked() {
        let cache = LoginEnvCache::new();
        let harvests = AtomicUsize::new(0);
        for _ in 0..3 {
            let env = cache
                .get(async {
                    harvests.fetch_add(1, Ordering::SeqCst);
                    path_env("/first")
                })
                .await;
            assert_eq!(env, path_env("/first").as_slice());
        }
        assert_eq!(harvests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_refresh_replaces_what_later_reads_see() {
        let cache = LoginEnvCache::new();
        cache.get(async { path_env("/first") }).await;
        cache.refresh(async { path_env("/second") }).await;
        let env = cache.get(async { path_env("/never") }).await;
        assert_eq!(env, path_env("/second").as_slice());
    }

    #[tokio::test]
    async fn an_environment_handed_out_before_a_refresh_stays_readable() {
        let cache = LoginEnvCache::new();
        let before = cache.get(async { path_env("/first") }).await;
        cache.refresh(async { path_env("/second") }).await;
        assert_eq!(before, path_env("/first").as_slice());
    }

    #[tokio::test]
    async fn refreshing_before_any_read_is_the_first_harvest() {
        let cache = LoginEnvCache::new();
        cache.refresh(async { path_env("/only") }).await;
        let env = cache.get(async { path_env("/never") }).await;
        assert_eq!(env, path_env("/only").as_slice());
    }
}
