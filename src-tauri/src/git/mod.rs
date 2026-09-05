#![allow(unused_imports)]

pub mod blame;
pub mod commands;
pub mod diff;
pub mod discard;
pub mod discovery;
pub mod log;
pub mod staging;
pub mod status;
pub mod types;
pub mod worktrees;

// Re-export commands for lib.rs and tauri handler
pub use commands::*;

// Re-export implementations for internal / test use
pub use blame::*;
pub use diff::*;
pub use discard::*;
pub use discovery::*;
pub use log::*;
pub use staging::*;
pub use status::*;
pub use types::*;
pub use worktrees::*;

#[cfg(test)]
mod tests;
