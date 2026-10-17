//! The globs of document types and job kinds: project-relative, `/`-separated,
//! with `*` and `?` inside one segment and `**` for any number of segments.
//! Nothing else (no braces, no classes), so a pattern means the same thing in
//! the settings, in the spec and here. Fixture `globs`.

/// `**` only as a whole segment; no empty segment.
pub fn is_valid(pattern: &str) -> bool {
    pattern
        .split('/')
        .all(|segment| !segment.is_empty() && (segment == "**" || !segment.contains("**")))
}

/// Whether `path` (project-relative, `/`-separated) matches `pattern`.
pub fn matches(pattern: &str, path: &str) -> bool {
    let pattern: Vec<&str> = pattern.split('/').collect();
    let path: Vec<&str> = path.split('/').collect();
    match_segments(&pattern, &path)
}

fn match_segments(pattern: &[&str], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((&"**", rest)) => (0..=path.len()).any(|skip| match_segments(rest, &path[skip..])),
        Some((first, rest)) => match path.split_first() {
            Some((segment, path_rest)) => {
                match_segment(first.as_bytes(), segment.as_bytes())
                    && match_segments(rest, path_rest)
            }
            None => false,
        },
    }
}

fn match_segment(pattern: &[u8], text: &[u8]) -> bool {
    match pattern.split_first() {
        None => text.is_empty(),
        Some((b'*', rest)) => (0..=text.len()).any(|skip| match_segment(rest, &text[skip..])),
        Some((b'?', rest)) => !text.is_empty() && match_segment(rest, &text[1..]),
        Some((c, rest)) => text.first() == Some(c) && match_segment(rest, &text[1..]),
    }
}

/// The folder a walk for `pattern` starts in: its segments before the first
/// one with a wildcard. `docs/**/*.x.json` starts in `docs`.
pub fn base(pattern: &str) -> String {
    let segments: Vec<&str> = pattern.split('/').collect();
    let fixed: Vec<&str> = segments[..segments.len().saturating_sub(1)]
        .iter()
        .take_while(|segment| !segment.contains(['*', '?']))
        .copied()
        .collect();
    fixed.join("/")
}

/// The literal end of `pattern` after its last wildcard: what a file name
/// that matches always ends with (`.x.json` for `docs/**/*.x.json`), or
/// `None` when the pattern ends in a wildcard or has none.
pub fn suffix(pattern: &str) -> Option<&str> {
    let last = pattern.rsplit('/').next()?;
    let at = last.rfind(['*', '?'])?;
    let tail = &last[at + 1..];
    (!tail.is_empty()).then_some(tail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs_match_as_the_fixtures_say() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/lib/agents/supervisorLink.fixtures.json"
        ))
        .expect("fixtures parse");
        for case in fixtures["globs"]["match"].as_array().expect("match cases") {
            let pattern = case["pattern"].as_str().expect("pattern");
            let path = case["path"].as_str().expect("path");
            assert_eq!(
                matches(pattern, path),
                case["matches"].as_bool().expect("matches"),
                "{pattern} ~ {path}"
            );
        }
        for case in fixtures["globs"]["invalid"]
            .as_array()
            .expect("invalid cases")
        {
            assert!(!is_valid(case.as_str().expect("pattern")), "{case}");
        }
    }

    #[test]
    fn base_and_suffix_come_from_the_literal_parts() {
        assert_eq!(base("docs/**/*.x.json"), "docs");
        assert_eq!(base("docs/arch/*.json"), "docs/arch");
        assert_eq!(base("*.json"), "");
        assert_eq!(base("docs/plan.json"), "docs");
        assert_eq!(suffix("docs/**/*.x.json"), Some(".x.json"));
        assert_eq!(suffix("docs/*"), None);
        assert_eq!(suffix("docs/plan.json"), None);
    }
}
