use super::*;
use crate::database::*;

#[test]
fn test_requirements_save_and_load_roundtrip() {
    let conn = setup_in_memory_db();
    let payload = RequirementsState {
        requirements: vec![PmRequirement {
            id: "r1".to_string(),
            req_id: "REQ-AUTH-01".to_string(),
            title: "User Login".to_string(),
            description: "Users must be able to log in".to_string(),
            r#type: "functional".to_string(),
            category: "auth".to_string(),
            priority: "high".to_string(),
            status: "draft".to_string(),
            rationale: "Core feature".to_string(),
            acceptance_criteria: "- Can log in with email".to_string(),
            source: "spec.md".to_string(),
            applies_to: "[]".to_string(),
            last_verified_at: None,
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        test_links: vec![],
    };

    requirements_save_impl(&conn, &payload).unwrap();
    let state = requirements_load_impl(&conn).unwrap();

    assert_eq!(state.requirements.len(), 1);
    assert_eq!(state.requirements[0].id, "r1");
    assert_eq!(state.requirements[0].req_id, "REQ-AUTH-01");
    assert_eq!(state.requirements[0].title, "User Login");
    assert_eq!(state.requirements[0].r#type, "functional");
    assert_eq!(state.requirements[0].category, "auth");
    assert_eq!(state.test_links.len(), 0);
}

#[test]
fn test_requirements_clear() {
    let conn = setup_in_memory_db();
    let payload = RequirementsState {
        requirements: vec![PmRequirement {
            id: "r1".to_string(),
            req_id: "REQ-01".to_string(),
            title: "Test".to_string(),
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
        }],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &payload).unwrap();
    requirements_clear_impl(&conn).unwrap();
    let state = requirements_load_impl(&conn).unwrap();
    assert_eq!(state.requirements.len(), 0);
    assert_eq!(state.test_links.len(), 0);
}

#[test]
fn test_requirements_save_replaces_existing() {
    let conn = setup_in_memory_db();
    let payload1 = RequirementsState {
        requirements: vec![PmRequirement {
            id: "r1".to_string(),
            req_id: "REQ-01".to_string(),
            title: "Old".to_string(),
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
        }],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &payload1).unwrap();

    let payload2 = RequirementsState {
        requirements: vec![PmRequirement {
            id: "r2".to_string(),
            req_id: "REQ-02".to_string(),
            title: "New".to_string(),
            description: "".to_string(),
            r#type: "non_functional".to_string(),
            category: "perf".to_string(),
            priority: "critical".to_string(),
            status: "active".to_string(),
            rationale: "".to_string(),
            acceptance_criteria: "".to_string(),
            source: "".to_string(),
            applies_to: r#"["module-a"]"#.to_string(),
            last_verified_at: Some("2026-03-01 00:00:00".to_string()),
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &payload2).unwrap();

    let state = requirements_load_impl(&conn).unwrap();
    assert_eq!(state.requirements.len(), 1);
    assert_eq!(state.requirements[0].id, "r2");
    assert_eq!(state.requirements[0].title, "New");
    assert_eq!(state.requirements[0].applies_to, r#"["module-a"]"#);
    assert_eq!(
        state.requirements[0].last_verified_at,
        Some("2026-03-01 00:00:00".to_string())
    );
}

fn make_test_requirement(id: &str, req_id: &str) -> PmRequirement {
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

#[test]
fn test_requirement_test_links_save_and_load() {
    let conn = setup_in_memory_db();

    // Need a ticket and test case for the FK to work
    let pm_payload = make_test_payload();
    pm_save_impl(&conn, &pm_payload).unwrap();

    let payload = RequirementsState {
        requirements: vec![make_test_requirement("r1", "REQ-01")],
        test_links: vec![PmRequirementTestLink {
            id: "tl1".to_string(),
            requirement_id: "r1".to_string(),
            test_case_id: "tc1".to_string(),
            created_at: "2026-01-01 00:00:00".to_string(),
        }],
    };

    requirements_save_impl(&conn, &payload).unwrap();
    let state = requirements_load_impl(&conn).unwrap();

    assert_eq!(state.requirements.len(), 1);
    assert_eq!(state.test_links.len(), 1);
    assert_eq!(state.test_links[0].id, "tl1");
    assert_eq!(state.test_links[0].requirement_id, "r1");
    assert_eq!(state.test_links[0].test_case_id, "tc1");
}

#[test]
fn test_requirement_test_links_cleared_with_requirements() {
    let conn = setup_in_memory_db();

    let pm_payload = make_test_payload();
    pm_save_impl(&conn, &pm_payload).unwrap();

    let payload = RequirementsState {
        requirements: vec![make_test_requirement("r1", "REQ-01")],
        test_links: vec![PmRequirementTestLink {
            id: "tl1".to_string(),
            requirement_id: "r1".to_string(),
            test_case_id: "tc1".to_string(),
            created_at: "2026-01-01 00:00:00".to_string(),
        }],
    };
    requirements_save_impl(&conn, &payload).unwrap();

    requirements_clear_impl(&conn).unwrap();
    let state = requirements_load_impl(&conn).unwrap();

    assert_eq!(state.requirements.len(), 0);
    assert_eq!(state.test_links.len(), 0);
}

#[test]
fn test_requirement_applies_to_and_last_verified_at_roundtrip() {
    let conn = setup_in_memory_db();

    let mut req = make_test_requirement("r1", "REQ-01");
    req.applies_to = r#"["auth","payments"]"#.to_string();
    req.last_verified_at = Some("2026-03-07 12:00:00".to_string());

    let payload = RequirementsState {
        requirements: vec![req],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &payload).unwrap();
    let state = requirements_load_impl(&conn).unwrap();

    assert_eq!(state.requirements[0].applies_to, r#"["auth","payments"]"#);
    assert_eq!(
        state.requirements[0].last_verified_at,
        Some("2026-03-07 12:00:00".to_string())
    );
}

#[test]
fn test_requirement_last_verified_at_nullable() {
    let conn = setup_in_memory_db();

    let payload = RequirementsState {
        requirements: vec![make_test_requirement("r1", "REQ-01")],
        test_links: vec![],
    };
    requirements_save_impl(&conn, &payload).unwrap();
    let state = requirements_load_impl(&conn).unwrap();

    assert_eq!(state.requirements[0].last_verified_at, None);
}
