//! The last stretch of every agent's console, kept for readers outside the
//! webview (the control socket, `docs/design-agent-control.md`).
//!
//! Each agent gets a ring of `BUFFER_BYTES_PER_AGENT` bytes and a running
//! offset that counts every byte it ever produced, so a reader can ask for
//! "everything since offset N" and learn whether some of it is already gone.
//! Buffers of finished agents are kept for the `FINISHED_AGENTS_KEPT` most
//! recent ones — a reader asking what an agent did right after it stopped is
//! the common case, not an edge case.
//!
//! Output is cleaned as it is appended, by one `AnsiStripper` per agent: a
//! sequence split across two PTY batches is removed whole, instead of its
//! tail leaking into whichever read starts there. Offsets count bytes of the
//! cleaned text.

use super::types::AgentStatus;
use crate::ansi::AnsiStripper;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub const BUFFER_BYTES_PER_AGENT: usize = 256 * 1024;
pub const FINISHED_AGENTS_KEPT: usize = 20;

pub type OutputBuffersState = Arc<OutputBuffers>;

pub fn new_output_buffers_state() -> OutputBuffersState {
    Arc::new(OutputBuffers::default())
}

/// A read out of one agent's ring. `text` is the cleaned console; it covers
/// `[start_offset, end_offset)`.
#[derive(Debug, Clone, PartialEq)]
pub struct OutputSlice {
    pub text: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub truncated: bool,
    /// How the agent ended, once it has. `None` while it runs.
    pub final_status: Option<AgentStatus>,
}

struct Ring {
    bytes: VecDeque<u8>,
    /// Cleaned bytes since the agent started, evicted ones included.
    total: u64,
    final_status: Option<AgentStatus>,
    stripper: AnsiStripper,
}

impl Default for Ring {
    fn default() -> Self {
        Self {
            bytes: VecDeque::new(),
            total: 0,
            final_status: None,
            stripper: AnsiStripper::console(),
        }
    }
}

impl Ring {
    fn oldest_offset(&self) -> u64 {
        self.total - self.bytes.len() as u64
    }

    fn append(&mut self, data: &[u8], capacity: usize) {
        self.total += data.len() as u64;
        // Only the tail of an oversized chunk can survive; copying the rest
        // just to evict it again would be wasted work on the output hot path.
        let data = &data[data.len().saturating_sub(capacity)..];
        let overflow = (self.bytes.len() + data.len()).saturating_sub(capacity);
        self.bytes.drain(..overflow);
        self.bytes.extend(data);
    }
}

#[derive(Default)]
struct Inner {
    rings: HashMap<String, Ring>,
    /// Finished agents, oldest first. Only these are ever evicted.
    finished: VecDeque<String>,
    /// Reused for every append, so cleaning allocates nothing per chunk.
    scratch: String,
}

pub struct OutputBuffers {
    inner: Mutex<Inner>,
    capacity: usize,
    finished_kept: usize,
}

impl Default for OutputBuffers {
    fn default() -> Self {
        Self::with_limits(BUFFER_BYTES_PER_AGENT, FINISHED_AGENTS_KEPT)
    }
}

impl OutputBuffers {
    pub fn with_limits(capacity: usize, finished_kept: usize) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            capacity,
            finished_kept,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic mid-append leaves a ring that is at worst short a chunk;
        // refusing every later read over it would be worse.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn append(&self, agent_id: &str, data: &str) {
        if data.is_empty() {
            return;
        }
        let mut guard = self.lock();
        let inner = &mut *guard;
        if !inner.rings.contains_key(agent_id) {
            inner.rings.insert(agent_id.to_string(), Ring::default());
        }
        let Some(ring) = inner.rings.get_mut(agent_id) else {
            return;
        };
        inner.scratch.clear();
        ring.stripper.push(data, &mut inner.scratch);
        ring.append(inner.scratch.as_bytes(), self.capacity);
    }

    /// Record that the agent ended. Its buffer stays readable until
    /// `finished_kept` agents have finished after it.
    pub fn finish(&self, agent_id: &str, status: AgentStatus) {
        let mut inner = self.lock();
        let ring = inner.rings.entry(agent_id.to_string()).or_default();
        if ring.final_status.is_some() {
            return;
        }
        ring.final_status = Some(status);
        inner.finished.push_back(agent_id.to_string());
        while inner.finished.len() > self.finished_kept {
            if let Some(evicted) = inner.finished.pop_front() {
                inner.rings.remove(&evicted);
            }
        }
    }

    pub fn knows(&self, agent_id: &str) -> bool {
        self.lock().rings.contains_key(agent_id)
    }

    /// The agent's running byte offset; 0 for an agent that printed nothing.
    pub fn total_bytes(&self, agent_id: &str) -> u64 {
        self.lock().rings.get(agent_id).map_or(0, |ring| ring.total)
    }

    /// Read from `since_offset` when given, otherwise the last `tail_bytes`.
    /// `None` when the agent has no buffer at all.
    pub fn read(
        &self,
        agent_id: &str,
        tail_bytes: u64,
        since_offset: Option<u64>,
    ) -> Option<OutputSlice> {
        let (raw, start, end, truncated, final_status) = {
            let inner = self.lock();
            let ring = inner.rings.get(agent_id)?;
            let oldest = ring.oldest_offset();
            let end = ring.total;
            let (start, truncated) = match since_offset {
                Some(since) if since < oldest => (oldest, true),
                Some(since) => (since.min(end), false),
                None => {
                    let start = end.saturating_sub(tail_bytes).max(oldest);
                    (start, start > 0)
                }
            };
            let skip = (start - oldest) as usize;
            let take = (end - start) as usize;
            let raw: Vec<u8> = ring.bytes.range(skip..skip + take).copied().collect();
            (raw, start, end, truncated, ring.final_status.clone())
        };

        // Appends always end on a character boundary, but a start chosen by
        // eviction or by the tail length may fall inside one. The partial
        // character is left out and `start_offset` says so, rather than
        // decoding it into replacement characters.
        let lead = raw
            .iter()
            .take(3)
            .take_while(|byte| (0x80..0xc0).contains(*byte))
            .count();
        let text = String::from_utf8_lossy(&raw[lead..]).into_owned();
        Some(OutputSlice {
            text,
            start_offset: start + lead as u64,
            end_offset: end,
            truncated,
            final_status,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = include_str!("../../../src/lib/agents/agentControl.fixtures.json");

    #[test]
    fn limits_match_the_contract() {
        let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
        let limits = &fixtures["limits"];
        assert_eq!(limits["bufferBytesPerAgent"], BUFFER_BYTES_PER_AGENT as u64);
        assert_eq!(limits["finishedAgentsKept"], FINISHED_AGENTS_KEPT as u64);
    }

    #[test]
    fn tail_read_returns_the_newest_bytes_and_says_older_ones_existed() {
        let buffers = OutputBuffers::default();
        buffers.append("agent-1", "first line\r\n");
        buffers.append("agent-1", "second\r\n");

        let all = buffers.read("agent-1", 1024, None).unwrap();
        assert_eq!(all.text, "first line\nsecond\n");
        // Offsets count cleaned bytes: each "\r\n" is one.
        assert_eq!((all.start_offset, all.end_offset), (0, 18));
        assert!(!all.truncated);

        let tail = buffers.read("agent-1", 7, None).unwrap();
        assert_eq!(tail.text, "second\n");
        assert_eq!((tail.start_offset, tail.end_offset), (11, 18));
        assert!(tail.truncated);
    }

    #[test]
    fn overflow_keeps_the_newest_capacity_bytes_and_the_running_offset() {
        let buffers = OutputBuffers::with_limits(8, 20);
        buffers.append("a", "0123456789");
        buffers.append("a", "abc");
        assert_eq!(buffers.total_bytes("a"), 13);

        let slice = buffers.read("a", 1024, None).unwrap();
        assert_eq!(slice.text, "56789abc");
        assert_eq!((slice.start_offset, slice.end_offset), (5, 13));
        assert!(slice.truncated);
    }

    #[test]
    fn since_offset_returns_only_what_is_new() {
        let buffers = OutputBuffers::default();
        buffers.append("a", "old ");
        let end = buffers.total_bytes("a");
        buffers.append("a", "new");

        let slice = buffers.read("a", 16, Some(end)).unwrap();
        assert_eq!(slice.text, "new");
        assert_eq!((slice.start_offset, slice.end_offset), (4, 7));
        assert!(!slice.truncated);

        let nothing = buffers.read("a", 16, Some(7)).unwrap();
        assert_eq!(nothing.text, "");
        assert_eq!((nothing.start_offset, nothing.end_offset), (7, 7));

        let beyond = buffers.read("a", 16, Some(99)).unwrap();
        assert_eq!((beyond.start_offset, beyond.end_offset), (7, 7));
    }

    #[test]
    fn since_offset_older_than_the_buffer_starts_at_the_oldest_kept_byte() {
        let buffers = OutputBuffers::with_limits(4, 20);
        buffers.append("a", "abcdefgh");
        let slice = buffers.read("a", 16, Some(1)).unwrap();
        assert_eq!(slice.text, "efgh");
        assert_eq!(slice.start_offset, 4);
        assert!(slice.truncated);
    }

    #[test]
    fn a_start_inside_a_character_skips_the_partial_character() {
        let buffers = OutputBuffers::default();
        buffers.append("a", "xÄy");
        // "Ä" is two bytes at offsets 1..3; the last 2 bytes start inside it.
        let slice = buffers.read("a", 2, None).unwrap();
        assert_eq!(slice.text, "y");
        assert_eq!(slice.start_offset, 3);
    }

    #[test]
    fn escape_sequences_are_removed() {
        let buffers = OutputBuffers::default();
        buffers.append(
            "a",
            "\x1b]0;claude\x07\x1b[32mReading src/parser.ts\x1b[0m\r\n",
        );
        assert_eq!(
            buffers.read("a", 1024, None).unwrap().text,
            "Reading src/parser.ts\n"
        );
    }

    #[test]
    fn a_sequence_split_across_batches_does_not_leak_into_the_next_read() {
        let buffers = OutputBuffers::default();
        buffers.append("a", "ok\x1b[3");
        let end = buffers.total_bytes("a");
        buffers.append("a", "8;5;12m\x0fgo\r");
        let slice = buffers.read("a", 16, Some(end)).unwrap();
        assert_eq!(slice.text, "go\n");
        assert_eq!((slice.start_offset, slice.end_offset), (2, 5));
    }

    #[test]
    fn only_the_most_recently_finished_agents_are_kept() {
        let buffers = OutputBuffers::with_limits(64, 2);
        buffers.append("running", "still here");
        for id in ["a", "", "c"] {
            buffers.append(id, "x");
            buffers.finish(id, AgentStatus::Idle);
        }
        assert!(!buffers.knows("a"));
        assert!(buffers.knows(""));
        assert!(buffers.knows("c"));
        assert!(buffers.knows("running"), "a running agent is never evicted");
        assert_eq!(
            buffers.read("c", 16, None).unwrap().final_status,
            Some(AgentStatus::Idle)
        );
    }

    #[test]
    fn finishing_twice_does_not_take_a_second_slot() {
        let buffers = OutputBuffers::with_limits(64, 2);
        buffers.finish("a", AgentStatus::Error);
        buffers.finish("a", AgentStatus::Idle);
        buffers.finish("", AgentStatus::Idle);
        assert!(buffers.knows("a"));
        assert_eq!(
            buffers.read("a", 16, None).unwrap().final_status,
            Some(AgentStatus::Error)
        );
    }

    #[test]
    fn an_unknown_agent_has_no_buffer() {
        let buffers = OutputBuffers::default();
        assert!(buffers.read("nope", 16, None).is_none());
        assert_eq!(buffers.total_bytes("nope"), 0);
    }
}
