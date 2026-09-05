use super::migrations::run_migrations;
use super::types::*;
use rusqlite::Connection;

pub(crate) fn setup_in_memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    conn
}

pub(crate) fn make_test_payload() -> PmSavePayload {
    PmSavePayload {
        epics: vec![PmEpic {
            id: "e1".to_string(),
            name: "Epic One".to_string(),
            description: "First epic".to_string(),
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        tickets: vec![PmTicket {
            id: "t1".to_string(),
            epic_id: "e1".to_string(),
            name: "Ticket One".to_string(),
            description: "First ticket".to_string(),
            status: "open".to_string(),
            status_updated_at: "2026-01-01 00:00:00".to_string(),
            sort_order: 0,
            working_directory: Some("/tmp".to_string()),
            context: Some(vec![PmContextItem {
                id: "c1".to_string(),
                r#type: "snippet".to_string(),
                value: "some context".to_string(),
            }]),
            model_power: Some("high".to_string()),
            priority: "normal".to_string(),
            needs_human_supervision: false,
            goal_id: None,
            due_date: Some("2026-08-20".to_string()),
            skills: vec!["/tdd".to_string(), "/review".to_string()],
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        test_cases: vec![PmTestCase {
            id: "tc1".to_string(),
            ticket_id: "t1".to_string(),
            title: "Test Case One".to_string(),
            body: "Test body".to_string(),
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        dependencies: vec![PmDependency {
            id: "d1".to_string(),
            source_type: "ticket".to_string(),
            source_id: "t1".to_string(),
            target_type: "ticket".to_string(),
            target_id: "t2".to_string(),
        }],
    }
}

pub(crate) fn make_test_requirement(id: &str, req_id: &str) -> PmRequirement {
    PmRequirement {
        id: id.to_string(),
        req_id: req_id.to_string(),
        title: format!("Requirement {}", id),
        description: "".to_string(),
        r#type: "functional".to_string(),
        category: "".to_string(),
        priority: "normal".to_string(),
        status: "draft".to_string(),
        rationale: "".to_string(),
        acceptance_criteria: "".to_string(),
        source: "".to_string(),
        applies_to: "[]".to_string(),
        last_verified_at: None,
        sort_order: 0,
        created_at: "2026-01-01 00:00:00".to_string(),
        updated_at: "2026-01-01 00:00:00".to_string(),
    }
}

pub(crate) fn make_test_goal(id: &str, parent_id: Option<&str>) -> PmGoal {
    PmGoal {
        id: id.to_string(),
        parent_id: parent_id.map(|p| p.to_string()),
        name: format!("Goal {}", id),
        description: "".to_string(),
        success_criteria: "".to_string(),
        status: "draft".to_string(),
        priority: "normal".to_string(),
        goal_prompt: "".to_string(),
        created_by: "ui".to_string(),
        achieved_at: None,
        sort_order: 0,
        created_at: "2026-01-01 00:00:00".to_string(),
        updated_at: "2026-01-01 00:00:00".to_string(),
    }
}

pub(crate) fn sync_payload(
    goals: Vec<PmGoal>,
    goal_runs: Vec<PmGoalRun>,
    requirement_links: Vec<PmGoalRequirementLink>,
) -> GoalsSyncPayload {
    GoalsSyncPayload {
        goals,
        goal_runs,
        requirement_links,
        ..Default::default()
    }
}

pub(crate) fn make_test_station(id: &str, goal_id: &str, sort_order: i32) -> PmGoalStation {
    PmGoalStation {
        id: id.to_string(),
        goal_id: goal_id.to_string(),
        name: "A station".to_string(),
        kind: "normal".to_string(),
        status: "planned".to_string(),
        evidence_kind: "claim".to_string(),
        predicate: "{\"type\":\"undefined\"}".to_string(),
        evidence_note: "".to_string(),
        source_context: "null".to_string(),
        ticket_id: None,
        lane: 0,
        sort_order,
        last_checked_at: None,
        done_at: None,
        created_at: "2026-01-01 00:00:00".to_string(),
        updated_at: "2026-01-01 00:00:00".to_string(),
    }
}

mod goals_tests;
mod kv_tests;
mod pm_tests;
mod requirements_tests;
mod reviews_tests;
mod schema_tests;
