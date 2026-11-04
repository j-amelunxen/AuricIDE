//! Control socket handlers for `list_quota_blocks`, `set_quota_block`, and
//! `clear_quota_block`.

use super::protocol::*;
use super::{to_value, Dispatcher, Outcome};
use crate::quota_blocks::store::{clear_block_with_status_at, read_blocks_at, set_manual_block_at};
use crate::quota_blocks::{parse_scope_pattern, QuotaBlock};
use crate::supervisor::policy::normalize_provider_id;
use chrono::Utc;
use std::path::PathBuf;

impl Dispatcher {
    fn quota_app_data(&self) -> Result<PathBuf, ControlError> {
        self.backend
            .app_data_dir()
            .ok_or_else(|| ControlError::new(ErrorCode::Internal, "no app data directory"))
    }

    pub(super) fn list_quota_blocks(&self) -> Outcome {
        let Some(dir) = self.backend.app_data_dir() else {
            return to_value(QuotaBlocksResult {
                blocks: Vec::new(),
                default_ttl_minutes: crate::quota_blocks::store::DEFAULT_QUOTA_BLOCK_TTL_MINUTES,
            });
        };
        let file = read_blocks_at(&dir, Utc::now());
        to_value(QuotaBlocksResult {
            blocks: file.blocks,
            default_ttl_minutes: file.default_ttl_minutes,
        })
    }

    pub(super) fn set_quota_block(&self, params: SetQuotaBlockParams) -> Outcome {
        let dir = self.quota_app_data()?;
        let now = Utc::now();
        let norm_provider = normalize_provider_id(&params.provider);
        let scope = parse_scope_pattern(params.scope.as_deref());
        let expected_id = QuotaBlock::make_id(&norm_provider, &scope);
        let updated = set_manual_block_at(
            &dir,
            &params.provider,
            params.scope.as_deref(),
            params.until.as_deref(),
            params.duration_minutes,
            params.detail.as_deref(),
            now,
        )
        .map_err(|error| ControlError::new(ErrorCode::InvalidParams, error))?;
        let block = updated
            .blocks
            .into_iter()
            .find(|b| b.id == expected_id)
            .ok_or_else(|| {
                ControlError::new(
                    ErrorCode::InvalidParams,
                    "quota block expiry is not in the future",
                )
            })?;
        to_value(SetQuotaBlockResult { block })
    }

    pub(super) fn clear_quota_block(&self, params: ClearQuotaBlockParams) -> Outcome {
        let dir = self.quota_app_data()?;
        let now = Utc::now();
        let (_, cleared) = clear_block_with_status_at(&dir, &params.id, now)
            .map_err(|error| ControlError::new(ErrorCode::InvalidParams, error))?;
        to_value(ClearQuotaBlockResult {
            id: params.id.trim().to_string(),
            cleared,
        })
    }
}
