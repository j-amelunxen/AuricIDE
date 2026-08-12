use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

/// Deep enough to reach `apps/web/public/favicon.ico` in a monorepo, shallow
/// enough that the walk stays instant on a large tree.
const MAX_DEPTH: usize = 8;
const MAX_RESULTS: usize = 24;
/// A tile is 40px. Anything past this is a hero image someone named "logo",
/// not an icon, and base64-ing it into the UI would cost more than it shows.
const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;

const IMAGE_EXTENSIONS: [&str; 6] = ["ico", "png", "svg", "webp", "jpg", "jpeg"];

/// Directories that never hold a project's own icon but do hold thousands of
/// other people's. Skipping them is what keeps this a sub-second walk.
const SKIPPED_DIRS: [&str; 12] = [
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "vendor",
    "coverage",
    "__pycache__",
];

/// Names ranked by how likely they are to BE the project's icon, best first.
/// A file called `favicon` is a stronger claim than one called `logo`, and a
/// bare `icon.png` is stronger than `apple-touch-icon-180x180.png`.
const NAME_RANKS: [(&str, u32); 6] = [
    ("favicon", 0),
    ("icon", 10),
    ("logo", 20),
    ("apple-touch-icon", 30),
    ("app-icon", 30),
    ("mark", 40),
];

/// Conventional homes for a favicon, ranked. Anything else scores worse than
/// all of these, so a stray `docs/img/logo.png` never outranks `public/favicon.ico`.
const DIR_RANKS: [(&str, u32); 7] = [
    ("public", 0),
    ("static", 1),
    ("assets", 2),
    ("app", 3),
    ("src", 4),
    ("resources", 4),
    ("icons", 2),
];

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconCandidate {
    pub path: String,
    /// Path relative to the project root, for display.
    pub relative_path: String,
    pub file_name: String,
    pub size_bytes: u64,
}

fn extension_rank(extension: &str) -> u32 {
    match extension {
        // svg scales to any tile size; ico and png are the conventional pair.
        "svg" => 0,
        "png" => 1,
        "ico" => 2,
        "webp" => 3,
        _ => 5,
    }
}

fn name_rank(stem: &str) -> Option<u32> {
    let lowered = stem.to_ascii_lowercase();
    NAME_RANKS
        .iter()
        .filter(|(needle, _)| lowered.contains(needle))
        .map(|(_, rank)| *rank)
        .min()
}

fn directory_rank(relative: &Path) -> u32 {
    let best = relative
        .parent()
        .into_iter()
        .flat_map(|parent| parent.components())
        .filter_map(|component| {
            let segment = component.as_os_str().to_string_lossy().to_ascii_lowercase();
            DIR_RANKS
                .iter()
                .find(|(name, _)| *name == segment)
                .map(|(_, rank)| *rank)
        })
        .min();
    // Unrecognised locations rank behind every recognised one, and the deeper
    // the file sits the weaker its claim.
    best.unwrap_or(10) + relative.components().count() as u32
}

/// Finds the files in a project that plausibly ARE its icon, best first.
///
/// Takes a path rather than a `tauri::State` so it is testable against a temp
/// directory.
pub fn find_icon_candidates(root: &Path) -> Vec<ProjectIconCandidate> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut found: Vec<(u32, ProjectIconCandidate)> = Vec::new();

    for entry in WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        // A symlinked node_modules or a self-referential link would otherwise
        // turn a scan into a hang.
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            if entry.depth() == 0 {
                return true;
            }
            if entry.file_type().is_dir() {
                // Hidden directories are skipped except at depth 0, where the
                // root itself may well be a dotted folder.
                return !SKIPPED_DIRS.contains(&name.as_ref()) && !name.starts_with('.');
            }
            true
        })
        // An unreadable entry is skipped, never fatal.
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(extension) = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
        else {
            continue;
        };
        if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(name_score) = name_rank(stem) else {
            continue;
        };
        let size_bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if size_bytes == 0 || size_bytes > MAX_ICON_BYTES {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(path);
        let score = name_score * 100 + directory_rank(relative) * 10 + extension_rank(&extension);
        found.push((
            score,
            ProjectIconCandidate {
                path: path.to_string_lossy().into_owned(),
                relative_path: relative.to_string_lossy().into_owned(),
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                size_bytes,
            },
        ));
    }

    found.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.relative_path.cmp(&b.1.relative_path))
    });
    found.truncate(MAX_RESULTS);
    found.into_iter().map(|(_, candidate)| candidate).collect()
}

#[tauri::command]
pub fn project_icon_candidates(project_path: String) -> Result<Vec<ProjectIconCandidate>, String> {
    if project_path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    Ok(find_icon_candidates(Path::new(&project_path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn names(root: &Path) -> Vec<String> {
        find_icon_candidates(root)
            .into_iter()
            .map(|candidate| candidate.relative_path)
            .collect()
    }

    #[test]
    fn finds_a_favicon_at_the_conventional_place() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("public/favicon.ico"), b"x");

        assert_eq!(names(dir.path()), vec!["public/favicon.ico"]);
    }

    /// The point of the feature: it must reach a favicon nobody would think to
    /// look for by hand.
    #[test]
    fn finds_a_favicon_buried_deep_in_the_tree() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("apps/web/src/app/assets/favicon.png"),
            b"x",
        );

        assert_eq!(
            names(dir.path()),
            vec!["apps/web/src/app/assets/favicon.png"]
        );
    }

    #[test]
    fn ranks_favicon_above_logo_and_public_above_docs() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("docs/images/logo.png"), b"x");
        write(&dir.path().join("public/favicon.svg"), b"x");
        write(&dir.path().join("src/icon.png"), b"x");

        assert_eq!(
            names(dir.path()),
            vec!["public/favicon.svg", "src/icon.png", "docs/images/logo.png"]
        );
    }

    #[test]
    fn ignores_images_that_are_not_icon_shaped() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("public/hero-banner.png"), b"x");
        write(&dir.path().join("public/screenshot.png"), b"x");

        assert!(names(dir.path()).is_empty());
    }

    #[test]
    fn ignores_non_image_files_named_icon() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("src/icon.tsx"), b"x");

        assert!(names(dir.path()).is_empty());
    }

    /// Without this the walk crawls other people's icons for seconds.
    #[test]
    fn never_descends_into_dependency_directories() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("node_modules/pkg/public/favicon.ico"),
            b"x",
        );
        write(&dir.path().join("target/debug/icon.png"), b"x");
        write(&dir.path().join(".git/logo.png"), b"x");
        write(&dir.path().join("public/favicon.ico"), b"x");

        assert_eq!(names(dir.path()), vec!["public/favicon.ico"]);
    }

    #[test]
    fn skips_an_empty_or_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("public/favicon.ico"), b"");
        write(
            &dir.path().join("public/logo.png"),
            &vec![0u8; (MAX_ICON_BYTES + 1) as usize],
        );

        assert!(names(dir.path()).is_empty());
    }

    #[test]
    fn caps_the_number_of_candidates() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(MAX_RESULTS + 10) {
            write(&dir.path().join(format!("public/icon-{i}.png")), b"x");
        }

        assert_eq!(find_icon_candidates(dir.path()).len(), MAX_RESULTS);
    }

    #[test]
    fn returns_nothing_for_a_path_that_is_not_a_directory() {
        assert!(find_icon_candidates(Path::new("/definitely/not/here")).is_empty());
    }

    #[test]
    fn reports_the_size_so_the_caller_can_decide() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("public/favicon.ico"), b"1234");

        assert_eq!(find_icon_candidates(dir.path())[0].size_bytes, 4);
    }
}
