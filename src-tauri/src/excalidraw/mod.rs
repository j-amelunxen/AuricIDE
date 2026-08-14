//! Excalidraw+ integration: contract (single source of truth for the beta
//! REST API), HTTP client with pagination, a fixture-backed mock lane
//! (`AURIC_EXCALIDRAW_MOCK=1`) for CI/offline work, and the impls behind the
//! Tauri commands. Only `fetch_json` touches the network; everything else is
//! pure and covered by `cargo test --lib`.

pub mod contract;

use crate::database::{kv_get, DatabaseState};
use contract::{
    parse_paged, scene_content_to_file_json, ApiCollection, ApiScene, Collection, ExcalidrawError,
    Paged, SceneSummary,
};
use serde::de::DeserializeOwned;
use tauri::State;

const MAX_PAGES: usize = 20;

const FIXTURE_COLLECTIONS: &str = include_str!("../../../fixtures/excalidraw/collections.json");
const FIXTURE_SCENES: &str = include_str!("../../../fixtures/excalidraw/scenes.json");
const FIXTURE_SCENE_CONTENT: &str = include_str!("../../../fixtures/excalidraw/scene-content.json");

/// Mock lane: serve the contract-validated fixtures instead of HTTP.
/// Deliberately kept alive next to the real integration — it is the
/// deterministic CI/regression/offline anchor.
pub fn mock_enabled() -> bool {
    std::env::var("AURIC_EXCALIDRAW_MOCK")
        .map(|v| is_mock_value(&v))
        .unwrap_or(false)
}

fn is_mock_value(value: &str) -> bool {
    value == "1"
}

/// The key is application-wide, so a project that never configured one still
/// works; a project that set its own still wins.
fn read_api_key(
    db_state: &State<'_, DatabaseState>,
    credentials: &State<'_, crate::app_config::AppCredentialsState>,
    project_path: &str,
) -> Result<String, ExcalidrawError> {
    let global = crate::app_config::global_namespace(credentials.path(), "excalidraw_settings")
        .get("api_key")
        .cloned();

    // No project database is no longer a reason to give up — it only means
    // this project overrides nothing.
    let project = {
        let connections = db_state.connections.lock().unwrap();
        match connections.get(project_path) {
            Some(conn) => kv_get(conn, "excalidraw_settings", "api_key")
                .map_err(|detail| ExcalidrawError::Network { detail })?,
            None => None,
        }
    };

    crate::app_config::resolve_credential(global, project).ok_or(ExcalidrawError::NotConfigured)
}

fn build_query_path(path: &str, offset: usize) -> String {
    let separator = if path.contains('?') { '&' } else { '?' };
    format!("{path}{separator}limit=100&offset={offset}")
}

async fn fetch_json(api_key: &str, path: &str, endpoint: &str) -> Result<String, ExcalidrawError> {
    let network = |detail: String| ExcalidrawError::Network { detail };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| network(e.to_string()))?;
    let response = client
        .get(format!("{}{}", contract::API_BASE, path))
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| network(e.to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(contract::map_status(status, endpoint));
    }
    response.text().await.map_err(|e| network(e.to_string()))
}

async fn fetch_all_pages<T: DeserializeOwned>(
    api_key: &str,
    base_path: &str,
    endpoint: &str,
) -> Result<Vec<T>, ExcalidrawError> {
    let mut pages: Vec<Paged<T>> = Vec::new();
    let mut offset = 0usize;
    for _ in 0..MAX_PAGES {
        let body = fetch_json(api_key, &build_query_path(base_path, offset), endpoint).await?;
        let page: Paged<T> = parse_paged(endpoint, &body)?;
        let count = page.data.len();
        let has_next = page.has_next_page;
        pages.push(page);
        offset += count;
        if !has_next || count == 0 {
            break;
        }
    }
    Ok(contract::merge_pages(pages))
}

// ---------------------------------------------------------------------------
// Mock lane (pure, fixture-backed — used when AURIC_EXCALIDRAW_MOCK=1)
// ---------------------------------------------------------------------------

fn mock_collections() -> Result<Vec<Collection>, ExcalidrawError> {
    let paged: Paged<ApiCollection> = parse_paged("GET /collections (mock)", FIXTURE_COLLECTIONS)?;
    Ok(contract::normalize_collections(paged.data))
}

fn mock_scenes(collection_id: &str) -> Result<Vec<SceneSummary>, ExcalidrawError> {
    let paged: Paged<ApiScene> = parse_paged("GET /scenes (mock)", FIXTURE_SCENES)?;
    Ok(contract::normalize_scenes(paged.data)
        .into_iter()
        .filter(|s| s.collection_id.as_deref() == Some(collection_id))
        .collect())
}

fn mock_scene_content() -> Result<String, ExcalidrawError> {
    scene_content_to_file_json("GET /scenes/{id}/content (mock)", FIXTURE_SCENE_CONTENT)
}

// ---------------------------------------------------------------------------
// Command impls (thin #[tauri::command] wrappers live in lib.rs)
// ---------------------------------------------------------------------------

pub async fn test_connection_impl(
    project_path: &str,
    db_state: State<'_, DatabaseState>,
    credentials: State<'_, crate::app_config::AppCredentialsState>,
) -> Result<String, String> {
    if mock_enabled() {
        return Ok("Connected to Excalidraw+ (mock) — 2 collections visible".to_string());
    }
    let api_key = read_api_key(&db_state, &credentials, project_path).map_err(|e| e.to_string())?;
    let endpoint = "GET /collections";
    let body = fetch_json(&api_key, "/collections?limit=100", endpoint)
        .await
        .map_err(|e| e.to_string())?;
    let page: Paged<ApiCollection> = parse_paged(endpoint, &body).map_err(|e| e.to_string())?;
    let suffix = if page.has_next_page { "+" } else { "" };
    Ok(format!(
        "Connected to Excalidraw+ — {}{suffix} collection(s) visible",
        page.data.len()
    ))
}

pub async fn list_collections_impl(
    project_path: &str,
    db_state: State<'_, DatabaseState>,
    credentials: State<'_, crate::app_config::AppCredentialsState>,
) -> Result<Vec<Collection>, String> {
    if mock_enabled() {
        return mock_collections().map_err(|e| e.to_string());
    }
    let api_key = read_api_key(&db_state, &credentials, project_path).map_err(|e| e.to_string())?;
    let raw: Vec<ApiCollection> = fetch_all_pages(&api_key, "/collections", "GET /collections")
        .await
        .map_err(|e| e.to_string())?;
    Ok(contract::normalize_collections(raw))
}

pub async fn list_scenes_impl(
    project_path: &str,
    collection_id: &str,
    db_state: State<'_, DatabaseState>,
    credentials: State<'_, crate::app_config::AppCredentialsState>,
) -> Result<Vec<SceneSummary>, String> {
    if mock_enabled() {
        return mock_scenes(collection_id).map_err(|e| e.to_string());
    }
    let api_key = read_api_key(&db_state, &credentials, project_path).map_err(|e| e.to_string())?;
    let endpoint = "GET /scenes";
    let raw: Vec<ApiScene> = fetch_all_pages(
        &api_key,
        &format!("/scenes?collectionId={collection_id}"),
        endpoint,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(contract::normalize_scenes(raw))
}

pub async fn get_scene_content_impl(
    project_path: &str,
    scene_id: &str,
    db_state: State<'_, DatabaseState>,
    credentials: State<'_, crate::app_config::AppCredentialsState>,
) -> Result<String, String> {
    if mock_enabled() {
        return mock_scene_content().map_err(|e| e.to_string());
    }
    let api_key = read_api_key(&db_state, &credentials, project_path).map_err(|e| e.to_string())?;
    let endpoint = "GET /scenes/{sceneId}/content";
    let body = fetch_json(&api_key, &format!("/scenes/{scene_id}/content"), endpoint)
        .await
        .map_err(|e| e.to_string())?;
    scene_content_to_file_json(endpoint, &body).map_err(|e| e.to_string())
}

/// Web URL for "Open in Excalidraw+" — see contract::scene_web_url for the
/// one-place-to-fix caveat.
pub fn scene_url_impl(workspace_id: Option<&str>, scene_id: &str) -> String {
    contract::scene_web_url(workspace_id, scene_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_path_appends_pagination_with_the_right_separator() {
        assert_eq!(
            build_query_path("/collections", 0),
            "/collections?limit=100&offset=0"
        );
        assert_eq!(
            build_query_path("/scenes?collectionId=col_1", 200),
            "/scenes?collectionId=col_1&limit=100&offset=200"
        );
    }

    #[test]
    fn mock_collections_serve_the_normalized_fixture() {
        let collections = mock_collections().unwrap();
        assert_eq!(collections.len(), 2);
        assert_eq!(collections[0].id, "col_arch");
        assert_eq!(collections[1].name, "Flow Specs");
    }

    #[test]
    fn mock_scenes_filter_by_collection() {
        let scenes = mock_scenes("col_flows").unwrap();
        assert_eq!(scenes.len(), 2);
        assert!(mock_scenes("col_arch").unwrap().is_empty());
    }

    #[test]
    fn mock_scene_content_is_a_valid_excalidraw_file() {
        let file = mock_scene_content().unwrap();
        let value: serde_json::Value = serde_json::from_str(&file).unwrap();
        assert_eq!(value["type"], "excalidraw");
        assert!(value["elements"].is_array());
        assert!(value["appState"]["collaborators"].is_null());
    }

    #[test]
    fn mock_flag_only_accepts_exactly_1() {
        assert!(is_mock_value("1"));
        assert!(!is_mock_value("true"));
        assert!(!is_mock_value("0"));
        assert!(!is_mock_value(""));
    }
}
