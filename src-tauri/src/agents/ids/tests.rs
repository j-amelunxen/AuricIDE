use super::*;
use chrono::NaiveDate;
use std::collections::HashSet;

/// A local time on the day `yyMMdd`, at the given hour.
fn at(day: u32, hour: u32) -> NaiveDateTime {
    let (yy, mm, dd) = (day / 10_000, day / 100 % 100, day % 100);
    NaiveDate::from_ymd_opt(2000 + i32::try_from(yy).unwrap(), mm, dd)
        .unwrap()
        .and_hms_opt(hour, 0, 0)
        .unwrap()
}

fn state(day: u32, seq: u64) -> IdState {
    IdState { day, seq }
}

fn write_state(dir: &Path, day: u32, seq: u64) {
    std::fs::write(
        dir.join(STATE_FILE_NAME),
        format!("{{\"version\":1,\"day\":{day},\"seq\":{seq}}}"),
    )
    .unwrap();
}

#[test]
fn a_later_day_starts_over_and_the_same_day_counts_on() {
    assert_eq!(next(state(261101, 4), 261102), state(261102, 1));
    assert_eq!(next(state(261101, 4), 261101), state(261101, 5));
    assert_eq!(next(IdState::NONE, 261101), state(261101, 1));
}

#[test]
fn a_clock_set_back_keeps_the_stored_day() {
    assert_eq!(next(state(261101, 4), 261031), state(261101, 5));
    assert_eq!(next(state(270101, 9), 261101), state(270101, 10));
}

#[test]
fn ids_render_with_a_six_digit_day() {
    assert_eq!(render(state(261101, 4)), "agent-261101-4");
    assert_eq!(render(state(10101, 12)), "agent-010101-12");
}

#[test]
fn a_dated_id_is_never_a_legacy_id() {
    let legacy = regex_like_legacy;
    for id in ["agent-261101-4", "agent-010101-1", "agent-270101-99999"] {
        assert!(!legacy(id), "{id}");
        assert!(parse_dated(id).is_some(), "{id}");
    }
    for id in ["agent-4", "agent-12", "agent-261101"] {
        assert!(legacy(id), "{id}");
        assert_eq!(parse_dated(id), None, "{id}");
    }
}

fn regex_like_legacy(id: &str) -> bool {
    id.strip_prefix("agent-")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

#[test]
fn parse_dated_round_trips_and_refuses_other_shapes() {
    assert_eq!(parse_dated("agent-261101-4"), Some(state(261101, 4)));
    assert_eq!(parse_dated(&render(state(10101, 7))), Some(state(10101, 7)));
    for bad in [
        "agent-26110-4",
        "agent-2611011-4",
        "agent-261101-",
        "agent-261101-x",
        "agent-261101-4-5",
        "agent-+61101-4",
        "agent-agent-3",
        "shell-261101-4",
    ] {
        assert_eq!(parse_dated(bad), None, "{bad}");
    }
}

#[test]
fn an_agent_id_passes_the_terminal_session_round_trip() {
    let id = render(state(261101, 4));
    let session = format!("agent-{id}");
    assert_eq!(session, "agent-agent-261101-4");
    assert_eq!(
        crate::agents::human_draft::agent_of_session(&session),
        Some(id.as_str())
    );
}

#[test]
fn in_memory_allocation_follows_the_rule() {
    let mut allocator = IdAllocator::in_memory();
    assert_eq!(
        allocator.allocate_at(at(261101, 9)).unwrap(),
        "agent-261101-1"
    );
    assert_eq!(
        allocator.allocate_at(at(261101, 10)).unwrap(),
        "agent-261101-2"
    );
    assert_eq!(
        allocator.allocate_at(at(261102, 1)).unwrap(),
        "agent-261102-1"
    );
    assert_eq!(
        allocator.allocate_at(at(261101, 1)).unwrap(),
        "agent-261102-2"
    );
}

#[test]
fn a_missing_file_is_a_first_run() {
    let dir = tempfile::tempdir().unwrap();
    let mut allocator = IdAllocator::durable(dir.path());
    assert_eq!(
        allocator.allocate_at(at(261101, 9)).unwrap(),
        "agent-261101-1"
    );
    let saved = std::fs::read_to_string(dir.path().join(STATE_FILE_NAME)).unwrap();
    assert!(
        saved.contains("\"day\":261101") && saved.contains("\"seq\":1"),
        "{saved}"
    );
}

#[cfg(unix)]
#[test]
fn the_state_file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    IdAllocator::durable(dir.path())
        .allocate_at(at(261101, 9))
        .unwrap();
    let mode = std::fs::metadata(dir.path().join(STATE_FILE_NAME))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn the_state_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let first = IdAllocator::durable(dir.path())
        .allocate_at(at(261101, 9))
        .unwrap();
    let second = IdAllocator::durable(dir.path())
        .allocate_at(at(261101, 9))
        .unwrap();
    assert_eq!(
        (first.as_str(), second.as_str()),
        ("agent-261101-1", "agent-261101-2")
    );
}

#[test]
fn a_corrupt_file_is_reseeded_from_the_seconds_since_midnight_and_overwritten() {
    for garbage in ["", "{", "not json", "{\"version\":2,\"day\":1,\"seq\":1}"] {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(STATE_FILE_NAME), garbage).unwrap();
        let mut allocator = IdAllocator::durable(dir.path());
        // 10:00 is 36000 seconds into the day.
        assert_eq!(
            allocator.allocate_at(at(261101, 10)).unwrap(),
            "agent-261101-36001"
        );
        assert_eq!(
            allocator.allocate_at(at(261101, 10)).unwrap(),
            "agent-261101-36002"
        );
        match load(&dir.path().join(STATE_FILE_NAME)) {
            Loaded::Valid(saved) => assert_eq!(saved, state(261101, 36002)),
            _ => panic!("the file was not rewritten for {garbage:?}"),
        }
    }
}

#[test]
fn restored_agents_raise_the_floor_when_the_file_is_lost() {
    let dir = tempfile::tempdir().unwrap();
    let mut allocator = IdAllocator::durable(dir.path());
    allocator.raise_floor(state(261101, 40));
    allocator.raise_floor(state(261101, 12));
    assert_eq!(
        allocator.allocate_at(at(261101, 9)).unwrap(),
        "agent-261101-41"
    );
}

#[test]
fn a_failed_save_hands_out_no_id() {
    let dir = tempfile::tempdir().unwrap();
    // The "folder" is a file, so neither lock nor state can be created in it.
    let blocker = dir.path().join("blocker");
    std::fs::write(&blocker, "").unwrap();
    let mut allocator = IdAllocator::durable(&blocker);
    assert!(allocator.allocate_at(at(261101, 9)).is_err());
    let mut refusing = IdAllocator::unavailable("no folder");
    assert_eq!(
        refusing.allocate_at(at(261101, 9)),
        Err("no folder".to_string())
    );
}

#[test]
fn allocators_in_threads_sharing_one_file_never_issue_the_same_id() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let workers: Vec<_> = (0..6)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                // Each worker is its own "process": own allocator, own descriptor.
                let mut allocator = IdAllocator::durable(&path);
                (0..40)
                    .map(|_| allocator.allocate_at(at(261101, 9)).unwrap())
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    let all: Vec<String> = workers
        .into_iter()
        .flat_map(|worker| worker.join().unwrap())
        .collect();
    let unique: HashSet<&String> = all.iter().collect();
    assert_eq!(all.len(), 240);
    assert_eq!(unique.len(), 240);
    assert!(unique.contains(&"agent-261101-240".to_string()));
}

/// Replays `verification/contracts/agent-ids-v1.jsonl`, written by the Lean
/// model, against the real rule, renderer and state file.
#[test]
fn the_lean_corpus_replays_against_the_rust_allocator() {
    let corpus = include_str!("../../../../verification/contracts/agent-ids-v1.jsonl");
    let mut traces = 0;
    for line in corpus.lines() {
        let trace: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(trace["version"], "agent-ids-v1");
        let dir = tempfile::tempdir().unwrap();
        let start = &trace["start"];
        if start["day"].as_u64() != Some(0) {
            write_state(
                dir.path(),
                u32::try_from(start["day"].as_u64().unwrap()).unwrap(),
                start["seq"].as_u64().unwrap(),
            );
        }
        let mut allocator = IdAllocator::durable(dir.path());
        let mut pure = IdState {
            day: u32::try_from(start["day"].as_u64().unwrap()).unwrap(),
            seq: start["seq"].as_u64().unwrap(),
        };
        let ops = trace["ops"].as_array().unwrap();
        let ids = trace["ids"].as_array().unwrap();
        assert_eq!(ops.len(), ids.len());
        for (op, expected) in ops.iter().zip(ids) {
            let today = u32::try_from(op["today"].as_u64().unwrap()).unwrap();
            let name = trace["name"].as_str().unwrap();
            match op["op"].as_str().unwrap() {
                "alloc" => {
                    pure = next(pure, today);
                    let id = allocator.allocate_at(at(today, 9)).unwrap();
                    assert_eq!(expected.as_str(), Some(id.as_str()), "{name}");
                    assert_eq!(render(pure), id, "{name}");
                }
                "crash" => {
                    pure = next(pure, today);
                    allocator.allocate_at(at(today, 9)).unwrap();
                    assert!(expected.is_null(), "{name}");
                }
                "restart" => {
                    allocator = IdAllocator::durable(dir.path());
                    assert!(expected.is_null(), "{name}");
                }
                other => panic!("unknown op {other}"),
            }
        }
        traces += 1;
    }
    assert!(traces >= 40, "{traces} traces");
}
