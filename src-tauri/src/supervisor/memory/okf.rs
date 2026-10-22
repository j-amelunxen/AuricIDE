//! `okf validate` for a manager's bundle: find it through `machine/`, run it
//! with a timeout, read what it says defensively.
//!
//! The parsing order and its reasons are in `docs/design-project-manager.md`
//! ("Version drift and parsing"); the captures in
//! `machine/testdata/okf-validate-*.txt` are its source of truth. Tool output
//! never becomes a message here: the sentences are ours, only a file path is
//! taken from what okf printed.

use super::{FindingSource, MemoryFinding, OkfState};
use crate::machine::VersionProbe;
use crate::machine::{dependency, run_probe};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

/// `memory.validateTimeoutMs` in the fixture.
const VALIDATE_TIMEOUT: Duration = Duration::from_millis(10_000);
const EXIT_CONFORMANT: i32 = 0;
const EXIT_NOT_CONFORMANT: i32 = 1;

#[derive(Debug, PartialEq, Eq)]
pub struct OkfReading {
    pub state: OkfState,
    pub findings: Vec<MemoryFinding>,
}

impl OkfReading {
    fn without_findings(state: OkfState) -> Self {
        Self {
            state,
            findings: Vec::new(),
        }
    }
}

/// Where okf stands on this machine: the program to run, or the state that
/// says why there is none.
pub fn availability(
    found_at: Option<&Path>,
    probe: Option<VersionProbe>,
    minimum: (u64, u64, u64),
) -> Result<&Path, OkfState> {
    let program = found_at.ok_or(OkfState::Missing)?;
    match probe {
        None => Err(OkfState::Failed),
        Some(VersionProbe::Unreadable) => Err(OkfState::Unrecognised),
        Some(VersionProbe::Version(found)) if found < minimum => Err(OkfState::Outdated),
        Some(VersionProbe::Version(_)) => Ok(program),
    }
}

/// Resolves okf now (never cached) and checks the bundle with it.
pub async fn validate(bundle: &Path) -> OkfReading {
    let Some(row) = dependency("okf") else {
        return OkfReading::without_findings(OkfState::Missing);
    };
    let observation = row.observe().await;
    let minimum = row.minimum.unwrap_or_default();
    let found_at = observation
        .resolved
        .as_ref()
        .map(|found| found.path.as_path());
    match availability(found_at, observation.probe, minimum) {
        Ok(program) => validate_with(program, bundle, VALIDATE_TIMEOUT).await,
        Err(state) => OkfReading::without_findings(state),
    }
}

pub async fn validate_with(program: &Path, bundle: &Path, timeout: Duration) -> OkfReading {
    let bundle_arg = bundle.to_string_lossy();
    let output = run_probe(program, &["validate", &bundle_arg, "--json"], timeout).await;
    match output {
        Some(output) => read_validation(output.exit_code, &output.stdout),
        None => OkfReading::without_findings(OkfState::Failed),
    }
}

/// Exit code first: 2 (or no code) means okf could not load the bundle and
/// the body is plain text, so it is not read. Then the JSON, every list read as
/// "absent or null means empty".
pub fn read_validation(exit_code: Option<i32>, stdout: &str) -> OkfReading {
    if !matches!(exit_code, Some(EXIT_CONFORMANT | EXIT_NOT_CONFORMANT)) {
        return OkfReading::without_findings(OkfState::Failed);
    }
    let Ok(report) = serde_json::from_str::<Value>(stdout.trim()) else {
        let state = if exit_code == Some(EXIT_CONFORMANT) {
            OkfState::Unrecognised
        } else {
            OkfState::Failed
        };
        return OkfReading::without_findings(state);
    };
    let Some(conformant) = report.get("is_conformant").and_then(Value::as_bool) else {
        return OkfReading::without_findings(OkfState::Unrecognised);
    };
    let mut reading = Entries::default();
    reading.take_texts(
        &report,
        "errors",
        "okf_error",
        "okf found an error in this concept.",
    );
    reading.take_texts(
        &report,
        "warnings",
        "okf_warning",
        "okf has a warning about this concept.",
    );
    reading.take_texts(
        &report,
        "gate_findings",
        "okf_gate",
        "This concept fails a check okf applies.",
    );
    reading.take_broken_links(&report);
    reading.take_orphans(&report);
    if reading.unreadable > 0 {
        reading.add(
            "okf_unreadable",
            None,
            format!(
                "okf reported {} thing(s) this app could not read.",
                reading.unreadable
            ),
        );
    }
    if !conformant && reading.findings.is_empty() {
        reading.add(
            "okf_not_conformant",
            None,
            "okf does not accept this memory folder.".to_string(),
        );
    }
    let state = if reading.findings.is_empty() {
        OkfState::Ok
    } else {
        OkfState::Findings
    };
    OkfReading {
        state,
        findings: reading.findings,
    }
}

#[derive(Default)]
struct Entries {
    findings: Vec<MemoryFinding>,
    unreadable: usize,
}

impl Entries {
    fn add(&mut self, code: &str, path: Option<String>, message: String) {
        self.findings.push(MemoryFinding {
            source: FindingSource::Okf,
            code: code.to_string(),
            path,
            message,
        });
    }

    /// A list of strings, `null` or absent being empty. Anything else is
    /// counted, not shown.
    fn list<'a>(&mut self, report: &'a Value, field: &str) -> &'a [Value] {
        match report.get(field) {
            None | Some(Value::Null) => &[],
            Some(Value::Array(entries)) => entries,
            Some(_) => {
                self.unreadable += 1;
                &[]
            }
        }
    }

    fn take_texts(&mut self, report: &Value, field: &str, code: &str, message: &str) {
        for entry in self.list(report, field) {
            match entry.as_str() {
                Some(text) => self.add(code, path_before_colon(text), message.to_string()),
                None => self.unreadable += 1,
            }
        }
    }

    fn take_broken_links(&mut self, report: &Value) {
        for entry in self.list(report, "broken_links") {
            match entry.get("source_concept").and_then(Value::as_str) {
                Some(source) => self.add(
                    "okf_broken_link",
                    Some(source.to_string()),
                    "This concept has a link okf could not resolve.".to_string(),
                ),
                None => self.unreadable += 1,
            }
        }
    }

    /// okf names an orphan by concept id, without `.md`.
    fn take_orphans(&mut self, report: &Value) {
        for entry in self.list(report, "orphans") {
            match entry.as_str() {
                Some(id) => {
                    let path = if id.ends_with(".md") {
                        id.to_string()
                    } else {
                        format!("{id}.md")
                    };
                    self.add(
                        "okf_orphan",
                        Some(path),
                        "No other concept links to or from this one.".to_string(),
                    );
                }
                None => self.unreadable += 1,
            }
        }
    }
}

/// The file an okf line is about: what stands before the first `: `, when it
/// looks like a path and not like a sentence.
fn path_before_colon(line: &str) -> Option<String> {
    let (head, _) = line.split_once(": ")?;
    (head.ends_with(".md") && !head.contains(' ')).then(|| head.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn capture(text: &'static str) -> &'static str {
        // The captures start with three '#' header lines.
        let body = text.splitn(4, '\n').nth(3).unwrap_or("");
        body
    }

    const CLEAN: &str = include_str!("../../machine/testdata/okf-validate-clean-json.txt");
    const FINDINGS: &str = include_str!("../../machine/testdata/okf-validate-findings-json.txt");
    const MALFORMED: &str = include_str!("../../machine/testdata/okf-validate-malformed-json.txt");
    const MISSING: &str =
        include_str!("../../machine/testdata/okf-validate-missing-bundle-json.txt");

    fn summary(reading: &OkfReading) -> Vec<(&str, Option<&str>)> {
        reading
            .findings
            .iter()
            .map(|f| (f.code.as_str(), f.path.as_deref()))
            .collect()
    }

    #[test]
    fn the_clean_capture_is_ok() {
        let reading = read_validation(Some(0), capture(CLEAN));
        assert_eq!(reading, OkfReading::without_findings(OkfState::Ok));
    }

    #[test]
    fn broken_links_and_orphans_are_findings_though_okf_calls_the_bundle_conformant() {
        let reading = read_validation(Some(0), capture(FINDINGS));
        assert_eq!(reading.state, OkfState::Findings);
        assert_eq!(
            summary(&reading),
            vec![
                ("okf_broken_link", Some("facts-orphan.md")),
                ("okf_orphan", Some("facts-orphan.md")),
            ]
        );
    }

    #[test]
    fn errors_and_gate_findings_from_the_malformed_capture_carry_their_file() {
        let reading = read_validation(Some(1), capture(MALFORMED));
        assert_eq!(reading.state, OkfState::Findings);
        let found = summary(&reading);
        assert!(found.contains(&("okf_error", Some("decisions/no-front-matter.md"))));
        assert!(found.contains(&("okf_gate", Some("decisions/bad-status.md"))));
        assert!(found.contains(&("okf_orphan", Some("decisions/broken-yaml.md"))));
        assert_eq!(found.len(), 5);
    }

    #[test]
    fn what_we_show_is_our_sentence_never_okfs_words() {
        let reading = read_validation(Some(1), capture(MALFORMED));
        for finding in &reading.findings {
            assert!(
                !finding.message.contains("frontmatter"),
                "{}",
                finding.message
            );
            assert!(
                !finding.message.contains("draft|stable"),
                "{}",
                finding.message
            );
        }
    }

    #[test]
    fn exit_two_is_failed_without_reading_the_body_as_json() {
        let reading = read_validation(Some(2), capture(MISSING));
        assert_eq!(reading, OkfReading::without_findings(OkfState::Failed));
        let even_if_it_were_json = read_validation(Some(2), capture(CLEAN));
        assert_eq!(even_if_it_were_json.state, OkfState::Failed);
    }

    #[test]
    fn a_signal_or_an_unknown_exit_code_is_failed() {
        assert_eq!(
            read_validation(None, capture(CLEAN)).state,
            OkfState::Failed
        );
        assert_eq!(
            read_validation(Some(3), capture(CLEAN)).state,
            OkfState::Failed
        );
    }

    #[test]
    fn json_that_does_not_parse_or_lacks_is_conformant_is_unrecognised() {
        assert_eq!(
            read_validation(Some(0), "not json").state,
            OkfState::Unrecognised
        );
        assert_eq!(
            read_validation(Some(0), "{\"errors\": []}").state,
            OkfState::Unrecognised
        );
        assert_eq!(
            read_validation(Some(0), "{\"is_conformant\": \"yes\"}").state,
            OkfState::Unrecognised
        );
        assert_eq!(read_validation(Some(1), "not json").state, OkfState::Failed);
    }

    #[test]
    fn absent_or_null_lists_are_empty() {
        let reading = read_validation(Some(0), "{\"is_conformant\": true, \"orphans\": null}");
        assert_eq!(reading, OkfReading::without_findings(OkfState::Ok));
    }

    #[test]
    fn entries_we_cannot_place_are_counted_in_one_finding() {
        let report = r#"{"is_conformant": true,
            "errors": [7, "a.md: boom"],
            "broken_links": [{"nope": 1}],
            "orphans": "wrong shape"}"#;
        let reading = read_validation(Some(0), report);
        assert_eq!(reading.state, OkfState::Findings);
        assert_eq!(
            summary(&reading),
            vec![("okf_error", Some("a.md")), ("okf_unreadable", None)]
        );
        assert!(reading.findings[1].message.contains('3'));
    }

    #[test]
    fn a_nonconformant_report_without_entries_still_says_so() {
        let reading = read_validation(Some(1), "{\"is_conformant\": false}");
        assert_eq!(summary(&reading), vec![("okf_not_conformant", None)]);
    }

    #[test]
    fn a_line_without_a_path_gets_no_path() {
        assert_eq!(path_before_colon("something odd: happened"), None);
        assert_eq!(path_before_colon("a/b.md: x"), Some("a/b.md".to_string()));
        assert_eq!(path_before_colon("no colon at all"), None);
    }

    #[test]
    fn availability_follows_what_the_machine_said() {
        let minimum = (0, 7, 0);
        let okf = Some(Path::new("/x/okf"));
        let version = |v| Some(VersionProbe::Version(v));
        assert_eq!(availability(None, None, minimum), Err(OkfState::Missing));
        assert_eq!(availability(okf, None, minimum), Err(OkfState::Failed));
        assert_eq!(
            availability(okf, Some(VersionProbe::Unreadable), minimum),
            Err(OkfState::Unrecognised)
        );
        assert_eq!(
            availability(okf, version((0, 6, 9)), minimum),
            Err(OkfState::Outdated)
        );
        assert_eq!(
            availability(okf, version((0, 7, 0)), minimum),
            Ok(Path::new("/x/okf"))
        );
        assert_eq!(
            availability(okf, version((1, 0, 0)), minimum),
            Ok(Path::new("/x/okf"))
        );
    }

    fn fake_okf(script: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("okf");
        std::fs::write(&program, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, program)
    }

    #[tokio::test]
    async fn a_fake_okf_is_run_with_validate_the_bundle_and_json() {
        let (_dir, program) = fake_okf(
            "[ \"$1\" = validate ] && [ \"$2\" = /some/bundle ] && [ \"$3\" = --json ] || exit 9\n\
             echo '{\"is_conformant\": true}'",
        );
        let reading =
            validate_with(&program, Path::new("/some/bundle"), Duration::from_secs(10)).await;
        assert_eq!(reading.state, OkfState::Ok);
    }

    #[tokio::test]
    async fn a_fake_okf_that_hangs_is_failed_at_the_timeout() {
        let (_dir, program) = fake_okf("sleep 5");
        let started = std::time::Instant::now();
        let reading = validate_with(&program, Path::new("/b"), Duration::from_millis(200)).await;
        assert_eq!(reading.state, OkfState::Failed);
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn a_fake_okf_that_exits_non_zero_with_text_is_failed() {
        let (_dir, program) = fake_okf("echo 'Error loading bundle: nope'; exit 2");
        let reading = validate_with(&program, Path::new("/b"), Duration::from_secs(10)).await;
        assert_eq!(reading, OkfReading::without_findings(OkfState::Failed));
    }

    /// Runs the real okf (found the way the app finds it) over the captured
    /// bundles. When this disagrees with the unit tests above: recapture the
    /// outputs first, then fix the parser, in that order.
    #[tokio::test]
    #[ignore = "needs okf >= 0.7.0 installed on this machine"]
    async fn the_real_okf_is_classified_the_way_the_captures_say() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/machine/testdata/okf-bundles");
        let codes = |reading: &OkfReading| -> Vec<String> {
            reading.findings.iter().map(|f| f.code.clone()).collect()
        };

        let clean = validate(&root.join("clean")).await;
        assert_eq!(clean, OkfReading::without_findings(OkfState::Ok), "clean");

        let findings = validate(&root.join("findings")).await;
        assert_eq!(findings.state, OkfState::Findings);
        assert_eq!(codes(&findings), vec!["okf_broken_link", "okf_orphan"]);

        let malformed = validate(&root.join("malformed")).await;
        assert_eq!(malformed.state, OkfState::Findings);
        let malformed_codes = codes(&malformed);
        assert!(malformed_codes.contains(&"okf_error".to_string()));
        assert!(malformed_codes.contains(&"okf_gate".to_string()));
        assert!(!malformed_codes.contains(&"okf_unreadable".to_string()));

        let nowhere = validate(&root.join("does-not-exist")).await;
        assert_eq!(nowhere, OkfReading::without_findings(OkfState::Failed));
    }
}
