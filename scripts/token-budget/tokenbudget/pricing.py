"""List-price lookup that reuses the repo's own price tables.

Claude models: ``src-tauri/src/cc_usage/default-manifest.json``.
Codex / OpenAI models: ``src-tauri/src/agent_usage/codex-pricing.json``.
Same rules as ``cc_usage/manifest.rs``: dated ``until`` rates, aliases, a
``fastRates`` table for fast mode, per-model cache multipliers over input.
Nothing is invented: a model without a price is *unpriced* (cost None).
"""
from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Optional, Tuple

REPO_FILES = {
    "claude": os.path.join("src-tauri", "src", "cc_usage", "default-manifest.json"),
    "codex": os.path.join("src-tauri", "src", "agent_usage", "codex-pricing.json"),
}
_DATE_SUFFIX = re.compile(r"-\d{8}$")


class Rate:
    __slots__ = ("inp", "out", "r", "w5", "w1", "model_id", "table", "fast_inp", "fast_out")

    def __init__(self, inp, out, r, w5, w1, model_id, table, fast_inp=None, fast_out=None):
        self.inp, self.out, self.r, self.w5, self.w1 = inp, out, r, w5, w1
        self.model_id, self.table = model_id, table
        self.fast_inp, self.fast_out = fast_inp, fast_out


class PriceBook:
    def __init__(self, tables: Dict[str, dict]):
        self.tables = tables
        self.index: Dict[str, Tuple[str, dict]] = {}
        for tname, t in tables.items():
            for m in t["pricing"]["models"]:
                for key in [m["id"]] + list(m.get("aliases", [])):
                    self.index.setdefault(key.lower(), (tname, m))
        self.used: Dict[str, str] = {}      # model id -> table, for the report
        self.unpriced: Dict[str, int] = {}  # model -> requests

    @classmethod
    def load(cls, repo_root: str, override: Optional[Dict[str, str]] = None) -> "PriceBook":
        files = dict(REPO_FILES)
        tables = {}
        for name, rel in files.items():
            path = (override or {}).get(name) or os.path.join(repo_root, rel)
            with open(path, "r", encoding="utf-8") as fh:
                tables[name] = json.load(fh)
        return cls(tables)

    def _find(self, model: str):
        m = (model or "").lower().strip()
        if not m:
            return None
        for cand in (m, _DATE_SUFFIX.sub("", m), m.split("[")[0]):
            if cand in self.index:
                return self.index[cand]
        # longest known id that is a prefix, e.g. 'claude-opus-4-6-thinking'
        best = None
        for key, val in self.index.items():
            if m.startswith(key) and (best is None or len(key) > len(best[0])):
                best = (key, val)
        return best[1] if best else None

    def rate(self, model: str, day: str) -> Optional[Rate]:
        hit = self._find(model)
        if hit is None:
            return None
        tname, m = hit
        table = self.tables[tname]["pricing"]
        base = table["cache"]
        cache = {**base, **m.get("cache", {})}

        def pick(rates: List[dict]):
            for r in rates:
                u = r.get("until")
                if u is None or day < u:
                    return r
            return rates[-1] if rates else None

        r = pick(m["rates"])
        fast = pick(m.get("fastRates", [])) if m.get("fastRates") else None
        self.used[m["id"]] = tname
        return Rate(r["inputPerMTok"], r["outputPerMTok"], cache["read"], cache["write5m"], cache["write1h"],
                    m["id"], tname, fast["inputPerMTok"] if fast else None, fast["outputPerMTok"] if fast else None)

    def cost(self, model: str, day: str, inp: int, out: int, cread: int, w5: int, w1: int,
             fast: bool = False) -> Optional[float]:
        rt = self.rate(model, day)
        if rt is None:
            self.unpriced[model] = self.unpriced.get(model, 0) + 1
            return None
        pi, po = (rt.fast_inp, rt.fast_out) if fast and rt.fast_inp else (rt.inp, rt.out)
        return (inp * pi + out * po + cread * pi * rt.r + w5 * pi * rt.w5 + w1 * pi * rt.w1) / 1e6

    def unit_prices(self, model: str, day: str, fast: bool = False):
        """USD per token: (input, output, read, write5m, write1h) or None."""
        rt = self.rate(model, day)
        if rt is None:
            return None
        pi, po = (rt.fast_inp, rt.fast_out) if fast and rt.fast_inp else (rt.inp, rt.out)
        return (pi / 1e6, po / 1e6, pi * rt.r / 1e6, pi * rt.w5 / 1e6, pi * rt.w1 / 1e6)

    def describe(self) -> List[dict]:
        out = []
        for mid in sorted(self.used):
            tname = self.used[mid]
            m = next(x for x in self.tables[tname]["pricing"]["models"] if x["id"] == mid)
            cache = {**self.tables[tname]["pricing"]["cache"], **m.get("cache", {})}
            r = m["rates"][-1]
            out.append({"model": mid, "table": tname, "input_per_mtok": r["inputPerMTok"],
                        "output_per_mtok": r["outputPerMTok"], "cache_read_x": cache["read"],
                        "cache_write_5m_x": cache["write5m"], "cache_write_1h_x": cache["write1h"]})
        return out
