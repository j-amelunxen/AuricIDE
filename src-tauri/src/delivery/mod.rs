mod outbox;
mod policy;
mod pushover;
mod types;
pub(crate) mod worker;

pub use types::PUSHOVER_NAMESPACE;
pub use worker::DeliveryRouterState;

use std::collections::BTreeMap;
use tauri::Manager;
use types::PushoverConfig;

/// What a change to the credentials store means for delivery, checked before
/// it is written. Pushover cannot be on without both keys, and switching it on
/// means "from now on": what was queued while it was off is skipped, never
/// flushed. Other namespaces are not delivery's business. Returns whether the
/// router should be woken once the change is written.
pub fn credentials_changing(
    app: &tauri::AppHandle,
    namespace: &str,
    before: Option<&BTreeMap<String, String>>,
    after: Option<&BTreeMap<String, String>>,
) -> Result<bool, String> {
    if namespace != PUSHOVER_NAMESPACE {
        return Ok(false);
    }
    if pushover_switches_on(before, after)? {
        if let Some(delivery) = app.try_state::<DeliveryRouterState>() {
            delivery.skip_nonterminal()?;
        }
    }
    Ok(true)
}

/// Starts a delivery pass now rather than at the next tick.
pub fn wake(app: &tauri::AppHandle) {
    if let Some(delivery) = app.try_state::<DeliveryRouterState>() {
        delivery.wake();
    }
}

/// Whether Pushover goes from off to on; an error when it would be on
/// without both credentials.
fn pushover_switches_on(
    before: Option<&BTreeMap<String, String>>,
    after: Option<&BTreeMap<String, String>>,
) -> Result<bool, String> {
    let config = |values: Option<&BTreeMap<String, String>>| {
        PushoverConfig::from_namespace(values.cloned().unwrap_or_default())
    };
    let (before, after) = (config(before), config(after));
    if after.enabled && !after.is_configured() {
        return Err("Enter both Pushover credentials before enabling delivery".to_string());
    }
    Ok(after.enabled && !before.enabled)
}

#[cfg(test)]
mod credential_tests {
    use super::pushover_switches_on;
    use std::collections::BTreeMap;

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn switching_on_needs_both_nonblank_credentials() {
        let half = values(&[("enabled", "true"), ("api_token", "t"), ("user_key", "  ")]);
        assert!(pushover_switches_on(None, Some(&half)).is_err());
    }

    #[test]
    fn only_the_switch_from_off_to_on_skips_the_queue() {
        let on = values(&[("enabled", "true"), ("api_token", "t"), ("user_key", "u")]);
        let off = values(&[("api_token", "t"), ("user_key", "u")]);
        assert_eq!(pushover_switches_on(Some(&off), Some(&on)), Ok(true));
        assert_eq!(pushover_switches_on(Some(&on), Some(&on)), Ok(false));
        assert_eq!(pushover_switches_on(Some(&on), Some(&off)), Ok(false));
    }
}
