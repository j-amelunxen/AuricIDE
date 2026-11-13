//! Pure delivery policy. Keep this module free of SQLite, HTTP and clocks: its
//! small transition table is the conformance surface for stronger verification.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryStatus {
    Pending,
    Processing,
    Retry,
    Delivered,
    Dead,
    Skipped,
}

impl DeliveryStatus {
    const ALL: [Self; 6] = [
        Self::Pending,
        Self::Processing,
        Self::Retry,
        Self::Delivered,
        Self::Dead,
        Self::Skipped,
    ];

    /// The statuses that are (or are not) final, as a quoted SQL `IN` list.
    pub fn sql_list(terminal: bool) -> String {
        Self::ALL
            .iter()
            .filter(|status| status.is_terminal() == terminal)
            .map(|status| format!("'{}'", status.as_str()))
            .collect::<Vec<_>>()
            .join(", ")
    }

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

/// Which rows a worker may claim, as SQL over `status`, `available_at` and
/// `lease_until` with `?1` as now: a waiting row once it is due, a row being
/// processed once its lease lapsed. A final row never.
pub fn claimable_sql() -> String {
    format!(
        "(status IN ('{}', '{}') AND available_at <= ?1) OR (status = '{}' AND lease_until <= ?1)",
        DeliveryStatus::Pending.as_str(),
        DeliveryStatus::Retry.as_str(),
        DeliveryStatus::Processing.as_str(),
    )
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
    fn the_sql_status_lists_split_every_status_by_finality() {
        assert_eq!(
            DeliveryStatus::sql_list(true),
            "'delivered', 'dead', 'skipped'"
        );
        assert_eq!(
            DeliveryStatus::sql_list(false),
            "'pending', 'processing', 'retry'"
        );
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
