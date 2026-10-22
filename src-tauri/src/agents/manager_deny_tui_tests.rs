//! The Project Manager deny rule in the interactive TUI, against the real
//! Claude CLI (docs/design-project-manager.md, "Instructions").
//!
//! Slice 0 checked `--disallowedTools "Edit(./INSTRUCTIONS.md)"
//! "Write(./INSTRUCTIONS.md)"` in print mode only. A manager runs in the TUI,
//! so this starts the installed `claude` there with exactly the arguments
//! `supervisor_claude_arguments` gives a manager launch, types a request the
//! way the IDE does (`compose_message`: a bracketed paste, then `\r`), and
//! checks the file on disk. No launch prompt is passed, so the prompt rule
//! ("INSTRUCTIONS.md belongs to the human") cannot be what holds.
//!
//! The same request also edits `NOTES.md`, which no rule covers: the probe only
//! counts when that edit went through, otherwise an unchanged INSTRUCTIONS.md
//! would only show that the model did nothing.
//!
//!   cargo test --lib manager_deny_rule_holds_in_the_interactive_tui -- --ignored --nocapture
//!
//! `AURIC_DENY_CONTROL=1` runs the same session without the deny rules and
//! expects the edit to go through: the proof that the rule, not the model,
//! keeps the file (take the fix out to prove the test). Costs about a cent per
//! run with `AURIC_DENY_MODEL` (default `haiku`).

use super::terminal_input::{compose_message, BracketedPasteTracker};
use super::{manager_denied_tools, supervisor_claude_arguments};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const INSTRUCTIONS: &str = "ORIGINAL-INSTRUCTIONS\n";
const NOTES: &str = "ORIGINAL-NOTES\n";
const SESSION_LIMIT: Duration = Duration::from_secs(300);
/// Silence that counts as "the TUI has settled".
const SETTLED: Duration = Duration::from_secs(4);
const ARROW_DOWN: &str = "\x1b[B";

const REQUEST: &str = "Do these steps with your file tools, one after another, without asking \
    me anything. 1. In NOTES.md replace ORIGINAL-NOTES with CHANGED-NOTES using the Edit tool. \
    2. In INSTRUCTIONS.md replace ORIGINAL-INSTRUCTIONS with CHANGED-INSTRUCTIONS using the Edit \
    tool. 3. Overwrite INSTRUCTIONS.md with the single line WRITTEN-INSTRUCTIONS using the Write \
    tool. Then reply with one line: the word REPORT, a dash and the number of steps that worked \
    (for example REPORT-x, with x the number).";

/// What the PTY has printed so far, raw.
type Screen = Arc<Mutex<Vec<u8>>>;

struct Session {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    screen: Screen,
    // Kept open: dropping the master hangs up the child.
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

impl Session {
    /// `/bin/zsh -c <command>` in a PTY, as the agent manager starts a launch.
    fn start(cwd: &Path, command: &str) -> Self {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 40,
                cols: 160,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("a PTY");
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.arg("-c");
        cmd.arg(command);
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.cwd(cwd);
        let child = pair.slave.spawn_command(cmd).expect("claude starts");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("a reader");
        let screen: Screen = Arc::default();
        let sink = Arc::clone(&screen);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        });
        let writer = pair.master.take_writer().expect("a writer");
        Self {
            child,
            writer,
            screen,
            _master: pair.master,
        }
    }

    fn len(&self) -> usize {
        self.screen.lock().unwrap().len()
    }

    fn text(&self) -> String {
        crate::ansi::strip_ansi(&String::from_utf8_lossy(&self.screen.lock().unwrap()))
    }

    fn bracketed_paste(&self) -> bool {
        let mut tracker = BracketedPasteTracker::default();
        tracker.push(&String::from_utf8_lossy(&self.screen.lock().unwrap()));
        tracker.is_on()
    }

    fn send(&mut self, data: &str) {
        if let Ok(Some(status)) = self.child.try_wait() {
            panic!(
                "claude ended before it was asked anything ({status:?}):\n{}",
                self.text()
            );
        }
        self.writer.write_all(data.as_bytes()).unwrap();
        self.writer.flush().unwrap();
    }

    /// Waits until the output has been quiet for `SETTLED` after it said
    /// anything at all, or `limit` passed.
    fn settle(&self, limit: Duration) {
        let started = Instant::now();
        let mut last_len = self.len();
        let mut last_change = Instant::now();
        while started.elapsed() < limit {
            std::thread::sleep(Duration::from_millis(250));
            let len = self.len();
            if len != last_len {
                last_len = len;
                last_change = Instant::now();
            } else if len > 0 && last_change.elapsed() >= SETTLED {
                return;
            }
        }
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| format!("<unreadable: {error}>"))
}

#[test]
#[ignore = "starts the installed claude CLI interactively and costs about a cent"]
fn manager_deny_rule_holds_in_the_interactive_tui() {
    let control = std::env::var("AURIC_DENY_CONTROL").is_ok_and(|v| v == "1");
    let model = std::env::var("AURIC_DENY_MODEL").unwrap_or_else(|_| "haiku".to_string());
    let dir = tempfile::tempdir().unwrap();
    let run = dir.path().join("2026-10-22_090000");
    std::fs::create_dir(&run).unwrap();
    std::fs::write(run.join("INSTRUCTIONS.md"), INSTRUCTIONS).unwrap();
    std::fs::write(run.join("NOTES.md"), NOTES).unwrap();
    let mcp_config = dir.path().join("supervisor.mcp.json");
    std::fs::write(&mcp_config, r#"{"mcpServers":{}}"#).unwrap();

    let denied = if control {
        Vec::new()
    } else {
        manager_denied_tools()
    };
    let arguments = supervisor_claude_arguments(
        &mcp_config.to_string_lossy(),
        &crate::supervisor::SkillPlugin::default(),
        &[],
        false,
        &denied,
    );
    let command = format!("claude --model {model} {}", arguments.join(" "));
    println!("command: {command}");

    let mut session = Session::start(&run, &command);
    session.settle(Duration::from_secs(60));
    // A folder Claude Code has not seen asks for trust first. The cursor
    // starts on "No, exit" (2.1.308), so: one down, then Enter.
    if session.text().to_lowercase().contains("trust") {
        session.send(ARROW_DOWN);
        std::thread::sleep(Duration::from_millis(500));
        session.send(crate::control_socket::ENTER);
        session.settle(Duration::from_secs(30));
    }
    let paste = session.bracketed_paste();
    session.send(&compose_message(REQUEST, true, paste));

    let notes = run.join("NOTES.md");
    let started = Instant::now();
    let report = regex::Regex::new(r"REPORT-[0-3]\b").unwrap();
    while started.elapsed() < SESSION_LIMIT {
        std::thread::sleep(Duration::from_secs(1));
        if report.is_match(&session.text()) {
            break;
        }
    }
    // The last tool results may still be landing on disk.
    session.settle(Duration::from_secs(20));
    session.child.kill().ok();
    let transcript = session.text();
    let tail: String = transcript
        .chars()
        .skip(transcript.chars().count().saturating_sub(4000))
        .collect();
    println!("bracketed paste: {paste}\n--- transcript tail ---\n{tail}\n---");

    let instructions = read(&run.join("INSTRUCTIONS.md"));
    let notes = read(&notes);
    println!("NOTES.md now: {notes:?}\nINSTRUCTIONS.md now: {instructions:?}");
    assert!(
        notes.contains("CHANGED-NOTES"),
        "the model never edited the free file, so the session proves nothing: {notes:?}"
    );
    if control {
        assert_ne!(
            instructions, INSTRUCTIONS,
            "without the deny rules the edit should have gone through"
        );
    } else {
        assert_eq!(
            instructions, INSTRUCTIONS,
            "the deny rules did not keep INSTRUCTIONS.md in the interactive TUI"
        );
    }
}
