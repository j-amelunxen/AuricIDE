//! Reads the ChatGPT quota out of `codex app-server`.
//!
//! `codex app-server` speaks JSON-RPC over stdio. The exchange is short — an
//! `initialize` handshake, then `account/rateLimits/read` — so each reading
//! spawns its own child and lets it go again. A resident server would need
//! crash detection, restart-with-backoff and shutdown handling, and would hold
//! the user's OAuth session open for the lifetime of the app, all to save a
//! process spawn every half hour.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::contract::{
    normalize_codex, parse_wire, CodexRateLimitsResponse, UsageError, UsageSnapshot,
};

const SOURCE: &str = "codex";

/// Budget for the whole exchange, not per message.
const EXCHANGE_TIMEOUT_SECS: u64 = 5;

/// Reads the current rate limits. `env` is the cached login-shell environment;
/// its `PATH` is what the binary is resolved against.
pub async fn read_codex_limits(
    env: &[(String, String)],
    observed_at: i64,
) -> Result<UsageSnapshot, UsageError> {
    // `Command` resolves a bare program name against the PATH of the *calling*
    // process, not the one handed to `.envs()`. A packaged app launched from
    // Finder has a minimal PATH, so the binary is resolved by hand first.
    let binary = env
        .iter()
        .find(|(key, _)| key == "PATH")
        .and_then(|(_, path)| crate::mcp::find_in_path("codex", path))
        .ok_or_else(|| UsageError::Unavailable {
            source: SOURCE.to_string(),
            detail: "`codex` is not on PATH".to_string(),
        })?;

    let exchange = run_exchange(&binary, env);
    let body =
        match tokio::time::timeout(Duration::from_secs(EXCHANGE_TIMEOUT_SECS), exchange).await {
            Ok(result) => result?,
            // Dropping the future drops the child, and `kill_on_drop` reaps it.
            Err(_) => {
                return Err(UsageError::Timeout {
                    source: SOURCE.to_string(),
                    seconds: EXCHANGE_TIMEOUT_SECS,
                })
            }
        };

    let raw: CodexRateLimitsResponse = parse_wire(SOURCE, &body)?;
    Ok(normalize_codex(raw, observed_at))
}

/// Spawns the server, walks the handshake, and returns the `result` object of
/// `account/rateLimits/read` as raw JSON.
async fn run_exchange(
    binary: &std::path::Path,
    env: &[(String, String)],
) -> Result<String, UsageError> {
    let unavailable = |detail: String| UsageError::Unavailable {
        source: SOURCE.to_string(),
        detail,
    };

    let mut child = Command::new(binary)
        .arg("app-server")
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| unavailable(format!("could not start `codex app-server`: {e}")))?;

    // An undrained stderr pipe blocks the child once ~64KB accumulate, which
    // would strand the exchange mid-handshake. `codex app-server` is marked
    // experimental and is chatty, so this is not theoretical.
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut stderr = stderr;
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        });
    }

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| unavailable("stdin was not piped".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| unavailable("stdout was not piped".to_string()))?;
    let mut lines = BufReader::new(stdout).lines();

    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": { "clientInfo": { "name": "auric-ide", "title": "AuricIDE", "version": env!("CARGO_PKG_VERSION") } },
        }),
    )
    .await?;
    read_response(&mut lines, 0).await?;

    send(
        &mut stdin,
        &serde_json::json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }),
    )
    .await?;
    send(
        &mut stdin,
        &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "account/rateLimits/read", "params": {} }),
    )
    .await?;
    let result = read_response(&mut lines, 1).await?;

    let _ = child.kill().await;
    let _ = child.wait().await;

    Ok(result)
}

async fn send(
    stdin: &mut tokio::process::ChildStdin,
    message: &serde_json::Value,
) -> Result<(), UsageError> {
    let mut line = message.to_string();
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| UsageError::Unavailable {
            source: SOURCE.to_string(),
            detail: format!("could not write to `codex app-server`: {e}"),
        })?;
    stdin.flush().await.map_err(|e| UsageError::Unavailable {
        source: SOURCE.to_string(),
        detail: format!("could not flush to `codex app-server`: {e}"),
    })
}

/// Reads until the response to `id` arrives, returning its `result` as JSON.
///
/// Skipping is deliberate on two counts: the server volunteers notifications
/// mid-exchange, and a server→client *request* carries an id as well as a
/// method — so a message with a `method` is never our answer, whatever its id.
async fn read_response<R>(
    lines: &mut tokio::io::Lines<BufReader<R>>,
    id: u64,
) -> Result<String, UsageError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| UsageError::Unavailable {
            source: SOURCE.to_string(),
            detail: format!("could not read from `codex app-server`: {e}"),
        })?
    {
        // Startup banners and progress chatter are not JSON; skipping them is
        // cheaper and steadier than trying to enumerate them.
        let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if message.get("method").is_some() {
            continue;
        }
        if message.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(UsageError::Contract {
                source: SOURCE.to_string(),
                detail: format!("request {id} was rejected: {error}"),
            });
        }
        return message
            .get("result")
            .map(ToString::to_string)
            .ok_or_else(|| UsageError::Contract {
                source: SOURCE.to_string(),
                detail: format!("response {id} carried neither `result` nor `error`"),
            });
    }

    Err(UsageError::Unavailable {
        source: SOURCE.to_string(),
        detail: format!("`codex app-server` closed before answering request {id}"),
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    const OBSERVED_AT: i64 = 1_787_300_000;

    fn write_executable(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).expect("stub must be creatable");
        file.write_all(contents.as_bytes())
            .expect("stub must write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("stub must be executable");
    }

    /// The stub directory in front of the real PATH. Prepending rather than
    /// replacing matters: the stubs are `sh` scripts and call `sleep` and
    /// `awk`, so a PATH holding only the temp dir would make them exit
    /// instantly and quietly turn the tests below into assertions about
    /// nothing.
    fn path_env(dir: &Path) -> Vec<(String, String)> {
        let inherited = std::env::var("PATH").unwrap_or_default();
        vec![(
            "PATH".to_string(),
            format!("{}:{}", dir.display(), inherited),
        )]
    }

    /// A stub that answers the handshake and then the rate-limit read, with an
    /// unsolicited notification wedged in between — exactly what the real
    /// `codex app-server` did when this was probed by hand.
    fn stub_script(result_json: &str) -> String {
        format!(
            r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"initialize"'*)
      printf '%s\n' '{{"id":0,"result":{{"codexHome":"/tmp"}}}}'
      ;;
    *'"account/rateLimits/read"'*)
      printf '%s\n' '{{"method":"remoteControl/status/changed","params":{{}}}}'
      printf '%s\n' '{{"id":1,"result":{result_json}}}'
      ;;
  esac
done
"#
        )
    }

    fn compact_fixture(raw: &str) -> String {
        let value: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");
        serde_json::to_string(&value).expect("fixture re-serializes")
    }

    #[tokio::test]
    async fn reads_the_weekly_window_through_the_handshake() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = compact_fixture(include_str!(
            "../../../fixtures/usage-limits/codex.rate-limits.json"
        ));
        write_executable(dir.path(), "codex", &stub_script(&fixture));

        let snapshot = read_codex_limits(&path_env(dir.path()), OBSERVED_AT)
            .await
            .expect("stub answers");

        assert_eq!(snapshot.provider, "codex");
        assert_eq!(snapshot.source, "app-server");
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.windows[0].window_minutes, 10080);
        assert_eq!(snapshot.observed_at, OBSERVED_AT);
    }

    #[tokio::test]
    async fn an_unsolicited_notification_is_not_mistaken_for_the_answer() {
        // The stub emits `remoteControl/status/changed` before the response.
        // Matching on `id` alone is not enough — a server→client *request*
        // carries both an id and a method.
        let dir = tempfile::tempdir().unwrap();
        let fixture = compact_fixture(include_str!(
            "../../../fixtures/usage-limits/codex.rate-limits.both-windows.json"
        ));
        let script = stub_script(&fixture).replace(
            r#"printf '%s\n' '{"method":"remoteControl/status/changed","params":{}}'"#,
            r#"printf '%s\n' '{"id":1,"method":"someServerRequest","params":{}}'"#,
        );
        write_executable(dir.path(), "codex", &script);

        let snapshot = read_codex_limits(&path_env(dir.path()), OBSERVED_AT)
            .await
            .expect("stub answers");
        assert_eq!(snapshot.windows.len(), 2);
    }

    #[tokio::test]
    async fn a_missing_binary_is_unavailable_not_a_panic() {
        // Deliberately not `path_env`: this one must not see a real `codex`
        // that happens to be installed on the machine running the suite.
        let dir = tempfile::tempdir().unwrap();
        let empty = vec![("PATH".to_string(), dir.path().display().to_string())];
        let error = read_codex_limits(&empty, OBSERVED_AT)
            .await
            .expect_err("nothing to run");
        assert!(
            error.to_string().starts_with("USAGE_UNAVAILABLE:"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a_silent_server_times_out_instead_of_hanging() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(dir.path(), "codex", "#!/bin/sh\nsleep 30\n");

        let error = read_codex_limits(&path_env(dir.path()), OBSERVED_AT)
            .await
            .expect_err("nothing ever answers");
        assert!(error.to_string().starts_with("USAGE_TIMEOUT:"), "{error}");
    }

    #[tokio::test]
    async fn a_chatty_stderr_does_not_deadlock_the_handshake() {
        // An undrained stderr pipe blocks the child once ~64KB accumulate,
        // which would strand the exchange mid-handshake.
        let dir = tempfile::tempdir().unwrap();
        let fixture = compact_fixture(include_str!(
            "../../../fixtures/usage-limits/codex.rate-limits.json"
        ));
        let noisy = format!(
            "#!/bin/sh\nawk 'BEGIN {{ for (i = 0; i < 20000; i++) print \"noise noise noise noise\" }}' >&2\n{}",
            stub_script(&fixture).trim_start_matches("#!/bin/sh\n")
        );
        write_executable(dir.path(), "codex", &noisy);

        let snapshot = read_codex_limits(&path_env(dir.path()), OBSERVED_AT)
            .await
            .expect("stderr volume must not matter");
        assert_eq!(snapshot.windows.len(), 1);
    }

    #[tokio::test]
    async fn a_malformed_answer_names_the_field() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = compact_fixture(include_str!(
            "../../../fixtures/usage-limits/codex.rate-limits.wrong-type.json"
        ));
        write_executable(dir.path(), "codex", &stub_script(&fixture));

        let error = read_codex_limits(&path_env(dir.path()), OBSERVED_AT)
            .await
            .expect_err("a string percentage must not parse");
        let message = error.to_string();
        assert!(message.starts_with("USAGE_CONTRACT: codex:"), "{message}");
        assert!(message.contains("usedPercent"), "{message}");
    }
}
