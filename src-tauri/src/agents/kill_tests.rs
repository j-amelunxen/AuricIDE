//! Native stop failures at the production manager/PTY claim boundary.
use super::*;
use portable_pty::{Child, ChildKiller, ExitStatus};
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};

#[derive(Clone, Debug, Default)]
struct NativeChild {
    attempts: Arc<AtomicUsize>,
    fail_next: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    gate: Option<Arc<(mpsc::SyncSender<()>, Mutex<mpsc::Receiver<()>>)>>,
}

impl ChildKiller for NativeChild {
    fn kill(&mut self) -> io::Result<()> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = self.gate.take() {
            gate.0.send(()).unwrap();
            gate.1
                .lock()
                .unwrap()
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
        }
        if self.fail_next.swap(false, Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected native kill denied",
            ));
        }
        self.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(self.clone())
    }
}

impl Child for NativeChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(self
            .stopped
            .load(Ordering::SeqCst)
            .then(|| ExitStatus::with_exit_code(0)))
    }
    fn wait(&mut self) -> io::Result<ExitStatus> {
        Ok(ExitStatus::with_exit_code(0))
    }
    fn process_id(&self) -> Option<u32> {
        None
    }
    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        None
    }
}

#[derive(Clone, Default)]
struct WriterProbe {
    bytes: Arc<Mutex<Vec<u8>>>,
    drops: Arc<AtomicUsize>,
}
impl Write for WriterProbe {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl Drop for WriterProbe {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}

async fn registered(
    state: &AgentManagerState,
    terminals: &TerminalState,
    id: &str,
    repo: &str,
    child: NativeChild,
) -> WriterProbe {
    let pty = AgentPty::new(id, terminals);
    let probe = WriterProbe::default();
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    pty.prepare(Box::new(probe.clone()), pair.master).publish();
    state.lock().await.agents.insert(
        id.into(),
        AgentSession {
            info: super::super::tests::session_info(id, Some(repo)),
            child: Box::new(child),
            pty,
            launch_request_uid: Some("launch-native".into()),
            usage: None,
            launch_file: None,
        },
    );
    probe
}

#[tokio::test]
async fn native_failure_keeps_the_same_session_writer_and_launch_file_for_retry() {
    let state = new_agent_manager_state();
    let terminals = TerminalState::default();
    let child = NativeChild::default();
    child.fail_next.store(true, Ordering::SeqCst);
    let probe = registered(&state, &terminals, "agent-1", "/repo", child.clone()).await;
    let file = tempfile::NamedTempFile::new().unwrap().into_temp_path();
    let path = file.to_path_buf();
    file.keep().unwrap();
    state
        .lock()
        .await
        .agents
        .get_mut("agent-1")
        .unwrap()
        .launch_file = Some(OwnedFile(path.clone()));
    let key = super::super::pty::agent_session_id("agent-1");
    let original = terminals
        .sessions
        .lock()
        .unwrap()
        .get(&key)
        .unwrap()
        .clone();
    let error = claim_killed_agent(&state, "agent-1")
        .await
        .err()
        .expect("native failure must reach caller");
    assert!(error.contains("agent-1") && error.contains("injected native kill denied"));
    {
        let manager = state.lock().await;
        let session = manager.agents.get("agent-1").unwrap();
        assert_eq!(session.launch_request_uid.as_deref(), Some("launch-native"));
        assert_eq!(session.info.status, AgentStatus::Running);
    }
    assert!(Arc::ptr_eq(
        &original,
        terminals.sessions.lock().unwrap().get(&key).unwrap()
    ));
    drop(original);
    super::super::pty::write_to_session(&terminals, &key, "retry input")
        .await
        .unwrap();
    assert_eq!(*probe.bytes.lock().unwrap(), b"retry input");
    assert!(path.exists());
    assert_eq!(probe.drops.load(Ordering::SeqCst), 0);
    let claimed = claim_killed_agent(&state, "agent-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(child.attempts.load(Ordering::SeqCst), 2);
    assert!(!state.lock().await.agents.contains_key("agent-1"));
    assert!(!terminals.sessions.lock().unwrap().contains_key(&key));
    assert_eq!(probe.drops.load(Ordering::SeqCst), 1);
    assert!(claim_agent(&state, "agent-1").await.is_none());
    drop(claimed);
    assert!(!path.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_eof_waiting_during_failed_native_kill_can_still_claim_the_run() {
    let state = new_agent_manager_state();
    let terminals = TerminalState::default();
    let (entered, received) = mpsc::sync_channel(1);
    let (release, released) = mpsc::sync_channel(1);
    let child = NativeChild {
        gate: Some(Arc::new((entered, Mutex::new(released)))),
        ..Default::default()
    };
    child.fail_next.store(true, Ordering::SeqCst);
    let probe = registered(&state, &terminals, "agent-1", "/repo", child.clone()).await;
    let kill_state = state.clone();
    let kill = tokio::spawn(async move { claim_killed_agent(&kill_state, "agent-1").await });
    received
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    // EOF must wait on the same manager lock rather than see a removed session.
    let manager_locked = state.try_lock().is_err();
    let exit_state = state.clone();
    let exit = tokio::spawn(async move { claim_agent(&exit_state, "agent-1").await });
    release.send(()).unwrap();
    assert!(
        manager_locked,
        "native kill must keep the registered manager entry locked"
    );
    assert!(kill.await.unwrap().is_err());
    let exited = exit
        .await
        .unwrap()
        .expect("EOF keeps the only finish claim after failed stop");
    assert_eq!(probe.drops.load(Ordering::SeqCst), 0);
    exited.pty.remove();
    assert_eq!(probe.drops.load(Ordering::SeqCst), 1);
    assert_eq!(child.attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn successful_native_claim_and_eof_have_exactly_one_winner() {
    for exit_first in [false, true] {
        let state = new_agent_manager_state();
        let terminals = TerminalState::default();
        let child = NativeChild::default();
        registered(&state, &terminals, "agent-1", "/repo", child.clone()).await;
        if exit_first {
            let (exit, kill) = tokio::join!(
                claim_agent(&state, "agent-1"),
                claim_killed_agent(&state, "agent-1")
            );
            assert!(exit.is_some());
            assert!(kill.unwrap().is_none());
            assert_eq!(child.attempts.load(Ordering::SeqCst), 0);
            exit.unwrap().pty.remove();
        } else {
            let (kill, exit) = tokio::join!(
                claim_killed_agent(&state, "agent-1"),
                claim_agent(&state, "agent-1")
            );
            assert!(kill.unwrap().is_some());
            assert!(exit.is_none());
            assert_eq!(child.attempts.load(Ordering::SeqCst), 1);
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn native_pty_child_is_terminated_through_the_production_kill_claim() {
    let state = new_agent_manager_state();
    let terminals = TerminalState::default();
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let mut command = CommandBuilder::new("sleep");
    command.arg("30");
    let child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let pty = AgentPty::new("agent-native", &terminals);
    pty.prepare(pair.master.take_writer().unwrap(), pair.master)
        .publish();
    state.lock().await.agents.insert(
        "agent-native".into(),
        AgentSession {
            info: super::super::tests::session_info("agent-native", Some("/repo")),
            child,
            pty,
            launch_request_uid: None,
            usage: None,
            launch_file: None,
        },
    );
    // A real input/resize operation may hold this alias after removal. Keep
    // the master open so PTY-close SIGHUP cannot hide an omitted native kill.
    let in_flight = terminals
        .sessions
        .lock()
        .unwrap()
        .get(&super::super::pty::agent_session_id("agent-native"))
        .unwrap()
        .clone();
    let mut claimed = claim_killed_agent(&state, "agent-native")
        .await
        .unwrap()
        .unwrap();
    let mut exited = false;
    for _ in 0..100 {
        if claimed.child.try_wait().unwrap().is_some() {
            exited = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    // Clean our own test process even when a deliberately injected fault made
    // the production helper omit the signal. The assertion still stays red.
    if !exited {
        let _ = claimed.child.kill();
        let _ = claimed.child.wait();
    }
    drop(in_flight);
    assert!(
        exited,
        "representative native child must actually exit after accepted kill"
    );
    assert!(!state.lock().await.agents.contains_key("agent-native"));
    assert!(!terminals
        .sessions
        .lock()
        .unwrap()
        .contains_key(&super::super::pty::agent_session_id("agent-native")));
}
