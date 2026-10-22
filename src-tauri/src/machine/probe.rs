//! Running a tool once, bounded, in the login shell's environment.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// Long enough for a cold `uv python find`, short enough that a hung tool
/// cannot stall a settings panel.
pub const DEFAULT_PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeOutput {
    /// `None` when the process was ended by a signal.
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl ProbeOutput {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }

    /// Stdout followed by stderr, for tools that print a version to either.
    pub fn combined(&self) -> String {
        format!("{}{}", self.stdout, self.stderr)
    }
}

/// `None` when the tool could not be started or did not finish in time.
pub async fn run_probe(program: &Path, args: &[&str], timeout: Duration) -> Option<ProbeOutput> {
    let mut command = Command::new(program);
    command.args(args);
    for (key, value) in crate::agents::cached_login_shell_env().await {
        command.env(key, value);
    }
    command.stdin(Stdio::null());
    command.kill_on_drop(true);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .ok()?
        .ok()?;
    Some(ProbeOutput {
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUICK: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn captures_exit_code_and_both_streams() {
        let output = run_probe(
            Path::new("/bin/sh"),
            &["-c", "echo out; echo err >&2; exit 3"],
            QUICK,
        )
        .await
        .unwrap();
        assert_eq!(output.exit_code, Some(3));
        assert_eq!(output.stdout, "out\n");
        assert_eq!(output.stderr, "err\n");
        assert!(!output.success());
        assert_eq!(output.combined(), "out\nerr\n");
    }

    #[tokio::test]
    async fn a_zero_exit_is_success() {
        let output = run_probe(Path::new("/bin/sh"), &["-c", "true"], QUICK)
            .await
            .unwrap();
        assert!(output.success());
    }

    #[tokio::test]
    async fn a_tool_that_outlives_the_timeout_gives_no_answer() {
        let started = std::time::Instant::now();
        let output = run_probe(
            Path::new("/bin/sh"),
            &["-c", "sleep 5"],
            Duration::from_millis(100),
        )
        .await;
        assert_eq!(output, None);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn a_program_that_cannot_start_gives_no_answer() {
        let output = run_probe(Path::new("/definitely/not/here"), &[], QUICK).await;
        assert_eq!(output, None);
    }
}
