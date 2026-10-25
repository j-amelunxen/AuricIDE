//! Running one formatter over stdin, bounded, and judging what it printed.
//!
//! A formatter's output replaces the person's text, so the guards here are
//! about never handing back something worse: no output for real input, a
//! non-zero exit, a timeout and output that is not UTF-8 are all `failed`,
//! and the message is one cleaned sentence rather than the tool's stderr.

use super::FormatOutcome;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug)]
pub enum RunResult {
    Finished {
        /// `None` when the process was ended by a signal.
        exit_code: Option<i32>,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },
    TimedOut(Duration),
    CouldNotStart(String),
}

/// Run `program` in `cwd` with `input` on stdin. The child is killed when it
/// outlives `timeout`.
pub async fn run_tool(
    program: &Path,
    args: &[String],
    cwd: &Path,
    input: &str,
    timeout: Duration,
) -> RunResult {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // `node_modules/.bin/*` start with `#!/usr/bin/env node`, which needs the
    // login shell's PATH, not launchd's.
    for (key, value) in crate::agents::cached_login_shell_env().await {
        command.env(key, value);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return RunResult::CouldNotStart(error.to_string()),
    };
    // Written from a task so a tool that fills its stdout pipe before reading
    // all of stdin cannot deadlock against us. A write error means the tool
    // stopped reading; its exit code and output say what that meant.
    let writer = child.stdin.take().map(|mut stdin| {
        let bytes = input.as_bytes().to_vec();
        tokio::spawn(async move {
            if stdin.write_all(&bytes).await.is_ok() {
                let _closed = stdin.shutdown().await;
            }
        })
    });
    let waited = tokio::time::timeout(timeout, child.wait_with_output()).await;
    if let Some(writer) = writer {
        writer.abort();
    }
    match waited {
        // Dropping the wait dropped the child, and `kill_on_drop` ended it.
        Err(_) => RunResult::TimedOut(timeout),
        Ok(Err(error)) => RunResult::CouldNotStart(error.to_string()),
        Ok(Ok(output)) => RunResult::Finished {
            exit_code: output.status.code(),
            stdout: output.stdout,
            stderr: output.stderr,
        },
    }
}

/// Turn a run into the outcome the frontend acts on.
pub fn judge(label: &str, input: &str, result: RunResult) -> FormatOutcome {
    let failed = |message: String| FormatOutcome::Failed {
        formatter: label.to_string(),
        message,
    };
    let (exit_code, stdout, stderr) = match result {
        RunResult::CouldNotStart(error) => {
            return failed(clip(&format!("{label} could not be started: {error}.")));
        }
        RunResult::TimedOut(after) => {
            return failed(format!(
                "{label} did not finish within {} and was stopped.",
                describe_duration(after)
            ));
        }
        RunResult::Finished {
            exit_code,
            stdout,
            stderr,
        } => (exit_code, stdout, stderr),
    };
    if exit_code != Some(0) {
        return failed(exit_message(label, exit_code, &stderr, &stdout));
    }
    let Ok(output) = String::from_utf8(stdout) else {
        return failed(format!("{label} printed text that is not UTF-8."));
    };
    if output.is_empty() && !input.trim().is_empty() {
        return failed(format!(
            "{label} printed nothing for a file that is not empty."
        ));
    }
    if output == input {
        return FormatOutcome::Unchanged {
            formatter: label.to_string(),
        };
    }
    FormatOutcome::Formatted {
        content: output,
        formatter: label.to_string(),
    }
}

fn exit_message(label: &str, exit_code: Option<i32>, stderr: &[u8], stdout: &[u8]) -> String {
    let said = summarize(&String::from_utf8_lossy(stderr))
        .or_else(|| summarize(&String::from_utf8_lossy(stdout)));
    if let Some(line) = said {
        return line;
    }
    match exit_code {
        Some(code) => format!("{label} exited with code {code}."),
        None => format!("{label} was stopped by a signal."),
    }
}

fn describe_duration(duration: Duration) -> String {
    match duration.as_secs() {
        0 => format!("{} ms", duration.as_millis()),
        1 => "1 second".to_string(),
        secs => format!("{secs} seconds"),
    }
}

/// The longest message the frontend shows, in characters.
const MAX_MESSAGE_CHARS: usize = 200;

/// The one line of a tool's output a person should read. For a Python
/// traceback that is its last line (the exception); otherwise the first line
/// that says something, with prettier's `[error]` tag and decoration removed.
pub fn summarize(raw: &str) -> Option<String> {
    let text = crate::ansi::strip_ansi(raw);
    let lines: Vec<&str> = text.lines().map(trim_decoration).collect();
    let pick = if text.contains("Traceback (most recent call last)") {
        lines.iter().rev().find(|line| is_meaningful(line))
    } else {
        lines.iter().find(|line| is_meaningful(line))
    }?;
    let line = pick.strip_prefix("[error]").map_or(*pick, str::trim_start);
    Some(clip(line))
}

/// Box drawing, block elements and the markers tools frame errors with.
fn is_decoration(ch: char) -> bool {
    ch.is_whitespace() || ('\u{2500}'..='\u{259F}').contains(&ch) || "×✖│╭╰".contains(ch)
}

fn trim_decoration(line: &str) -> &str {
    line.trim_matches(is_decoration)
}

fn is_meaningful(line: &&str) -> bool {
    line.chars().any(char::is_alphanumeric) && !line.starts_with("Traceback")
}

fn clip(line: &str) -> String {
    if line.chars().count() <= MAX_MESSAGE_CHARS {
        return line.to_string();
    }
    let mut clipped: String = line.chars().take(MAX_MESSAGE_CHARS - 1).collect();
    clipped.push('…');
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUICK: Duration = Duration::from_secs(5);

    async fn sh(script: &str, input: &str, timeout: Duration) -> RunResult {
        let args = vec!["-c".to_string(), script.to_string()];
        run_tool(Path::new("/bin/sh"), &args, Path::new("/"), input, timeout).await
    }

    fn finished(exit_code: i32, stdout: &str, stderr: &str) -> RunResult {
        RunResult::Finished {
            exit_code: Some(exit_code),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[tokio::test]
    async fn stdin_reaches_the_tool_and_stdout_comes_back() {
        let outcome = judge("shfmt", "b\na\n", sh("sort", "b\na\n", QUICK).await);
        assert_eq!(
            outcome,
            FormatOutcome::Formatted {
                content: "a\nb\n".into(),
                formatter: "shfmt".into()
            }
        );
    }

    #[tokio::test]
    async fn output_equal_to_the_input_is_unchanged() {
        let outcome = judge("gofmt", "same\n", sh("cat", "same\n", QUICK).await);
        assert_eq!(
            outcome,
            FormatOutcome::Unchanged {
                formatter: "gofmt".into()
            }
        );
    }

    #[tokio::test]
    async fn a_large_input_does_not_deadlock_on_full_pipes() {
        let input = "x".repeat(4 * 1024 * 1024);
        let outcome = judge("prettier", &input, sh("cat", &input, QUICK).await);
        assert!(matches!(outcome, FormatOutcome::Unchanged { .. }));
    }

    #[tokio::test]
    async fn a_tool_that_outlives_the_timeout_is_stopped_and_failed() {
        // The first call reads the login shell's environment; keep that out
        // of the clock.
        crate::agents::cached_login_shell_env().await;
        let started = std::time::Instant::now();
        let result = sh("sleep 5", "x", Duration::from_millis(200)).await;
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(
            judge("ruff", "x", result),
            FormatOutcome::Failed {
                formatter: "ruff".into(),
                message: "ruff did not finish within 200 ms and was stopped.".into()
            }
        );
        let ten = judge("ruff", "x", RunResult::TimedOut(Duration::from_secs(10)));
        assert!(matches!(ten, FormatOutcome::Failed { message, .. }
            if message == "ruff did not finish within 10 seconds and was stopped."));
    }

    #[tokio::test]
    async fn a_program_that_cannot_start_is_failed() {
        let result = run_tool(
            Path::new("/definitely/not/here"),
            &[],
            Path::new("/"),
            "x",
            QUICK,
        )
        .await;
        let FormatOutcome::Failed { message, .. } = judge("black", "x", result) else {
            panic!("expected failed");
        };
        assert!(
            message.starts_with("black could not be started"),
            "{message}"
        );
    }

    #[test]
    fn empty_output_for_real_input_is_a_failure_not_an_empty_file() {
        assert_eq!(
            judge("prettier", "const a = 1;\n", finished(0, "", "")),
            FormatOutcome::Failed {
                formatter: "prettier".into(),
                message: "prettier printed nothing for a file that is not empty.".into()
            }
        );
        assert_eq!(
            judge("prettier", "  \n", finished(0, "", "")),
            FormatOutcome::Formatted {
                content: String::new(),
                formatter: "prettier".into()
            }
        );
    }

    #[test]
    fn a_non_zero_exit_fails_with_the_cleaned_first_line_even_with_stdout() {
        let stderr = "\u{1b}[31m[error]\u{1b}[39m a.ts: SyntaxError: ';' expected. (1:7)\n\
                      [error] > 1 | const\n";
        assert_eq!(
            judge("prettier", "const", finished(2, "const", stderr)),
            FormatOutcome::Failed {
                formatter: "prettier".into(),
                message: "a.ts: SyntaxError: ';' expected. (1:7)".into()
            }
        );
    }

    #[test]
    fn a_non_zero_exit_without_output_names_the_code() {
        assert_eq!(
            judge("gofmt", "x", finished(2, "", "  \n")),
            FormatOutcome::Failed {
                formatter: "gofmt".into(),
                message: "gofmt exited with code 2.".into()
            }
        );
        let signalled = RunResult::Finished {
            exit_code: None,
            stdout: vec![],
            stderr: vec![],
        };
        assert!(matches!(judge("gofmt", "x", signalled),
            FormatOutcome::Failed { message, .. } if message == "gofmt was stopped by a signal."));
    }

    #[test]
    fn output_that_is_not_utf8_is_failed() {
        let result = RunResult::Finished {
            exit_code: Some(0),
            stdout: vec![0xff, 0xfe],
            stderr: vec![],
        };
        assert!(matches!(
            judge("shfmt", "x", result),
            FormatOutcome::Failed { .. }
        ));
    }

    #[test]
    fn a_traceback_becomes_its_exception_line() {
        let traceback =
            "Traceback (most recent call last):\n  File \"/x/black\", line 8, in <module>\n    \
                         sys.exit(main())\nModuleNotFoundError: No module named 'black'\n";
        assert_eq!(
            summarize(traceback).as_deref(),
            Some("ModuleNotFoundError: No module named 'black'")
        );
    }

    #[test]
    fn box_drawing_and_markers_are_trimmed_and_long_lines_clipped() {
        let biome = "━━━━━━━━━━\n  × Expected a semicolon here.  ━━━━\n";
        assert_eq!(
            summarize(biome).as_deref(),
            Some("Expected a semicolon here.")
        );
        let long = "e".repeat(500);
        let clipped = summarize(&long).unwrap();
        assert_eq!(clipped.chars().count(), MAX_MESSAGE_CHARS);
        assert!(clipped.ends_with('…'));
        assert_eq!(summarize("\n  \n──\n"), None);
    }
}
