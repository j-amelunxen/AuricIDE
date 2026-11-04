"""Shared data model: normalised request records and the coverage ledger.

Nothing in here ever holds message content. Records carry sizes, counts, token
figures, timestamps, model, tool names, skill names and agent ids only.
"""
from __future__ import annotations

import dataclasses
from collections import Counter
from typing import Dict, Optional

MEASURED = "measured"
ESTIMATED = "estimated"
HEURISTIC = "heuristic"
UNKNOWN = "unknown"


@dataclasses.dataclass
class Req:
    """One API request (one model response), already deduplicated."""

    source: str            # claude | codex | box
    session: str           # session / thread id
    agent: str             # sub-agent id, '' for the main chain
    role: str              # supervisor | worker | interactive | subagent | box
    project: str           # label only, never a path
    model: str
    ts: str                # ISO-8601 UTC, e.g. 2026-10-01T12:00:00.123Z
    input: int = 0         # fresh (uncached) input tokens
    output: int = 0        # all output tokens, reasoning included
    reasoning: int = 0     # subset of output
    cache_read: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    fast: bool = False
    cost: Optional[float] = None   # list-price USD, None = model unpriced

    @property
    def cache_write(self) -> int:
        return self.cache_write_5m + self.cache_write_1h

    @property
    def context(self) -> int:
        return self.input + self.cache_read + self.cache_write

    @property
    def day(self) -> str:
        return self.ts[:10]


class Coverage:
    """What was read, what was skipped and why. Every number is a count."""

    def __init__(self) -> None:
        self.files: Counter = Counter()          # source -> files read
        self.lines: Counter = Counter()          # source -> lines read
        self.bytes: Counter = Counter()          # source -> bytes read
        self.skipped: Counter = Counter()        # (source, reason) -> lines/files
        self.unknown_types: Counter = Counter()  # (source, type) -> lines
        self.sessions: Dict[str, set] = {}       # source -> session ids
        self.notes: Counter = Counter()          # free counters, e.g. duplicates
        self.errors: Counter = Counter()         # (source, exception class) -> n

    def file(self, source: str, nbytes: int = 0) -> None:
        self.files[source] += 1
        self.bytes[source] += nbytes

    def line(self, source: str, n: int = 1) -> None:
        self.lines[source] += n

    def skip(self, source: str, reason: str, n: int = 1) -> None:
        self.skipped[(source, reason)] += n

    def unknown(self, source: str, rtype: str, n: int = 1) -> None:
        # Only short identifier-like type names are kept; anything else is bucketed.
        ok = isinstance(rtype, str) and 0 < len(rtype) <= 40 and rtype.replace("-", "_").replace(".", "_").isidentifier()
        self.unknown_types[(source, rtype if ok else "<non-identifier>")] += n

    def session(self, source: str, sid: str) -> None:
        self.sessions.setdefault(source, set()).add(sid)

    def note(self, key: str, n: int = 1) -> None:
        self.notes[key] += n

    def error(self, source: str, exc: BaseException) -> None:
        # The class name only: exception text may quote data.
        self.errors[(source, type(exc).__name__)] += 1
