//! Format on save: hand a document to the formatter the project or the machine
//! already has, and give the frontend the result to write.
//!
//! The tools are the ones installed in the project (`node_modules/.bin`, a
//! virtualenv) or on the machine, never copies bundled with the app. A bundled
//! prettier would format differently from the one the project's own CI runs,
//! and pinning a runtime means owning its upgrades. So, as for video import, we
//! check what is there, run it by absolute path, and say in one sentence what
//! to install when nothing fits. The one formatter that ships with the app is
//! the JSON re-indenter, because strict JSON has a single correct layout.
//!
//! A formatter never decides whether the save happens. This command reads no
//! document and writes none: it answers with an outcome, and the frontend
//! saves the formatted text or, on `unavailable` and `failed`, the text as
//! typed. A broken toolchain may cost a person their formatting, never their
//! work — which is also why the command has no error path.

mod json;
mod resolve;
mod run;

use resolve::{Disk, Plan};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Long enough for a cold `node` start in a large monorepo, short enough that
/// a hung tool does not hold a save back for long.
pub const FORMAT_TIMEOUT: Duration = Duration::from_secs(10);

/// What came of one format request. Serialized as `{ "status": … }` with the
/// variant's fields beside it; the TypeScript side is written against exactly
/// these four shapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FormatOutcome {
    /// The tool's output differs from the input.
    Formatted { content: String, formatter: String },
    /// The tool ran and had nothing to change.
    Unchanged { formatter: String },
    /// Nothing on this machine or in this project formats the file.
    Unavailable { reason: String },
    /// The tool ran and did not produce a usable result.
    Failed { formatter: String, message: String },
}

/// The language ids the frontend maps file extensions to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    JavaScript,
    TypeScript,
    Json,
    Css,
    Html,
    Yaml,
    Markdown,
    Python,
    Go,
    Rust,
    Shell,
}

impl Language {
    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "javascript" => Self::JavaScript,
            "typescript" => Self::TypeScript,
            "json" => Self::Json,
            "css" => Self::Css,
            "html" => Self::Html,
            "yaml" => Self::Yaml,
            "markdown" => Self::Markdown,
            "python" => Self::Python,
            "go" => Self::Go,
            "rust" => Self::Rust,
            "shell" => Self::Shell,
            _ => return None,
        })
    }

    /// How the language is named in a sentence shown to a person.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::JavaScript => "JavaScript",
            Self::TypeScript => "TypeScript",
            Self::Json => "JSON",
            Self::Css => "CSS",
            Self::Html => "HTML",
            Self::Yaml => "YAML",
            Self::Markdown => "Markdown",
            Self::Python => "Python",
            Self::Go => "Go",
            Self::Rust => "Rust",
            Self::Shell => "shell",
        }
    }
}

/// Format `content` as the file at `path` would be formatted. `path` decides
/// which project's tools and configuration apply; the file itself is never
/// read or written.
#[tauri::command]
pub async fn format_document(path: String, content: String, language: String) -> FormatOutcome {
    let Some(language) = Language::from_id(&language) else {
        return FormatOutcome::Unavailable {
            reason: format!("There is no formatter for {language} files."),
        };
    };
    let file = PathBuf::from(path);
    let disk = Disk::new(crate::machine::shell_path().await, dirs::home_dir());
    let walk = resolve::walk_dirs(&file, &disk);
    let plan = resolve::plan(language, &file, &walk, &disk);
    let cwd = resolve::child_cwd(&file, &walk, &disk);
    format_with(plan, &content, &cwd, FORMAT_TIMEOUT).await
}

async fn format_with(plan: Plan, content: &str, cwd: &Path, timeout: Duration) -> FormatOutcome {
    match plan {
        Plan::Unavailable(reason) => FormatOutcome::Unavailable { reason },
        Plan::BuiltinJson => json::outcome(content),
        Plan::Tool(tool) => {
            let result = run::run_tool(&tool.program, &tool.args, cwd, content, timeout).await;
            run::judge(tool.label, content, result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_outcome_serializes_to_the_shape_the_frontend_reads() {
        let cases = [
            (
                FormatOutcome::Formatted {
                    content: "a\n".into(),
                    formatter: "prettier".into(),
                },
                json!({ "status": "formatted", "content": "a\n", "formatter": "prettier" }),
            ),
            (
                FormatOutcome::Unchanged {
                    formatter: "ruff".into(),
                },
                json!({ "status": "unchanged", "formatter": "ruff" }),
            ),
            (
                FormatOutcome::Unavailable {
                    reason: "No Python formatter found. Install ruff or black.".into(),
                },
                json!({
                    "status": "unavailable",
                    "reason": "No Python formatter found. Install ruff or black."
                }),
            ),
            (
                FormatOutcome::Failed {
                    formatter: "gofmt".into(),
                    message: "1:1: expected 'package'".into(),
                },
                json!({
                    "status": "failed",
                    "formatter": "gofmt",
                    "message": "1:1: expected 'package'"
                }),
            ),
        ];
        for (outcome, expected) in cases {
            assert_eq!(serde_json::to_value(&outcome).unwrap(), expected);
        }
    }

    #[test]
    fn every_language_id_the_frontend_sends_is_known() {
        for id in [
            "javascript",
            "typescript",
            "json",
            "css",
            "html",
            "yaml",
            "markdown",
            "python",
            "go",
            "rust",
            "shell",
        ] {
            assert!(Language::from_id(id).is_some(), "{id}");
        }
        assert_eq!(Language::from_id("cobol"), None);
    }

    #[tokio::test]
    async fn an_unknown_language_is_unavailable_not_an_error() {
        let outcome = format_document("/tmp/x.cob".into(), "x".into(), "cobol".into()).await;
        assert!(matches!(outcome, FormatOutcome::Unavailable { .. }));
    }

    #[tokio::test]
    async fn a_plan_runs_its_tool_in_the_given_folder() {
        let dir = tempfile::tempdir().unwrap();
        let plan = Plan::Tool(resolve::Tool {
            label: "prettier",
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), "pwd -P".into()],
        });
        let outcome = format_with(plan, "x", dir.path(), FORMAT_TIMEOUT).await;
        let expected = format!("{}\n", dir.path().canonicalize().unwrap().display());
        assert_eq!(
            outcome,
            FormatOutcome::Formatted {
                content: expected,
                formatter: "prettier".into()
            }
        );
    }

    /// Runs the real command for each language whose tool this machine has,
    /// and prints the outcome. The only place resolution and argument shapes
    /// meet the real tools rather than our idea of them.
    #[tokio::test]
    #[ignore]
    async fn formats_with_this_machines_tools() {
        let samples: [(&str, &str, &str); 11] = [
            ("javascript", "a.js", "const a = {b:1}\n"),
            ("typescript", "a.ts", "const a : number=1\n"),
            ("json", "a.json", "{\"b\":[1,2],\"c\":{}}\n"),
            ("css", "a.css", "a{color:red}\n"),
            ("html", "a.html", "<p>hi</p>\n"),
            ("yaml", "a.yaml", "a:   1\n"),
            ("markdown", "a.md", "# hi\n*  x\n"),
            ("python", "a.py", "x = { 'a':1 }\n"),
            (
                "go",
                "a.go",
                "package main\nfunc main() {\nx:=1\n_ = x\n}\n",
            ),
            ("rust", "a.rs", "fn main(){let x=1;}\n"),
            ("shell", "a.sh", "if true;then echo hi;fi\n"),
        ];
        let dir = tempfile::tempdir().unwrap();
        for (language, name, content) in samples {
            let path = dir.path().join(name).display().to_string();
            let outcome = format_document(path, content.into(), language.into()).await;
            println!(
                "{language:<10} {}",
                serde_json::to_string(&outcome).unwrap()
            );
        }
        let broken = dir.path().join("broken.py").display().to_string();
        let outcome = format_document(broken, "def (:\n".into(), "python".into()).await;
        println!(
            "{:<10} {}",
            "python!",
            serde_json::to_string(&outcome).unwrap()
        );

        let black_project = dir.path().join("black-project");
        std::fs::create_dir_all(&black_project).unwrap();
        std::fs::write(black_project.join("pyproject.toml"), "[tool.black]\n").unwrap();
        let path = black_project.join("a.py").display().to_string();
        let outcome = format_document(path, "x = { 'a':1 }\n".into(), "python".into()).await;
        println!(
            "{:<10} {}",
            "black",
            serde_json::to_string(&outcome).unwrap()
        );

        // This repository's own prettier, found through the walk. The file is
        // never read or written, so it need not exist.
        let in_repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/not-a-real-file.ts");
        let outcome = format_document(
            in_repo.display().to_string(),
            "const a : number=1\n".into(),
            "typescript".into(),
        )
        .await;
        println!(
            "{:<10} {}",
            "repo ts",
            serde_json::to_string(&outcome).unwrap()
        );
    }
}
