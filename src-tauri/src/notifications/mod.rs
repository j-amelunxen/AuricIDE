//! The notification inbox: a persistent, cross-project event log.

mod operations;
mod schema;
mod types;

#[cfg(test)]
mod tests;

pub use operations::*;
pub use schema::*;
pub use types::*;
