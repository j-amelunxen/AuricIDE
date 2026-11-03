//! One line per agent ending, with what the UI throws away.
//!
//! `manager.rs` folds every non-success into exit code 1, so a SIGKILL from the
//! kernel, a SIGHUP from a closed PTY and a plain `exit 1` all looked the same:
//! status `error`, no message. This log keeps the raw end next to the run:
//! the real exit code or signal, whether the IDE itself ended it, how long it
//! ran, how far its output got and when it last spoke, and how much memory the
//! machine had at that moment. It changes nothing the UI shows.
//!
//! The file is `<app_data_dir>/agent-exits.jsonl`, append-only, rotated to
//! `agent-exits.jsonl.1` once it passes [`MAX_LOG_BYTES`]. It holds no prompt,
//! no task text, no output and no environment: only ids, the provider, the
//! model, paths the agent was started in, numbers.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const LOG_FILE_NAME: &str = "agent-exits.jsonl";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// How an agent's run came to an end, as far as the IDE can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EndKind {
    /// The process ended with an exit code (0 or not).
    Exited,
    /// The process was ended by a signal it did not send itself.
    Signaled,
    /// `kill_agent_impl`: the IDE ended it (a person pressed kill, or a
    /// supervisor did). Exit status is not read.
    IdeKill,
    /// The app was quitting; the run was alive and is booked as killed.
    AppQuit,
    /// `wait()` itself failed, so there is no status at all.
    WaitFailed,
}

/// The status as the PTY library reports it, before it is folded to 0/1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RawExit {
    pub code: u32,
    /// The libc description of the signal ("Killed: 9", "Hangup: 1").
    pub signal: Option<String>,
}

impl RawExit {
    pub fn new(code: u32, signal: Option<&str>) -> Self {
        Self {
            code,
            signal: signal.map(str::to_string),
        }
    }

    pub fn kind(&self) -> EndKind {
        if self.signal.is_some() {
            EndKind::Signaled
        } else {
            EndKind::Exited
        }
    }
}

/// Memory of the whole machine when the agent ended. Every field is optional:
/// a probe that did not answer leaves a gap rather than a made-up number.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    /// Free + inactive + speculative pages, in bytes (`vm_stat`).
    pub available_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
    pub swap_total_bytes: Option<u64>,
    /// `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical.
    pub pressure_level: Option<u32>,
}

/// What the manager knew about the run when it ended.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitRecord {
    pub at: String,
    pub agent_id: String,
    pub provider: String,
    pub model: String,
    pub headless: bool,
    pub role: String,
    pub project_path: Option<String>,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub runtime_ms: u64,
    pub end: EndKind,
    /// Raw code from the PTY library. `None` when the IDE did not read it.
    pub exit_code: Option<u32>,
    pub signal: Option<String>,
    pub killed_by_ide: bool,
    /// Bytes of cleaned console output the agent produced in total.
    pub last_output_offset: u64,
    /// When that output last grew, as epoch ms. `None`: it never printed.
    pub last_output_at_ms: Option<u64>,
    /// Seconds from the last output to the end. Large: it went quiet first.
    pub silent_for_ms: Option<u64>,
    pub memory: SystemMemory,
}

/// The run-specific inputs of a record, so the builder stays a pure function.
pub struct RunFacts<'a> {
    pub agent_id: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub headless: bool,
    pub role: &'a str,
    pub project_path: Option<&'a str>,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub output_bytes: u64,
    /// Time since the output last grew; `None` if it never did.
    pub silent_for_ms: Option<u64>,
}

pub fn build_record(
    facts: &RunFacts,
    end: EndKind,
    raw: Option<&RawExit>,
    memory: SystemMemory,
    at: String,
) -> ExitRecord {
    ExitRecord {
        at,
        agent_id: facts.agent_id.to_string(),
        provider: facts.provider.to_string(),
        model: facts.model.to_string(),
        headless: facts.headless,
        role: facts.role.to_string(),
        project_path: facts.project_path.map(str::to_string),
        started_at_ms: facts.started_at_ms,
        ended_at_ms: facts.ended_at_ms,
        runtime_ms: facts.ended_at_ms.saturating_sub(facts.started_at_ms),
        end,
        exit_code: raw.map(|r| r.code),
        signal: raw.and_then(|r| r.signal.clone()),
        killed_by_ide: end == EndKind::IdeKill,
        last_output_offset: facts.output_bytes,
        last_output_at_ms: facts
            .silent_for_ms
            .map(|silent| facts.ended_at_ms.saturating_sub(silent)),
        silent_for_ms: facts.silent_for_ms,
        memory,
    }
}

/// Appends one line. Past the size limit the file is moved to `.1` first, so
/// the log never grows without bound and the previous period stays readable.
pub fn append_record(app_data_dir: &Path, record: &ExitRecord) -> Result<PathBuf, String> {
    let path = app_data_dir.join(LOG_FILE_NAME);
    fs::create_dir_all(app_data_dir).map_err(|e| format!("Exit log: cannot create dir: {e}"))?;
    if fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_LOG_BYTES) {
        let rotated = app_data_dir.join(format!("{LOG_FILE_NAME}.1"));
        fs::rename(&path, &rotated).map_err(|e| format!("Exit log: cannot rotate: {e}"))?;
    }
    let mut line =
        serde_json::to_string(record).map_err(|e| format!("Exit log: cannot serialize: {e}"))?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Exit log: cannot open {}: {e}", path.display()))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("Exit log: cannot write {}: {e}", path.display()))?;
    Ok(path)
}

/// `vm_stat` → bytes that are free, inactive or speculative.
pub fn parse_vm_stat_available(text: &str) -> Option<u64> {
    let page_size = text
        .lines()
        .next()?
        .split("page size of ")
        .nth(1)?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    let pages = |label: &str| -> Option<u64> {
        let line = text.lines().find(|l| l.starts_with(label))?;
        line.split(':')
            .nth(1)?
            .trim()
            .trim_end_matches('.')
            .parse()
            .ok()
    };
    let free = pages("Pages free")?;
    let inactive = pages("Pages inactive")?;
    let speculative = pages("Pages speculative").unwrap_or(0);
    Some((free + inactive + speculative) * page_size)
}

/// `sysctl vm.swapusage` → (used, total) in bytes.
pub fn parse_swap_usage(text: &str) -> Option<(u64, u64)> {
    let megabytes = |label: &str| -> Option<u64> {
        let rest = text.split(label).nth(1)?;
        let number = rest
            .split('M')
            .next()?
            .trim()
            .trim_start_matches('=')
            .trim();
        let value: f64 = number.parse().ok()?;
        Some((value * 1024.0 * 1024.0) as u64)
    };
    Some((megabytes("used =")?, megabytes("total =")?))
}

fn run_text(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Reads the three probes. Blocking (three short child processes): call it
/// from a blocking context, once per ended agent.
pub fn read_system_memory() -> SystemMemory {
    let available_bytes =
        run_text("/usr/bin/vm_stat", &[]).and_then(|t| parse_vm_stat_available(&t));
    let swap =
        run_text("/usr/sbin/sysctl", &["-n", "vm.swapusage"]).and_then(|t| parse_swap_usage(&t));
    let pressure_level = run_text(
        "/usr/sbin/sysctl",
        &["-n", "kern.memorystatus_vm_pressure_level"],
    )
    .and_then(|t| t.trim().parse().ok());
    SystemMemory {
        available_bytes,
        swap_used_bytes: swap.map(|s| s.0),
        swap_total_bytes: swap.map(|s| s.1),
        pressure_level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VM_STAT: &str = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n\
Pages free:                               10000.\n\
Pages active:                            200000.\n\
Pages inactive:                           30000.\n\
Pages speculative:                         5000.\n";

    fn facts() -> RunFacts<'static> {
        RunFacts {
            agent_id: "agent-1",
            provider: "claude",
            model: "some-model",
            headless: false,
            role: "worker",
            project_path: Some("/work/project"),
            started_at_ms: 1_000,
            ended_at_ms: 61_000,
            output_bytes: 4096,
            silent_for_ms: Some(2_000),
        }
    }

    #[test]
    fn vm_stat_available_is_free_inactive_and_speculative_in_bytes() {
        assert_eq!(parse_vm_stat_available(VM_STAT), Some(45_000 * 16384));
    }

    #[test]
    fn vm_stat_without_a_page_size_is_a_gap_not_a_guess() {
        assert_eq!(parse_vm_stat_available("garbage"), None);
    }

    #[test]
    fn swap_usage_reads_used_and_total() {
        let text = "total = 8192.00M  used = 7324.56M  free = 867.44M  (encrypted)";
        let (used, total) = parse_swap_usage(text).expect("parses");
        assert_eq!(total, 8192 * 1024 * 1024);
        assert!(used > 7_680_000_000 && used < 7_690_000_000, "{used}");
        assert_eq!(parse_swap_usage("nope"), None);
    }

    #[test]
    fn a_signal_is_kept_even_though_the_ui_sees_exit_one() {
        let raw = RawExit::new(1, Some("Killed: 9"));
        assert_eq!(raw.kind(), EndKind::Signaled);
        let record = build_record(
            &facts(),
            raw.kind(),
            Some(&raw),
            SystemMemory::default(),
            "t".into(),
        );
        assert_eq!(record.signal.as_deref(), Some("Killed: 9"));
        assert_eq!(record.exit_code, Some(1));
        assert!(!record.killed_by_ide);
        assert_eq!(record.runtime_ms, 60_000);
        assert_eq!(record.last_output_at_ms, Some(59_000));
    }

    #[test]
    fn a_plain_exit_one_has_no_signal() {
        let raw = RawExit::new(1, None);
        assert_eq!(raw.kind(), EndKind::Exited);
        let record = build_record(
            &facts(),
            raw.kind(),
            Some(&raw),
            SystemMemory::default(),
            "t".into(),
        );
        assert_eq!(record.signal, None);
    }

    #[test]
    fn an_ide_kill_says_so_and_reads_no_status() {
        let record = build_record(
            &facts(),
            EndKind::IdeKill,
            None,
            SystemMemory::default(),
            "t".into(),
        );
        assert!(record.killed_by_ide);
        assert_eq!(record.exit_code, None);
        assert_eq!(record.signal, None);
    }

    #[test]
    fn an_agent_that_never_printed_has_no_last_output_time() {
        let mut f = facts();
        f.silent_for_ms = None;
        f.output_bytes = 0;
        let record = build_record(
            &f,
            EndKind::Exited,
            None,
            SystemMemory::default(),
            "t".into(),
        );
        assert_eq!(record.last_output_at_ms, None);
        assert_eq!(record.last_output_offset, 0);
    }

    #[test]
    fn the_line_names_no_prompt_or_task_field() {
        let record = build_record(
            &facts(),
            EndKind::Exited,
            None,
            SystemMemory::default(),
            "t".into(),
        );
        let json = serde_json::to_value(&record).expect("serializes");
        for key in ["task", "prompt", "currentTask", "instruction", "env"] {
            assert!(json.get(key).is_none(), "{key} must not be logged");
        }
        assert_eq!(json["end"], "exited");
        assert_eq!(json["agentId"], "agent-1");
    }

    #[test]
    fn append_writes_json_lines_and_rotates_past_the_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let record = build_record(
            &facts(),
            EndKind::AppQuit,
            None,
            SystemMemory::default(),
            "t".into(),
        );
        append_record(dir.path(), &record).expect("first");
        append_record(dir.path(), &record).expect("second");
        let text = fs::read_to_string(dir.path().join(LOG_FILE_NAME)).expect("read");
        assert_eq!(text.lines().count(), 2);
        let first: serde_json::Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
        assert_eq!(first["end"], "app-quit");

        let big = vec![b'x'; MAX_LOG_BYTES as usize];
        fs::write(dir.path().join(LOG_FILE_NAME), big).expect("fill");
        append_record(dir.path(), &record).expect("after rotation");
        assert!(dir.path().join(format!("{LOG_FILE_NAME}.1")).exists());
        let fresh = fs::read_to_string(dir.path().join(LOG_FILE_NAME)).expect("read");
        assert_eq!(fresh.lines().count(), 1);
    }
}
