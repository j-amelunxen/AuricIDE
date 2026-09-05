use crate::{agents, utf8_stream};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::Mutex as AsyncMutex;

pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, Arc<AsyncMutex<TerminalSession>>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

pub struct TerminalSession {
    pub writer: Option<Box<dyn Write + Send>>,
    pub master: Option<Box<dyn MasterPty + Send>>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn shell_spawn(
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            println!("Session '{}' already exists, skipping spawn", id);
            return Ok(());
        }
    }

    println!("Spawning PTY shell '{}' with id '{}'", command, id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(args);
    if let Some(ref c) = cwd {
        cmd.cwd(c);
    }
    // GUI apps on macOS launch with a minimal PATH — give terminal sessions
    // the same login-shell environment agents get (see agents.rs).
    for (key, value) in agents::cached_login_shell_env().await {
        cmd.env(key, value);
    }
    // Ensure child processes see a proper terminal type.
    // GUI apps on macOS do not inherit TERM from the user's shell.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(pair.master),
    }));

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.clone(), session);
    }

    let app_stdout = app.clone();
    let id_stdout = id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 16_384];
        let mut decoder = utf8_stream::Utf8StreamDecoder::new();
        let mut accumulated = String::new();
        let mut last_emit = std::time::Instant::now();
        let batch_interval = std::time::Duration::from_millis(16);

        loop {
            let n = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };

            // Decode only complete UTF-8 sequences; the decoder keeps trailing
            // incomplete bytes for the next read.
            accumulated.push_str(&decoder.push(&buffer[..n]));

            // Emit batched output every ~16 ms or when the buffer is large enough
            if last_emit.elapsed() >= batch_interval || accumulated.len() > 32_000 {
                if !accumulated.is_empty() {
                    let batch = std::mem::take(&mut accumulated);
                    let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), batch);
                }
                last_emit = std::time::Instant::now();
            }
        }

        // Flush any remaining data
        accumulated.push_str(&decoder.finish());
        if !accumulated.is_empty() {
            let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), accumulated);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn shell_write(
    id: String,
    data: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned().ok_or("Session not found")?
    };

    let mut session = session_arc.lock().await;
    if let Some(ref mut writer) = session.writer {
        if let Err(e) = writer.write_all(data.as_bytes()) {
            let err_msg = e.to_string();
            println!("I/O Error writing to session '{}': {}", id, err_msg);
            drop(session);
            let mut sessions = state.sessions.lock().unwrap();
            sessions.remove(&id);
            return Err(format!("Terminal session closed: {}", err_msg));
        }
        let _ = writer.flush();
    }
    Ok(())
}

#[tauri::command]
pub async fn shell_resize(
    id: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned().ok_or("Session not found")?
    };

    let session = session_arc.lock().await;
    if let Some(ref master) = session.master {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
