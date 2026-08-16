//! Tokens to money.
//!
//! Everything here is arithmetic over a manifest's rates — no I/O, no clock,
//! no knowledge of where the numbers came from. That is deliberate: the price
//! of a run is the one figure in this feature nobody can eyeball for
//! plausibility, so it has to be the part that is trivially testable.

use serde::{Deserialize, Serialize};

use super::manifest::{CacheMultipliers, Rate, ServerToolRates};

/// Everything one assistant turn consumed.
///
/// `thinking` is *not* added anywhere: the transcript reports it inside
/// `output_tokens_details`, so it is already part of `output`. It is carried
/// only so the report can say how much of the output was reasoning.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCounts {
    pub input: u64,
    pub output: u64,
    pub cache_write5m: u64,
    pub cache_write1h: u64,
    pub cache_read: u64,
    /// A subset of `output`, reported separately for the breakdown.
    pub thinking: u64,
    pub web_search_requests: u64,
    pub web_fetch_requests: u64,
}

impl TokenCounts {
    /// Everything the API charged for, counted once.
    pub fn billable(&self) -> u64 {
        self.input + self.output + self.cache_write5m + self.cache_write1h + self.cache_read
    }

    pub fn is_empty(&self) -> bool {
        self.billable() == 0 && self.web_search_requests == 0 && self.web_fetch_requests == 0
    }
}

impl std::ops::AddAssign for TokenCounts {
    fn add_assign(&mut self, other: Self) {
        self.input += other.input;
        self.output += other.output;
        self.cache_write5m += other.cache_write5m;
        self.cache_write1h += other.cache_write1h;
        self.cache_read += other.cache_read;
        self.thinking += other.thinking;
        self.web_search_requests += other.web_search_requests;
        self.web_fetch_requests += other.web_fetch_requests;
    }
}

const PER_M_TOK: f64 = 1_000_000.0;
const PER_THOUSAND: f64 = 1_000.0;

/// What this turn cost, in the manifest's currency.
///
/// Cached tokens are priced off the *input* rate, never the output one: a
/// cache write is an input token that was also stored, and a cache read is an
/// input token that was not recomputed. Multiplying either by the output rate
/// would overstate a heavily-cached agent run several times over.
pub fn cost_of(
    counts: &TokenCounts,
    rate: &Rate,
    cache: &CacheMultipliers,
    server_tools: &ServerToolRates,
) -> f64 {
    let input_rate = rate.input_per_m_tok;

    let tokens = (counts.input as f64) * input_rate
        + (counts.output as f64) * rate.output_per_m_tok
        + (counts.cache_write5m as f64) * input_rate * cache.write5m
        + (counts.cache_write1h as f64) * input_rate * cache.write1h
        + (counts.cache_read as f64) * input_rate * cache.read;

    let tools = (counts.web_search_requests as f64) * server_tools.web_search_per_thousand
        + (counts.web_fetch_requests as f64) * server_tools.web_fetch_per_thousand;

    tokens / PER_M_TOK + tools / PER_THOUSAND
}

/// What the prompt cache saved on this turn.
///
/// A cache read is an input token that was not recomputed: it billed at
/// `cache.read` of the input rate instead of the full rate, so the saving is
/// the difference. Cache *writes* are excluded deliberately — they cost more
/// than a plain input token, not less, and netting them off here would turn
/// one honest number into two hidden ones. The write premium is visible in
/// the cost this saving is set against.
pub fn cache_saving_of(counts: &TokenCounts, rate: &Rate, cache: &CacheMultipliers) -> f64 {
    let unavoided = (1.0 - cache.read).max(0.0);
    (counts.cache_read as f64) * rate.input_per_m_tok * unavoided / PER_M_TOK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opus_rate() -> Rate {
        Rate {
            until: None,
            input_per_m_tok: 5.0,
            output_per_m_tok: 25.0,
            note: None,
        }
    }

    fn cache() -> CacheMultipliers {
        CacheMultipliers {
            write5m: 1.25,
            write1h: 2.0,
            read: 0.1,
        }
    }

    fn tools() -> ServerToolRates {
        ServerToolRates {
            web_search_per_thousand: 10.0,
            web_fetch_per_thousand: 0.0,
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn a_plain_turn_costs_input_plus_output() {
        let counts = TokenCounts {
            input: 1_000_000,
            output: 1_000_000,
            ..Default::default()
        };
        assert_close(
            cost_of(&counts, &opus_rate(), &cache(), &tools()),
            5.0 + 25.0,
        );
    }

    #[test]
    fn cache_tokens_are_priced_off_the_input_rate() {
        // The whole point of the multipliers: a cache read is a cheap input
        // token, not an output token. Pricing it at $25/MTok instead of
        // $0.50/MTok would inflate a long agent session fiftyfold.
        let read_only = TokenCounts {
            cache_read: 1_000_000,
            ..Default::default()
        };
        assert_close(
            cost_of(&read_only, &opus_rate(), &cache(), &tools()),
            5.0 * 0.1,
        );

        let write_5m = TokenCounts {
            cache_write5m: 1_000_000,
            ..Default::default()
        };
        assert_close(
            cost_of(&write_5m, &opus_rate(), &cache(), &tools()),
            5.0 * 1.25,
        );

        let write_1h = TokenCounts {
            cache_write1h: 1_000_000,
            ..Default::default()
        };
        assert_close(
            cost_of(&write_1h, &opus_rate(), &cache(), &tools()),
            5.0 * 2.0,
        );
    }

    #[test]
    fn the_two_cache_write_ttls_are_priced_apart() {
        // A one-hour write costs 1.6x a five-minute one. Folding them into a
        // single "cache creation" bucket — which is what the older transcript
        // format offered — understates any run that uses the 1h TTL.
        let five = TokenCounts {
            cache_write5m: 100_000,
            ..Default::default()
        };
        let hour = TokenCounts {
            cache_write1h: 100_000,
            ..Default::default()
        };
        let five_cost = cost_of(&five, &opus_rate(), &cache(), &tools());
        let hour_cost = cost_of(&hour, &opus_rate(), &cache(), &tools());
        assert_close(hour_cost / five_cost, 2.0 / 1.25);
    }

    #[test]
    fn thinking_tokens_are_not_billed_a_second_time() {
        // They are already inside `output`; adding them again would overstate
        // every high-effort turn.
        let without = TokenCounts {
            output: 10_000,
            ..Default::default()
        };
        let with = TokenCounts {
            output: 10_000,
            thinking: 9_000,
            ..Default::default()
        };
        assert_close(
            cost_of(&with, &opus_rate(), &cache(), &tools()),
            cost_of(&without, &opus_rate(), &cache(), &tools()),
        );
        assert_eq!(with.billable(), without.billable());
    }

    #[test]
    fn web_search_is_billed_per_request_not_per_token() {
        let counts = TokenCounts {
            web_search_requests: 250,
            ..Default::default()
        };
        assert_close(cost_of(&counts, &opus_rate(), &cache(), &tools()), 2.5);
    }

    #[test]
    fn the_cache_saving_is_what_the_read_would_have_cost_uncached() {
        // 1M cache reads on Opus bill at $0.50 where a fresh read would have
        // billed $5.00 — the saving is the $4.50 difference, not the $0.50 paid.
        let counts = TokenCounts {
            cache_read: 1_000_000,
            ..Default::default()
        };
        assert_close(cache_saving_of(&counts, &opus_rate(), &cache()), 4.5);
    }

    #[test]
    fn cache_writes_are_not_counted_as_a_saving() {
        // A write costs *more* than a plain input token. Folding it in here
        // would let a run that wrote a lot of cache and read none of it back
        // report a saving it never made.
        let counts = TokenCounts {
            cache_write5m: 1_000_000,
            cache_write1h: 1_000_000,
            ..Default::default()
        };
        assert_close(cache_saving_of(&counts, &opus_rate(), &cache()), 0.0);
    }

    #[test]
    fn an_empty_turn_costs_nothing() {
        let counts = TokenCounts::default();
        assert!(counts.is_empty());
        assert_close(cost_of(&counts, &opus_rate(), &cache(), &tools()), 0.0);
    }

    #[test]
    fn totals_accumulate_field_by_field() {
        let mut total = TokenCounts::default();
        total += TokenCounts {
            input: 1,
            output: 2,
            cache_write5m: 3,
            cache_write1h: 4,
            cache_read: 5,
            thinking: 6,
            web_search_requests: 7,
            web_fetch_requests: 8,
        };
        total += TokenCounts {
            input: 10,
            output: 20,
            cache_write5m: 30,
            cache_write1h: 40,
            cache_read: 50,
            thinking: 60,
            web_search_requests: 70,
            web_fetch_requests: 80,
        };
        assert_eq!(total.input, 11);
        assert_eq!(total.output, 22);
        assert_eq!(total.cache_write5m, 33);
        assert_eq!(total.cache_write1h, 44);
        assert_eq!(total.cache_read, 55);
        assert_eq!(total.thinking, 66);
        assert_eq!(total.web_search_requests, 77);
        assert_eq!(total.web_fetch_requests, 88);
        assert_eq!(total.billable(), 11 + 22 + 33 + 44 + 55);
    }
}
