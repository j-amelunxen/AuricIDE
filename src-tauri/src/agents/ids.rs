//! Agent ids that stay unique across runs and restarts.
//!
//! An id is `agent-<yyMMdd>-<seq>` (`agent-261101-4`): the local day it was
//! handed out and a counter that restarts on a new day. The second hyphen means
//! a new id can never equal a stored legacy `agent-<digits>` id, and
//! `supervisor::several::is_valid_key` keeps keys from taking either shape.
//!
//! The rule is one pure function, [`next`]: the pair `(day, seq)` strictly
//! increases under any clock behaviour, including a clock that went backwards
//! or a changed timezone (the old day is kept and the counter goes on). It is
//! modelled and proved in `verification/lean/AuricIDE/AgentIds.lean`, and the
//! corpus `verification/contracts/agent-ids-v1.jsonl` replays traces of it
//! against this file.
//!
//! What Lean does not model, and Rust tests cover: the state file
//! (`<app_data_dir>/agent-id-state.json`, 0600, temp file + fsync + rename),
//! and the advisory lock on `agent-id-state.json.lock` that keeps a dev build
//! and the installed build, which share that folder, from handing out the same
//! id. The state is written before the id leaves this module; a failed write
//! refuses the spawn.

use crate::json_store::{self, FileLock, Read};
use chrono::{Local, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// File name inside the app data folder.
pub const STATE_FILE_NAME: &str = "agent-id-state.json";
const LOCK_SUFFIX: &str = ".lock";
const ID_PREFIX: &str = "agent-";
/// `yyMMdd` is always six digits.
const DAY_WIDTH: usize = 6;

/// The last id handed out. `day` is `yyMMdd` as a number; `(0, 0)` is "none yet".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct IdState {
    pub day: u32,
    pub seq: u64,
}

impl IdState {
    pub const NONE: IdState = IdState { day: 0, seq: 0 };
}

/// The state after one allocation. A later day starts at 1; the same day, or a
/// day that is not later (clock set back), keeps the stored day and counts on.
pub fn next(state: IdState, today: u32) -> IdState {
    if today > state.day {
        IdState { day: today, seq: 1 }
    } else {
        IdState {
            day: state.day,
            seq: state.seq.saturating_add(1),
        }
    }
}

/// `agent-261101-4`.
pub fn render(state: IdState) -> String {
    format!(
        "{ID_PREFIX}{:0width$}-{}",
        state.day,
        state.seq,
        width = DAY_WIDTH
    )
}

/// Reads a dated id back (`agent-261101-4`). Legacy `agent-4` and anything else
/// give `None`.
pub fn parse_dated(id: &str) -> Option<IdState> {
    let (day, seq) = id.strip_prefix(ID_PREFIX)?.split_once('-')?;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if day.len() != DAY_WIDTH || !digits(day) || !digits(seq) {
        return None;
    }
    Some(IdState {
        day: day.parse().ok()?,
        seq: seq.parse().ok()?,
    })
}

/// `yyMMdd` of a local date-time.
pub fn day_number(now: NaiveDateTime) -> u32 {
    use chrono::Datelike;
    let year = u32::try_from(now.year().rem_euclid(100)).unwrap_or(0);
    year * 10_000 + now.month() * 100 + now.day()
}

#[derive(Serialize, Deserialize)]
struct StoredState {
    version: u32,
    day: u32,
    seq: u64,
}

fn load(path: &Path) -> Read<IdState> {
    match json_store::read_json::<StoredState>(path, Some(1)) {
        Read::Valid(stored) => Read::Valid(IdState {
            day: stored.day,
            seq: stored.seq,
        }),
        Read::Missing => Read::Missing,
        Read::Unreadable(reason) => Read::Unreadable(reason),
    }
}

fn store(path: &Path, state: IdState) -> Result<(), String> {
    let payload = serde_json::to_vec(&StoredState {
        version: 1,
        day: state.day,
        seq: state.seq,
    })
    .map_err(|error| error.to_string())?;
    json_store::write_atomic(path, &payload, json_store::Mode::Private)
}

/// Hands out ids. Durable when it has a state file, in memory otherwise (tests).
#[derive(Debug)]
pub struct IdAllocator {
    file: Option<PathBuf>,
    memory: IdState,
    /// Newest dated id among agents restored from disk: the allocator never
    /// goes below it, which covers a lost or damaged state file.
    floor: IdState,
    /// Set when the durable store could not be set up: every allocation is
    /// refused rather than served from memory, where ids would repeat.
    refusal: Option<String>,
}

impl Default for IdAllocator {
    fn default() -> Self {
        Self::in_memory()
    }
}

impl IdAllocator {
    pub fn in_memory() -> Self {
        Self {
            file: None,
            memory: IdState::NONE,
            floor: IdState::NONE,
            refusal: None,
        }
    }

    /// Durable allocator on `<dir>/agent-id-state.json`.
    pub fn durable(dir: &Path) -> Self {
        Self {
            file: Some(dir.join(STATE_FILE_NAME)),
            memory: IdState::NONE,
            floor: IdState::NONE,
            refusal: None,
        }
    }

    /// An allocator that refuses every request with `reason`.
    pub fn unavailable(reason: &str) -> Self {
        Self {
            refusal: Some(reason.to_string()),
            ..Self::in_memory()
        }
    }

    /// Ids already in use by restored agents (the newest one counts).
    pub fn raise_floor(&mut self, seen: IdState) {
        self.floor = self.floor.max(seen);
    }

    /// The next id, from the local clock.
    pub fn allocate(&mut self) -> Result<String, String> {
        self.allocate_at(Local::now().naive_local())
    }

    /// The next id for the given local time. The state is saved before the id
    /// is returned; an error means no id was handed out.
    pub fn allocate_at(&mut self, now: NaiveDateTime) -> Result<String, String> {
        if let Some(reason) = &self.refusal {
            return Err(reason.clone());
        }
        let today = day_number(now);
        let Some(path) = self.file.clone() else {
            self.memory = next(self.memory.max(self.floor), today);
            return Ok(render(self.memory));
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("{}: {error}", parent.display()))?;
        }
        let lock_path = PathBuf::from(format!("{}{LOCK_SUFFIX}", path.display()));
        let _lock = FileLock::acquire_file(&lock_path)
            .map_err(|error| format!("could not lock {}: {error}", lock_path.display()))?;
        let stored = match load(&path) {
            Read::Missing => IdState::NONE,
            Read::Valid(state) => state,
            Read::Unreadable(reason) => {
                // Not trusted. Seeding the counter with the seconds since
                // midnight keeps this day from reissuing low numbers.
                eprintln!(
                    "Agent ids: {} is unusable ({reason}); reseeding",
                    path.display()
                );
                IdState {
                    day: today,
                    seq: u64::from(now.num_seconds_from_midnight()),
                }
            }
        };
        let issued = next(stored.max(self.floor), today);
        store(&path, issued).map_err(|error| {
            format!(
                "Could not save the agent id counter ({}): {error}",
                path.display()
            )
        })?;
        Ok(render(issued))
    }
}

#[cfg(test)]
mod tests;
