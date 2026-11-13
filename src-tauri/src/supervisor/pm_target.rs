//! Which project a supervisor's PM tool call may run in, by the policy in force
//! at that call. The MCP gateway (`src/mcp/supervisorPm.ts`) spawns only the path
//! answered here and asks before every use of a child, cached or not.
//!
//! `resolve_pm_target` is pure: the policy plus what the disk said (`PmFacts`).
//! `verification/lean/AuricIDE/PmScope.lean` models it, and a test replays the
//! model's traces against this function. Contract: `callerScope.supervisor.pmTarget`
//! in `agentControl.fixtures.json`.

use super::policy::SupervisorPolicy;
use super::{pm_server_names, pm_slug};
use crate::project_path::canonical_project_path;
use std::collections::BTreeSet;
use std::path::Path;

/// What the disk says, gathered before the decision.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PmFacts {
    /// The permitted projects that hold `.auric/project.db`.
    pub initialized: BTreeSet<String>,
    /// The canonical spelling of an absolute `wanted`.
    pub canonical_wanted: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PmTarget {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PmRefusal {
    /// Not permitted, not a project, or spelled in a way that names nothing.
    /// The same answer for each, so probing teaches nothing.
    Unknown,
    NotInitialized {
        path: String,
    },
    Ambiguous {
        candidates: Vec<String>,
    },
    NoneInitialized,
}

/// The folder name a project answers to.
fn folder_name(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}

/// Every permitted project `wanted` could mean. A server name stands for all
/// projects of its slug: a number was only right for the policy that handed it
/// out, so the name is not trusted to still tell them apart.
fn candidates(permitted: &[String], wanted: &str, canonical: Option<&str>) -> Vec<String> {
    if wanted.starts_with('/') {
        let wanted = canonical.unwrap_or(wanted);
        return permitted.iter().filter(|p| *p == wanted).cloned().collect();
    }
    // A relative path or `~/x` names nothing; no folder name holds a slash.
    if wanted.contains(['/', '\\']) {
        return Vec::new();
    }
    let names = pm_server_names(permitted);
    let server_slug = permitted
        .iter()
        .zip(&names)
        .find(|(_, name)| name.eq_ignore_ascii_case(wanted))
        .map(|(path, _)| pm_slug(path));
    permitted
        .iter()
        .filter(|path| {
            folder_name(path).eq_ignore_ascii_case(wanted)
                || server_slug.as_deref() == Some(pm_slug(path).as_str())
        })
        .cloned()
        .collect()
}

/// `wanted` is a path, folder name or old server name; `None` asks for the first
/// usable project. Only what the policy permits right now is looked at.
pub fn resolve_pm_target(
    policy: &SupervisorPolicy,
    wanted: Option<&str>,
    facts: &PmFacts,
) -> Result<PmTarget, PmRefusal> {
    // Sorted by path: `projects` is a map keyed by it.
    let permitted: Vec<String> = policy
        .projects
        .iter()
        .filter(|(_, rules)| rules.allowed)
        .map(|(path, _)| path.clone())
        .collect();
    let target = |path: String| PmTarget {
        name: folder_name(&path).to_string(),
        path,
    };
    let Some(wanted) = wanted.map(str::trim) else {
        return permitted
            .into_iter()
            .find(|path| facts.initialized.contains(path))
            .map(target)
            .ok_or(PmRefusal::NoneInitialized);
    };
    let mut found = candidates(&permitted, wanted, facts.canonical_wanted.as_deref());
    match found.len() {
        0 => Err(PmRefusal::Unknown),
        1 => {
            let path = found.remove(0);
            if facts.initialized.contains(&path) {
                Ok(target(path))
            } else {
                Err(PmRefusal::NotInitialized { path })
            }
        }
        _ => Err(PmRefusal::Ambiguous { candidates: found }),
    }
}

/// Asks the disk what `resolve_pm_target` needs: a regular file (or a link to
/// one) at `.auric/project.db`, and the real spelling of an absolute `wanted`.
pub fn pm_facts(policy: &SupervisorPolicy, wanted: Option<&str>) -> PmFacts {
    PmFacts {
        initialized: policy
            .projects
            .iter()
            .filter(|(path, rules)| {
                rules.allowed && crate::database::project_db_path(Path::new(path)).is_file()
            })
            .map(|(path, _)| path.clone())
            .collect(),
        canonical_wanted: wanted
            .map(str::trim)
            .filter(|wanted| wanted.starts_with('/'))
            .map(canonical_project_path),
    }
}

#[cfg(test)]
mod tests {
    use super::super::policy::ProjectRules;
    use super::*;
    use serde_json::Value;

    fn policy_of(entries: &[Value]) -> (SupervisorPolicy, PmFacts) {
        let mut policy = SupervisorPolicy::default();
        let mut facts = PmFacts::default();
        for entry in entries {
            let path = entry["path"].as_str().unwrap().to_string();
            assert_eq!(folder_name(&path), entry["name"].as_str().unwrap());
            let allowed = entry["allowed"].as_bool().unwrap();
            if entry["initialized"].as_bool().unwrap() && allowed {
                facts.initialized.insert(path.clone());
            }
            policy.projects.insert(
                path,
                ProjectRules {
                    allowed,
                    ..Default::default()
                },
            );
        }
        (policy, facts)
    }

    fn expected(resolution: &Value) -> Result<PmTarget, PmRefusal> {
        let path = || resolution["path"].as_str().unwrap().to_string();
        match resolution["kind"].as_str().unwrap() {
            "ok" => Ok(PmTarget {
                name: folder_name(&path()).to_string(),
                path: path(),
            }),
            "unknown" => Err(PmRefusal::Unknown),
            "not_initialized" => Err(PmRefusal::NotInitialized { path: path() }),
            "ambiguous" => Err(PmRefusal::Ambiguous {
                candidates: resolution["candidates"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|path| path.as_str().unwrap().to_string())
                    .collect(),
            }),
            "none_initialized" => Err(PmRefusal::NoneInitialized),
            other => panic!("unknown resolution {other}"),
        }
    }

    /// `verification/contracts/pm-scope-v1.jsonl`: every decision of the Lean
    /// model, against the real resolver. The cache half replays in
    /// `src/mcp/supervisorPm.oracle.test.ts`.
    #[test]
    fn the_resolver_decides_every_oracle_trace_like_the_lean_model() {
        let corpus = include_str!("../../../verification/contracts/pm-scope-v1.jsonl");
        let mut decisions = 0;
        for line in corpus.lines() {
            let trace: Value = serde_json::from_str(line).unwrap();
            let name = trace["name"].as_str().unwrap();
            let (mut policy, mut facts) = policy_of(trace["initial"].as_array().unwrap());
            for step in trace["steps"].as_array().unwrap() {
                if step["op"] == "set_policy" {
                    (policy, facts) = policy_of(step["policy"].as_array().unwrap());
                    continue;
                }
                let wanted = step["project"].as_str();
                let facts = PmFacts {
                    canonical_wanted: wanted.filter(|w| w.starts_with('/')).map(str::to_string),
                    ..facts.clone()
                };
                let answer = resolve_pm_target(&policy, wanted, &facts);
                assert_eq!(answer, expected(&step["resolution"]), "{name}: {wanted:?}");
                decisions += 1;
            }
        }
        assert!(decisions > 500, "only {decisions} decisions replayed");
    }

    /// A folder called like another project's old server name fits both.
    #[test]
    fn a_folder_named_like_a_server_name_is_ambiguous_not_guessed() {
        let mut policy = SupervisorPolicy::default();
        for path in ["/a/foo", "/b/auric-pm-foo"] {
            policy.projects.insert(
                path.to_string(),
                ProjectRules {
                    allowed: true,
                    ..Default::default()
                },
            );
        }
        let facts = pm_facts(&policy, None);
        assert_eq!(
            resolve_pm_target(&policy, Some("auric-pm-foo"), &facts),
            Err(PmRefusal::Ambiguous {
                candidates: vec!["/a/foo".to_string(), "/b/auric-pm-foo".to_string()],
            })
        );
    }
}
