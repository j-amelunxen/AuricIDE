//! `documents.asset`: the bytes of a file a document refers to, such as a
//! model or an image (`docs/design-supervisor-link.md`, "Assets"). Read-only
//! and opaque: the link never interprets an asset and never writes one.
//!
//! An asset is visible when one of the project's document types lists a glob
//! under `assets` that matches it. The rules are those of `documents.get`: a
//! project-relative path of plain segments, no symlink out of the project,
//! `rev` limited to commit ids and ref names, and only regular blobs at a rev.
//! On top of that the path a working-tree file *resolves to* must match an
//! asset glob too, so a symlink cannot turn a visible name into any file.

use super::documents::{
    blob_hash, is_valid_id, not_found, path_string, read_at_rev, read_contained_where,
    visible_project, DocumentError, DocumentErrorCode,
};
use super::glob;
use super::policy::{DocumentType, LinkPolicy, ProjectConfig};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub project: String,
    /// The document type whose `assets` globs matched first.
    #[serde(rename = "type")]
    pub document_type: String,
    pub path: String,
    /// The full commit id it was read at; `None` is the working tree.
    pub rev: Option<String>,
    /// As in `documents.get`: whether `HEAD` holds that commit.
    pub merged: Option<bool>,
    pub size: u64,
    /// Hex SHA-256 of the bytes.
    pub sha256: String,
    /// `git hash-object` of the bytes, comparable with a document's `hash`.
    pub hash: String,
    /// Always `base64` (fixture `assets.encoding`).
    pub encoding: &'static str,
    pub data: String,
}

fn asset_type<'c>(config: &'c ProjectConfig, path: &str) -> Option<&'c DocumentType> {
    config.document_types.iter().find(|document_type| {
        document_type
            .assets
            .iter()
            .any(|pattern| glob::matches(pattern, path))
    })
}

fn not_an_asset(path: &str, config: &ProjectConfig) -> DocumentError {
    let globs: Vec<&str> = config
        .document_types
        .iter()
        .flat_map(|t| t.assets.iter().map(String::as_str))
        .collect();
    DocumentError::new(
        DocumentErrorCode::InvalidParams,
        format!(
            "\"{path}\" is not an asset of this project (assets: {})",
            if globs.is_empty() {
                "none".to_string()
            } else {
                globs.join(", ")
            }
        ),
    )
}

/// An asset from the working tree (`rev` absent) or from a commit.
pub fn get(
    policy: &LinkPolicy,
    project: &str,
    path: &str,
    rev: Option<&str>,
) -> Result<Asset, DocumentError> {
    let (root, config) = visible_project(policy, project)?;
    if !is_valid_id(path) {
        return Err(DocumentError::new(
            DocumentErrorCode::InvalidParams,
            format!("\"{path}\" is not a project-relative file path"),
        ));
    }
    let document_type = asset_type(config, path).ok_or_else(|| not_an_asset(path, config))?;
    let cap = usize::try_from(document_type.asset_cap()).unwrap_or(usize::MAX);
    let (bytes, commit, merged) = match rev {
        None => {
            let resolves_to_an_asset =
                |real: &str| is_valid_id(real) && asset_type(config, real).is_some();
            let bytes = read_contained_where(&root, path, cap, resolves_to_an_asset)?
                .ok_or_else(|| not_found(path, None))?;
            (bytes, None, None)
        }
        Some(rev) => {
            let (bytes, commit, merged) = read_at_rev(&root, path, rev, cap)?;
            (bytes, Some(commit), Some(merged))
        }
    };
    let sha256 = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(Asset {
        project: path_string(&root),
        document_type: document_type.name.clone(),
        path: path.to_string(),
        rev: commit,
        merged,
        size: bytes.len() as u64,
        sha256,
        hash: blob_hash(&bytes)?,
        encoding: "base64",
        data: STANDARD.encode(&bytes),
    })
}

#[cfg(test)]
#[path = "assets_tests.rs"]
mod tests;
