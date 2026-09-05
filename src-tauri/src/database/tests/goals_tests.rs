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
