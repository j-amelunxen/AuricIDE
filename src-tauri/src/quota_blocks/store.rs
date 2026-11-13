//! Persistence and expiry pruning for `<app_data_dir>/quota-blocks.json`.

use super::matcher::resolve_manual_until;
use super::{parse_scope_pattern, QuotaBlock, QuotaBlockReason};
use crate::json_store::{self, write_json, Unreadable};
use crate::providers::normalize_provider_id;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const QUOTA_BLOCKS_FILE_NAME: &str = "quota-blocks.json";
pub const DEFAULT_QUOTA_BLOCK_TTL_MINUTES: u32 = 60;

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

/// Reads `<app_data>/quota-blocks.json` without the blocks whose `expires_at`
/// is at or before `now`. Reading never writes: expired entries leave the file
/// with the next change, which holds the lock. A file this build cannot read is
/// no blocks, and is moved aside so the next write does not replace it; one
/// that cannot even be moved is left alone and still reads as no blocks.
pub fn read_blocks_at(app_data: &Path, now: DateTime<Utc>) -> QuotaBlocksFile {
    let path = blocks_path_in(app_data);
    let Ok(Some(mut parsed)) =
        json_store::load::<QuotaBlocksFile>(&path, Some(1), Unreadable::MoveAside)
    else {
        return QuotaBlocksFile::default();
    };
    if parsed.default_ttl_minutes == 0 {
        parsed.default_ttl_minutes = DEFAULT_QUOTA_BLOCK_TTL_MINUTES;
    }
    parsed.blocks.retain(|block| block.is_active_at(now));
    parsed
}

/// Held across a read-change-write: agent exits and the control socket change
/// this file from different threads, and both builds of the app share it.
fn lock_blocks(app_data: &Path) -> Result<json_store::FileLock, String> {
    json_store::FileLock::acquire(app_data, "quota-blocks.lock")
        .map_err(|error| format!("Could not lock the quota blocks: {error}"))
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
    let _lock = lock_blocks(app_data)?;
    upsert_locked(app_data, block, now)
}

/// [`upsert_block_at`] for a caller that already holds the lock.
fn upsert_locked(
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
    write_json(&blocks_path_in(app_data), &file)?;
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
    let _lock = lock_blocks(app_data)?;
    let expiry = |candidate: &QuotaBlock| DateTime::parse_from_rfc3339(&candidate.expires_at).ok();
    let already_covered = read_blocks_at(app_data, now)
        .blocks
        .iter()
        .any(|existing| existing.id == block.id && expiry(existing) >= expiry(&block));
    if already_covered {
        return Ok(false);
    }
    upsert_locked(app_data, block, now)?;
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
    let _lock = lock_blocks(app_data)?;
    let mut file = read_blocks_at(app_data, now);
    let before = file.blocks.len();
    file.blocks.retain(|block| {
        block.id != target
            && block.id != norm
            && derived_id.as_deref() != Some(block.id.as_str())
            && normalize_provider_id(&block.provider) != norm
    });
    let removed = file.blocks.len() != before;
    write_json(&blocks_path_in(app_data), &file)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota_blocks::QuotaBlockScope;
    use chrono::TimeZone;

    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// A file this build cannot read is kept aside, never written over: the
    /// next block starts a fresh file and the broken one keeps its content.
    #[test]
    fn an_unreadable_file_is_moved_aside_and_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc.with_ymd_and_hms(2026, 10, 23, 18, 0, 0).unwrap();
        let broken = r#"{"version":2,"blocks":"from a newer build"}"#;
        std::fs::write(blocks_path_in(dir.path()), broken).unwrap();

        set_manual_block_at(dir.path(), "grok", None, None, None, None, now).unwrap();

        let names = files_in(dir.path());
        let aside: Vec<&String> = names
            .iter()
            .filter(|name| name.starts_with("quota-blocks.json.unreadable-"))
            .collect();
        assert_eq!(aside.len(), 1, "{names:?}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(aside[0])).unwrap(),
            broken
        );
        assert_eq!(read_blocks_at(dir.path(), now).blocks.len(), 1);
    }

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
