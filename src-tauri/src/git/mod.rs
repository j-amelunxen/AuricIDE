#![allow(unused_imports)]

pub mod blame;
pub mod commands;
pub mod diff;
pub mod discard;
pub mod discovery;
pub mod graph;
pub mod log;
pub mod merge;
pub mod operation_step;
pub mod refs_ops;
pub mod staging;
pub mod status;
pub mod types;
pub mod worktree_include;
pub mod worktrees;

// Re-export commands for lib.rs and tauri handler
pub use commands::*;

// Re-export implementations for internal / test use
pub use blame::*;
pub use diff::*;
pub use discard::*;
pub use discovery::*;
pub use graph::*;
pub use log::*;
pub use merge::*;
pub use operation_step::*;
pub use refs_ops::*;
pub use staging::*;
pub use status::*;
pub use types::*;
pub use worktree_include::*;
pub use worktrees::*;

#[cfg(test)]
pub(crate) mod tests;
