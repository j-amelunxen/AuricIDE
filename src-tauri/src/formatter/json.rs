//! The built-in JSON formatter, for machines and projects without prettier.
//!
//! It re-indents and does nothing else. Values are copied byte for byte, never
//! parsed: a round trip through `serde_json::Value` would reorder keys, turn
//! `12345678901234567890` into a float and `1.0e5` into `100000.0`. Validation
//! is a separate pass into `IgnoredAny`, which checks syntax without building
//! a value, so the token walk below may rely on the input being strict JSON.

use super::FormatOutcome;
use serde::de::IgnoredAny;

pub const LABEL: &str = "built-in JSON";

pub fn outcome(input: &str) -> FormatOutcome {
    match reindent(input) {
        None => FormatOutcome::Unavailable {
            reason: "This file is not strict JSON and no prettier or biome was found.".to_string(),
        },
        Some(output) if output == input => FormatOutcome::Unchanged {
            formatter: LABEL.to_string(),
        },
        Some(output) => FormatOutcome::Formatted {
            content: output,
            formatter: LABEL.to_string(),
        },
    }
}

/// `None` when `input` is not strict JSON.
pub fn reindent(input: &str) -> Option<String> {
    serde_json::from_str::<IgnoredAny>(input).ok()?;
    let mut writer = Writer {
        input,
        bytes: input.as_bytes(),
        unit: detect_indent(input),
        out: String::with_capacity(input.len() + input.len() / 4),
        depth: 0,
    };
    writer.run();
    if input.ends_with('\n') {
        writer.out.push('\n');
    }
    Some(writer.out)
}

/// The indentation of the first indented line: a tab, or that many spaces.
fn detect_indent(input: &str) -> String {
    for line in input.lines() {
        let rest = line.trim_start_matches([' ', '\t']);
        if rest.is_empty() || rest.len() == line.len() {
            continue;
        }
        if line.starts_with('\t') {
            return "\t".to_string();
        }
        let spaces = line.len() - line.trim_start_matches(' ').len();
        return " ".repeat(spaces);
    }
    "  ".to_string()
}

fn is_json_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

/// Every structural character in JSON is ASCII, so walking bytes and copying
/// slices between them never splits a UTF-8 sequence.
struct Writer<'a> {
    input: &'a str,
    bytes: &'a [u8],
    unit: String,
    out: String,
    depth: usize,
}

impl Writer<'_> {
    fn run(&mut self) {
        let mut at = 0;
        while at < self.bytes.len() {
            at = match self.bytes[at] {
                b'"' => self.copy_until(at, string_end(self.bytes, at)),
                b'{' | b'[' => self.open(at),
                b'}' | b']' => self.close(at),
                b',' => {
                    self.out.push(',');
                    self.newline();
                    at + 1
                }
                b':' => {
                    self.out.push_str(": ");
                    at + 1
                }
                byte if is_json_whitespace(byte) => at + 1,
                _ => self.copy_until(at, scalar_end(self.bytes, at)),
            };
        }
    }

    fn copy_until(&mut self, start: usize, end: usize) -> usize {
        self.out.push_str(&self.input[start..end]);
        end
    }

    fn open(&mut self, at: usize) -> usize {
        let open = self.bytes[at];
        let close = if open == b'{' { b'}' } else { b']' };
        let next = skip_whitespace(self.bytes, at + 1);
        self.out.push(char::from(open));
        if self.bytes.get(next) == Some(&close) {
            self.out.push(char::from(close));
            return next + 1;
        }
        self.depth += 1;
        self.newline();
        at + 1
    }

    fn close(&mut self, at: usize) -> usize {
        self.depth = self.depth.saturating_sub(1);
        self.newline();
        self.out.push(char::from(self.bytes[at]));
        at + 1
    }

    fn newline(&mut self) {
        self.out.push('\n');
        for _ in 0..self.depth {
            self.out.push_str(&self.unit);
        }
    }
}

fn skip_whitespace(bytes: &[u8], mut at: usize) -> usize {
    while bytes.get(at).copied().is_some_and(is_json_whitespace) {
        at += 1;
    }
    at
}

/// One past the closing quote of the string opening at `start`.
fn string_end(bytes: &[u8], start: usize) -> usize {
    let mut at = start + 1;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' => at += 2,
            b'"' => return at + 1,
            _ => at += 1,
        }
    }
    bytes.len()
}

/// A number or literal runs until the next structural byte or whitespace.
fn scalar_end(bytes: &[u8], start: usize) -> usize {
    let mut at = start;
    while at < bytes.len()
        && !is_json_whitespace(bytes[at])
        && !matches!(bytes[at], b',' | b':' | b'}' | b']')
    {
        at += 1;
    }
    at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minified_json_gets_two_space_indentation() {
        assert_eq!(
            reindent("{\"a\":1,\"b\":[true,null]}").as_deref(),
            Some("{\n  \"a\": 1,\n  \"b\": [\n    true,\n    null\n  ]\n}")
        );
    }

    #[test]
    fn numbers_are_copied_verbatim() {
        let input = "[12345678901234567890,1.0e5,-0.10,1E-7]\n";
        assert_eq!(
            reindent(input).as_deref(),
            Some("[\n  12345678901234567890,\n  1.0e5,\n  -0.10,\n  1E-7\n]\n")
        );
    }

    #[test]
    fn strings_keep_escapes_unicode_and_structural_characters() {
        let input = r#"{"say \"hi\"":"a,b:{c}[d]","é":"\u00e9 ✓ \\","tab":"\t"}"#;
        assert_eq!(
            reindent(input).as_deref(),
            Some(concat!(
                "{\n",
                "  \"say \\\"hi\\\"\": \"a,b:{c}[d]\",\n",
                "  \"é\": \"\\u00e9 ✓ \\\\\",\n",
                "  \"tab\": \"\\t\"\n",
                "}"
            ))
        );
    }

    #[test]
    fn key_order_is_kept() {
        assert_eq!(
            reindent("{\"z\":1,\"a\":2,\"m\":3}").as_deref(),
            Some("{\n  \"z\": 1,\n  \"a\": 2,\n  \"m\": 3\n}")
        );
    }

    #[test]
    fn empty_containers_stay_empty_even_with_whitespace_inside() {
        assert_eq!(
            reindent("{\"a\":{ },\"b\":[\n],\"c\":[{}]}").as_deref(),
            Some("{\n  \"a\": {},\n  \"b\": [],\n  \"c\": [\n    {}\n  ]\n}")
        );
        assert_eq!(reindent("[]").as_deref(), Some("[]"));
    }

    #[test]
    fn the_inputs_indentation_is_kept() {
        let tabs = "{\n\t\"a\": [1,2]\n}\n";
        assert_eq!(
            reindent(tabs).as_deref(),
            Some("{\n\t\"a\": [\n\t\t1,\n\t\t2\n\t]\n}\n")
        );
        let four = "{\n    \"a\":{\"b\":1}}";
        assert_eq!(
            reindent(four).as_deref(),
            Some("{\n    \"a\": {\n        \"b\": 1\n    }\n}")
        );
    }

    #[test]
    fn a_trailing_newline_is_kept_only_when_present() {
        assert_eq!(reindent("1\n").as_deref(), Some("1\n"));
        assert_eq!(reindent("\"x\"").as_deref(), Some("\"x\""));
    }

    #[test]
    fn already_formatted_json_is_unchanged() {
        let input = "{\n  \"a\": [\n    1\n  ],\n  \"b\": {}\n}\n";
        assert_eq!(
            outcome(input),
            FormatOutcome::Unchanged {
                formatter: LABEL.into()
            }
        );
    }

    #[test]
    fn json_with_comments_or_trailing_commas_is_unavailable() {
        for input in ["{\"a\":1,}", "// c\n{}", "", "{'a':1}"] {
            assert_eq!(reindent(input), None, "{input}");
            assert_eq!(
                outcome(input),
                FormatOutcome::Unavailable {
                    reason: "This file is not strict JSON and no prettier or biome was found."
                        .into()
                }
            );
        }
    }

    #[test]
    fn crlf_input_is_reindented_with_lf() {
        assert_eq!(
            reindent("{\r\n  \"a\": 1\r\n}\r\n").as_deref(),
            Some("{\n  \"a\": 1\n}\n")
        );
    }
}
