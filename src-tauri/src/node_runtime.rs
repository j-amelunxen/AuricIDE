//! Which `node` runs the bundled MCP server.
//!
//! `better-sqlite3` ships inside the bundle as a native addon built for one
//! Node ABI (`process.versions.modules`). A bare `node` in an agent's PATH may
//! be another major version, and then the server dies on load before it
//! answers `initialize`. The build records the ABI in `manifest.json`; this
//! module finds a `node` on the machine with exactly that ABI and hands its
//! absolute path to every MCP config.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Fixed places a Node install usually lives, searched after the PATH.
const COMMON_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// What the bundle was compiled against (`manifest.json`, written by
/// `scripts/build-mcp-runtime.mjs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleAbi {
    pub modules: String,
    pub node: Option<String>,
}

/// What to write into the MCP configs, and what to tell the human if it is
/// not a verified match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeChoice {
    pub command: String,
    pub problem: Option<String>,
}

/// Reads the ABI from the `manifest.json` next to `server.mjs`. `None` for a
/// bundle built before the ABI was recorded.
pub fn read_bundle_abi(runtime: &Path) -> Option<BundleAbi> {
    let manifest = runtime.parent()?.join("manifest.json");
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(manifest).ok()?).ok()?;
    let modules = value.get("nodeModuleVersion")?;
    let modules = match modules {
        serde_json::Value::String(text) => text.trim().to_string(),
        serde_json::Value::Number(number) => number.to_string(),
        _ => return None,
    };
    if modules.is_empty() {
        return None;
    }
    let node = value
        .get("nodeVersion")
        .and_then(|version| version.as_str())
        .map(str::to_string);
    Some(BundleAbi { modules, node })
}

/// Candidate `node` binaries in priority order: the PATH we were handed, the
/// usual install folders, then version-manager installs (newest first).
pub fn candidate_nodes(
    path_var: &str,
    home: Option<&Path>,
    nvm_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .collect();
    dirs.extend(COMMON_DIRS.iter().map(PathBuf::from));
    let nvm = nvm_dir
        .map(Path::to_path_buf)
        .or_else(|| home.map(|home| home.join(".nvm")));
    if let Some(nvm) = nvm {
        dirs.extend(versioned_bins(&nvm.join("versions").join("node")));
    }
    if let Some(home) = home {
        dirs.push(home.join(".volta").join("bin"));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.into_iter()
        .map(|dir| dir.join("node"))
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

/// `<root>/<version>/bin`, versions sorted newest first by numeric parts.
fn versioned_bins(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<(Vec<u64>, PathBuf)> = entries
        .flatten()
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let key = name
                .trim_start_matches('v')
                .split('.')
                .map(|part| part.parse::<u64>().unwrap_or(0))
                .collect();
            (key, entry.path().join("bin"))
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions.into_iter().map(|(_, bin)| bin).collect()
}

/// The first candidate whose probe reports `abi`. Probes only candidates that
/// are executable files; a probe that fails is a candidate that does not match.
pub fn pick_matching(
    abi: &str,
    candidates: &[PathBuf],
    probe: &dyn Fn(&Path) -> Option<String>,
) -> Result<PathBuf, String> {
    let mut seen: Vec<(PathBuf, String)> = Vec::new();
    for candidate in candidates {
        if !crate::mcp::is_executable_file(candidate) {
            continue;
        }
        match probe(candidate) {
            Some(found) if found == abi => return Ok(candidate.clone()),
            Some(found) => seen.push((candidate.clone(), found)),
            None => {}
        }
    }
    let looked = if seen.is_empty() {
        "no working node binary was found".to_string()
    } else {
        seen.iter()
            .map(|(path, found)| format!("{} (ABI {found})", path.display()))
            .collect::<Vec<_>>()
            .join(", ")
    };
    Err(format!(
        "No Node.js with ABI {abi} found for the bundled MCP server; looked at: {looked}"
    ))
}

/// Runs `<node> -p process.versions.modules`, bounded in time.
fn probe_abi(node: &Path) -> Option<String> {
    let mut child = Command::new(node)
        .args(["-p", "process.versions.modules"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => break,
            Some(_) => return None,
            None if started.elapsed() > PROBE_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    let out = out.trim().to_string();
    (!out.is_empty()).then_some(out)
}

static CACHE: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);

fn cached(abi: &str) -> Option<PathBuf> {
    let guard = CACHE.lock().ok()?;
    let path = guard.as_ref()?.get(abi)?.clone();
    crate::mcp::is_executable_file(&path).then_some(path)
}

fn remember(abi: &str, path: &Path) {
    if let Ok(mut guard) = CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(abi.to_string(), path.to_path_buf());
    }
}

/// The node to write into MCP configs for the bundle at `runtime`.
/// Never silent: a bundle without a recorded ABI or a machine without a
/// matching node yields the bare `node` *and* a `problem` for the caller to
/// log and show.
pub fn node_choice(runtime: &Path, path_var: &str) -> NodeChoice {
    let Some(abi) = read_bundle_abi(runtime) else {
        return NodeChoice {
            command: "node".to_string(),
            problem: Some(
                "The MCP bundle does not record its Node ABI (built before manifest.json carried \
                 it), so the right Node.js cannot be chosen. Run `pnpm mcp:bundle` and rebuild."
                    .to_string(),
            ),
        };
    };
    if let Some(path) = cached(&abi.modules) {
        return NodeChoice {
            command: path.to_string_lossy().into_owned(),
            problem: None,
        };
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let nvm = std::env::var_os("NVM_DIR").map(PathBuf::from);
    let candidates = candidate_nodes(path_var, home.as_deref(), nvm.as_deref());
    match pick_matching(&abi.modules, &candidates, &probe_abi) {
        Ok(path) => {
            remember(&abi.modules, &path);
            NodeChoice {
                command: path.to_string_lossy().into_owned(),
                problem: None,
            }
        }
        Err(error) => {
            let wanted = abi
                .node
                .map(|version| format!(" (built with Node.js {version})"))
                .unwrap_or_default();
            NodeChoice {
                command: "node".to_string(),
                problem: Some(format!(
                    "{error}{wanted}. The auric-pm tools will not load for agents until a \
                     matching Node.js is installed."
                )),
            }
        }
    }
}

/// PATH from a harvested environment, else this process's PATH.
pub fn path_from_env(env: &[(String, String)]) -> String {
    env.iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default()
}

/// Node command to write into MCP configs. Logs when the choice is unverified.
pub fn command_for_mcp(runtime: &Path, path_var: &str) -> String {
    let choice = node_choice(runtime, path_var);
    if let Some(problem) = &choice.problem {
        eprintln!("MCP node: {problem}");
    }
    choice.command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fake_node(dir: &Path) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join("node");
        std::fs::write(&path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// Probe that reads the ABI out of the parent folder name ("abi-127").
    fn folder_probe(path: &Path) -> Option<String> {
        let folder = path.parent()?.file_name()?.to_str()?;
        folder.strip_prefix("abi-").map(str::to_string)
    }

    #[test]
    fn the_first_node_with_the_matching_abi_wins_over_an_earlier_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let old = fake_node(&tmp.path().join("abi-127"));
        let new = fake_node(&tmp.path().join("abi-141"));
        let picked = pick_matching("141", &[old, new.clone()], &folder_probe).unwrap();
        assert_eq!(picked, new);
    }

    #[test]
    fn a_later_candidate_is_the_fallback_when_the_first_does_not_run() {
        let tmp = tempfile::tempdir().unwrap();
        let broken = fake_node(&tmp.path().join("broken"));
        let good = fake_node(&tmp.path().join("abi-141"));
        let picked = pick_matching("141", &[broken, good.clone()], &folder_probe).unwrap();
        assert_eq!(picked, good);
    }

    #[test]
    fn no_match_names_what_was_found_and_the_wanted_abi() {
        let tmp = tempfile::tempdir().unwrap();
        let old = fake_node(&tmp.path().join("abi-127"));
        let error = pick_matching("141", &[old], &folder_probe).unwrap_err();
        assert!(error.contains("ABI 141"), "{error}");
        assert!(error.contains("(ABI 127)"), "{error}");
    }

    #[test]
    fn candidates_are_not_probed_when_not_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("abi-141").join("node");
        let error = pick_matching("141", &[missing], &folder_probe).unwrap_err();
        assert!(error.contains("no working node binary"), "{error}");
    }

    #[test]
    fn candidates_follow_path_then_common_dirs_then_nvm_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        let nvm = tmp.path().join(".nvm");
        for version in ["v20.1.0", "v22.23.4", "v22.9.0"] {
            fake_node(&nvm.join("versions/node").join(version).join("bin"));
        }
        let list = candidate_nodes("/a/bin::/b/bin", Some(tmp.path()), None);
        let text: Vec<String> = list
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert_eq!(text[0], "/a/bin/node");
        assert_eq!(text[1], "/b/bin/node");
        assert_eq!(text[2], "/opt/homebrew/bin/node");
        assert_eq!(text[3], "/usr/local/bin/node");
        assert!(text[4].contains("v22.23.4"), "{text:?}");
        assert!(text[5].contains("v22.9.0"), "{text:?}");
        assert!(text[6].contains("v20.1.0"), "{text:?}");
    }

    #[test]
    fn duplicate_path_entries_are_listed_once() {
        let list = candidate_nodes("/opt/homebrew/bin:/opt/homebrew/bin", None, None);
        let count = list
            .iter()
            .filter(|p| p.to_string_lossy() == "/opt/homebrew/bin/node")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn the_manifest_abi_is_read_next_to_the_entrypoint() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("manifest.json"),
            r#"{"version":1,"entrypoint":"server.mjs","nodeModuleVersion":"141","nodeVersion":"25.1.0"}"#,
        )
        .unwrap();
        let abi = read_bundle_abi(&tmp.path().join("server.mjs")).unwrap();
        assert_eq!(abi.modules, "141");
        assert_eq!(abi.node.as_deref(), Some("25.1.0"));
    }

    #[test]
    fn a_manifest_without_an_abi_is_reported_not_guessed() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("manifest.json"), r#"{"version":1}"#).unwrap();
        let runtime = tmp.path().join("server.mjs");
        assert!(read_bundle_abi(&runtime).is_none());
        let choice = node_choice(&runtime, "");
        assert_eq!(choice.command, "node");
        assert!(choice.problem.unwrap().contains("pnpm mcp:bundle"));
    }

    #[test]
    fn a_machine_without_the_abi_gets_a_problem_instead_of_a_silent_node() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("manifest.json"),
            r#"{"version":1,"nodeModuleVersion":"999999","nodeVersion":"99.0.0"}"#,
        )
        .unwrap();
        let choice = node_choice(&tmp.path().join("server.mjs"), "");
        let problem = choice.problem.expect("a problem");
        assert!(problem.contains("ABI 999999"), "{problem}");
        assert!(problem.contains("99.0.0"), "{problem}");
    }

    #[test]
    fn the_running_machines_node_is_found_by_its_real_abi() {
        // Uses whatever node the test machine has on PATH; skipped without one.
        let path = std::env::var("PATH").unwrap_or_default();
        let candidates = candidate_nodes(&path, None, None);
        let Some(abi) = candidates
            .iter()
            .filter(|c| crate::mcp::is_executable_file(c))
            .find_map(|c| probe_abi(c))
        else {
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("manifest.json"),
            format!(r#"{{"version":1,"nodeModuleVersion":"{abi}"}}"#),
        )
        .unwrap();
        let choice = node_choice(&tmp.path().join("server.mjs"), &path);
        assert!(choice.problem.is_none(), "{:?}", choice.problem);
        assert!(choice.command.starts_with('/'));
        assert_eq!(
            command_for_mcp(&tmp.path().join("server.mjs"), &path),
            choice.command
        );
    }

    #[test]
    fn path_from_env_prefers_the_harvested_path() {
        let env = vec![
            ("HOME".to_string(), "/Users/dev".to_string()),
            ("PATH".to_string(), "/a/bin:/b/bin".to_string()),
        ];
        assert_eq!(path_from_env(&env), "/a/bin:/b/bin");
    }

    #[test]
    fn path_from_env_falls_back_to_the_process_path() {
        let from_process = std::env::var("PATH").unwrap_or_default();
        assert_eq!(path_from_env(&[]), from_process);
        assert_eq!(
            path_from_env(&[("HOME".to_string(), "/tmp".to_string())]),
            from_process
        );
    }
}
