//! What features need from the machine, and how to find out.
//!
//! One mechanism, shared: find an executable by absolute path through the
//! login shell's PATH, run it once with a timeout, read its version, remember
//! the answer per binary. Simple tools are rows in [`table`]; checks that are
//! not simple live next to their feature and return the same [`Check`].
//! We check and report; we never pin or install a third-party runtime.

mod cache;
mod check;
mod probe;
mod resolve;
mod table;
mod version;

pub use check::Check;
pub use probe::{run_probe, DEFAULT_PROBE_TIMEOUT};
pub use resolve::resolve_executable;
pub use table::{dependency, DependencyReport};
pub use version::{format_version, meets_minimum, parse_version};

/// Every declared dependency, probed now. `refresh` first re-reads the login
/// shell's environment — what "Check Again" does after the human installed
/// something and changed their shell rc files.
#[tauri::command]
pub async fn machine_dependencies(refresh: Option<bool>) -> Vec<DependencyReport> {
    if refresh.unwrap_or(false) {
        crate::agents::refresh_login_shell_env().await;
    }
    table::inspect_all().await
}
