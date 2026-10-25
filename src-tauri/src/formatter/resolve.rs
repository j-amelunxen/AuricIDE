//! Which formatter applies to a file, decided from what is on disk around it.
//!
//! The decision reads the disk only through [`Machine`], so the order rules
//! (project tool before machine tool, biome only where configured, the Python
//! and Rust config lookups) are tested without one.

use super::Language;
use crate::machine::{expand_home, on_disk, resolve_with_extra_dirs};
use std::path::{Path, PathBuf};

/// The questions resolution asks of the disk.
pub trait Machine {
    fn exists(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn is_executable(&self, path: &Path) -> bool;
    fn read(&self, path: &Path) -> Option<String>;
    fn home(&self) -> Option<&Path>;
    /// An executable on the login shell's PATH, then in `extra_dirs`.
    fn on_path(&self, name: &str, extra_dirs: &[PathBuf]) -> Option<PathBuf>;
}

/// The real disk, with the login shell's PATH captured once per request.
pub struct Disk {
    path_var: String,
    home: Option<PathBuf>,
}

impl Disk {
    pub fn new(path_var: String, home: Option<PathBuf>) -> Self {
        Self { path_var, home }
    }
}

/// Config files are small; anything bigger is not one we should be parsing.
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

impl Machine for Disk {
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn is_executable(&self, path: &Path) -> bool {
        on_disk(path)
    }

    fn read(&self, path: &Path) -> Option<String> {
        let meta = path.metadata().ok()?;
        if !meta.is_file() || meta.len() > MAX_CONFIG_BYTES {
            return None;
        }
        std::fs::read_to_string(path).ok()
    }

    fn home(&self) -> Option<&Path> {
        self.home.as_deref()
    }

    fn on_path(&self, name: &str, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
        resolve_with_extra_dirs(name, &self.path_var, extra_dirs, &on_disk).map(|found| found.path)
    }
}

/// One formatter run: label shown to the person, absolute program, arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tool {
    pub label: &'static str,
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    Tool(Tool),
    BuiltinJson,
    Unavailable(String),
}

/// The file's folder and its ancestors, nearest first, ending at the first
/// folder that holds `.git` — a tool or config above the repository belongs
/// to some other project.
pub fn walk_dirs(file: &Path, machine: &dyn Machine) -> Vec<PathBuf> {
    let Some(start) = file.parent() else {
        return Vec::new();
    };
    let mut dirs = Vec::new();
    for dir in start.ancestors() {
        if dir.as_os_str().is_empty() {
            break;
        }
        dirs.push(dir.to_path_buf());
        if machine.exists(&dir.join(".git")) {
            break;
        }
    }
    dirs
}

/// Where the tool runs, so it finds the configuration next to the file: the
/// file's folder, or the walk's root when that folder does not exist yet.
pub fn child_cwd(file: &Path, walk: &[PathBuf], machine: &dyn Machine) -> PathBuf {
    file.parent()
        .filter(|dir| machine.is_dir(dir))
        .map(Path::to_path_buf)
        .or_else(|| walk.last().filter(|dir| machine.is_dir(dir)).cloned())
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn plan(language: Language, file: &Path, walk: &[PathBuf], machine: &dyn Machine) -> Plan {
    let file_arg = file.to_string_lossy().into_owned();
    match language {
        Language::Python => python(&file_arg, walk, machine),
        Language::Go => machine_tool(
            machine,
            "gofmt",
            &["/usr/local/go/bin", "~/go/bin"],
            Vec::new(),
            "No Go formatter found. Install Go, which brings gofmt.",
        ),
        Language::Rust => machine_tool(
            machine,
            "rustfmt",
            &["~/.cargo/bin"],
            vec!["--edition".into(), rust_edition(walk, machine)],
            "No Rust formatter found. Install rustfmt with rustup component add rustfmt.",
        ),
        Language::Shell => machine_tool(
            machine,
            "shfmt",
            &[],
            vec!["-filename".into(), file_arg],
            "No shell formatter found. Install shfmt.",
        ),
        _ => web(language, file_arg, walk, machine),
    }
}

fn machine_tool(
    machine: &dyn Machine,
    name: &'static str,
    extra_dirs: &[&str],
    args: Vec<String>,
    missing: &str,
) -> Plan {
    let extra: Vec<PathBuf> = extra_dirs
        .iter()
        .map(|dir| expand_home(dir, machine.home()))
        .collect();
    match machine.on_path(name, &extra) {
        Some(program) => Plan::Tool(Tool {
            label: name,
            program,
            args,
        }),
        None => Plan::Unavailable(missing.to_string()),
    }
}

/// The nearest `<dir>/<relative>` on the walk that may be run.
fn nearest_executable(walk: &[PathBuf], machine: &dyn Machine, relative: &str) -> Option<PathBuf> {
    walk.iter()
        .map(|dir| dir.join(relative))
        .find(|candidate| machine.is_executable(candidate))
}

fn found_on_walk(walk: &[PathBuf], machine: &dyn Machine, names: &[&str]) -> bool {
    walk.iter()
        .any(|dir| names.iter().any(|name| machine.exists(&dir.join(name))))
}

/// Every file name prettier reads its configuration from.
const PRETTIER_CONFIGS: &[&str] = &[
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.json5",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.toml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.ts",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
];

/// Whether the project asked for prettier: a config file, or a `prettier` key
/// in a `package.json` on the walk.
fn prettier_configured(walk: &[PathBuf], machine: &dyn Machine) -> bool {
    found_on_walk(walk, machine, PRETTIER_CONFIGS)
        || walk.iter().any(|dir| {
            machine
                .read(&dir.join("package.json"))
                .is_some_and(|text| text.contains("\"prettier\""))
        })
}

/// The prettier family: a project's biome where it configured one, then the
/// project's prettier, then the machine's, then the JSON re-indenter.
///
/// The machine's prettier only runs where the project configured prettier. In
/// a repository that never used it, its defaults (quotes, semicolons, 80
/// columns) would rewrite whole files on every save — a diff nobody asked for.
fn web(language: Language, file_arg: String, walk: &[PathBuf], machine: &dyn Machine) -> Plan {
    let biome_language = matches!(
        language,
        Language::JavaScript | Language::TypeScript | Language::Json | Language::Css
    );
    if biome_language && found_on_walk(walk, machine, &["biome.json", "biome.jsonc"]) {
        if let Some(program) = nearest_executable(walk, machine, "node_modules/.bin/biome") {
            return Plan::Tool(Tool {
                label: "biome (project)",
                program,
                args: vec!["format".into(), format!("--stdin-file-path={file_arg}")],
            });
        }
    }
    let args = vec!["--stdin-filepath".to_string(), file_arg];
    if let Some(program) = nearest_executable(walk, machine, "node_modules/.bin/prettier") {
        return Plan::Tool(Tool {
            label: "prettier (project)",
            program,
            args,
        });
    }
    let machine_prettier = prettier_configured(walk, machine)
        .then(|| machine.on_path("prettier", &[]))
        .flatten();
    if let Some(program) = machine_prettier {
        return Plan::Tool(Tool {
            label: "prettier",
            program,
            args,
        });
    }
    if language == Language::Json {
        return Plan::BuiltinJson;
    }
    Plan::Unavailable(format!(
        "No formatter for {} in this project. Add prettier to the project.",
        language.display_name()
    ))
}

#[derive(Debug, Default, PartialEq, Eq)]
struct PythonConfig {
    ruff: bool,
    black: bool,
}

/// The nearest folder with Python formatter config decides; folders further up
/// are not consulted once one is found.
fn python_config(walk: &[PathBuf], machine: &dyn Machine) -> PythonConfig {
    for dir in walk {
        let ruff_file =
            machine.exists(&dir.join("ruff.toml")) || machine.exists(&dir.join(".ruff.toml"));
        let pyproject = machine.read(&dir.join("pyproject.toml"));
        if !ruff_file && pyproject.is_none() {
            continue;
        }
        let has = |section: &str| {
            pyproject
                .as_deref()
                .is_some_and(|text| has_toml_section(text, section))
        };
        return PythonConfig {
            ruff: ruff_file || has("tool.ruff"),
            black: has("tool.black"),
        };
    }
    PythonConfig::default()
}

/// `[tool.ruff]`, `[tool.ruff.format]` or `[[tool.ruff…]]` all count for
/// `tool.ruff`; `[tool.ruffle]` does not.
fn has_toml_section(text: &str, section: &str) -> bool {
    text.lines().any(|line| {
        let Some(header) = line.trim().strip_prefix('[') else {
            return false;
        };
        let header = header.trim_start_matches('[').trim_start();
        header
            .strip_prefix(section)
            .is_some_and(|rest| rest.starts_with(']') || rest.starts_with('.'))
    })
}

fn python(file_arg: &str, walk: &[PathBuf], machine: &dyn Machine) -> Plan {
    let config = python_config(walk, machine);
    let order = if config.black && !config.ruff {
        ["black", "ruff"]
    } else {
        ["ruff", "black"]
    };
    for name in order {
        if let Some(program) = python_executable(walk, machine, name) {
            return Plan::Tool(python_tool(name, program, file_arg));
        }
    }
    Plan::Unavailable("No Python formatter found. Install ruff or black.".to_string())
}

/// A project's virtualenv first, nearest folder first, then the login PATH.
fn python_executable(walk: &[PathBuf], machine: &dyn Machine, name: &str) -> Option<PathBuf> {
    walk.iter()
        .flat_map(|dir| {
            [
                dir.join(".venv/bin").join(name),
                dir.join("venv/bin").join(name),
            ]
        })
        .find(|candidate| machine.is_executable(candidate))
        .or_else(|| machine.on_path(name, &[]))
}

fn python_tool(name: &str, program: PathBuf, file_arg: &str) -> Tool {
    let file_arg = file_arg.to_string();
    if name == "black" {
        return Tool {
            label: "black",
            program,
            args: vec!["-q".into(), "--stdin-filename".into(), file_arg, "-".into()],
        };
    }
    Tool {
        label: "ruff",
        program,
        args: vec![
            "format".into(),
            "--stdin-filename".into(),
            file_arg,
            "-".into(),
        ],
    }
}

const DEFAULT_RUST_EDITION: &str = "2021";

#[derive(Debug, PartialEq, Eq)]
enum Edition {
    Set(String),
    Inherited,
    Absent,
}

/// The nearest Cargo.toml's edition, following `edition.workspace = true` up
/// to the workspace's `[workspace.package]`. rustfmt reading stdin knows no
/// manifest, and its own default edition is 2015, which rejects `async fn`.
fn rust_edition(walk: &[PathBuf], machine: &dyn Machine) -> String {
    let manifests: Vec<String> = walk
        .iter()
        .filter_map(|dir| machine.read(&dir.join("Cargo.toml")))
        .collect();
    let Some(nearest) = manifests.first() else {
        return DEFAULT_RUST_EDITION.to_string();
    };
    let edition = match edition_in(nearest, "package") {
        Edition::Inherited => {
            manifests
                .iter()
                .find_map(|text| match edition_in(text, "workspace.package") {
                    Edition::Set(edition) => Some(edition),
                    _ => None,
                })
        }
        Edition::Set(edition) => Some(edition),
        Edition::Absent => None,
    };
    edition.unwrap_or_else(|| DEFAULT_RUST_EDITION.to_string())
}

/// A line-level read of one table's `edition` key; enough for the three forms
/// a manifest writes it in, without a TOML dependency.
fn edition_in(manifest: &str, table: &str) -> Edition {
    let mut current = String::new();
    for raw in manifest.lines() {
        let line = raw.trim();
        if let Some(header) = line.strip_prefix('[') {
            current = header
                .split(']')
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            continue;
        }
        if current != table {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
        let value = value.trim();
        if key == "edition.workspace" && value.starts_with("true") {
            return Edition::Inherited;
        }
        if key != "edition" {
            continue;
        }
        if value.starts_with('{') && value.contains("workspace") {
            return Edition::Inherited;
        }
        if let Some(edition) = quoted_edition(value) {
            return Edition::Set(edition);
        }
    }
    Edition::Absent
}

/// `"2021"` → `2021`; anything that is not a four-digit year is ignored rather
/// than handed to rustfmt as an argument.
fn quoted_edition(value: &str) -> Option<String> {
    let inner = value.strip_prefix('"')?.split('"').next()?;
    (inner.len() == 4 && inner.bytes().all(|b| b.is_ascii_digit())).then(|| inner.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    /// A disk made of a few files, some executable, and a PATH.
    #[derive(Default)]
    struct Fake {
        files: HashMap<PathBuf, String>,
        executables: HashSet<PathBuf>,
        path_var: String,
    }

    impl Fake {
        fn file(mut self, path: &str, text: &str) -> Self {
            self.files.insert(PathBuf::from(path), text.to_string());
            self
        }
        fn exe(mut self, path: &str) -> Self {
            self.executables.insert(PathBuf::from(path));
            self
        }
        fn path(mut self, path_var: &str) -> Self {
            self.path_var = path_var.to_string();
            self
        }
    }

    impl Machine for Fake {
        fn exists(&self, path: &Path) -> bool {
            self.files.contains_key(path) || self.executables.contains(path) || self.is_dir(path)
        }
        fn is_dir(&self, path: &Path) -> bool {
            self.files
                .keys()
                .chain(self.executables.iter())
                .any(|file| file != path && file.starts_with(path))
        }
        fn is_executable(&self, path: &Path) -> bool {
            self.executables.contains(path)
        }
        fn read(&self, path: &Path) -> Option<String> {
            self.files.get(path).cloned()
        }
        fn home(&self) -> Option<&Path> {
            Some(Path::new("/home/dev"))
        }
        fn on_path(&self, name: &str, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
            let exists = |path: &Path| self.executables.contains(path);
            resolve_with_extra_dirs(name, &self.path_var, extra_dirs, &exists).map(|r| r.path)
        }
    }

    const FILE: &str = "/repo/app/src/main.ts";

    fn plan_for(machine: &Fake, language: Language, file: &str) -> Plan {
        let file = Path::new(file);
        let walk = walk_dirs(file, machine);
        plan(language, file, &walk, machine)
    }

    fn label(plan: &Plan) -> Option<&'static str> {
        match plan {
            Plan::Tool(tool) => Some(tool.label),
            _ => None,
        }
    }

    #[test]
    fn the_walk_stops_at_the_first_folder_with_git() {
        let machine = Fake::default().file("/repo/.git", "gitdir: elsewhere");
        let walk = walk_dirs(Path::new(FILE), &machine);
        assert_eq!(
            walk,
            ["/repo/app/src", "/repo/app", "/repo"].map(PathBuf::from)
        );
        let nested = Fake::default().file("/repo/app/.git/HEAD", "ref");
        assert_eq!(walk_dirs(Path::new(FILE), &nested).len(), 2);
    }

    #[test]
    fn without_git_the_walk_reaches_the_root() {
        let walk = walk_dirs(Path::new("/a/b/c.ts"), &Fake::default());
        assert_eq!(walk, ["/a/b", "/a", "/"].map(PathBuf::from));
        assert!(walk_dirs(Path::new("c.ts"), &Fake::default()).is_empty());
    }

    #[test]
    fn a_tool_above_the_repository_is_not_the_projects() {
        let machine = Fake::default()
            .file("/repo/.git/HEAD", "ref")
            .exe("/node_modules/.bin/prettier");
        assert_eq!(
            plan_for(&machine, Language::TypeScript, FILE),
            Plan::Unavailable(
                "No formatter for TypeScript in this project. Add prettier to the project.".into()
            )
        );
    }

    #[test]
    fn a_configured_project_biome_wins_over_prettier() {
        let machine = Fake::default()
            .file("/repo/biome.json", "{}")
            .exe("/repo/node_modules/.bin/biome")
            .exe("/repo/node_modules/.bin/prettier")
            .exe("/usr/bin/prettier")
            .path("/usr/bin");
        assert_eq!(
            plan_for(&machine, Language::TypeScript, FILE),
            Plan::Tool(Tool {
                label: "biome (project)",
                program: PathBuf::from("/repo/node_modules/.bin/biome"),
                args: vec!["format".into(), format!("--stdin-file-path={FILE}")],
            })
        );
    }

    #[test]
    fn biome_needs_both_its_config_and_its_binary() {
        let binary_only = Fake::default()
            .exe("/repo/node_modules/.bin/biome")
            .exe("/repo/node_modules/.bin/prettier");
        assert_eq!(
            label(&plan_for(&binary_only, Language::TypeScript, FILE)),
            Some("prettier (project)")
        );
        let config_only = Fake::default()
            .file("/repo/.prettierrc", "{}")
            .file("/repo/app/biome.jsonc", "{}")
            .exe("/usr/bin/prettier")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&config_only, Language::TypeScript, FILE)),
            Some("prettier")
        );
    }

    #[test]
    fn biome_is_skipped_for_languages_it_does_not_format() {
        let machine = Fake::default()
            .file("/repo/biome.json", "{}")
            .exe("/repo/node_modules/.bin/biome")
            .exe("/repo/node_modules/.bin/prettier");
        for language in [Language::Markdown, Language::Yaml, Language::Html] {
            assert_eq!(
                label(&plan_for(&machine, language, "/repo/README.md")),
                Some("prettier (project)")
            );
        }
        for language in [Language::JavaScript, Language::Json, Language::Css] {
            assert_eq!(
                label(&plan_for(&machine, language, "/repo/x")),
                Some("biome (project)")
            );
        }
    }

    #[test]
    fn the_nearest_project_prettier_is_used_with_the_file_path() {
        let machine = Fake::default()
            .exe("/repo/node_modules/.bin/prettier")
            .exe("/repo/app/node_modules/.bin/prettier");
        assert_eq!(
            plan_for(&machine, Language::Css, "/repo/app/src/a.scss"),
            Plan::Tool(Tool {
                label: "prettier (project)",
                program: PathBuf::from("/repo/app/node_modules/.bin/prettier"),
                args: vec!["--stdin-filepath".into(), "/repo/app/src/a.scss".into()],
            })
        );
    }

    #[test]
    fn a_non_executable_project_prettier_falls_through_to_the_machine() {
        let machine = Fake::default()
            .file("/repo/node_modules/.bin/prettier", "#!/usr/bin/env node")
            .file("/repo/.prettierrc.json", "{}")
            .exe("/opt/homebrew/bin/prettier")
            .path("/usr/bin:/opt/homebrew/bin");
        assert_eq!(
            plan_for(&machine, Language::Yaml, FILE),
            Plan::Tool(Tool {
                label: "prettier",
                program: PathBuf::from("/opt/homebrew/bin/prettier"),
                args: vec!["--stdin-filepath".into(), FILE.into()],
            })
        );
    }

    #[test]
    fn json_without_any_tool_uses_the_built_in_re_indenter() {
        assert_eq!(
            plan_for(&Fake::default(), Language::Json, "/repo/a.json"),
            Plan::BuiltinJson
        );
        let with_prettier = Fake::default()
            .file("/repo/package.json", r#"{ "prettier": { "semi": false } }"#)
            .exe("/usr/bin/prettier")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&with_prettier, Language::Json, "/repo/a.json")),
            Some("prettier")
        );
    }

    #[test]
    fn the_machines_prettier_needs_the_projects_prettier_config() {
        let unconfigured = Fake::default()
            .file("/repo/package.json", r#"{ "name": "app" }"#)
            .exe("/usr/bin/prettier")
            .path("/usr/bin");
        assert_eq!(
            plan_for(&unconfigured, Language::TypeScript, FILE),
            Plan::Unavailable(
                "No formatter for TypeScript in this project. Add prettier to the project.".into()
            )
        );
        assert_eq!(
            plan_for(&unconfigured, Language::Json, "/repo/a.json"),
            Plan::BuiltinJson
        );
        let configured = Fake::default()
            .file("/repo/prettier.config.mjs", "export default {}")
            .exe("/usr/bin/prettier")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&configured, Language::TypeScript, FILE)),
            Some("prettier")
        );
    }

    #[test]
    fn markdown_without_any_tool_names_what_to_install() {
        assert_eq!(
            plan_for(&Fake::default(), Language::Markdown, "/repo/a.md"),
            Plan::Unavailable(
                "No formatter for Markdown in this project. Add prettier to the project.".into()
            )
        );
    }

    const PY: &str = "/repo/pkg/mod.py";

    #[test]
    fn python_prefers_ruff_when_nothing_says_otherwise() {
        let machine = Fake::default()
            .exe("/usr/bin/ruff")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(
            plan_for(&machine, Language::Python, PY),
            Plan::Tool(Tool {
                label: "ruff",
                program: PathBuf::from("/usr/bin/ruff"),
                args: vec![
                    "format".into(),
                    "--stdin-filename".into(),
                    PY.into(),
                    "-".into()
                ],
            })
        );
    }

    #[test]
    fn python_prefers_black_when_only_black_is_configured() {
        let machine = Fake::default()
            .file(
                "/repo/pyproject.toml",
                "[project]\n[tool.black]\nline-length = 100\n",
            )
            .exe("/usr/bin/ruff")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(
            plan_for(&machine, Language::Python, PY),
            Plan::Tool(Tool {
                label: "black",
                program: PathBuf::from("/usr/bin/black"),
                args: vec![
                    "-q".into(),
                    "--stdin-filename".into(),
                    PY.into(),
                    "-".into()
                ],
            })
        );
    }

    #[test]
    fn python_keeps_ruff_first_when_both_or_ruff_are_configured() {
        let both = Fake::default()
            .file("/repo/pyproject.toml", "[tool.black]\n[tool.ruff.format]\n")
            .exe("/usr/bin/ruff")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(label(&plan_for(&both, Language::Python, PY)), Some("ruff"));
        let ruff_toml = Fake::default()
            .file("/repo/pkg/.ruff.toml", "")
            .file("/repo/pyproject.toml", "[tool.black]\n")
            .exe("/usr/bin/ruff")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&ruff_toml, Language::Python, PY)),
            Some("ruff")
        );
    }

    #[test]
    fn the_nearest_python_config_decides() {
        let machine = Fake::default()
            .file("/repo/pkg/pyproject.toml", "[tool.black]\n")
            .file("/repo/ruff.toml", "")
            .exe("/usr/bin/ruff")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&machine, Language::Python, PY)),
            Some("black")
        );
    }

    #[test]
    fn python_falls_back_to_the_other_tool_when_the_preferred_one_is_missing() {
        let machine = Fake::default()
            .file("/repo/pyproject.toml", "[tool.ruff]\n")
            .exe("/usr/bin/black")
            .path("/usr/bin");
        assert_eq!(
            label(&plan_for(&machine, Language::Python, PY)),
            Some("black")
        );
        assert_eq!(
            plan_for(&Fake::default(), Language::Python, PY),
            Plan::Unavailable("No Python formatter found. Install ruff or black.".into())
        );
    }

    #[test]
    fn a_project_virtualenv_wins_over_the_login_path() {
        let machine = Fake::default()
            .exe("/repo/venv/bin/ruff")
            .exe("/repo/pkg/.venv/bin/ruff")
            .exe("/usr/bin/ruff")
            .path("/usr/bin");
        let Plan::Tool(tool) = plan_for(&machine, Language::Python, PY) else {
            panic!("expected a tool");
        };
        assert_eq!(tool.program, PathBuf::from("/repo/pkg/.venv/bin/ruff"));
    }

    #[test]
    fn toml_section_match_respects_the_name_boundary() {
        assert!(has_toml_section("[tool.ruff]", "tool.ruff"));
        assert!(has_toml_section("  [tool.ruff.lint]", "tool.ruff"));
        assert!(has_toml_section("[[tool.ruff.x]]", "tool.ruff"));
        assert!(!has_toml_section("[tool.ruffle]", "tool.ruff"));
        assert!(!has_toml_section("# [tool.ruff]", "tool.ruff"));
    }

    const RS: &str = "/repo/crates/core/src/lib.rs";

    fn rustfmt_args(machine: Fake) -> Vec<String> {
        let machine = machine.exe("/home/dev/.cargo/bin/rustfmt");
        match plan_for(&machine, Language::Rust, RS) {
            Plan::Tool(tool) => {
                assert_eq!(tool.program, PathBuf::from("/home/dev/.cargo/bin/rustfmt"));
                tool.args
            }
            other => panic!("expected rustfmt, got {other:?}"),
        }
    }

    #[test]
    fn rust_uses_the_nearest_manifest_edition() {
        let machine = Fake::default()
            .file(
                "/repo/crates/core/Cargo.toml",
                "[package]\nname = \"core\"\nedition = \"2024\" # newest\n",
            )
            .file(
                "/repo/Cargo.toml",
                "[workspace.package]\nedition = \"2018\"\n",
            );
        assert_eq!(rustfmt_args(machine), ["--edition", "2024"]);
    }

    #[test]
    fn rust_follows_an_inherited_edition_to_the_workspace() {
        for inherit in ["edition.workspace = true", "edition = { workspace = true }"] {
            let machine = Fake::default()
                .file(
                    "/repo/crates/core/Cargo.toml",
                    &format!("[package]\nname = \"core\"\n{inherit}\n"),
                )
                .file(
                    "/repo/Cargo.toml",
                    "[workspace]\nmembers = []\n\n[workspace.package]\nedition = \"2018\"\n",
                );
            assert_eq!(rustfmt_args(machine), ["--edition", "2018"], "{inherit}");
        }
    }

    #[test]
    fn rust_defaults_to_2021() {
        assert_eq!(rustfmt_args(Fake::default()), ["--edition", "2021"]);
        let no_edition = Fake::default().file(
            "/repo/crates/core/Cargo.toml",
            "[package]\nname = \"core\"\n[dependencies]\nedition = \"2015\"\n",
        );
        assert_eq!(rustfmt_args(no_edition), ["--edition", "2021"]);
        let unresolved = Fake::default().file(
            "/repo/crates/core/Cargo.toml",
            "[package]\nedition.workspace = true\n",
        );
        assert_eq!(rustfmt_args(unresolved), ["--edition", "2021"]);
        let junk = Fake::default().file(
            "/repo/crates/core/Cargo.toml",
            "[package]\nedition = \"--help\"\n",
        );
        assert_eq!(rustfmt_args(junk), ["--edition", "2021"]);
    }

    #[test]
    fn go_and_shell_resolve_on_the_machine_with_their_extra_folders() {
        let go = Fake::default().exe("/usr/local/go/bin/gofmt");
        assert_eq!(
            plan_for(&go, Language::Go, "/repo/main.go"),
            Plan::Tool(Tool {
                label: "gofmt",
                program: PathBuf::from("/usr/local/go/bin/gofmt"),
                args: vec![],
            })
        );
        let home_go = Fake::default().exe("/home/dev/go/bin/gofmt");
        assert_eq!(
            label(&plan_for(&home_go, Language::Go, "/r/m.go")),
            Some("gofmt")
        );
        let shell = Fake::default().exe("/usr/bin/shfmt").path("/usr/bin");
        assert_eq!(
            plan_for(&shell, Language::Shell, "/repo/run.sh"),
            Plan::Tool(Tool {
                label: "shfmt",
                program: PathBuf::from("/usr/bin/shfmt"),
                args: vec!["-filename".into(), "/repo/run.sh".into()],
            })
        );
    }

    #[test]
    fn missing_machine_tools_say_what_to_install() {
        for (language, needle) in [
            (Language::Go, "gofmt"),
            (Language::Rust, "rustfmt"),
            (Language::Shell, "shfmt"),
        ] {
            let Plan::Unavailable(reason) = plan_for(&Fake::default(), language, "/r/x") else {
                panic!("expected unavailable");
            };
            assert!(reason.contains(needle), "{reason}");
        }
    }

    #[test]
    fn the_child_runs_in_the_files_folder_or_the_walk_root() {
        let machine = Fake::default().file("/repo/app/src/other.ts", "");
        let walk = walk_dirs(Path::new(FILE), &machine);
        assert_eq!(
            child_cwd(Path::new(FILE), &walk, &machine),
            PathBuf::from("/repo/app/src")
        );
        let new_folder = Path::new("/repo/app/fresh/new.ts");
        let walk = walk_dirs(new_folder, &machine);
        assert_eq!(child_cwd(new_folder, &walk, &machine), PathBuf::from("/"));
    }

    #[test]
    fn resolution_on_a_real_disk_finds_the_project_tool() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let bin = repo.join("node_modules/.bin");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(repo.join("biome.json"), "{}").unwrap();
        for tool in ["biome", "prettier"] {
            std::fs::write(bin.join(tool), "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(bin.join(tool), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let disk = Disk::new(String::new(), None);
        let file = repo.join("src/a.ts");
        let walk = walk_dirs(&file, &disk);
        assert_eq!(walk.last(), Some(&repo));
        assert_eq!(
            label(&plan(Language::TypeScript, &file, &walk, &disk)),
            Some("biome (project)")
        );
        assert_eq!(
            label(&plan(Language::Markdown, &file, &walk, &disk)),
            Some("prettier (project)")
        );
        assert_eq!(child_cwd(&file, &walk, &disk), repo.join("src"));
    }
}
