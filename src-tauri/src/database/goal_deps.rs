//! Rust twin of `validateGoalDependencies` in `src/lib/goals/goalDependencies.ts`.
//!
//! This is a line-for-line port, not a reinterpretation: the same waits-for
//! graph (own edges, parent-to-child completion arcs, and inheritance arcs
//! from an ancestor's own edges onto every descendant), the same
//! bundle-collapsed node keys, and the same "add edges one at a time, reject
//! whichever one would close a loop" order. Both sides run every case in
//! `src/lib/goals/goalDependencies.fixtures.json`, so a change in meaning has
//! to be made — and re-verified — on both sides at once.
//!
//! `goals::goals_sync_impl` is the only caller in this crate: it snapshots
//! every goal and edge before the sync's writes and again after, and rolls
//! the whole transaction back on the first error `introduced_dependency_errors`
//! reports between the two — never on the full list. A bad row that reached
//! the database by some other route (an older build, a hand edit, an MCP call
//! that predates a rule) must not make every later, unrelated save fail; see
//! `introducedDependencyErrors` in `goalDependencies.ts` for the same
//! reasoning on the TypeScript side. Only `code`, `goal_id` and
//! `depends_on_goal_id` are used for any of that, so — unlike the TypeScript
//! original — this port does not carry a human-readable `message` or a
//! cycle `path`; nothing on the Rust side reads either.

use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDependencyGoal {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub bundle: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDependencyEdge {
    pub goal_id: String,
    pub depends_on_goal_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GoalDependencyErrorCode {
    UnknownGoal,
    SelfDependency,
    Ancestor,
    Descendant,
    SameBundle,
    Cycle,
}

impl GoalDependencyErrorCode {
    /// The wire spelling shared with the TypeScript side and the fixtures
    /// (`unknown-goal`, `self`, `ancestor`, `descendant`, `same-bundle`, `cycle`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnknownGoal => "unknown-goal",
            Self::SelfDependency => "self",
            Self::Ancestor => "ancestor",
            Self::Descendant => "descendant",
            Self::SameBundle => "same-bundle",
            Self::Cycle => "cycle",
        }
    }
}

#[derive(Debug, Clone)]
pub struct GoalDependencyError {
    pub code: GoalDependencyErrorCode,
    pub goal_id: String,
    pub depends_on_goal_id: String,
}

/// Blank labels are no bundle; labels compare trimmed — mirrors `normalizeBundle`.
fn normalize_bundle(bundle: &Option<String>) -> Option<String> {
    let trimmed = bundle.as_deref().unwrap_or("").trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

struct Index {
    by_id: HashMap<String, GoalDependencyGoal>,
    /// Parent id (`None` for a root) to its children's ids, in input order.
    children: HashMap<Option<String>, Vec<String>>,
}

fn build_index(goals: &[GoalDependencyGoal]) -> Index {
    let mut by_id = HashMap::new();
    let mut children: HashMap<Option<String>, Vec<String>> = HashMap::new();
    for goal in goals {
        children
            .entry(goal.parent_id.clone())
            .or_default()
            .push(goal.id.clone());
        by_id.insert(goal.id.clone(), goal.clone());
    }
    Index { by_id, children }
}

fn ancestors_of(index: &Index, goal_id: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen: HashSet<String> = HashSet::from([goal_id.to_string()]);
    let mut current = index.by_id.get(goal_id).and_then(|g| g.parent_id.clone());
    while let Some(cur) = current {
        if seen.contains(&cur) {
            break;
        }
        seen.insert(cur.clone());
        result.push(cur.clone());
        current = index.by_id.get(&cur).and_then(|g| g.parent_id.clone());
    }
    result
}

fn descendants_of(index: &Index, goal_id: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen: HashSet<String> = HashSet::from([goal_id.to_string()]);
    let mut stack = vec![goal_id.to_string()];
    while let Some(id) = stack.pop() {
        let Some(kids) = index.children.get(&Some(id)) else {
            continue;
        };
        for child_id in kids {
            if seen.contains(child_id) {
                continue;
            }
            seen.insert(child_id.clone());
            result.push(child_id.clone());
            stack.push(child_id.clone());
        }
    }
    result
}

/// Node key in the waits-for graph: a bundle collapses into one node.
fn node_key(index: &Index, goal_id: &str) -> String {
    let Some(goal) = index.by_id.get(goal_id) else {
        return goal_id.to_string();
    };
    match normalize_bundle(&goal.bundle) {
        None => goal_id.to_string(),
        Some(bundle) => format!(
            "bundle:{}:{}",
            goal.parent_id.clone().unwrap_or_default(),
            bundle
        ),
    }
}

/// The waits-for graph over bundle-collapsed nodes. Own edges, parent→child
/// completion arcs and inheritance arcs are all just arcs here; `reaches`
/// answers whether adding one more arc would close a loop. Neighbour lists
/// stay insertion-order (not a `HashSet`) only so a graph built the same way
/// always searches the same way — the fixtures never depend on the order
/// itself, but a deterministic port is easier to trust.
#[derive(Default)]
struct WaitsFor {
    arcs: HashMap<String, Vec<String>>,
}

impl WaitsFor {
    fn add(&mut self, from: String, to: String) {
        let list = self.arcs.entry(from).or_default();
        if !list.contains(&to) {
            list.push(to);
        }
    }

    /// Whether `to` is reachable from `from` along existing arcs.
    fn reaches(&self, from: &str, to: &str) -> bool {
        if from == to {
            return true;
        }
        let mut queue: VecDeque<&str> = VecDeque::from([from]);
        let mut seen: HashSet<&str> = HashSet::from([from]);
        while let Some(node) = queue.pop_front() {
            let Some(next_nodes) = self.arcs.get(node) else {
                continue;
            };
            for next in next_nodes {
                if next == to {
                    return true;
                }
                if seen.insert(next.as_str()) {
                    queue.push_back(next);
                }
            }
        }
        false
    }
}

fn structural_error(index: &Index, edge: &GoalDependencyEdge) -> Option<GoalDependencyErrorCode> {
    let (goal_id, depends_on) = (&edge.goal_id, &edge.depends_on_goal_id);
    if !index.by_id.contains_key(goal_id) || !index.by_id.contains_key(depends_on) {
        return Some(GoalDependencyErrorCode::UnknownGoal);
    }
    if goal_id == depends_on {
        return Some(GoalDependencyErrorCode::SelfDependency);
    }
    if ancestors_of(index, goal_id).iter().any(|a| a == depends_on) {
        return Some(GoalDependencyErrorCode::Ancestor);
    }
    if descendants_of(index, goal_id)
        .iter()
        .any(|d| d == depends_on)
    {
        return Some(GoalDependencyErrorCode::Descendant);
    }
    if node_key(index, goal_id) == node_key(index, depends_on) {
        return Some(GoalDependencyErrorCode::SameBundle);
    }
    None
}

/// Checks a whole edge set against a goal tree. Returns one error per rejected
/// edge, in edge order; an empty list means the plan is runnable.
// code-gate: complexity-cyclomatic - a line-for-line port of validateGoalDependencies (goalDependencies.ts); the branches are the four structural checks plus the cycle search, unchanged from the shared contract
pub fn validate_goal_dependencies(
    goals: &[GoalDependencyGoal],
    edges: &[GoalDependencyEdge],
) -> Vec<GoalDependencyError> {
    let index = build_index(goals);
    let mut graph = WaitsFor::default();
    for goal in index.by_id.values() {
        if let Some(parent_id) = &goal.parent_id {
            if index.by_id.contains_key(parent_id) {
                graph.add(node_key(&index, parent_id), node_key(&index, &goal.id));
            }
        }
    }

    let mut errors = Vec::new();
    for edge in edges {
        if let Some(code) = structural_error(&index, edge) {
            errors.push(GoalDependencyError {
                code,
                goal_id: edge.goal_id.clone(),
                depends_on_goal_id: edge.depends_on_goal_id.clone(),
            });
            continue;
        }

        let target = node_key(&index, &edge.depends_on_goal_id);
        let mut sources = vec![node_key(&index, &edge.goal_id)];
        sources.extend(
            descendants_of(&index, &edge.goal_id)
                .iter()
                .map(|d| node_key(&index, d)),
        );

        if sources.iter().any(|source| graph.reaches(&target, source)) {
            errors.push(GoalDependencyError {
                code: GoalDependencyErrorCode::Cycle,
                goal_id: edge.goal_id.clone(),
                depends_on_goal_id: edge.depends_on_goal_id.clone(),
            });
            continue;
        }

        for source in &sources {
            graph.add(source.clone(), target.clone());
        }
    }
    errors
}

/// The errors a change introduces: those in `after` that `before` did not
/// already have. Every write path rejects on this, never on the full list —
/// otherwise one bad row that reached the database by any route (an older
/// build, a hand edit) would refuse every later save, including saves that
/// do not touch it. Matching is by code and edge, so a pre-existing problem
/// stays tolerated until someone touches it, and is never reported as the
/// caller's fault. Mirrors `introducedDependencyErrors` in `goalDependencies.ts`.
pub fn introduced_dependency_errors(
    before: (&[GoalDependencyGoal], &[GoalDependencyEdge]),
    after: (&[GoalDependencyGoal], &[GoalDependencyEdge]),
) -> Vec<GoalDependencyError> {
    let existing: HashSet<(GoalDependencyErrorCode, String, String)> =
        validate_goal_dependencies(before.0, before.1)
            .into_iter()
            .map(|error| (error.code, error.goal_id, error.depends_on_goal_id))
            .collect();
    validate_goal_dependencies(after.0, after.1)
        .into_iter()
        .filter(|error| {
            !existing.contains(&(
                error.code,
                error.goal_id.clone(),
                error.depends_on_goal_id.clone(),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = include_str!("../../../src/lib/goals/goalDependencies.fixtures.json");

    #[derive(Deserialize)]
    struct ExpectedError {
        #[serde(rename = "goalId")]
        goal_id: String,
        #[serde(rename = "dependsOnGoalId")]
        depends_on_goal_id: String,
        code: String,
    }

    #[derive(Deserialize)]
    struct FixtureCase {
        name: String,
        goals: Vec<GoalDependencyGoal>,
        edges: Vec<GoalDependencyEdge>,
        #[serde(default)]
        errors: Vec<ExpectedError>,
    }

    #[derive(Deserialize)]
    struct Snapshot {
        goals: Vec<GoalDependencyGoal>,
        edges: Vec<GoalDependencyEdge>,
    }

    #[derive(Deserialize)]
    struct DeltaCase {
        name: String,
        before: Snapshot,
        after: Snapshot,
        #[serde(default)]
        errors: Vec<ExpectedError>,
    }

    #[derive(Deserialize)]
    struct Fixtures {
        cases: Vec<FixtureCase>,
        #[serde(rename = "deltaCases", default)]
        delta_cases: Vec<DeltaCase>,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(FIXTURES).expect("fixtures must parse")
    }

    #[test]
    fn matches_the_shared_dependency_cases() {
        for case in fixtures().cases {
            let errors = validate_goal_dependencies(&case.goals, &case.edges);
            assert_eq!(
                errors.len(),
                case.errors.len(),
                "case '{}': error count",
                case.name
            );
            for (actual, expected) in errors.iter().zip(case.errors.iter()) {
                assert_eq!(
                    actual.goal_id, expected.goal_id,
                    "case '{}': goalId",
                    case.name
                );
                assert_eq!(
                    actual.depends_on_goal_id, expected.depends_on_goal_id,
                    "case '{}': dependsOnGoalId",
                    case.name
                );
                assert_eq!(
                    actual.code.as_str(),
                    expected.code,
                    "case '{}': code",
                    case.name
                );
            }
        }
    }

    #[test]
    fn matches_the_shared_delta_cases() {
        for case in fixtures().delta_cases {
            let errors = introduced_dependency_errors(
                (&case.before.goals, &case.before.edges),
                (&case.after.goals, &case.after.edges),
            );
            assert_eq!(
                errors.len(),
                case.errors.len(),
                "delta case '{}': error count",
                case.name
            );
            for (actual, expected) in errors.iter().zip(case.errors.iter()) {
                assert_eq!(
                    actual.goal_id, expected.goal_id,
                    "delta case '{}': goalId",
                    case.name
                );
                assert_eq!(
                    actual.depends_on_goal_id, expected.depends_on_goal_id,
                    "delta case '{}': dependsOnGoalId",
                    case.name
                );
                assert_eq!(
                    actual.code.as_str(),
                    expected.code,
                    "delta case '{}': code",
                    case.name
                );
            }
        }
    }

    #[test]
    fn covers_every_shared_case() {
        // Guards against a fixture file that silently stops being read — an
        // empty list would make the loops above pass without testing anything.
        assert!(fixtures().cases.len() >= 15);
        assert!(fixtures().delta_cases.len() >= 4);
    }
}
