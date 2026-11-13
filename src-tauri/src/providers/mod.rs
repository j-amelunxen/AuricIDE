pub mod commands;
pub mod crush;
pub mod dynamic;
pub mod model_catalog;
pub mod registry;
pub mod types;

pub use registry::*;
pub use types::*;

#[cfg(test)]
mod dynamic_tests;
#[cfg(test)]
mod registry_tests;

/// Provider ids are lowercase in the registry; a hand-typed key must still match.
pub fn normalize_provider_id(value: &str) -> String {
    value.trim().to_lowercase()
}
