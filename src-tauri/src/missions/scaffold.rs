use super::{CreateMissionInput, CreatedMission, MissionRecurrence};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

pub(super) struct PreparedMission {
    pub mission: CreatedMission,
    staging: tempfile::TempDir,
    destination: PathBuf,
}

/// Stable, filesystem-safe identity derived from the display name.
pub fn derive_slug(name: &str) -> String {
    let mut out = String::new();
    let mut separator = false;
    for ch in name.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            if separator && !out.is_empty() {
                out.push('-');
            }
            separator = false;
            if out.len() < 64 {
                out.push(ch);
            }
        } else if !out.is_empty() {
            separator = true;
        }
        if out.len() >= 64 {
            break;
        }
    }
    let slug = out.trim_end_matches('-');
    if slug.is_empty() {
        "mission".to_string()
    } else {
        slug.to_string()
    }
}

/// FNV-1a is deliberately simple and specified here: unlike `DefaultHasher`,
/// its output is stable across Rust versions and process launches.
pub fn deterministic_schedule_id(project_path: &str, slug: &str) -> String {
    let normalized = project_path.trim_end_matches(['/', '\\']);
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in normalized
        .as_bytes()
        .iter()
        .chain([b'/'].iter())
        .chain(slug.as_bytes())
    {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("mission:{hash:016x}:{slug}")
}

fn yaml_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn recurrence_summary(recurrence: &MissionRecurrence) -> String {
    match recurrence {
        MissionRecurrence::Daily { time_of_day } => format!("daily at {time_of_day}"),
        MissionRecurrence::Weekly {
            weekday,
            time_of_day,
        } => format!("weekly on weekday {weekday} at {time_of_day}"),
        MissionRecurrence::Interval {
            every_n,
            every_unit,
            time_of_day,
        } => format!(
            "every {every_n} {every_unit}(s){}",
            time_of_day
                .as_deref()
                .map(|time| format!(" at {time}"))
                .unwrap_or_default()
        ),
    }
}

fn mission_markdown(input: &CreateMissionInput, slug: &str) -> String {
    let name = input.name.trim();
    format!(
        "---\nversion: 1\nid: {}\nname: {}\nslug: {}\ntimezone: {}\nschedule: {}\n---\n\n# {}\n\n## Objective\n\n{}\n\n## Operating rules\n\n- Read `STATE.md` before starting.\n- Make one useful, verifiable increment per run.\n- Record durable progress and the next step in `STATE.md`.\n- Put generated outputs in `artifacts/`.\n",
        yaml_string(slug),
        yaml_string(name),
        yaml_string(slug),
        yaml_string(&input.timezone),
        yaml_string(&recurrence_summary(&input.recurrence)),
        name,
        input.objective.trim()
    )
}

fn state_markdown() -> &'static str {
    "# Mission state\n\n## Status\n\nNot started.\n\n## Last completed\n\n- Nothing yet.\n\n## Next step\n\n- Review the mission objective and choose the first useful increment.\n\n## Notes\n\n"
}

fn write_new(path: &Path, contents: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync {}: {e}", path.display()))
}

fn populate(staging: &Path, input: &CreateMissionInput, slug: &str) -> Result<(), String> {
    fs::create_dir(staging.join("runs")).map_err(|e| format!("Failed to create runs: {e}"))?;
    fs::create_dir(staging.join("artifacts"))
        .map_err(|e| format!("Failed to create artifacts: {e}"))?;
    write_new(&staging.join("MISSION.md"), &mission_markdown(input, slug))?;
    write_new(&staging.join("STATE.md"), state_markdown())?;
    write_new(&staging.join("runs/.gitkeep"), "")?;
    write_new(&staging.join("artifacts/.gitkeep"), "")?;
    write_new(
        &staging.join(".gitignore"),
        "runs/*\n!runs/.gitkeep\nartifacts/*\n!artifacts/.gitkeep\n",
    )?;
    Ok(())
}

fn ensure_real_directory(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{label} must not be a symlink"))
        }
        Ok(metadata) if !metadata.is_dir() => Err(format!("{label} must be a directory")),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|e| format!("Failed to create {label}: {e}"))?;
            ensure_real_directory(path, label)
        }
        Err(error) => Err(format!("Failed to inspect {label}: {error}")),
    }
}

pub(super) fn prepare_impl(input: &CreateMissionInput) -> Result<PreparedMission, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Mission name is required".to_string());
    }
    if input.objective.trim().is_empty() {
        return Err("Mission objective is required".to_string());
    }
    let project = PathBuf::from(input.project_path.trim());
    if !project.is_dir() {
        return Err("Project path must be an existing directory".to_string());
    }
    let project = fs::canonicalize(&project)
        .map_err(|error| format!("Failed to resolve project path: {error}"))?;

    let slug = derive_slug(name);
    let auric = project.join(".auric");
    ensure_real_directory(&auric, ".auric directory")?;
    let missions = auric.join("missions");
    ensure_real_directory(&missions, "missions directory")?;
    let canonical_missions = fs::canonicalize(&missions)
        .map_err(|error| format!("Failed to resolve missions directory: {error}"))?;
    if !canonical_missions.starts_with(&project) {
        return Err("Missions directory escapes the project root".to_string());
    }
    if fs::read_dir(&canonical_missions)
        .map_err(|error| format!("Failed to inspect missions directory: {error}"))?
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&slug)
        })
    {
        return Err(format!("Mission `{slug}` already exists"));
    }
    let destination = canonical_missions.join(&slug);
    if destination.exists() {
        return Err(format!("Mission `{slug}` already exists"));
    }

    let staging = tempfile::Builder::new()
        .prefix(&format!(".{slug}.staging-"))
        .tempdir_in(&canonical_missions)
        .map_err(|error| format!("Failed to stage mission: {error}"))?;
    populate(staging.path(), input, &slug)?;

    Ok(PreparedMission {
        mission: CreatedMission {
            name: name.to_string(),
            slug: slug.clone(),
            path: destination.to_string_lossy().to_string(),
            schedule_id: deterministic_schedule_id(&project.to_string_lossy(), &slug),
        },
        staging,
        destination,
    })
}

pub(super) fn publish_impl(prepared: PreparedMission) -> Result<CreatedMission, String> {
    fs::rename(prepared.staging.path(), &prepared.destination).map_err(|error| {
        match error.kind() {
            ErrorKind::AlreadyExists => {
                format!("Mission `{}` already exists", prepared.mission.slug)
            }
            _ => format!(
                "Failed to publish mission `{}` atomically: {error}",
                prepared.mission.slug
            ),
        }
    })?;
    Ok(prepared.mission)
}

#[cfg(test)]
pub fn create_impl(input: &CreateMissionInput) -> Result<CreatedMission, String> {
    publish_impl(prepare_impl(input)?)
}
