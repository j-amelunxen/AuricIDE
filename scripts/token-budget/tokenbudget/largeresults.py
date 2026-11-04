"""What kind of tool results are the large ones, and are they the same calls again?

Rows are collected in ``analyze._flush`` (sizes, cost, class, a one-way hash of the normalised call; no
content) and turned into tables here. Every table sums to the ``large_tool_result`` rule.
"""
from __future__ import annotations

from collections import defaultdict

from .claude import Item

DIM_LABELS = ("project", "role", "skill")


def class_of(item: Item, tu) -> str:
    """Tool; Bash by first command word, Read by file extension, MCP by server and tool name."""
    if tu is not None and item.name == "Bash":
        return "Bash:" + (tu.bash or "<none>")
    if tu is not None and item.name == "Read":
        return "Read:" + (tu.ext or "(none)")
    return item.name


def record(agg, item: Item, tu, info: dict, cost: float, cfg: dict) -> None:
    """Called once per counted tool result."""
    large = item.tok >= cfg["candidates"]["large_tool_result_tokens"]
    for cap in cfg.get("result_caps_chars", []):
        if item.chars > cap:
            c = agg.caps[cap]
            c["results"] += 1
            c["tokens"] += item.tok
            c["cost"] += cost
            c["removed"] += cost * (item.chars - cap) / item.chars
            if large:
                c["large"] += 1
    if not large:
        return
    agg.large_rows.append({
        "class": class_of(item, tu), "tok": item.tok, "cost": cost, "tag": item.tag,
        "hash": (tu.nhash if tu is not None else ""), "session": info["session"],
        "project": info["project"], "role": info["role"], "skill": item.skill,
    })


def _quality(tags: set) -> str:
    return "measured" if tags == {"measured"} else "estimated"


def _k(n):
    return f"{int(n) // 1000}k"


def build(agg, cfg: dict) -> dict:
    thr = cfg["candidates"]["large_tool_result_tokens"]
    edges = [thr] + list(cfg.get("large_result_bands_tokens", [25000, 50000, 100000]))
    band_names = [f"{_k(a)}-{_k(b)}" for a, b in zip(edges, edges[1:])] + [f"above {_k(edges[-1])}"]

    def band_of(tok):
        idx = 0
        for k, e in enumerate(edges):
            if tok >= e:
                idx = k
        return band_names[idx]

    rows = agg.large_rows
    total_cost = sum(r["cost"] for r in rows)
    # ---- by class
    cls = defaultdict(lambda: {"count": 0, "tokens": 0.0, "max": 0.0, "cost": 0.0, "tags": set(), "sessions": set(),
                               "hashes": defaultdict(int), "grp": [0, 0, 0], "grp_cost": [0.0, 0.0, 0.0]})
    per_sess_hash = defaultdict(int)
    hash_sessions = defaultdict(set)
    for r in rows:
        if r["hash"]:
            per_sess_hash[(r["hash"], r["session"])] += 1
            hash_sessions[r["hash"]].add(r["session"])
    group_names = ("repeated_in_same_session", "identical_in_other_sessions", "unique")
    for r in rows:
        c = cls[r["class"]]
        c["count"] += 1
        c["tokens"] += r["tok"]
        c["max"] = max(c["max"], r["tok"])
        c["cost"] += r["cost"]
        c["tags"].add(r["tag"])
        c["sessions"].add(r["session"])
        if r["hash"]:
            c["hashes"][r["hash"]] += 1
        if r["hash"] and per_sess_hash[(r["hash"], r["session"])] >= 2:
            g = 0
        elif r["hash"] and len(hash_sessions[r["hash"]]) >= 2:
            g = 1
        else:
            g = 2
        r["group"] = g
        c["grp"][g] += 1
        c["grp_cost"][g] += r["cost"]
    order = sorted(cls, key=lambda k: (-cls[k]["cost"], k))
    by_class = [{"class": k, "count": cls[k]["count"], "tokens": cls[k]["tokens"],
                 "avg_tokens": cls[k]["tokens"] / cls[k]["count"], "max_tokens": cls[k]["max"],
                 "carry_cost_usd": cls[k]["cost"], "share": (cls[k]["cost"] / total_cost) if total_cost else 0.0,
                 "quality": _quality(cls[k]["tags"])} for k in order]
    # ---- bands
    bands = defaultdict(lambda: {"count": 0, "tokens": 0.0, "cost": 0.0, "tags": set()})
    for r in rows:
        for key in ("(all)", r["class"]):
            b = bands[(key, band_of(r["tok"]))]
            b["count"] += 1; b["tokens"] += r["tok"]; b["cost"] += r["cost"]; b["tags"].add(r["tag"])
    band_rows = []
    for key in ["(all)"] + order:
        for name in band_names:
            b = bands.get((key, name))
            if b:
                band_rows.append({"class": key, "band": name, "count": b["count"], "tokens": b["tokens"],
                                  "carry_cost_usd": b["cost"], "quality": _quality(b["tags"])})
    # ---- concentration
    def n_for(share):
        acc = 0.0
        for n, k in enumerate(order, start=1):
            acc += cls[k]["cost"]
            if total_cost and acc >= share * total_cost - 1e-12:
                return n
        return len(order)
    conc = [{"metric": "distinct_classes", "value": len(order), "quality": "measured"},
            {"metric": "classes_for_50pct_of_cost", "value": n_for(0.5) if order else 0, "quality": "estimated"},
            {"metric": "classes_for_80pct_of_cost", "value": n_for(0.8) if order else 0, "quality": "estimated"}]
    dims = []
    for d in DIM_LABELS:
        acc = defaultdict(lambda: {"count": 0, "cost": 0.0, "tags": set()})
        for r in rows:
            a = acc[r[d]]
            a["count"] += 1; a["cost"] += r["cost"]; a["tags"].add(r["tag"])
        for k in sorted(acc, key=lambda k: (-acc[k]["cost"], k)):
            dims.append({"dimension": d, "label": k, "count": acc[k]["count"], "carry_cost_usd": acc[k]["cost"],
                         "share": (acc[k]["cost"] / total_cost) if total_cost else 0.0, "quality": _quality(acc[k]["tags"])})
    # ---- repetition
    grp = [[0, 0.0], [0, 0.0], [0, 0.0]]
    for r in rows:
        grp[r["group"]][0] += 1
        grp[r["group"]][1] += r["cost"]
    notes = ("same call (hash of tool + normalised input) among the large results, more than once in one session",
             "same call in at least one other session, not repeated within this one",
             "this call appears once among the large results")
    rep = [{"group": n, "count": g[0], "carry_cost_usd": g[1], "share": (g[1] / total_cost) if total_cost else 0.0,
            "quality": "heuristic", "note": notes[i]} for i, (n, g) in enumerate(zip(group_names, grp))]
    rep_class = []
    for k in order:
        c = cls[k]
        top = sorted(c["hashes"].values(), reverse=True)[:5]
        rep_class.append({"class": k, "count": c["count"], "sessions": len(c["sessions"]),
                          "distinct_hashes": len(c["hashes"]), "top_repeat_counts": ";".join(str(x) for x in top),
                          "same_session_repeat": c["grp"][0], "other_sessions": c["grp"][1], "unique": c["grp"][2],
                          "same_session_repeat_cost_usd": c["grp_cost"][0], "other_sessions_cost_usd": c["grp_cost"][1],
                          "unique_cost_usd": c["grp_cost"][2], "quality": "heuristic"})
    # ---- cap
    caps = []
    for cap in cfg.get("result_caps_chars", []):
        c = agg.caps[cap]
        caps.append({"cap_chars": cap, "results_above_cap": c["results"], "of_which_large_results": c["large"],
                     "tokens_above_cap": c["tokens"], "carry_cost_usd": c["cost"],
                     "cost_removed_by_cap_usd": c["removed"], "quality": "estimated",
                     "note": "estimated: a capped agent may read again; counts every tool result above the cap, not only the large ones"})
    return {"large_results_by_class": by_class, "large_results_size_bands": band_rows,
            "large_results_concentration": conc, "large_results_by_dimension": dims,
            "large_results_repetition": rep, "large_results_repeat_by_class": rep_class,
            "large_results_cap_effect": caps}
