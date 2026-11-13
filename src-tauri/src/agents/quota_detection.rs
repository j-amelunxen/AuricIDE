//! Turns what a finished agent last printed into a quota block.
//!
//! The exit path is the one place every agent passes, conductor and supervisor
//! children included, and by then the console tail holds the CLI's last words.
//! Only the tail is read: a quota failure ends the run, while an earlier mention
//! of a quota is usually an agent reading logs or code that talk about one.

use super::output_buffer::OutputBuffers;
use super::run_results::CONSOLE_TAIL_ANSWER_BYTES;
use super::types::AgentInfo;
use crate::providers::normalize_provider_id;
use crate::providers::ProviderRegistryState;
use crate::quota_blocks::matcher::{detect_in_text, CatalogModelRef, DetectionContext};
use crate::quota_blocks::store::{read_blocks_at, record_detected_block_at};
use crate::quota_blocks::QuotaBlock;
use chrono::{DateTime, Utc};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Called once per agent as it ends. A store that cannot be written costs the
/// block, never the exit path.
pub(super) fn record_quota_block(app: &AppHandle, info: &AgentInfo, buffers: &OutputBuffers) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let catalog = app
        .try_state::<ProviderRegistryState>()
        .map(|registry| catalog_of(registry.inner(), &info.provider))
        .unwrap_or_default();
    if let Err(error) = detect_and_record(&app_data, info, &catalog, buffers, Utc::now()) {
        eprintln!("Quota blocks: {error}");
    }
}

fn catalog_of(registry: &ProviderRegistryState, provider: &str) -> Vec<CatalogModelRef> {
    let wanted = normalize_provider_id(provider);
    registry
        .list_providers()
        .into_iter()
        .find(|candidate| normalize_provider_id(&candidate.id) == wanted)
        .map(|found| {
            found
                .models
                .into_iter()
                .map(|model| CatalogModelRef {
                    id: model.value,
                    label: model.label,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Scans the agent's console tail and stores any block it finds. Without a
/// catalog the spawned model is withheld from the matcher: it would otherwise
/// read any "switched to ..." sentence as a model fallback, since it has no
/// list to check the target against.
fn detect_and_record(
    app_data: &Path,
    info: &AgentInfo,
    catalog: &[CatalogModelRef],
    buffers: &OutputBuffers,
    now: DateTime<Utc>,
) -> Result<Option<QuotaBlock>, String> {
    let Some(tail) = buffers.read(&info.id, CONSOLE_TAIL_ANSWER_BYTES, None) else {
        return Ok(None);
    };
    let context = DetectionContext {
        provider: &info.provider,
        spawned_model: (!catalog.is_empty()).then_some(info.model.as_str()),
        catalog,
        source_agent_id: Some(&info.id),
        now,
        default_ttl_minutes: read_blocks_at(app_data, now).default_ttl_minutes,
    };
    let Some(block) = detect_in_text(&context, &tail.text) else {
        return Ok(None);
    };
    record_detected_block_at(app_data, block.clone(), now)?;
    Ok(Some(block))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota_blocks::store::upsert_block_at;
    use crate::quota_blocks::{find_block_for_model, QuotaBlockReason, QuotaBlockScope};
    use chrono::{Duration, TimeZone};

    const AGENT: &str = "agent-1";

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
    }

    fn info(provider: &str, model: &str) -> AgentInfo {
        AgentInfo {
            id: AGENT.into(),
            model: model.into(),
            provider: provider.into(),
            ..crate::control_socket::protocol::tests::sample_agent()
        }
    }

    fn catalog() -> Vec<CatalogModelRef> {
        [
            ("claude-sonnet-test", "Claude Sonnet Test"),
            ("gemini-flash-test", "Gemini Flash Test"),
        ]
        .map(|(id, label)| CatalogModelRef {
            id: id.into(),
            label: label.into(),
        })
        .to_vec()
    }

    fn finished_with(output: &str) -> OutputBuffers {
        let buffers = OutputBuffers::default();
        buffers.append(AGENT, output);
        buffers
    }

    #[test]
    fn a_quota_message_at_the_end_of_the_console_blocks_the_model_family() {
        let dir = tempfile::tempdir().unwrap();
        let agent = info("antigravity", "claude-sonnet-test");
        // Colour codes on purpose: the buffer cleans them before the matcher reads.
        let buffers = finished_with(
            "working\r\n\x1b[31mYou have exhausted your quota on this model.\x1b[0m\r\n",
        );

        let block = detect_and_record(dir.path(), &agent, &catalog(), &buffers, now())
            .unwrap()
            .expect("a block");
        assert_eq!(block.reason, QuotaBlockReason::QuotaExhausted);
        assert_eq!(block.source_agent_id.as_deref(), Some(AGENT));
        assert_eq!(
            block.scope,
            QuotaBlockScope::Family {
                prefix: "claude-".into()
            }
        );

        // What a supervisor's spawn check reads next, from the file.
        let stored = read_blocks_at(dir.path(), now()).blocks;
        assert!(find_block_for_model(&stored, "antigravity", "claude-sonnet-test").is_some());
        assert!(find_block_for_model(&stored, "antigravity", "gemini-flash-test").is_none());
    }

    #[test]
    fn a_quota_mention_above_the_console_tail_is_not_read() {
        let dir = tempfile::tempdir().unwrap();
        let noise = "ordinary build output\r\n".repeat(1 + CONSOLE_TAIL_ANSWER_BYTES as usize / 20);
        let buffers = finished_with(&format!("429 Too Many Requests\r\n{noise}"));

        let found =
            detect_and_record(dir.path(), &info("codex", "m"), &[], &buffers, now()).unwrap();
        assert_eq!(found, None);
        assert!(read_blocks_at(dir.path(), now()).blocks.is_empty());
    }

    #[test]
    fn a_clean_run_or_an_unknown_agent_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let agent = info("claude", "claude-sonnet-test");
        let clean = finished_with("All tests pass.\r\n");
        assert_eq!(
            detect_and_record(dir.path(), &agent, &catalog(), &clean, now()).unwrap(),
            None
        );
        let none = OutputBuffers::default();
        assert_eq!(
            detect_and_record(dir.path(), &agent, &catalog(), &none, now()).unwrap(),
            None
        );
        assert!(!crate::quota_blocks::store::blocks_path_in(dir.path()).exists());
    }

    #[test]
    fn a_switch_sentence_is_a_fallback_only_when_the_catalog_can_confirm_it() {
        let dir = tempfile::tempdir().unwrap();
        let agent = info("antigravity", "claude-sonnet-test");

        let prose = finished_with("I switched to the async API.\r\n");
        for known in [&catalog()[..], &[]] {
            assert_eq!(
                detect_and_record(dir.path(), &agent, known, &prose, now()).unwrap(),
                None
            );
        }

        let real = finished_with("Falling back to Gemini Flash Test\r\n");
        let block = detect_and_record(dir.path(), &agent, &catalog(), &real, now())
            .unwrap()
            .expect("a fallback block");
        assert_eq!(block.reason, QuotaBlockReason::SilentModelFallback);
    }

    #[test]
    fn a_detection_never_shortens_a_longer_block_that_is_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let later = now() + Duration::hours(5);
        let longer = QuotaBlock {
            id: QuotaBlock::make_id("claude", &QuotaBlockScope::Provider),
            provider: "claude".into(),
            scope: QuotaBlockScope::Provider,
            reason: QuotaBlockReason::Manual,
            detail: "set by hand".into(),
            detected_at: now().to_rfc3339(),
            expires_at: later.to_rfc3339(),
            source_agent_id: None,
        };
        upsert_block_at(dir.path(), longer.clone(), now()).unwrap();

        let buffers = finished_with("Claude usage limit reached\r\n");
        detect_and_record(
            dir.path(),
            &info("claude", "claude-sonnet-test"),
            &[],
            &buffers,
            now(),
        )
        .unwrap();
        assert_eq!(read_blocks_at(dir.path(), now()).blocks, vec![longer]);
    }
}
