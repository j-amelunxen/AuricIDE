"""Accumulators. Everything here is numbers keyed by labels; no content."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict

# Stat columns
REQ, INP, OUT, REAS, CR, CW5, CW1, COST, UNPRICED, COST_OUT, COST_REAS = range(11)
STAT_FIELDS = ["requests", "input", "output", "reasoning", "cache_read", "cache_write_5m", "cache_write_1h",
               "cost_usd", "unpriced_requests", "cost_output_usd", "cost_reasoning_usd"]
DIMENSIONS = ["project", "session", "role", "model", "ticket", "goal", "skill", "request_tool_group", "day", "source"]


def _stat():
    return [0, 0, 0, 0, 0, 0, 0, 0.0, 0, 0.0, 0.0]


class Agg:
    def __init__(self):
        self.dims: Dict[str, Dict[tuple, list]] = {d: defaultdict(_stat) for d in DIMENSIONS}
        self.total = _stat()
        self.sessions: Dict[tuple, dict] = {}
        # cause decomposition: (category, name) -> dict
        self.cause: Dict[tuple, dict] = defaultdict(lambda: {"items": 0, "tokens": 0.0, "carried_token_requests": 0.0,
                                                           "cost_write": 0.0, "cost_read": 0.0,
                                                           "measured": 0, "estimated": 0})
        self.cause_skill: Dict[tuple, list] = defaultdict(lambda: [0.0, 0.0])   # (cat,name,skill)->[tokens,cost]
        self.tools: Dict[str, dict] = defaultdict(lambda: {"calls": 0, "tokens": 0.0, "chars": 0, "cost_write": 0.0,
                                                           "cost_read": 0.0, "measured": 0, "estimated": 0})
        self.bash: Dict[str, dict] = defaultdict(lambda: {"calls": 0, "tokens": 0.0, "cost": 0.0})
        self.rewrites = []        # dict rows: session key, reason, idle, tokens, cost, excess
        self.growth = {"tokens": 0.0, "cost": 0.0, "requests": 0}
        self.compactions = []
        self.baselines = []
        self.curve: Dict[tuple, dict] = {}
        self.subagents = []
        self.candidates: Dict[str, dict] = {}
        self.calib: Dict[str, list] = defaultdict(lambda: [0, 0])   # name -> [chars, tokens] from sole-item gaps
        self.paths: Dict[tuple, dict] = {}
        self.cost_state_ours: Dict[str, float] = defaultdict(float)
        self.session_cost: Dict[str, float] = defaultdict(float)    # claude session id -> list-price cost
        self.session_tokens: Dict[str, list] = defaultdict(lambda: [0, 0, 0, 0])  # in,out,cr,cw
        self.unpriced_models: Dict[str, int] = defaultdict(int)
        self.large_rows: list = []   # one dict per large tool result, no content
        self.caps: Dict[int, dict] = defaultdict(lambda: {"results": 0, "tokens": 0.0, "cost": 0.0, "removed": 0.0, "large": 0})
        self.over_line: Dict[str, list] = defaultdict(lambda: [0, 0, 0.0, 0.0])   # role -> requests, over, cost, cost over

    def add_request(self, labels: Dict[str, str], vals, count=True):
        """vals: [input, output, reasoning, cr, w5, w1, cost|None, cost_out, cost_reas]"""
        cost = vals[6]
        for dim in DIMENSIONS:
            self._add(self.dims[dim][(labels[dim],)], vals, cost, count)
        self._add(self.total, vals, cost, count)

    @staticmethod
    def _add(s, vals, cost, count=True):
        s[REQ] += 1 if count else 0
        s[INP] += vals[0]; s[OUT] += vals[1]; s[REAS] += vals[2]; s[CR] += vals[3]; s[CW5] += vals[4]; s[CW1] += vals[5]
        if cost is None:
            s[UNPRICED] += 1
        else:
            s[COST] += cost; s[COST_OUT] += vals[7]; s[COST_REAS] += vals[8]

    def cand(self, rule, threshold, unit):
        c = self.candidates.get(rule)
        if c is None:
            c = self.candidates[rule] = {"rule_id": rule, "threshold": threshold, "unit": unit, "count": 0,
                                         "tokens": 0.0, "cost_usd": 0.0, "sessions": set()}
        return c
