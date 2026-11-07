use super::*;
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;

const FIXTURES: &str = include_str!("../../../src/lib/agents/capabilityTokens.fixtures.json");
const NOW: u64 = 1_793_750_400_000;
const KIND: &str = "external_run";
const STOP: &str = "external_stop";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn authorize(
    app_data: &Path,
    token: &str,
    kind: &str,
    resource_id: &str,
    action: &str,
    now: u64,
) -> Result<Grant, TokenError> {
    let grant = lookup(app_data, token, now)?;
    grant.check(kind, resource_id, action, now)?;
    Ok(grant)
}

fn request<'a>(resource_id: &'a str, ttl_seconds: u64) -> GrantRequest<'a> {
    GrantRequest {
        kind: KIND,
        resource_id,
        actions: &[STOP],
        owner_run_dir: "/tmp/runs/one",
        ttl_seconds,
    }
}

#[test]
fn the_constants_are_the_contract() {
    let f = fixtures();
    assert_eq!(f["version"], json!(STORE_VERSION));
    assert_eq!(f["storeFileName"], json!(STORE_FILE_NAME));
    assert_eq!(f["lockFileName"], json!(LOCK_FILE_NAME));
    assert_eq!(f["token"]["prefix"], json!(TOKEN_PREFIX));
    assert_eq!(f["token"]["randomBytes"], json!(RANDOM_BYTES));
    assert_eq!(f["limits"]["ttlMinSeconds"], json!(TTL_MIN_SECONDS));
    assert_eq!(f["limits"]["ttlMaxSeconds"], json!(TTL_MAX_SECONDS));
    assert_eq!(f["limits"]["maxPerResource"], json!(MAX_PER_RESOURCE));
    assert_eq!(f["limits"]["maxGrants"], json!(MAX_GRANTS));
    let reasons = f["error"]["reasons"].as_object().unwrap();
    for error in [
        TokenError::Unknown,
        TokenError::Revoked,
        TokenError::Scope,
        TokenError::Limit,
    ] {
        assert!(reasons.contains_key(error.reason().unwrap()), "{error:?}");
    }
}

#[test]
fn every_authorize_case_in_the_contract_holds() {
    for case in fixtures()["authorize"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let g = &case["grant"];
        let grant = Grant {
            id: "cap-1".into(),
            sha256: "00".into(),
            kind: g["kind"].as_str().unwrap().into(),
            resource_id: g["resourceId"].as_str().unwrap().into(),
            actions: serde_json::from_value(g["actions"].clone()).unwrap(),
            owner_run_dir: "/tmp/runs/one".into(),
            issued_at: 0,
            expires_at: g["expiresAt"].as_u64().unwrap(),
            revoked_at: g["revokedAt"].as_u64(),
        };
        let ask = &case["ask"];
        let result = grant.check(
            ask["kind"].as_str().unwrap(),
            ask["resourceId"].as_str().unwrap(),
            ask["action"].as_str().unwrap(),
            case["now"].as_u64().unwrap(),
        );
        let got = match result {
            Ok(()) => "ok",
            Err(error) => error.reason().unwrap(),
        };
        assert_eq!(got, case["result"].as_str().unwrap(), "{name}");
    }
}

#[test]
fn the_token_shape_is_the_contract() {
    let f = fixtures();
    for token in f["tokenShape"]["accept"].as_array().unwrap() {
        assert!(valid_shape(token.as_str().unwrap()), "{token}");
    }
    for token in f["tokenShape"]["reject"].as_array().unwrap() {
        assert!(!valid_shape(token.as_str().unwrap()), "{token}");
    }
    let pattern = regex::Regex::new(f["token"]["pattern"].as_str().unwrap()).unwrap();
    for _ in 0..20 {
        let token = random_token().unwrap();
        assert!(valid_shape(token.expose()));
        assert!(pattern.is_match(token.expose()));
    }
}

#[test]
fn an_issued_token_opens_its_grant_and_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let issued = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    let token = issued.token.expose();
    assert_eq!(issued.grant.expires_at, NOW + 3_600_000);
    let grant = authorize(dir.path(), token, KIND, "ext-1", STOP, NOW + 1).unwrap();
    assert_eq!(grant.owner_run_dir, "/tmp/runs/one");
    let wrong_run = authorize(dir.path(), token, KIND, "ext-2", STOP, NOW + 1);
    assert_eq!(wrong_run.unwrap_err(), TokenError::Scope);
    let wrong_action = authorize(
        dir.path(),
        token,
        KIND,
        "ext-1",
        "external_register",
        NOW + 1,
    );
    assert_eq!(wrong_action.unwrap_err(), TokenError::Scope);
    let expired = authorize(dir.path(), token, KIND, "ext-1", STOP, NOW + 3_600_000);
    assert_eq!(expired.unwrap_err(), TokenError::Unknown);
    // One changed character is another, unknown token.
    let mut forged = token.to_string();
    let last = forged.pop().unwrap();
    forged.push(if last == 'A' { 'B' } else { 'A' });
    assert_eq!(
        lookup(dir.path(), &forged, NOW).unwrap_err(),
        TokenError::Unknown
    );
    assert_eq!(
        lookup(dir.path(), "not a token", NOW).unwrap_err(),
        TokenError::Unknown
    );
}

#[test]
fn only_the_hash_is_stored_and_the_file_is_private() {
    let dir = tempfile::tempdir().unwrap();
    let issued = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    let path = store_path_in(dir.path());
    let text = std::fs::read_to_string(&path).unwrap();
    let secret = issued.token.expose();
    assert!(!text.contains(secret));
    assert!(!text.contains(&secret[TOKEN_PREFIX.len()..]));
    assert!(text.contains(&sha256_hex(secret)));
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn a_token_never_prints_itself() {
    let dir = tempfile::tempdir().unwrap();
    let issued = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    let printed = format!("{issued:?} {:?}", issued.token);
    assert!(!printed.contains(issued.token.expose()));
    assert!(printed.contains("[redacted]"));
    // Serialising is how the one answer carries it, so that must keep it.
    assert_eq!(
        serde_json::to_value(&issued.token).unwrap(),
        json!(issued.token.expose())
    );
}

#[test]
fn revoking_a_resource_ends_every_token_on_it_and_no_other() {
    let dir = tempfile::tempdir().unwrap();
    let first = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    let second = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    let other = issue(dir.path(), request("ext-2", 3600), NOW).unwrap();
    assert_eq!(
        revoke_resource(dir.path(), KIND, "ext-1", NOW + 5).unwrap(),
        2
    );
    for token in [&first.token, &second.token] {
        assert_eq!(
            lookup(dir.path(), token.expose(), NOW + 6).unwrap_err(),
            TokenError::Revoked
        );
    }
    assert!(lookup(dir.path(), other.token.expose(), NOW + 6).is_ok());
    assert_eq!(
        revoke_resource(dir.path(), KIND, "ext-1", NOW + 7).unwrap(),
        0
    );
    // The tombstone goes when the grant would have expired.
    assert_eq!(
        lookup(dir.path(), first.token.expose(), NOW + 3_600_000).unwrap_err(),
        TokenError::Unknown
    );
}

#[test]
fn revoking_with_no_store_creates_nothing() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(revoke_resource(dir.path(), KIND, "ext-1", NOW).unwrap(), 0);
    assert!(std::fs::read_dir(dir.path()).unwrap().next().is_none());
}

#[test]
fn expired_grants_are_pruned_on_the_next_write() {
    let dir = tempfile::tempdir().unwrap();
    issue(dir.path(), request("ext-1", 60), NOW).unwrap();
    issue(dir.path(), request("ext-2", 3600), NOW + 61_000).unwrap();
    let file = read(dir.path()).unwrap();
    assert_eq!(file.grants.len(), 1);
    assert_eq!(file.grants[0].resource_id, "ext-2");
}

#[test]
fn a_resource_keeps_its_newest_grants_only() {
    let dir = tempfile::tempdir().unwrap();
    let first = issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    for _ in 0..MAX_PER_RESOURCE {
        issue(dir.path(), request("ext-1", 3600), NOW).unwrap();
    }
    assert_eq!(read(dir.path()).unwrap().grants.len(), MAX_PER_RESOURCE);
    assert_eq!(
        lookup(dir.path(), first.token.expose(), NOW).unwrap_err(),
        TokenError::Unknown
    );
}

#[test]
fn a_full_store_drops_tombstones_before_it_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let grant = |i: usize, revoked: bool| Grant {
        id: format!("cap-{i}"),
        sha256: format!("{i:064x}"),
        kind: KIND.into(),
        resource_id: format!("ext-{i}"),
        actions: vec![STOP.into()],
        owner_run_dir: "/tmp/runs/one".into(),
        issued_at: NOW,
        expires_at: NOW + 3_600_000,
        revoked_at: revoked.then_some(NOW),
    };
    let full = TokenFile {
        version: STORE_VERSION,
        grants: (0..MAX_GRANTS).map(|i| grant(i, i == 3)).collect(),
    };
    write_json_atomic(&store_path_in(dir.path()), &full).unwrap();
    issue(dir.path(), request("ext-new", 3600), NOW).unwrap();
    let file = read(dir.path()).unwrap();
    assert_eq!(file.grants.len(), MAX_GRANTS);
    assert!(!file.grants.iter().any(|g| g.id == "cap-3"));
    let refused = issue(dir.path(), request("ext-newer", 3600), NOW);
    assert_eq!(refused.unwrap_err(), TokenError::Limit);
}

#[test]
fn a_lifetime_outside_the_bounds_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    for ttl in [TTL_MIN_SECONDS - 1, TTL_MAX_SECONDS + 1] {
        let refused = issue(dir.path(), request("ext-1", ttl), NOW);
        assert_eq!(refused.unwrap_err(), TokenError::InvalidTtl, "{ttl}");
    }
    assert!(!store_path_in(dir.path()).exists());
}

#[test]
fn an_unreadable_store_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(store_path_in(dir.path()), "{ not json").unwrap();
    assert!(matches!(
        issue(dir.path(), request("ext-1", 3600), NOW),
        Err(TokenError::Unreadable(_))
    ));
    assert_eq!(
        std::fs::read_to_string(store_path_in(dir.path())).unwrap(),
        "{ not json"
    );
}
