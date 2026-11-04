//! Persistence and expiry pruning for `<app_data_dir>/quota-blocks.json`.

use super::matcher::resolve_manual_until;
use super::{parse_scope_pattern, QuotaBlock, QuotaBlockReason};
use crate::supervisor::policy::normalize_provider_id;
use crate::supervisor::write_json_atomic;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

pub const QUOTA_BLOCKS_FILE_NAME: &str = "quota-blocks.json";
pub const DEFAULT_QUOTA_BLOCK_TTL_MINUTES: u32 = 60;
pub const QUOTA_BLOCKS_UPDATED_EVENT: &str = "quota-blocks-updated";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBlocksFile {
    pub version: u64,
    pub default_ttl_minutes: u32,
    pub blocks: Vec<QuotaBlock>,
}

impl Default for QuotaBlocksFile {
    fn default() -> Self {
        Self {
            version: 1,
            default_ttl_minutes: DEFAULT_QUOTA_BLOCK_TTL_MINUTES,
            blocks: Vec::new(),
        }
    }
}

pub fn blocks_path_in(app_data: &Path) -> PathBuf {
    app_data.join(QUOTA_BLOCKS_FILE_NAME)
}

/// Reads `<app_data>/quota-blocks.json` and prunes any blocks whose `expires_at`
/// is at or before `now`.
pub fn read_blocks_at(app_data: &Path, now: DateTime<Utc>) -> QuotaBlocksFile {
    let path = blocks_path_in(app_data);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return QuotaBlocksFile::default();
    };
    let Ok(mut parsed) = serde_json::from_str::<QuotaBlocksFile>(&raw) else {
        return QuotaBlocksFile::default();
    };
    if parsed.version != 1 {
        return QuotaBlocksFile::default();
    }
    if parsed.default_ttl_minutes == 0 {
        parsed.default_ttl_minutes = DEFAULT_QUOTA_BLOCK_TTL_MINUTES;
    }
    let before = parsed.blocks.len();
    parsed.blocks.retain(|block| block.is_active_at(now));
    if parsed.blocks.len() != before {
        let _ = write_json_atomic(&path, &parsed);
    }
    parsed
}

/// Active quota blocks as of right now.
pub fn active_blocks(app_data: &Path) -> Vec<QuotaBlock> {
    read_blocks_at(app_data, Utc::now()).blocks
}

/// Inserts or replaces a block with the same `id`, pruning expired entries and
/// persisting atomically at mode 0600.
pub fn upsert_block_at(
    app_data: &Path,
    block: QuotaBlock,
    now: DateTime<Utc>,
) -> Result<QuotaBlocksFile, String> {
    let mut file = read_blocks_at(app_data, now);
    file.blocks.retain(|existing| existing.id != block.id);
    if block.is_active_at(now) {
        file.blocks.push(block);
        file.blocks.sort_by(|a, b| a.id.cmp(&b.id));
    }
    write_json_atomic(&blocks_path_in(app_data), &file)?;
    Ok(file)
}

/// Stores a block the matcher found, unless a block with the same `id` already
/// runs at least as long: a later detection must not shorten a reset time or a
/// manual block. Returns whether the file changed.
pub fn record_detected_block_at(
    app_data: &Path,
    block: QuotaBlock,
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let expiry = |candidate: &QuotaBlock| DateTime::parse_from_rfc3339(&candidate.expires_at).ok();
    let already_covered = read_blocks_at(app_data, now)
        .blocks
        .iter()
        .any(|existing| existing.id == block.id && expiry(existing) >= expiry(&block));
    if already_covered {
        return Ok(false);
    }
    upsert_block_at(app_data, block, now)?;
    Ok(true)
}

/// Creates or updates a manual block for `provider` and optional `scope`
/// (`None` / `"*"` for whole provider, `"claude-*"` for family, or a model ID).
pub fn set_manual_block_at(
    app_data: &Path,
    provider: &str,
    scope_pattern: Option<&str>,
    until: Option<&str>,
    duration_minutes: Option<u32>,
    reason_note: Option<&str>,
    now: DateTime<Utc>,
) -> Result<QuotaBlocksFile, String> {
    let norm_provider = normalize_provider_id(provider);
    if norm_provider.is_empty() {
        return Err("provider must not be empty".to_string());
    }
    let current = read_blocks_at(app_data, now);
    let expires_dt =
        resolve_manual_until(until, duration_minutes, current.default_ttl_minutes, now)?;
    let scope = parse_scope_pattern(scope_pattern);
    let detail = reason_note
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Set manually")
        .to_string();
    let block = QuotaBlock {
        id: QuotaBlock::make_id(&norm_provider, &scope),
        provider: norm_provider,
        scope,
        reason: QuotaBlockReason::Manual,
        detail,
        detected_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
        expires_at: expires_dt.to_rfc3339_opts(SecondsFormat::Secs, true),
        source_agent_id: None,
    };
    upsert_block_at(app_data, block, now)
}

/// Removes a block by its `id` (or shorthand `<provider>:<scope>` or bare
/// `provider` ID) and writes the updated file. Returns the updated file and
/// whether at least one block was removed.
pub fn clear_block_with_status_at(
    app_data: &Path,
    id_or_provider: &str,
    now: DateTime<Utc>,
) -> Result<(QuotaBlocksFile, bool), String> {
    let target = id_or_provider.trim();
    if target.is_empty() {
        return Err("id must not be empty".to_string());
    }
    let norm = normalize_provider_id(target);
    let derived_id = target.split_once(':').map(|(prov, rest)| {
        if rest == "provider" || rest.starts_with("family:") || rest.starts_with("model:") {
            format!("{}:{rest}", normalize_provider_id(prov))
        } else {
            QuotaBlock::make_id(prov, &parse_scope_pattern(Some(rest)))
        }
    });
    let mut file = read_blocks_at(app_data, now);
    let before = file.blocks.len();
    file.blocks.retain(|block| {
        block.id != target
            && block.id != norm
            && derived_id.as_deref() != Some(block.id.as_str())
            && normalize_provider_id(&block.provider) != norm
    });
    let removed = file.blocks.len() != before;
    write_json_atomic(&blocks_path_in(app_data), &file)?;
    Ok((file, removed))
}

/// Removes a block by its `id` (or all blocks for a `provider` if `id` is a bare
/// provider ID) and writes the updated file.
pub fn clear_block_at(
    app_data: &Path,
    id_or_provider: &str,
    now: DateTime<Utc>,
) -> Result<QuotaBlocksFile, String> {
    clear_block_with_status_at(app_data, id_or_provider, now).map(|(file, _)| file)
}

/// Clears all active blocks and writes the updated file.
pub fn clear_all_blocks_at(app_data: &Path, now: DateTime<Utc>) -> Result<QuotaBlocksFile, String> {
    let mut file = read_blocks_at(app_data, now);
    file.blocks.clear();
    write_json_atomic(&blocks_path_in(app_data), &file)?;
    Ok(file)
}

/// Updates the default TTL in minutes (`1..=10080`).
pub fn set_default_ttl_at(
    app_data: &Path,
    minutes: u32,
    now: DateTime<Utc>,
) -> Result<QuotaBlocksFile, String> {
    if minutes == 0 || minutes > 7 * 24 * 60 {
        return Err("defaultTtlMinutes must be between 1 and 10080".to_string());
    }
    let mut file = read_blocks_at(app_data, now);
    file.default_ttl_minutes = minutes;
    write_json_atomic(&blocks_path_in(app_data), &file)?;
    Ok(file)
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("No app data directory: {error}"))
}

pub fn emit_updated(app: &tauri::AppHandle, state: &QuotaBlocksFile) {
    let _ = app.emit(QUOTA_BLOCKS_UPDATED_EVENT, state);
}

// The commands below are not in `generate_handler!`: no frontend reads or sets
// blocks yet. The control socket methods in `control_socket/quota_blocks.rs` are
// the only way in from outside the backend today.

#[tauri::command]
pub fn quota_blocks_get(app: tauri::AppHandle) -> Result<QuotaBlocksFile, String> {
    Ok(read_blocks_at(&app_data_dir(&app)?, Utc::now()))
}

#[tauri::command]
pub fn quota_block_set(
    app: tauri::AppHandle,
    provider: String,
    scope: Option<String>,
    until: Option<String>,
    duration_minutes: Option<u32>,
    reason: Option<String>,
) -> Result<QuotaBlocksFile, String> {
    let updated = set_manual_block_at(
        &app_data_dir(&app)?,
        &provider,
        scope.as_deref(),
        until.as_deref(),
        duration_minutes,
        reason.as_deref(),
        Utc::now(),
    )?;
    emit_updated(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub fn quota_block_clear(app: tauri::AppHandle, id: String) -> Result<QuotaBlocksFile, String> {
    let updated = clear_block_at(&app_data_dir(&app)?, &id, Utc::now())?;
    emit_updated(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub fn quota_blocks_clear_all(app: tauri::AppHandle) -> Result<QuotaBlocksFile, String> {
    let updated = clear_all_blocks_at(&app_data_dir(&app)?, Utc::now())?;
    emit_updated(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub fn quota_blocks_set_default_ttl(
    app: tauri::AppHandle,
    minutes: u32,
) -> Result<QuotaBlocksFile, String> {
    let updated = set_default_ttl_at(&app_data_dir(&app)?, minutes, Utc::now())?;
    emit_updated(&app, &updated);
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota_blocks::QuotaBlockScope;
    use chrono::TimeZone;

    #[test]
    fn persists_across_restarts_prunes_expired_and_clears_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc.with_ymd_and_hms(2026, 10, 23, 18, 0, 0).unwrap();

        let block_a = QuotaBlock {
            id: QuotaBlock::make_id(
                "antigravity",
                &QuotaBlockScope::Family {
                    prefix: "claude-".to_string(),
                },
            ),
            provider: "antigravity".to_string(),
            scope: QuotaBlockScope::Family {
                prefix: "claude-".to_string(),
            },
            reason: QuotaBlockReason::QuotaExhausted,
            detail: "Anthropic family quota exhausted".to_string(),
            detected_at: "2026-10-23T18:00:00Z".to_string(),
            expires_at: "2026-10-23T19:00:00Z".to_string(),
            source_agent_id: Some("agent-1".to_string()),
        };

        let block_b = QuotaBlock {
            id: QuotaBlock::make_id("grok", &QuotaBlockScope::Provider),
            provider: "grok".to_string(),
            scope: QuotaBlockScope::Provider,
            reason: QuotaBlockReason::RateLimited,
            detail: "Rate limit hit".to_string(),
            detected_at: "2026-10-23T18:00:00Z".to_string(),
            expires_at: "2026-10-23T20:00:00Z".to_string(),
            source_agent_id: None,
        };

        upsert_block_at(dir.path(), block_a.clone(), now).unwrap();
        let after_second = upsert_block_at(dir.path(), block_b.clone(), now).unwrap();
        assert_eq!(after_second.blocks.len(), 2);

        // Simulated restart at 18:30: both still active
        let mid = Utc.with_ymd_and_hms(2026, 10, 23, 18, 30, 0).unwrap();
        let loaded_mid = read_blocks_at(dir.path(), mid);
        assert_eq!(loaded_mid.blocks.len(), 2);

        // Simulated read at 19:05: block_a (expires 19:00) is pruned, block_b remains
        let later = Utc.with_ymd_and_hms(2026, 10, 23, 19, 5, 0).unwrap();
        let loaded_later = read_blocks_at(dir.path(), later);
        assert_eq!(loaded_later.blocks.len(), 1);
        assert_eq!(loaded_later.blocks[0].provider, "grok");

        // Manual clear by id removes block_b
        let cleared = clear_block_at(dir.path(), &block_b.id, later).unwrap();
        assert!(cleared.blocks.is_empty());
    }

    #[test]
    fn manual_block_creation_supports_family_and_clock_time() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc.with_ymd_and_hms(2026, 10, 23, 18, 0, 0).unwrap();

        let state = set_manual_block_at(
            dir.path(),
            "antigravity",
            Some("claude-*"),
            Some("20:00"),
            None,
            Some("Anthropic quota exhausted on agy"),
            now,
        )
        .unwrap();

        assert_eq!(state.blocks.len(), 1);
        let b = &state.blocks[0];
        assert_eq!(b.id, "antigravity:family:claude-");
        assert_eq!(
            b.scope,
            QuotaBlockScope::Family {
                prefix: "claude-".to_string()
            }
        );
        assert_eq!(b.reason, QuotaBlockReason::Manual);
        assert_eq!(b.expires_at, "2026-10-23T20:00:00Z");
    }
}
