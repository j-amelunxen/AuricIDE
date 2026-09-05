use super::media::{expand_local_args, parse_transcription};
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
