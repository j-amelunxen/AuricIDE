//! Our own check of a manager's `knowledge/` folder: what the summary shows
//! and which rules of the layout were broken. It needs no tool and works on
//! every machine; okf covers the rest of the OKF spec (`okf.rs`).
//!
//! The rules come from the `memory` block of
//! `supervisorManagers.fixtures.json`, read at compile time. Change the
//! fixture first.

use super::{FindingSource, MemoryFinding};
use serde_yaml::Value as Yaml;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

/// Past this many concept files the walk stops, so a runaway folder cannot
/// stall the check. The design revisits memory at about 2 000 concepts.
const MAX_CONCEPT_FILES: usize = 10_000;
/// Front matter is read, never the body.
const FRONT_MATTER_READ_LIMIT: u64 = 16 * 1024;
const SECTION_INDEX_READ_LIMIT: u64 = 1024 * 1024;
const SECTION_INDEX_FILE: &str = "index.md";
const FRONT_MATTER_FENCE: &str = "---";
/// What a quoted status or file name may take of the prompt: a finding is a
/// sentence, never a way to paste a page into it.
const MAX_QUOTED_CHARS: usize = 60;
/// Declared by us, not by the fixture: it says the walk was cut short, which
/// no concept file can.
pub const SCAN_TRUNCATED: &str = "scan_truncated";

pub struct Layout {
    pub bundle_dir: String,
    root_index: String,
    log_file: String,
    /// Section folder to concept type, in folder order.
    sections: BTreeMap<String, String>,
    required_fields: Vec<String>,
    statuses: Vec<String>,
    pub finding_codes: Vec<String>,
}

pub fn layout() -> &'static Layout {
    static LAYOUT: OnceLock<Layout> = OnceLock::new();
    LAYOUT.get_or_init(|| {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../src/lib/agents/supervisorManagers.fixtures.json"
        ))
        .expect("the manager fixture is valid JSON");
        let memory = &fixture["memory"];
        let strings = |value: &serde_json::Value| -> Vec<String> {
            value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        };
        Layout {
            bundle_dir: memory["bundleDir"].as_str().unwrap_or_default().to_string(),
            root_index: memory["rootIndex"]["file"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            log_file: memory["logFile"].as_str().unwrap_or_default().to_string(),
            sections: memory["sections"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(folder, kind)| Some((folder.clone(), kind.as_str()?.to_string())))
                .collect(),
            required_fields: strings(&memory["requiredFields"]),
            statuses: strings(&memory["statuses"]),
            finding_codes: strings(&memory["layoutFindings"]["codes"]),
        }
    })
}

/// What the walk learned about one bundle.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Scan {
    pub concepts: BTreeMap<String, u32>,
    pub deprecated: u32,
    pub newest_change_ms: Option<u64>,
    pub findings: Vec<MemoryFinding>,
}

/// Walks the bundle. A folder that is not there, or is a link, is an empty
/// bundle: nothing is followed out of the run folder.
pub fn scan(bundle: &Path) -> Scan {
    scan_with_budget(bundle, MAX_CONCEPT_FILES)
}

fn scan_with_budget(bundle: &Path, concept_budget: usize) -> Scan {
    let mut scan = Scan::default();
    let is_real_folder = std::fs::symlink_metadata(bundle)
        .map(|meta| meta.is_dir())
        .unwrap_or(false);
    if !is_real_folder {
        return scan;
    }
    let layout = layout();
    for file in [&layout.root_index, &layout.log_file] {
        scan.note_change(&bundle.join(file));
    }
    let mut budget = concept_budget;
    let mut cut_short = false;
    for (folder, section_type) in &layout.sections {
        let section = bundle.join(folder);
        if !is_real_folder_at(&section) {
            continue;
        }
        scan.note_change(&section.join(SECTION_INDEX_FILE));
        let index = read_limited(&section.join(SECTION_INDEX_FILE), SECTION_INDEX_READ_LIMIT);
        let (files, more) = concept_files(&section, &mut budget);
        cut_short |= more;
        for file in files {
            scan.check_concept(bundle, folder, section_type, &file, &index);
        }
    }
    if cut_short {
        scan.findings.insert(0, truncation_finding(concept_budget));
    }
    scan
}

fn truncation_finding(limit: usize) -> MemoryFinding {
    MemoryFinding {
        source: FindingSource::Layout,
        code: SCAN_TRUNCATED.to_string(),
        path: None,
        message: format!("Only the first {limit} concepts were checked; the rest are not counted."),
    }
}

fn is_real_folder_at(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

/// Shortened and stripped of control characters, so text taken from a file
/// cannot start a line of its own in the prompt.
fn tidy(text: &str) -> String {
    let mut shown: String = text
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_QUOTED_CHARS + 1)
        .collect();
    if shown.chars().count() > MAX_QUOTED_CHARS {
        shown = shown.chars().take(MAX_QUOTED_CHARS).collect();
        shown.push('…');
    }
    shown
}

impl Scan {
    fn note_change(&mut self, file: &Path) {
        let changed = std::fs::metadata(file)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok());
        self.newest_change_ms = self.newest_change_ms.max(changed);
    }

    fn report(&mut self, code: &str, path: &str, message: String) {
        debug_assert!(
            layout()
                .finding_codes
                .iter()
                .any(|declared| declared == code),
            "{code} is not a code the fixture declares"
        );
        self.findings.push(MemoryFinding {
            source: FindingSource::Layout,
            code: code.to_string(),
            path: Some(tidy(path)),
            message,
        });
    }

    fn check_concept(
        &mut self,
        bundle: &Path,
        folder: &str,
        section_type: &str,
        file_name: &str,
        section_index: &str,
    ) {
        let relative = format!("{folder}/{file_name}");
        let file = bundle.join(folder).join(file_name);
        self.note_change(&file);
        let front_matter = read_front_matter(&file);
        let Some(fields) = front_matter.fields() else {
            self.count(section_type, false);
            if let Some((code, message)) = front_matter.problem() {
                self.report(code, &relative, message.to_string());
            }
            return;
        };
        let text = |name: &str| {
            fields
                .get(name)
                .and_then(Yaml::as_str)
                .filter(|value| !value.trim().is_empty())
        };
        let declared_type = text("type").unwrap_or(section_type);
        self.count(declared_type, text("status") == Some("deprecated"));
        for field in &layout().required_fields {
            if text(field).is_none() {
                self.report(
                    "missing_field",
                    &relative,
                    format!("This concept has no `{field}`."),
                );
            }
        }
        if let Some(status) = text("status") {
            if !layout().statuses.iter().any(|known| known == status) {
                self.report(
                    "unknown_status",
                    &relative,
                    format!(
                        "`{}` is not a status; use draft, stable or deprecated.",
                        tidy(status)
                    ),
                );
            }
        }
        if text("type").is_some_and(|kind| kind != section_type) {
            self.report(
                "type_not_section",
                &relative,
                format!("A concept in {folder}/ has the type {section_type}."),
            );
        }
        if let Some(target) = text("superseded_by") {
            if !concept_exists(bundle, folder, target) {
                self.report(
                    "dangling_superseded_by",
                    &relative,
                    "`superseded_by` names a concept that does not exist.".to_string(),
                );
            }
        }
        if !section_index.contains(&format!("({file_name})")) {
            self.report(
                "not_in_section_index",
                &relative,
                format!("This concept is not listed in {folder}/{SECTION_INDEX_FILE}."),
            );
        }
    }

    fn count(&mut self, kind: &str, deprecated: bool) {
        *self.concepts.entry(kind.to_string()).or_insert(0) += 1;
        self.deprecated += u32::from(deprecated);
    }
}

/// The names of the Markdown files in a section, sorted. Links, folders and
/// the section index are not concepts.
fn concept_files(section: &Path, budget: &mut usize) -> (Vec<String>, bool) {
    let Ok(entries) = std::fs::read_dir(section) else {
        return (Vec::new(), false);
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(".md") && name != SECTION_INDEX_FILE)
        .collect();
    names.sort();
    let more = names.len() > *budget;
    names.truncate(*budget);
    *budget -= names.len();
    (names, more)
}

fn read_limited(file: &Path, limit: u64) -> String {
    let mut text = String::new();
    // A pipe would block the open, and a link leads out of the run folder.
    if !std::fs::symlink_metadata(file).is_ok_and(|meta| meta.is_file()) {
        return text;
    }
    if let Ok(opened) = std::fs::File::open(file) {
        let _ = opened.take(limit).read_to_string(&mut text);
    }
    text
}

/// `superseded_by` is a concept id (`facts/old-one`) or a file name; either
/// with or without `.md`, relative to the bundle, or to the section when it
/// has no folder.
fn concept_exists(bundle: &Path, folder: &str, target: &str) -> bool {
    let id = target.trim().trim_start_matches("./");
    let id = id.strip_suffix(".md").unwrap_or(id);
    if id.is_empty() || id.starts_with('/') || id.split('/').any(|part| part == "..") {
        return false;
    }
    let from_bundle = bundle.join(format!("{id}.md"));
    let from_section = bundle.join(folder).join(format!("{id}.md"));
    let is_file = |path: &Path| std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file());
    is_file(&from_bundle) || (!id.contains('/') && is_file(&from_section))
}

enum FrontMatter {
    Missing,
    Broken,
    Fields(serde_yaml::Mapping),
}

impl FrontMatter {
    fn fields(&self) -> Option<&serde_yaml::Mapping> {
        match self {
            Self::Fields(fields) => Some(fields),
            _ => None,
        }
    }

    /// The finding code and sentence for a block that cannot be used.
    fn problem(&self) -> Option<(&'static str, &'static str)> {
        match self {
            Self::Fields(_) => None,
            Self::Missing => Some((
                "missing_front_matter",
                "This concept has no front matter block.",
            )),
            Self::Broken => Some((
                "broken_front_matter",
                "The front matter of this concept cannot be read as YAML.",
            )),
        }
    }
}

fn read_front_matter(file: &Path) -> FrontMatter {
    let text = read_limited(file, FRONT_MATTER_READ_LIMIT);
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some(FRONT_MATTER_FENCE) {
        return FrontMatter::Missing;
    }
    let mut block = String::new();
    let mut closed = false;
    for line in lines {
        if line.trim_end() == FRONT_MATTER_FENCE {
            closed = true;
            break;
        }
        block.push_str(line);
        block.push('\n');
    }
    if !closed {
        return FrontMatter::Broken;
    }
    match serde_yaml::from_str::<Yaml>(&block) {
        Ok(Yaml::Mapping(fields)) => FrontMatter::Fields(fields),
        Ok(Yaml::Null) => FrontMatter::Missing,
        _ => FrontMatter::Broken,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const GOOD: &str = "---\ntype: Decision\ntitle: Cadence\ndescription: Every second Tuesday.\nstatus: stable\n---\n\nbody\n";

    fn write(bundle: &Path, relative: &str, content: &str) {
        let file = bundle.join(relative);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, content).unwrap();
    }

    fn bundle_with(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (relative, content) in files {
            write(dir.path(), relative, content);
        }
        dir
    }

    fn codes(scan: &Scan) -> Vec<(&str, &str)> {
        scan.findings
            .iter()
            .map(|f| (f.code.as_str(), f.path.as_deref().unwrap_or("")))
            .collect()
    }

    fn listed(section: &str, file: &str) -> (String, String) {
        (
            format!("{section}/index.md"),
            format!("# {section}\n* [t]({file}) - d\n"),
        )
    }

    #[test]
    fn a_tidy_bundle_has_counts_and_no_findings() {
        let (index_path, index) = listed("decisions", "cadence.md");
        let bundle = bundle_with(&[("decisions/cadence.md", GOOD), (&index_path, &index)]);
        let scan = scan(bundle.path());
        assert_eq!(scan.findings, vec![]);
        assert_eq!(scan.concepts, BTreeMap::from([("Decision".to_string(), 1)]));
        assert_eq!(scan.deprecated, 0);
        assert!(scan.newest_change_ms.is_some());
    }

    #[test]
    fn a_folder_that_is_not_there_is_an_empty_bundle() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(scan(&dir.path().join("knowledge")), Scan::default());
    }

    #[test]
    fn a_bundle_that_is_a_link_is_not_followed() {
        let outside = bundle_with(&[("decisions/cadence.md", GOOD)]);
        let run = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), run.path().join("knowledge")).unwrap();
        assert_eq!(scan(&run.path().join("knowledge")), Scan::default());
    }

    #[test]
    fn every_fault_is_reported_with_its_code_and_file() {
        let (index_path, index) = listed("decisions", "ok.md");
        let bundle = bundle_with(&[
            ("decisions/ok.md", GOOD),
            (&index_path, &index),
            ("decisions/plain.md", "no front matter\n"),
            ("decisions/broken.md", "---\ntype: Decision\ntitle: \"Broken\ndescription: x\n---\n"),
            ("decisions/unclosed.md", "---\ntype: Decision\n"),
            (
                "decisions/no-title.md",
                "---\ntype: Decision\ndescription: d\nstatus: stable\n---\n",
            ),
            (
                "decisions/final.md",
                "---\ntype: Decision\ntitle: t\ndescription: d\nstatus: final\n---\n",
            ),
            (
                "decisions/wrong-type.md",
                "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: draft\n---\n",
            ),
            (
                "decisions/old.md",
                "---\ntype: Decision\ntitle: t\ndescription: d\nstatus: deprecated\nsuperseded_by: decisions/gone\n---\n",
            ),
        ]);
        let scan = scan(bundle.path());
        let found = codes(&scan);
        for expected in [
            ("missing_front_matter", "decisions/plain.md"),
            ("broken_front_matter", "decisions/broken.md"),
            ("broken_front_matter", "decisions/unclosed.md"),
            ("missing_field", "decisions/no-title.md"),
            ("unknown_status", "decisions/final.md"),
            ("type_not_section", "decisions/wrong-type.md"),
            ("dangling_superseded_by", "decisions/old.md"),
            ("not_in_section_index", "decisions/old.md"),
        ] {
            assert!(
                found.contains(&expected),
                "{expected:?} missing in {found:?}"
            );
        }
        assert!(!found.iter().any(|(_, path)| *path == "decisions/ok.md"));
        assert_eq!(scan.deprecated, 1);
    }

    #[test]
    fn a_broken_file_is_counted_under_its_section_and_does_not_stop_the_walk() {
        let bundle = bundle_with(&[
            ("facts/a-broken.md", "---\n: [\n---\n"),
            (
                "facts/b-fine.md",
                "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: draft\n---\n",
            ),
        ]);
        let scan = scan(bundle.path());
        assert_eq!(scan.concepts, BTreeMap::from([("Fact".to_string(), 2)]));
    }

    #[test]
    fn superseded_by_resolves_ids_with_or_without_extension_and_section_names() {
        let old = "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: deprecated\nsuperseded_by: TARGET\n---\n";
        let new = "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: stable\n---\n";
        for target in ["facts/new", "facts/new.md", "new", "./facts/new.md"] {
            let bundle = bundle_with(&[
                ("facts/new.md", new),
                ("facts/old.md", &old.replace("TARGET", target)),
            ]);
            let dangling = scan(bundle.path())
                .findings
                .iter()
                .any(|f| f.code == "dangling_superseded_by");
            assert!(!dangling, "{target} should resolve");
        }
        for target in ["../outside", "/etc/passwd", "facts/nope"] {
            let bundle = bundle_with(&[("facts/old.md", &old.replace("TARGET", target))]);
            let dangling = scan(bundle.path())
                .findings
                .iter()
                .any(|f| f.code == "dangling_superseded_by");
            assert!(dangling, "{target} should dangle");
        }
    }

    #[test]
    fn only_front_matter_is_read_so_a_huge_body_costs_nothing() {
        let mut content = GOOD.to_string();
        content.push_str(&"x".repeat(5 * 1024 * 1024));
        let (index_path, index) = listed("decisions", "big.md");
        let bundle = bundle_with(&[("decisions/big.md", &content), (&index_path, &index)]);
        assert_eq!(scan(bundle.path()).findings, vec![]);
    }

    #[test]
    fn links_folders_and_section_indexes_are_not_concepts() {
        let bundle = bundle_with(&[("decisions/nested/deep.md", GOOD), ("notes.md", GOOD)]);
        std::os::unix::fs::symlink(
            bundle.path().join("notes.md"),
            bundle.path().join("decisions/linked.md"),
        )
        .unwrap();
        assert_eq!(scan(bundle.path()).concepts, BTreeMap::new());
    }

    #[test]
    fn the_codes_we_emit_are_exactly_the_fixture_codes() {
        let bundle = bundle_with(&[
            ("decisions/plain.md", "x\n"),
            ("decisions/broken.md", "---\n: [\n---\n"),
            ("decisions/f.md", "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: final\nsuperseded_by: nope\n---\n"),
            ("decisions/m.md", "---\ntype: Decision\n---\n"),
        ]);
        let mut emitted: Vec<String> = scan(bundle.path())
            .findings
            .into_iter()
            .map(|f| f.code)
            .collect();
        emitted.sort();
        emitted.dedup();
        let mut declared = layout().finding_codes.clone();
        declared.sort();
        assert_eq!(emitted, declared);
    }

    #[test]
    fn the_truncation_code_is_the_one_the_fixture_declares() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../src/lib/agents/supervisorManagers.fixtures.json"
        ))
        .unwrap();
        assert_eq!(
            fixture["memory"]["layoutFindings"]["scanTruncated"]["code"].as_str(),
            Some(SCAN_TRUNCATED)
        );
    }

    #[test]
    fn a_section_folder_that_is_a_link_is_not_followed() {
        let outside = bundle_with(&[("secret/a.md", GOOD), ("secret/index.md", "(a.md)")]);
        let bundle = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret"),
            bundle.path().join("decisions"),
        )
        .unwrap();
        assert_eq!(scan(bundle.path()).concepts, BTreeMap::new());
    }

    #[test]
    fn a_section_index_that_is_a_link_is_not_read() {
        let outside = bundle_with(&[("listing.md", "* [t](a.md)")]);
        let bundle = bundle_with(&[("decisions/a.md", GOOD)]);
        std::os::unix::fs::symlink(
            outside.path().join("listing.md"),
            bundle.path().join("decisions/index.md"),
        )
        .unwrap();
        let found = scan(bundle.path());
        assert!(codes(&found).contains(&("not_in_section_index", "decisions/a.md")));
    }

    #[test]
    fn a_pipe_as_the_section_index_does_not_block_the_walk() {
        let bundle = bundle_with(&[("decisions/a.md", GOOD)]);
        let fifo = bundle.path().join("decisions/index.md");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());
        let found = scan(bundle.path());
        assert_eq!(
            found.concepts,
            BTreeMap::from([("Decision".to_string(), 1)])
        );
    }

    #[test]
    fn a_walk_that_hits_its_limit_says_so() {
        let (index_path, index) = listed("decisions", "a.md");
        let bundle = bundle_with(&[
            ("decisions/a.md", GOOD),
            ("decisions/b.md", GOOD),
            ("decisions/c.md", GOOD),
            (&index_path, &index),
        ]);
        let found = scan_with_budget(bundle.path(), 2);
        assert_eq!(
            found.concepts,
            BTreeMap::from([("Decision".to_string(), 2)])
        );
        assert!(found.findings.iter().any(|f| f.code == SCAN_TRUNCATED));
        let whole = scan_with_budget(bundle.path(), 3);
        assert!(!whole.findings.iter().any(|f| f.code == SCAN_TRUNCATED));
    }

    #[test]
    fn a_status_is_shortened_and_loses_control_characters_before_it_is_quoted() {
        // YAML escapes, so the parsed status holds a real newline and bell.
        let status = format!("x\\n## Forged heading\\a{}", "y".repeat(5_000));
        let content =
            format!("---\ntype: Decision\ntitle: t\ndescription: d\nstatus: \"{status}\"\n---\n");
        let bundle = bundle_with(&[("decisions/a.md", &content)]);
        let found = scan(bundle.path());
        let finding = found
            .findings
            .iter()
            .find(|f| f.code == "unknown_status")
            .unwrap();
        assert!(finding.message.len() < 200, "{}", finding.message.len());
        assert!(!finding.message.chars().any(char::is_control));
    }

    #[test]
    fn the_captured_okf_bundles_read_as_the_fixture_says() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/machine/testdata/okf-bundles");
        let clean = scan(&root.join("clean"));
        assert_eq!(clean.findings, vec![]);
        let malformed = scan(&root.join("malformed"));
        let found = codes(&malformed);
        assert!(found.contains(&("missing_front_matter", "decisions/no-front-matter.md")));
        assert!(found.contains(&("broken_front_matter", "decisions/broken-yaml.md")));
        assert!(found.contains(&("unknown_status", "decisions/bad-status.md")));
    }
}
