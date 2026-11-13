//! Ordered run completion, including the intentionally different exit, kill,
//! and app-quit policies. Removing the process from the manager claims its end;
//! a later output-pump EOF still finishes its console but cannot book it again.

use super::output_buffer::OutputBuffersState;
use super::run_results::{RunResult, RunResultsState, CONSOLE_TAIL_ANSWER_BYTES};
use super::types::{AgentInfo, AgentStatus, AgentStatusEvent};
use crate::agent_usage::capture::{
    EvidenceWait, UsageCapture, UsageRecordedEvent, EXIT_EVIDENCE_WAIT, USAGE_RECORDED_EVENT,
};
use crate::agent_usage::record::Outcome;
use crate::json_store::now_ms;
use tauri::{AppHandle, Emitter, Manager};

pub(super) struct Context<'a> {
    pub app: &'a AppHandle,
    pub buffers: Option<&'a OutputBuffersState>,
    pub results: Option<&'a RunResultsState>,
}

pub(super) struct Run {
    pub info: AgentInfo,
    pub usage: Option<UsageCapture>,
    pub cli_result: Option<crate::agent_usage::claude::CliResult>,
    pub launch_request_uid: Option<String>,
}

pub(super) enum How {
    Exit {
        exit_code: i32,
        raw: Option<super::exit_log::RawExit>,
        claimed: bool,
    },
    Kill,
    Quit {
        deadline: tokio::time::Instant,
        finished_at: chrono::DateTime<chrono::Utc>,
    },
}

impl How {
    fn claimed(&self) -> bool {
        !matches!(self, Self::Exit { claimed: false, .. })
    }

    fn exit_code(&self) -> Option<i32> {
        match self {
            Self::Exit { exit_code, .. } => Some(*exit_code),
            _ => None,
        }
    }

    fn status(&self) -> AgentStatus {
        if self.exit_code().is_some_and(|code| code != 0) {
            AgentStatus::Error
        } else {
            AgentStatus::Idle
        }
    }

    fn outcome(&self) -> Outcome {
        match self {
            Self::Exit { exit_code: 0, .. } => Outcome::Success,
            Self::Exit { .. } => Outcome::Error,
            _ => Outcome::Killed,
        }
    }
}

pub(super) async fn finish_agent(context: Context<'_>, run: Run, mut how: How) {
    // Quit keeps restart anchors and does not publish run-results, console
    // status or launch verdicts. All quit runs share the caller's deadline.
    if let How::Quit {
        deadline,
        finished_at,
    } = how
    {
        log_agent_end(
            context.app,
            &run.info,
            super::exit_log::EndKind::AppQuit,
            None,
        );
        finish_at_shutdown(context.app, run, deadline, finished_at).await;
        return;
    }

    match &mut how {
        How::Exit {
            raw, claimed: true, ..
        } => {
            let raw = raw.take();
            let end = raw
                .as_ref()
                .map_or(super::exit_log::EndKind::WaitFailed, |raw| raw.kind());
            log_agent_end(context.app, &run.info, end, raw);
        }
        How::Kill => log_agent_end(
            context.app,
            &run.info,
            super::exit_log::EndKind::IdeKill,
            None,
        ),
        _ => {}
    }
    if matches!(&how, How::Exit { .. }) {
        // Before any ending becomes observable: a woken supervisor's retry
        // must already meet a quota block. The loser EOF keeps this check too.
        if let Some(buffers) = context.buffers {
            super::quota_detection::record_quota_block(context.app, &run.info, buffers);
        }
    }
    finish_console(context.buffers, context.results, &run, &how);

    // Natural exit announces status before scheduling records/launch ending;
    // a kill has always announced it after those steps.
    if matches!(&how, How::Exit { .. }) {
        emit_status(context.app, &run.info, &how);
    }
    let status_info = run.info.clone();
    if how.claimed() {
        let launch_request_uid = run.launch_request_uid.clone();
        let agent_id = run.info.id.clone();
        let app = context.app.clone();
        let outcome = how.outcome();
        // Never wait for a transcript from exit or kill: the request answers
        // now, and usage/task rows follow when the evidence is on disk.
        tauri::async_runtime::spawn(async move {
            finish_run_records(
                &app,
                run.info,
                run.usage,
                outcome,
                run.cli_result,
                EvidenceWait::Poll(EXIT_EVIDENCE_WAIT),
            )
            .await;
        });
        let verdict = launch_request_uid.as_deref().map(|uid| match &how {
            How::Exit { exit_code, .. } => super::launch_runs::ended(uid, &agent_id, *exit_code),
            _ => super::launch_runs::killed(uid, &agent_id),
        });
        super::launch_runs::end(context.app, &agent_id, verdict);
    }
    if matches!(&how, How::Kill) {
        emit_status(context.app, &status_info, &how);
    }
}

/// Reads the result's tail before `finish` may evict its ring. A losing EOF
/// leaves the first remover's result standing and still closes its console.
fn finish_console(
    buffers: Option<&OutputBuffersState>,
    results: Option<&RunResultsState>,
    run: &Run,
    how: &How,
) {
    let status = how.status();
    if let (true, Some(results)) = (how.claimed(), results) {
        let console_tail = || {
            buffers
                .and_then(|buffers| buffers.read(&run.info.id, CONSOLE_TAIL_ANSWER_BYTES, None))
                .map(|slice| slice.text)
        };
        let result = RunResult::from_finish(
            &run.info.id,
            status.clone(),
            how.exit_code(),
            run.cli_result.as_ref(),
            console_tail,
            now_ms(),
        );
        let result = if matches!(how, How::Exit { .. }) {
            result.with_transcript_report(|| transcript_report_of(run.usage.as_ref()))
        } else {
            result
        };
        results.record_finished(result, run.info.clone());
    }
    if let Some(buffers) = buffers {
        buffers.finish(&run.info.id, status);
    }
}

fn emit_status(app: &AppHandle, info: &AgentInfo, how: &How) {
    let _ = app.emit(
        super::types::AGENT_STATUS_EVENT,
        AgentStatusEvent {
            agent_id: info.id.clone(),
            status: how.status(),
            exit_code: how.exit_code(),
            repo_path: info.repo_path.clone(),
        },
    );
}

async fn finish_at_shutdown(
    app: &AppHandle,
    run: Run,
    deadline: tokio::time::Instant,
    finished_at: chrono::DateTime<chrono::Utc>,
) {
    let usage_row = if let Some(capture) = run.usage {
        let read = book_usage(
            app,
            capture.clone(),
            Outcome::Killed,
            None,
            EvidenceWait::Now,
        );
        match tokio::time::timeout_at(deadline, read).await {
            Ok(row) => row,
            Err(_) => book_usage(app, capture, Outcome::Killed, None, EvidenceWait::Skip).await,
        }
    } else {
        None
    };
    let summary = usage_row
        .as_ref()
        .map(crate::task_log::TaskUsageSummary::from_usage_record);
    record_task_log(app, run.info, finished_at, Outcome::Killed, summary).await;
}

/// The run's last finished turn and where it was read, where it can be.
fn transcript_report_of(
    usage: Option<&UsageCapture>,
) -> Option<(String, crate::agent_usage::report::ReportSource)> {
    let home = dirs::home_dir()?;
    match usage?.latest_report(&home) {
        crate::agent_usage::report::ReportLookup::Found { report, source } => {
            Some((report.text, source))
        }
        crate::agent_usage::report::ReportLookup::Missing(_) => None,
    }
}

/// Reads a finished run's evidence, appends its usage row and tells the
/// frontend. Returns the written row when one was booked. A failure is logged,
/// never raised: the run itself already ended.
async fn book_usage(
    app: &AppHandle,
    capture: UsageCapture,
    outcome: Outcome,
    cli_result: Option<crate::agent_usage::claude::CliResult>,
    wait: EvidenceWait,
) -> Option<crate::agent_usage::record::UsageRecord> {
    let Ok(home) = app.path().home_dir() else {
        return None;
    };
    let claude_prices = app
        .try_state::<crate::cc_usage::CcUsageService>()
        .and_then(|service| service.plugin_by_id(crate::cc_usage::CLAUDE_CODE_PLUGIN_ID));
    let project_path = capture.event_project_path().to_string();
    let booked = tokio::task::spawn_blocking(move || {
        capture.book(
            &home,
            claude_prices.as_ref(),
            outcome,
            cli_result,
            chrono::Utc::now(),
            wait,
        )
    })
    .await;
    match booked {
        Ok(Ok(Some(row))) => {
            let _ = app.emit(
                USAGE_RECORDED_EVENT,
                UsageRecordedEvent {
                    project_path,
                    row: row.clone(),
                },
            );
            Some(row)
        }
        Ok(Ok(None)) => None,
        Ok(Err(error)) => {
            eprintln!("Agent usage: could not record a run: {error}");
            None
        }
        Err(error) => {
            eprintln!("Agent usage: recording a run aborted: {error}");
            None
        }
    }
}

/// Books usage (when the run belonged to an initialised project) and writes
/// the finished task to the monthly JSONL log when task logging is enabled.
///
/// The task log entry is stamped with `finished_at` taken before waiting for
/// the transcript, so the recorded duration and month match the actual moment
/// the run ended.
async fn finish_run_records(
    app: &AppHandle,
    info: AgentInfo,
    capture: Option<UsageCapture>,
    outcome: Outcome,
    cli_result: Option<crate::agent_usage::claude::CliResult>,
    wait: EvidenceWait,
) {
    let finished_at = chrono::Utc::now();
    let cli_summary = cli_result
        .as_ref()
        .map(crate::task_log::TaskUsageSummary::from_cli_result);
    let usage_row = match capture {
        Some(capture) => book_usage(app, capture, outcome, cli_result, wait).await,
        None => None,
    };
    let summary = usage_row
        .as_ref()
        .map(crate::task_log::TaskUsageSummary::from_usage_record)
        .or(cli_summary);
    record_task_log(app, info, finished_at, outcome, summary).await;
}

/// Writes the agent's ending to `agent-exits.jsonl` (see `exit_log`). Output
/// size and silence are read before the console buffer is marked finished;
/// the memory probes and the file write run off the caller's thread. A log
/// that cannot be written is reported on stderr and never changes the ending.
fn log_agent_end(
    app: &AppHandle,
    info: &AgentInfo,
    end: super::exit_log::EndKind,
    raw: Option<super::exit_log::RawExit>,
) {
    use super::exit_log;
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let (output_bytes, silent_for_ms) = app
        .try_state::<super::output_buffer::OutputBuffersState>()
        .map_or((0, None), |buffers| {
            (
                buffers.total_bytes(&info.id),
                buffers
                    .silent_for(&info.id)
                    .map(|silent| silent.as_millis() as u64),
            )
        });
    let info = info.clone();
    let ended_at_ms = now_ms();
    tauri::async_runtime::spawn_blocking(move || {
        let role = serde_json::to_value(info.role)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        let facts = exit_log::RunFacts {
            agent_id: &info.id,
            provider: &info.provider,
            model: &info.model,
            headless: info.headless,
            role: &role,
            project_path: info.project_path.as_deref(),
            started_at_ms: info.started_at,
            ended_at_ms,
            output_bytes,
            silent_for_ms,
        };
        let record = exit_log::build_record(
            &facts,
            end,
            raw.as_ref(),
            exit_log::read_system_memory(),
            chrono::Utc::now().to_rfc3339(),
        );
        if let Err(error) = exit_log::append_record(&app_data, &record) {
            eprintln!("{error}");
        }
    });
}

async fn record_task_log(
    app: &AppHandle,
    info: AgentInfo,
    finished_at: chrono::DateTime<chrono::Utc>,
    outcome: Outcome,
    summary: Option<crate::task_log::TaskUsageSummary>,
) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let recorded = tokio::task::spawn_blocking(move || {
        crate::task_log::record_finished_task_in(
            &app_data,
            &info,
            finished_at,
            outcome,
            summary.as_ref(),
        )
    })
    .await;
    match recorded {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => eprintln!("Task log: could not record a finished task: {error}"),
        Err(error) => eprintln!("Task log: recording a finished task aborted: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::super::output_buffer::OutputBuffers;
    use super::super::run_results::RunResults;
    use super::*;
    use std::sync::Arc;

    fn run(id: &str) -> Run {
        Run {
            info: super::super::tests::session_info(id, Some("/repo")),
            usage: None,
            cli_result: None,
            launch_request_uid: None,
        }
    }

    #[test]
    fn exit_and_kill_results_keep_the_tail_before_immediate_ring_eviction() {
        for how in [
            How::Exit {
                exit_code: 0,
                raw: None,
                claimed: true,
            },
            How::Exit {
                exit_code: 1,
                raw: None,
                claimed: true,
            },
            How::Kill,
        ] {
            let buffers = Arc::new(OutputBuffers::with_limits(1024, 0));
            let results = Arc::new(RunResults::default());
            let run = run("agent-1");
            buffers.append(&run.info.id, "\x1b[32manswer\x1b[0m\r\n");
            finish_console(Some(&buffers), Some(&results), &run, &how);
            assert!(!buffers.knows(&run.info.id), "finish evicted the ring");
            let result = results.get(&run.info.id).unwrap();
            assert_eq!(result.answer.as_deref(), Some("answer\n"));
            assert_eq!(result.exit_code, how.exit_code());
            assert_eq!(result.status, how.status());
        }
    }

    #[test]
    fn losing_eof_cannot_publish_a_result_or_replace_the_kill_verdict() {
        let buffers = Arc::new(OutputBuffers::default());
        let results = Arc::new(RunResults::default());
        let run = run("agent-1");
        buffers.append(&run.info.id, "answer");
        let losing_eof = How::Exit {
            exit_code: 0,
            raw: None,
            claimed: false,
        };
        finish_console(Some(&buffers), Some(&results), &run, &losing_eof);
        assert!(
            results.get(&run.info.id).is_none(),
            "the EOF that did not claim the process books no result"
        );
        finish_console(Some(&buffers), Some(&results), &run, &How::Kill);
        let killed = results.get(&run.info.id).unwrap();
        finish_console(Some(&buffers), Some(&results), &run, &losing_eof);
        assert_eq!(results.get(&run.info.id), Some(killed));
        assert_eq!(
            buffers.read(&run.info.id, 100, None).unwrap().final_status,
            Some(AgentStatus::Idle)
        );
    }
}
