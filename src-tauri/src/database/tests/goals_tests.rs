use super::*;
use crate::database::*;

#[test]
fn test_goal_stations_roundtrip_ordered_by_sort_order() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    let mut second = make_test_station("s2", "g1", 1);
    second.name = "Call the customer".to_string();
    second.kind = "human".to_string();
    second.evidence_kind = "human".to_string();
    second.predicate = "{\"type\":\"human\"}".to_string();
    second.source_context =
        "{\"importId\":\"video-1\",\"notes\":[\"Client approval\"]}".to_string();
    payload.stations = vec![second, make_test_station("s1", "g1", 0)];

    goals_sync_impl(&conn, &payload).unwrap();
    let state = goals_load_impl(&conn).unwrap();

    assert_eq!(state.stations.len(), 2);
    assert_eq!(state.stations[0].id, "s1");
    assert_eq!(state.stations[1].id, "s2");
    assert_eq!(state.stations[1].name, "Call the customer");
    assert_eq!(state.stations[1].kind, "human");
    assert_eq!(state.stations[1].predicate, "{\"type\":\"human\"}");
    assert!(state.stations[1].source_context.contains("video-1"));
}

#[test]
fn test_goal_stations_upsert_updates_existing_row() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    payload.stations = vec![make_test_station("s1", "g1", 0)];
    goals_sync_impl(&conn, &payload).unwrap();

    let mut updated = make_test_station("s1", "g1", 3);
    updated.status = "done".to_string();
    updated.evidence_kind = "human".to_string();
    updated.done_at = Some("2026-01-02 00:00:00".to_string());
    payload.stations = vec![updated];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.stations.len(), 1);
    assert_eq!(state.stations[0].status, "done");
    assert_eq!(state.stations[0].evidence_kind, "human");
    assert_eq!(state.stations[0].sort_order, 3);
    assert_eq!(
        state.stations[0].done_at,
        Some("2026-01-02 00:00:00".to_string())
    );
}

#[test]
fn test_deleted_station_ids_remove_only_listed_rows() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    payload.stations = vec![
        make_test_station("s1", "g1", 0),
        make_test_station("s2", "g1", 1),
    ];
    goals_sync_impl(&conn, &payload).unwrap();

    payload.stations = vec![];
    payload.deleted_station_ids = vec!["s1".to_string()];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.stations.len(), 1);
    assert_eq!(state.stations[0].id, "s2");
}

#[test]
fn test_deleting_a_goal_cascades_to_its_stations() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    payload.stations = vec![make_test_station("s1", "g1", 0)];
    goals_sync_impl(&conn, &payload).unwrap();

    payload.stations = vec![];
    payload.goals = vec![];
    payload.deleted_goal_ids = vec!["g1".to_string()];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.goals.len(), 0);
    assert_eq!(state.stations.len(), 0);
}

#[test]
fn test_goals_clear_also_clears_stations() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    payload.stations = vec![make_test_station("s1", "g1", 0)];
    goals_sync_impl(&conn, &payload).unwrap();
    goals_clear_impl(&conn).unwrap();
    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.stations.len(), 0);
}

#[test]
fn test_goals_save_and_load_roundtrip() {
    let conn = setup_in_memory_db();

    let mut root = make_test_goal("g1", None);
    root.name = "Ship orchestration".to_string();
    root.success_criteria = "- All sub-goals achieved".to_string();
    root.status = "active".to_string();
    root.goal_prompt = "Achieve orchestration".to_string();

    // Child listed BEFORE its parent to prove save order is not a constraint
    let payload = sync_payload(vec![make_test_goal("g2", Some("g1")), root], vec![], vec![]);

    goals_sync_impl(&conn, &payload).unwrap();
    let state = goals_load_impl(&conn).unwrap();

    assert_eq!(state.goals.len(), 2);
    let g1 = state.goals.iter().find(|g| g.id == "g1").unwrap();
    let g2 = state.goals.iter().find(|g| g.id == "g2").unwrap();
    assert_eq!(g1.name, "Ship orchestration");
    assert_eq!(g1.success_criteria, "- All sub-goals achieved");
    assert_eq!(g1.status, "active");
    assert_eq!(g1.goal_prompt, "Achieve orchestration");
    assert_eq!(g1.parent_id, None);
    assert_eq!(g2.parent_id, Some("g1".to_string()));
}

#[test]
fn test_goals_clear() {
    let conn = setup_in_memory_db();
    let payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    goals_sync_impl(&conn, &payload).unwrap();
    goals_clear_impl(&conn).unwrap();
    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.goals.len(), 0);
    assert_eq!(state.goal_runs.len(), 0);
    assert_eq!(state.requirement_links.len(), 0);
}

#[test]
fn test_goal_runs_and_requirement_links_roundtrip() {
    let conn = setup_in_memory_db();

    let req_payload = RequirementsState {
        requirements: vec![make_test_requirement("r1", "REQ-01")],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &req_payload).unwrap();

    let payload = sync_payload(
        vec![make_test_goal("g1", None)],
        vec![PmGoalRun {
            id: "run1".to_string(),
            goal_id: "g1".to_string(),
            agent_id: "agent-1".to_string(),
            ticket_id: None,
            prompt: "Do the thing".to_string(),
            model: "sonnet".to_string(),
            provider: "claude".to_string(),
            source: "conductor".to_string(),
            outcome: "running".to_string(),
            summary: "".to_string(),
            started_at: "2026-01-01 00:00:00".to_string(),
            finished_at: None,
        }],
        vec![PmGoalRequirementLink {
            id: "grl1".to_string(),
            goal_id: "g1".to_string(),
            requirement_id: "r1".to_string(),
            created_at: "2026-01-01 00:00:00".to_string(),
        }],
    );

    goals_sync_impl(&conn, &payload).unwrap();
    let state = goals_load_impl(&conn).unwrap();

    assert_eq!(state.goal_runs.len(), 1);
    assert_eq!(state.goal_runs[0].prompt, "Do the thing");
    assert_eq!(state.goal_runs[0].source, "conductor");
    assert_eq!(state.goal_runs[0].outcome, "running");
    assert_eq!(state.goal_runs[0].finished_at, None);
    assert_eq!(state.requirement_links.len(), 1);
    assert_eq!(state.requirement_links[0].requirement_id, "r1");
}

#[test]
fn test_ticket_goal_id_roundtrip() {
    let conn = setup_in_memory_db();

    let goals = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    goals_sync_impl(&conn, &goals).unwrap();

    let mut pm_payload = make_test_payload();
    pm_payload.tickets[0].goal_id = Some("g1".to_string());
    pm_save_impl(&conn, &pm_payload).unwrap();

    let state = pm_load_impl(&conn).unwrap();
    let ticket = state.tickets.iter().find(|t| t.id == "t1").unwrap();
    assert_eq!(ticket.goal_id, Some("g1".to_string()));
}

#[test]
fn test_goals_sync_preserves_mcp_created_rows() {
    let conn = setup_in_memory_db();

    // Frontend saves its draft
    let payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
    goals_sync_impl(&conn, &payload).unwrap();

    // MCP subprocess concurrently creates a goal + run the frontend never saw
    conn.execute(
        "INSERT INTO pm_goals (id, parent_id, name) VALUES ('mcp-goal', 'g1', 'Agent subgoal')",
        [],
    )
    .unwrap();
    conn.execute(
            "INSERT INTO pm_goal_runs (id, goal_id, agent_id, prompt) VALUES ('mcp-run', 'mcp-goal', 'agent-9', 'p')",
            [],
        )
        .unwrap();

    // Frontend saves again — MCP rows must survive
    let mut g1 = make_test_goal("g1", None);
    g1.name = "Renamed by UI".to_string();
    let payload2 = sync_payload(vec![g1], vec![], vec![]);
    goals_sync_impl(&conn, &payload2).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.goals.len(), 2);
    assert!(state.goals.iter().any(|g| g.id == "mcp-goal"));
    assert_eq!(state.goal_runs.len(), 1);
    assert_eq!(
        state.goals.iter().find(|g| g.id == "g1").unwrap().name,
        "Renamed by UI"
    );
}

#[test]
fn test_goals_sync_deletes_only_listed_ids() {
    let conn = setup_in_memory_db();

    let payload = sync_payload(
        vec![
            make_test_goal("keep", None),
            make_test_goal("doomed", None),
            make_test_goal("doomed-child", Some("doomed")),
        ],
        vec![],
        vec![],
    );
    goals_sync_impl(&conn, &payload).unwrap();

    let delete_payload = GoalsSyncPayload {
        deleted_goal_ids: vec!["doomed".to_string()],
        ..Default::default()
    };
    goals_sync_impl(&conn, &delete_payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    // Cascade removes the child; "keep" survives
    assert_eq!(state.goals.len(), 1);
    assert_eq!(state.goals[0].id, "keep");
}

#[test]
fn test_goal_work_mode_roundtrips_and_defaults_to_auto() {
    let conn = setup_in_memory_db();

    let mut stations_goal = make_test_goal("g1", None);
    stations_goal.work_mode = "stations".to_string();
    let payload = sync_payload(
        vec![stations_goal, make_test_goal("g2", None)],
        vec![],
        vec![],
    );
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    let g1 = state.goals.iter().find(|g| g.id == "g1").unwrap();
    let g2 = state.goals.iter().find(|g| g.id == "g2").unwrap();
    assert_eq!(g1.work_mode, "stations");
    assert_eq!(g2.work_mode, "auto");

    // A row written without the column (an older writer) reads back as auto.
    conn.execute(
        "INSERT INTO pm_goals (id, name) VALUES ('g3', 'Older writer')",
        [],
    )
    .unwrap();
    let state = goals_load_impl(&conn).unwrap();
    let g3 = state.goals.iter().find(|g| g.id == "g3").unwrap();
    assert_eq!(g3.work_mode, "auto");
}

#[test]
fn test_goal_payload_without_work_mode_deserializes_as_auto() {
    let json = r#"{"id":"g1","parentId":null,"name":"Goal","description":"",
        "successCriteria":"","status":"draft","priority":"normal","goalPrompt":"",
        "createdBy":"ui","achievedAt":null,"sortOrder":0,
        "createdAt":"2026-01-01 00:00:00","updatedAt":"2026-01-01 00:00:00"}"#;
    let goal: PmGoal = serde_json::from_str(json).unwrap();
    assert_eq!(goal.work_mode, "auto");
}

#[test]
fn test_goal_mission_path_roundtrips_and_defaults_to_none() {
    let conn = setup_in_memory_db();

    let mut mission_goal = make_test_goal("g1", None);
    mission_goal.mission_path = Some("missions/sample".to_string());
    let payload = sync_payload(
        vec![mission_goal, make_test_goal("g2", None)],
        vec![],
        vec![],
    );
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    let g1 = state.goals.iter().find(|g| g.id == "g1").unwrap();
    let g2 = state.goals.iter().find(|g| g.id == "g2").unwrap();
    assert_eq!(g1.mission_path.as_deref(), Some("missions/sample"));
    assert_eq!(g2.mission_path, None);

    let json = serde_json::to_value(g1).unwrap();
    assert_eq!(json["missionPath"], "missions/sample");
    assert!(serde_json::to_value(g2).unwrap()["missionPath"].is_null());
}

#[test]
fn test_goal_payload_without_mission_path_deserializes_as_none() {
    let json = r#"{"id":"g1","parentId":null,"name":"Goal","description":"",
        "successCriteria":"","status":"draft","priority":"normal","goalPrompt":"",
        "createdBy":"ui","achievedAt":null,"sortOrder":0,
        "createdAt":"2026-01-01 00:00:00","updatedAt":"2026-01-01 00:00:00"}"#;
    let goal: PmGoal = serde_json::from_str(json).unwrap();
    assert_eq!(goal.mission_path, None);
}

#[test]
fn test_goal_bundle_roundtrips_and_defaults_to_none() {
    let conn = setup_in_memory_db();

    let mut bundled = make_test_goal("g1", None);
    bundled.bundle = Some("api".to_string());
    let payload = sync_payload(vec![bundled, make_test_goal("g2", None)], vec![], vec![]);
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    let g1 = state.goals.iter().find(|g| g.id == "g1").unwrap();
    let g2 = state.goals.iter().find(|g| g.id == "g2").unwrap();
    assert_eq!(g1.bundle.as_deref(), Some("api"));
    assert_eq!(g2.bundle, None);
}

#[test]
fn test_goal_dependencies_roundtrip_ordered_by_created_at() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![
            make_test_goal("a", None),
            make_test_goal("b", None),
            make_test_goal("c", None),
        ],
        vec![],
        vec![],
    );
    payload.dependencies = vec![
        make_test_dependency("e2", "c", "b"),
        make_test_dependency("e1", "b", "a"),
    ];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 2);
    // Both rows share the same created_at fixture value, so id breaks the tie.
    assert_eq!(state.dependencies[0].id, "e1");
    assert_eq!(state.dependencies[1].id, "e2");
    assert_eq!(state.dependencies[0].goal_id, "b");
    assert_eq!(state.dependencies[0].depends_on_goal_id, "a");
}

#[test]
fn test_a_repeated_dependency_id_is_left_exactly_as_it_is() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![make_test_goal("a", None), make_test_goal("b", None)],
        vec![],
        vec![],
    );
    payload.dependencies = vec![make_test_dependency("e1", "b", "a")];
    goals_sync_impl(&conn, &payload).unwrap();

    // Dependency rows are immutable: sending the same id again is a no-op,
    // even with different (nonsensical) column values.
    payload.dependencies = vec![PmGoalDependency {
        id: "e1".to_string(),
        goal_id: "a".to_string(),
        depends_on_goal_id: "b".to_string(),
        created_at: "2099-01-01 00:00:00".to_string(),
    }];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 1);
    assert_eq!(state.dependencies[0].goal_id, "b");
    assert_eq!(state.dependencies[0].depends_on_goal_id, "a");
}

#[test]
fn test_deleted_dependency_ids_remove_only_listed_rows() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![
            make_test_goal("a", None),
            make_test_goal("b", None),
            make_test_goal("c", None),
        ],
        vec![],
        vec![],
    );
    payload.dependencies = vec![
        make_test_dependency("e1", "b", "a"),
        make_test_dependency("e2", "c", "b"),
    ];
    goals_sync_impl(&conn, &payload).unwrap();

    payload.dependencies = vec![];
    payload.deleted_dependency_ids = vec!["e1".to_string()];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 1);
    assert_eq!(state.dependencies[0].id, "e2");
}

#[test]
fn test_deleting_a_goal_cascades_its_dependency_edges() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![make_test_goal("a", None), make_test_goal("b", None)],
        vec![],
        vec![],
    );
    payload.dependencies = vec![make_test_dependency("e1", "b", "a")];
    goals_sync_impl(&conn, &payload).unwrap();

    payload.goals = vec![make_test_goal("b", None)];
    payload.dependencies = vec![];
    payload.deleted_goal_ids = vec!["a".to_string()];
    goals_sync_impl(&conn, &payload).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 0);
}

#[test]
fn test_goals_clear_also_clears_dependencies() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![make_test_goal("a", None), make_test_goal("b", None)],
        vec![],
        vec![],
    );
    payload.dependencies = vec![make_test_dependency("e1", "b", "a")];
    goals_sync_impl(&conn, &payload).unwrap();

    goals_clear_impl(&conn).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 0);
}

#[test]
fn test_a_cyclic_dependency_edge_rolls_back_the_whole_sync() {
    let conn = setup_in_memory_db();
    let mut payload = sync_payload(
        vec![
            make_test_goal("a", None),
            make_test_goal("b", None),
            make_test_goal("c", None),
        ],
        vec![],
        vec![],
    );
    payload.dependencies = vec![make_test_dependency("e1", "b", "a")];
    goals_sync_impl(&conn, &payload).unwrap();

    // b -> a already exists; adding a -> b closes a cycle. Also carries an
    // unrelated goal rename, which must not survive the rollback either.
    let mut renamed_c = make_test_goal("c", None);
    renamed_c.name = "Renamed while the cycle was rejected".to_string();
    let mut cyclic = sync_payload(vec![renamed_c], vec![], vec![]);
    cyclic.dependencies = vec![make_test_dependency("e2", "a", "b")];

    let result = goals_sync_impl(&conn, &cyclic);
    let error = result.expect_err("a cyclic edge must be rejected");
    assert_eq!(error, "Goal dependency rejected (cycle): a → b");

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(
        state.dependencies.len(),
        1,
        "the rejected edge must not persist"
    );
    assert_eq!(state.dependencies[0].id, "e1");
    assert_eq!(
        state.goals.iter().find(|g| g.id == "c").unwrap().name,
        "Goal c",
        "the whole transaction rolls back, not just the rejected edge"
    );
}

/// A row that reached the database by some route other than `goals_sync` — an
/// older build, a hand edit, an MCP call from before a rule existed — must not
/// turn every later sync into a rejection. `goals_sync_impl` only rejects what
/// THIS sync introduces (`introduced_dependency_errors`), never the graph as a
/// whole.
#[test]
fn test_a_preexisting_bad_edge_tolerates_unrelated_syncs_but_not_new_errors() {
    let conn = setup_in_memory_db();
    let mut a = make_test_goal("a", Some("p"));
    a.bundle = Some("x".to_string());
    let mut b = make_test_goal("b", Some("p"));
    b.bundle = Some("x".to_string());
    let payload = sync_payload(
        vec![
            make_test_goal("p", None),
            a,
            b,
            make_test_goal("c", Some("p")),
        ],
        vec![],
        vec![],
    );
    goals_sync_impl(&conn, &payload).unwrap();

    // A same-bundle edge (b and a are both bundle "x") that `goals_sync` would
    // reject — inserted directly, as if by an older build or a hand edit.
    conn.execute(
        "INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at) \
         VALUES ('bad', 'b', 'a', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();

    // An unrelated sync — a brand new, valid edge — must still go through
    // despite the pre-existing problem.
    let mut unrelated = sync_payload(vec![], vec![], vec![]);
    unrelated.dependencies = vec![make_test_dependency("e1", "c", "a")];
    goals_sync_impl(&conn, &unrelated).unwrap();

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(state.dependencies.len(), 2);
    assert!(state.dependencies.iter().any(|d| d.id == "bad"));
    assert!(state.dependencies.iter().any(|d| d.id == "e1"));

    // A sync that introduces its OWN new error is still rejected, even while
    // the old one is tolerated.
    let mut broken = sync_payload(vec![], vec![], vec![]);
    broken.dependencies = vec![make_test_dependency("e2", "c", "c")];
    let error = goals_sync_impl(&conn, &broken).expect_err("a new self edge must be rejected");
    assert_eq!(error, "Goal dependency rejected (self): c → c");

    let state = goals_load_impl(&conn).unwrap();
    assert_eq!(
        state.dependencies.len(),
        2,
        "the newly rejected edge must not persist; the old bad edge is untouched"
    );
}

/// `in_review` (a reviewer's verdict is pending) is a goal status the backend
/// stores verbatim: it has no goal-status vocabulary of its own, so the round
/// trip is what "known on the Rust side" means. The vocabulary lives in
/// src/lib/pm/enums.ts.
#[test]
fn test_goal_in_review_survives_save_and_load() {
    let conn = setup_in_memory_db();
    let mut goal = make_test_goal("g1", None);
    goal.status = "in_review".to_string();

    goals_sync_impl(&conn, &sync_payload(vec![goal], vec![], vec![])).unwrap();
    let state = goals_load_impl(&conn).unwrap();

    assert_eq!(state.goals[0].status, "in_review");
    assert_eq!(state.goals[0].achieved_at, None);
}
