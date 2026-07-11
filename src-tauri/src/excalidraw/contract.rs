//! Contract for the Excalidraw+ REST API (public beta).
//!
//! This module is the single source of truth for what we expect from
//! `api.excalidraw.com`. Raw response shapes live here, all validation
//! happens here, and the frontend only ever sees the normalized types.
//! The fixtures under `fixtures/excalidraw/` are validated against this
//! contract in the tests below — the mock lane and the real client can
//! therefore never drift apart silently. The API is beta: unknown fields
//! are tolerated (no `deny_unknown_fields`), but a missing or mistyped
//! field we DO consume fails loudly with the endpoint + field path.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub const API_BASE: &str = "https://api.excalidraw.com/api/v1";

/// Error taxonomy for the Excalidraw+ boundary. `Display` renders a stable
/// machine-readable prefix (`EXCALIDRAW_*:`) so the frontend can branch on
/// the error class while the rest of the message stays human-readable and
/// names exactly which system and field broke.
#[derive(Debug, Clone, PartialEq)]
pub enum ExcalidrawError {
    NotConfigured,
    Auth { status: u16 },
    NotFound { endpoint: String },
    RateLimited,
    Http { status: u16, endpoint: String },
    Network { detail: String },
    Contract { endpoint: String, detail: String },
}

impl std::fmt::Display for ExcalidrawError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExcalidrawError::NotConfigured => write!(
                f,
                "EXCALIDRAW_NOT_CONFIGURED: no Excalidraw+ API key — add one in Settings → Excalidraw+"
            ),
            ExcalidrawError::Auth { status } => write!(
                f,
                "EXCALIDRAW_AUTH: Excalidraw+ rejected the API key (HTTP {status})"
            ),
            ExcalidrawError::NotFound { endpoint } => write!(
                f,
                "EXCALIDRAW_NOT_FOUND: {endpoint} — resource does not exist (deleted on Excalidraw+?)"
            ),
            ExcalidrawError::RateLimited => write!(
                f,
                "EXCALIDRAW_RATE_LIMITED: Excalidraw+ rate limit hit — try again shortly"
            ),
            ExcalidrawError::Http { status, endpoint } => {
                write!(f, "EXCALIDRAW_HTTP: {endpoint} returned HTTP {status}")
            }
            ExcalidrawError::Network { detail } => {
                write!(f, "EXCALIDRAW_NETWORK: {detail}")
            }
            ExcalidrawError::Contract { endpoint, detail } => {
                write!(f, "EXCALIDRAW_CONTRACT: Excalidraw API {endpoint}: {detail}")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Raw API shapes (only the fields we consume; beta API may add more freely)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct Paged<T> {
    #[serde(default, rename = "hasNextPage")]
    pub has_next_page: bool,
    pub data: Vec<T>,
}

#[derive(Debug, Deserialize)]
pub struct ApiEmoji {
    pub native: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApiCollection {
    pub id: String,
    pub name: String,
    pub updated: Option<String>,
    #[serde(default)]
    pub emoji: Option<ApiEmoji>,
}

/// Reality check (2026-07-10, live API): the documented flat scene object is
/// actually wrapped — each item is `{ metadata: {...}, readOnlyLinks: [...],
/// sharedSlidesLinks: [...] }`. The fixtures mirror the live shape.
#[derive(Debug, Deserialize)]
pub struct ApiScene {
    pub metadata: ApiSceneMetadata,
}

#[derive(Debug, Deserialize)]
pub struct ApiSceneMetadata {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default, rename = "previewUrl")]
    pub preview_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Normalized shapes (what the IPC layer returns to the frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub emoji: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneSummary {
    pub id: String,
    pub name: String,
    pub collection_id: Option<String>,
    pub workspace_id: Option<String>,
    pub updated_at: Option<String>,
    pub preview_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Parsing / validation / normalization (pure, fixture-tested)
// ---------------------------------------------------------------------------

/// Deserialize a paged API response, reporting contract violations with the
/// exact field path (e.g. `data[0].id`) via `serde_path_to_error`.
pub fn parse_paged<T: DeserializeOwned>(
    endpoint: &str,
    body: &str,
) -> Result<Paged<T>, ExcalidrawError> {
    let deserializer = &mut serde_json::Deserializer::from_str(body);
    serde_path_to_error::deserialize(deserializer).map_err(|e| ExcalidrawError::Contract {
        endpoint: endpoint.to_string(),
        detail: format!("field '{}' — {}", e.path(), e.inner()),
    })
}

pub fn normalize_collections(raw: Vec<ApiCollection>) -> Vec<Collection> {
    raw.into_iter()
        .map(|c| Collection {
            id: c.id,
            name: c.name,
            emoji: c.emoji.and_then(|e| e.native),
            updated_at: c.updated,
        })
        .collect()
}

pub fn normalize_scenes(raw: Vec<ApiScene>) -> Vec<SceneSummary> {
    raw.into_iter()
        .map(|s| SceneSummary {
            id: s.metadata.id,
            name: s.metadata.name,
            collection_id: s.metadata.collection,
            workspace_id: s.metadata.workspace,
            updated_at: s.metadata.updated,
            preview_url: s.metadata.preview_url,
        })
        .collect()
}

pub fn merge_pages<T>(pages: Vec<Paged<T>>) -> Vec<T> {
    pages.into_iter().flat_map(|p| p.data).collect()
}

/// Validate a scene-content response and turn it into ready-to-write
/// `.excalidraw` file JSON: standard envelope, `source` stamped, transient
/// server state (`collaborators`, `sceneVersion`, `filesFailedToEmbed`)
/// stripped so the snapshot opens cleanly in any Excalidraw tool.
pub fn scene_content_to_file_json(endpoint: &str, body: &str) -> Result<String, ExcalidrawError> {
    let contract_err = |detail: String| ExcalidrawError::Contract {
        endpoint: endpoint.to_string(),
        detail,
    };

    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| contract_err(format!("invalid JSON — {e}")))?;
    let obj = value
        .as_object()
        .ok_or_else(|| contract_err("expected a JSON object".to_string()))?;

    let elements = obj
        .get("elements")
        .ok_or_else(|| contract_err("field 'elements' — missing".to_string()))?;
    if !elements.is_array() {
        return Err(contract_err(format!(
            "field 'elements' — expected array, got {}",
            json_type_name(elements)
        )));
    }

    let mut app_state = obj
        .get("appState")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(state) = app_state.as_object_mut() {
        state.remove("collaborators");
    }

    let version = obj.get("version").and_then(|v| v.as_u64()).unwrap_or(2);
    let files = obj
        .get("files")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    let file = serde_json::json!({
        "type": "excalidraw",
        "version": version,
        "source": "https://plus.excalidraw.com",
        "elements": elements,
        "appState": app_state,
        "files": files,
    });

    serde_json::to_string_pretty(&file)
        .map_err(|e| contract_err(format!("could not serialize snapshot — {e}")))
}

fn json_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Map an HTTP error status to the taxonomy.
pub fn map_status(status: u16, endpoint: &str) -> ExcalidrawError {
    match status {
        401 | 403 => ExcalidrawError::Auth { status },
        404 => ExcalidrawError::NotFound {
            endpoint: endpoint.to_string(),
        },
        429 => ExcalidrawError::RateLimited,
        _ => ExcalidrawError::Http {
            status,
            endpoint: endpoint.to_string(),
        },
    }
}

/// Best-known Excalidraw+ web URL for a scene. The API does not document a
/// web URL field, so this is the ONE place to correct once verified against
/// a real workspace; callers also offer copy-to-clipboard as a fallback.
pub fn scene_web_url(workspace_id: Option<&str>, scene_id: &str) -> String {
    match workspace_id {
        Some(ws) => format!("https://app.excalidraw.com/s/{ws}/{scene_id}"),
        None => "https://app.excalidraw.com/".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLLECTIONS: &str = include_str!("../../../fixtures/excalidraw/collections.json");
    const COLLECTIONS_NORMALIZED: &str =
        include_str!("../../../fixtures/excalidraw/collections.normalized.json");
    const COLLECTIONS_MISSING_ID: &str =
        include_str!("../../../fixtures/excalidraw/collections.missing-id.json");
    const COLLECTIONS_PAGE1: &str =
        include_str!("../../../fixtures/excalidraw/collections.page1.json");
    const COLLECTIONS_PAGE2: &str =
        include_str!("../../../fixtures/excalidraw/collections.page2.json");
    const SCENES: &str = include_str!("../../../fixtures/excalidraw/scenes.json");
    const SCENES_NORMALIZED: &str =
        include_str!("../../../fixtures/excalidraw/scenes.normalized.json");
    const SCENES_WRONG_TYPE: &str =
        include_str!("../../../fixtures/excalidraw/scenes.wrong-type.json");
    const SCENE_CONTENT: &str = include_str!("../../../fixtures/excalidraw/scene-content.json");
    const SCENE_CONTENT_NORMALIZED: &str =
        include_str!("../../../fixtures/excalidraw/scene-content.normalized.json");
    const SCENE_CONTENT_MALFORMED: &str =
        include_str!("../../../fixtures/excalidraw/scene-content.malformed.json");

    fn as_value<T: Serialize>(value: &T) -> serde_json::Value {
        serde_json::to_value(value).expect("serializable")
    }

    #[test]
    fn parses_collections_happy_path() {
        let paged: Paged<ApiCollection> = parse_paged("GET /collections", COLLECTIONS).unwrap();
        assert!(!paged.has_next_page);
        assert_eq!(paged.data.len(), 2);
        assert_eq!(paged.data[0].id, "col_arch");
        assert_eq!(paged.data[1].name, "Flow Specs");
    }

    #[test]
    fn normalized_collections_match_the_shared_fixture() {
        let paged: Paged<ApiCollection> = parse_paged("GET /collections", COLLECTIONS).unwrap();
        let normalized = normalize_collections(paged.data);
        let fixture: serde_json::Value = serde_json::from_str(COLLECTIONS_NORMALIZED).unwrap();
        assert_eq!(as_value(&normalized), fixture);
    }

    #[test]
    fn missing_collection_id_is_a_precise_contract_violation() {
        let err = parse_paged::<ApiCollection>("GET /collections", COLLECTIONS_MISSING_ID)
            .expect_err("must fail");
        let message = err.to_string();
        assert!(message.starts_with("EXCALIDRAW_CONTRACT:"), "{message}");
        assert!(message.contains("GET /collections"), "{message}");
        assert!(message.contains("data[0].id"), "{message}");
    }

    #[test]
    fn parses_scenes_happy_path() {
        let paged: Paged<ApiScene> =
            parse_paged("GET /scenes?collectionId=col_flows", SCENES).unwrap();
        assert_eq!(paged.data.len(), 2);
        assert_eq!(
            paged.data[0].metadata.preview_url.as_deref(),
            Some("https://plus.excalidraw.com/previews/scn_checkout.png")
        );
        assert_eq!(paged.data[1].metadata.preview_url, None);
    }

    #[test]
    fn normalized_scenes_match_the_shared_fixture() {
        let paged: Paged<ApiScene> =
            parse_paged("GET /scenes?collectionId=col_flows", SCENES).unwrap();
        let normalized = normalize_scenes(paged.data);
        let fixture: serde_json::Value = serde_json::from_str(SCENES_NORMALIZED).unwrap();
        assert_eq!(as_value(&normalized), fixture);
    }

    #[test]
    fn mistyped_scene_name_is_a_precise_contract_violation() {
        let err = parse_paged::<ApiScene>("GET /scenes", SCENES_WRONG_TYPE).expect_err("must fail");
        let message = err.to_string();
        assert!(message.starts_with("EXCALIDRAW_CONTRACT:"), "{message}");
        assert!(message.contains("data[0].metadata.name"), "{message}");
    }

    #[test]
    fn merges_pages_in_order() {
        let page1: Paged<ApiCollection> =
            parse_paged("GET /collections", COLLECTIONS_PAGE1).unwrap();
        let page2: Paged<ApiCollection> =
            parse_paged("GET /collections", COLLECTIONS_PAGE2).unwrap();
        assert!(page1.has_next_page);
        assert!(!page2.has_next_page);
        let merged = merge_pages(vec![page1, page2]);
        let ids: Vec<&str> = merged.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["col_a", "col_b", "col_c"]);
    }

    #[test]
    fn scene_content_becomes_a_clean_excalidraw_file() {
        let file = scene_content_to_file_json("GET /scenes/scn_1/content", SCENE_CONTENT).unwrap();
        let produced: serde_json::Value = serde_json::from_str(&file).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(SCENE_CONTENT_NORMALIZED).unwrap();
        assert_eq!(produced, fixture);
    }

    #[test]
    fn scene_content_strips_collaborators() {
        let file = scene_content_to_file_json("GET /scenes/scn_1/content", SCENE_CONTENT).unwrap();
        assert!(!file.contains("collaborators"));
    }

    #[test]
    fn malformed_scene_content_names_the_field() {
        let err = scene_content_to_file_json("GET /scenes/scn_1/content", SCENE_CONTENT_MALFORMED)
            .expect_err("must fail");
        let message = err.to_string();
        assert!(message.starts_with("EXCALIDRAW_CONTRACT:"), "{message}");
        assert!(message.contains("'elements'"), "{message}");
        assert!(message.contains("expected array, got string"), "{message}");
    }

    #[test]
    fn status_codes_map_to_the_taxonomy() {
        assert_eq!(
            map_status(401, "GET /collections"),
            ExcalidrawError::Auth { status: 401 }
        );
        assert_eq!(
            map_status(403, "GET /collections"),
            ExcalidrawError::Auth { status: 403 }
        );
        assert_eq!(
            map_status(404, "GET /scenes/x"),
            ExcalidrawError::NotFound {
                endpoint: "GET /scenes/x".to_string()
            }
        );
        assert_eq!(map_status(429, "GET /scenes"), ExcalidrawError::RateLimited);
        assert_eq!(
            map_status(500, "GET /scenes"),
            ExcalidrawError::Http {
                status: 500,
                endpoint: "GET /scenes".to_string()
            }
        );
    }

    #[test]
    fn error_display_uses_stable_prefixes() {
        assert!(ExcalidrawError::NotConfigured
            .to_string()
            .starts_with("EXCALIDRAW_NOT_CONFIGURED:"));
        assert!(ExcalidrawError::Auth { status: 401 }
            .to_string()
            .starts_with("EXCALIDRAW_AUTH:"));
        assert!(ExcalidrawError::RateLimited
            .to_string()
            .starts_with("EXCALIDRAW_RATE_LIMITED:"));
        assert!(ExcalidrawError::Network {
            detail: "offline".into()
        }
        .to_string()
        .starts_with("EXCALIDRAW_NETWORK:"));
    }

    #[test]
    fn scene_web_url_has_one_fixable_shape() {
        assert_eq!(
            scene_web_url(Some("ws_1"), "scn_1"),
            "https://app.excalidraw.com/s/ws_1/scn_1"
        );
        assert_eq!(scene_web_url(None, "scn_1"), "https://app.excalidraw.com/");
    }
}
