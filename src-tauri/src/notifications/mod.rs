//! The notification inbox: a persistent, cross-project event log.

mod coalesce;
mod operations;
mod schema;
mod types;
mod watch;

#[cfg(test)]
mod tests;

pub use operations::*;
pub use schema::*;
pub use types::*;
pub use watch::*;
