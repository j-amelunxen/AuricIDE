//! Reading a tool's version out of whatever its `--version` prints.
//!
//! Each tool gets a pattern with capture groups for major, minor and an
//! optional patch. Output that does not match is `None`, never a guess.

use regex::Regex;

pub type Version = (u64, u64, u64);

/// First match of `pattern` in the trimmed output. Groups 1 and 2 are
/// required, group 3 (patch) defaults to 0 — `go version go1.22 …` has none.
pub fn parse_version(raw: &str, pattern: &str) -> Option<Version> {
    let captures = Regex::new(pattern).ok()?.captures(raw.trim())?;
    let number = |group: usize| captures.get(group)?.as_str().parse().ok();
    Some((number(1)?, number(2)?, number(3).unwrap_or(0)))
}

pub fn meets_minimum(found: Version, minimum: Version) -> bool {
    found >= minimum
}

pub fn format_version(version: Version) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OKF: &str = r"^okf version v(\d+)\.(\d+)\.(\d+)";
    const GO: &str = r"^go version go(\d+)\.(\d+)(?:\.(\d+))?";

    #[test]
    fn reads_the_okf_line_captured_from_the_real_tool() {
        let captured = include_str!("testdata/okf-version.txt");
        let output = captured.lines().last().unwrap();
        assert_eq!(parse_version(output, OKF), Some((0, 7, 0)));
    }

    #[test]
    fn a_missing_patch_counts_as_zero() {
        assert_eq!(
            parse_version("go version go1.22 darwin/arm64", GO),
            Some((1, 22, 0))
        );
        assert_eq!(
            parse_version("go version go1.25.6 darwin/arm64", GO),
            Some((1, 25, 6))
        );
    }

    #[test]
    fn surrounding_whitespace_does_not_hide_the_version() {
        assert_eq!(
            parse_version("\n  okf version v1.2.3 (OKF v0.2)\n", OKF),
            Some((1, 2, 3))
        );
    }

    #[test]
    fn output_that_does_not_match_is_none_rather_than_a_guess() {
        assert_eq!(parse_version("", OKF), None);
        assert_eq!(parse_version("okf version devel", OKF), None);
        assert_eq!(parse_version("command not found: okf", OKF), None);
    }

    #[test]
    fn a_pattern_that_does_not_compile_reads_nothing() {
        assert_eq!(parse_version("okf version v0.7.0", "("), None);
    }

    #[test]
    fn comparison_orders_by_component_not_by_string() {
        assert!(meets_minimum((0, 10, 0), (0, 9, 0)));
        assert!(meets_minimum((0, 7, 0), (0, 7, 0)));
        assert!(!meets_minimum((0, 6, 99), (0, 7, 0)));
    }

    #[test]
    fn formats_as_dotted_triple() {
        assert_eq!(format_version((0, 7, 0)), "0.7.0");
    }
}
