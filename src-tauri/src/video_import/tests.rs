use super::media::{expand_local_args, parse_transcription};
use super::{settings_from, SETTINGS_NS, SETTING_KEYS};
use std::path::Path;

#[test]
fn parses_verbose_json_segments_without_losing_text() {
    let raw = br#"{"segments":[{"start":1.25,"end":2.5,"text":" First step "},{"start":3,"end":4,"text":"Second step"}],"text":"First step Second step"}"#;
    let segments = parse_transcription(raw, 5_000).unwrap();
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].start_ms, 1_250);
    assert_eq!(segments[0].text, "First step");
    assert_eq!(segments[1].text, "Second step");
}

#[test]
fn plain_text_is_preserved_as_one_full_duration_segment() {
    let segments = parse_transcription(b"Everything the speaker said", 9_000).unwrap();
    assert_eq!(segments[0].end_ms, 9_000);
    assert_eq!(segments[0].text, "Everything the speaker said");
}

#[test]
fn local_argument_template_substitutes_audio_path() {
    let args = expand_local_args(
        "{audio} --output-dir {outputDir} --output-format json",
        Path::new("/tmp/a file.wav"),
        Path::new("/tmp/out dir"),
    );
    assert_eq!(
        args,
        vec![
            "/tmp/a file.wav",
            "--output-dir",
            "/tmp/out dir",
            "--output-format",
            "json"
        ]
    );
}

/// The settings screen (`src/lib/videoImport/settings.ts`) reads the same
/// namespace, keys and defaults.
#[test]
fn settings_match_the_shared_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../src/lib/videoImport/videoImportSettings.fixtures.json"
    ))
    .unwrap();
    assert_eq!(fixture["namespace"], SETTINGS_NS);
    let defaults = fixture["defaults"].as_object().unwrap();
    let mut keys: Vec<&str> = defaults.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut ours = SETTING_KEYS.to_vec();
    ours.sort_unstable();
    assert_eq!(keys, ours);

    let empty = settings_from(&Default::default());
    let default = |key: &str| defaults[key].as_str().unwrap().to_string();
    assert_eq!(empty.mode, default("transcription_mode"));
    assert_eq!(empty.remote_endpoint, default("remote_endpoint"));
    assert_eq!(empty.remote_api_key, default("remote_api_key"));
    assert_eq!(empty.remote_model, default("remote_model"));
    assert_eq!(empty.local_command, default("local_command"));
    assert_eq!(empty.local_args, default("local_args"));
}
