//! Pure delivery policy. Keep this module free of SQLite, HTTP and clocks: its
//! small transition table is the conformance surface for stronger verification.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Complete model state space; SQLite constructs `pending` directly.
pub enum DeliveryStatus {
    Pending,
    Processing,
    Retry,
    Delivered,
    Dead,
    Skipped,
}

impl DeliveryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Retry => "retry",
            Self::Delivered => "delivered",
            Self::Dead => "dead",
            Self::Skipped => "skipped",
        }
    }

    #[cfg(test)]
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Delivered | Self::Dead | Self::Skipped)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptResult {
    Delivered,
    Retryable,
    PermanentFailure,
    Disabled,
    BelowThreshold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transition {
    pub status: DeliveryStatus,
    pub retry_after_secs: Option<u64>,
}

pub const MAX_ATTEMPTS: u32 = 8;
const BASE_BACKOFF_SECS: u64 = 15;
const MAX_BACKOFF_SECS: u64 = 60 * 60;

#[cfg(test)]
pub fn can_claim(status: DeliveryStatus, available: bool, lease_expired: bool) -> bool {
    match status {
        DeliveryStatus::Pending | DeliveryStatus::Retry => available,
        DeliveryStatus::Processing => lease_expired,
        DeliveryStatus::Delivered | DeliveryStatus::Dead | DeliveryStatus::Skipped => false,
    }
}

pub fn retry_delay_secs(attempts: u32) -> u64 {
    let exponent = attempts.saturating_sub(1).min(16);
    BASE_BACKOFF_SECS
        .saturating_mul(1_u64 << exponent)
        .min(MAX_BACKOFF_SECS)
}

/// `attempts` includes the claim whose result is being classified.
pub fn transition(attempts: u32, result: AttemptResult) -> Transition {
    match result {
        AttemptResult::Delivered => Transition {
            status: DeliveryStatus::Delivered,
            retry_after_secs: None,
        },
        AttemptResult::Disabled | AttemptResult::BelowThreshold => Transition {
            status: DeliveryStatus::Skipped,
            retry_after_secs: None,
        },
        AttemptResult::PermanentFailure => Transition {
            status: DeliveryStatus::Dead,
            retry_after_secs: None,
        },
        AttemptResult::Retryable if attempts >= MAX_ATTEMPTS => Transition {
            status: DeliveryStatus::Dead,
            retry_after_secs: None,
        },
        AttemptResult::Retryable => Transition {
            status: DeliveryStatus::Retry,
            retry_after_secs: Some(retry_delay_secs(attempts)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_states_can_never_be_reclaimed() {
        for status in [
            DeliveryStatus::Delivered,
            DeliveryStatus::Dead,
            DeliveryStatus::Skipped,
        ] {
            assert!(status.is_terminal());
            assert!(!can_claim(status, true, true));
        }
    }

    #[test]
    fn only_an_expired_processing_lease_can_be_reclaimed() {
        assert!(!can_claim(DeliveryStatus::Processing, true, false));
        assert!(can_claim(DeliveryStatus::Processing, false, true));
    }

    #[test]
    fn retryable_failures_back_off_then_become_terminal() {
        assert_eq!(
            transition(1, AttemptResult::Retryable).status,
            DeliveryStatus::Retry
        );
        assert_eq!(
            transition(1, AttemptResult::Retryable).retry_after_secs,
            Some(15)
        );
        assert_eq!(
            transition(2, AttemptResult::Retryable).retry_after_secs,
            Some(30)
        );
        assert_eq!(
            transition(MAX_ATTEMPTS, AttemptResult::Retryable).status,
            DeliveryStatus::Dead
        );
    }

    #[test]
    fn disabled_and_filtered_delivery_are_successful_terminal_skips() {
        assert_eq!(
            transition(1, AttemptResult::Disabled).status,
            DeliveryStatus::Skipped
        );
        assert_eq!(
            transition(1, AttemptResult::BelowThreshold).status,
            DeliveryStatus::Skipped
        );
    }
}
