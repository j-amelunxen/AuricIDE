//! The Rust half of `scripts/probe-project-manager.mjs`.
//!
//! Promote, rename, archive, restore, remove and the runs list are Tauri
//! commands, and nothing outside the webview can call one. The probe needs
//! them against an isolated running app, so it runs this ignored test, which
//! calls the very functions those commands wrap (`managers::promote` & co.,
//! `runs::list_runs` + `attach_managers`) on that app's files. The commands
//! add only the path lookup, plus one step this cannot reach: keying a
//! supervisor that is live while it is promoted.
//!
//! Input is the environment, output one `PROBE_RESULT <json>` line per step:
//!
//!   AURIC_PROBE_APP_DATA   the isolated app data dir (holds supervisor-managers.json)
//!   AURIC_PROBE_RUNS_ROOT  its ~/.auric/supervisors
//!   AURIC_PROBE_OPS        [{"op":"promote","runDir":…,"name":…}, {"op":"rename","key":…,"name":…},
//!                           {"op":"archive"|"restore"|"remove","key":…}, {"op":"list"}, {"op":"runs"}]

use super::managers::{self, REGISTRY_FILE_NAME};
use super::runs::list_runs;
use serde_json::{json, Value};
use std::path::PathBuf;

fn text(step: &Value, field: &str) -> String {
    step[field].as_str().unwrap_or_default().to_string()
}

fn answer<T: serde::Serialize>(result: Result<T, String>) -> Value {
    match result {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[test]
#[ignore = "driven by scripts/probe-project-manager.mjs against an isolated app"]
fn project_manager_probe_driver() {
    let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set"));
    let registry = PathBuf::from(var("AURIC_PROBE_APP_DATA")).join(REGISTRY_FILE_NAME);
    let runs_root = PathBuf::from(var("AURIC_PROBE_RUNS_ROOT"));
    let steps: Vec<Value> = serde_json::from_str(&var("AURIC_PROBE_OPS")).expect("AURIC_PROBE_OPS");
    for step in steps {
        let key = text(&step, "key");
        let result = match text(&step, "op").as_str() {
            "promote" => answer(managers::promote(
                &registry,
                &runs_root,
                &text(&step, "runDir"),
                &text(&step, "name"),
                &[],
            )),
            "rename" => answer(managers::rename(&registry, &key, &text(&step, "name"))),
            "archive" => answer(managers::archive(&registry, &key)),
            "restore" => answer(managers::restore(&registry, &key)),
            "remove" => answer(managers::remove(&registry, &key)),
            "list" => answer(Ok(managers::list(&registry))),
            "runs" => {
                let mut runs = list_runs(&runs_root);
                managers::attach_managers(&mut runs, &managers::list(&registry).managers);
                answer(Ok(runs))
            }
            other => answer::<()>(Err(format!("unknown op {other}"))),
        };
        println!("PROBE_RESULT {result}");
    }
}
