"""Turn a Result into summary.json, one CSV per table and report.md. Deterministic bytes."""
from __future__ import annotations

import csv
import json
import os
import statistics
from typing import Dict, List

from . import SCHEMA_VERSION
from .aggregate import (CR, CW1, CW5, COST, COST_OUT, COST_REAS, INP, OUT, REAS, REQ, STAT_FIELDS, UNPRICED)

NOTE_COST = "list-price equivalent from the repo price tables, not a bill"
DIM_QUALITY = {"project": "measured", "session": "measured", "role": "heuristic", "model": "measured",
               "ticket": "measured", "goal": "measured", "skill": "heuristic", "request_tool_group": "heuristic",
               "day": "measured", "source": "measured"}
RULES = [("repeat_file_read", "extra reads"), ("large_tool_result", "tool results"),
         ("session_context_over_threshold", "sessions"), ("idle_gap_cache_miss", "requests"),
         ("large_baseline", "sessions"), ("high_model_short_run", "sessions"),
         ("repeat_identical_call", "extra calls")]


def r6(x):
    return round(x + 0.0, 6) if isinstance(x, float) else x


def clean(o):
    if isinstance(o, float):
        return r6(o)
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in sorted(o.items(), key=lambda kv: str(kv[0]))}
    if isinstance(o, (list, tuple)):
        return [clean(x) for x in o]
    if isinstance(o, set):
        return sorted(clean(x) for x in o)
    return o


def stat_row(label, s):
    row = {"bucket": label}
    for name, v in zip(STAT_FIELDS, s):
        row[name] = r6(v)
    row["context_tokens"] = s[INP] + s[CR] + s[CW5] + s[CW1]
    return row


def dim_table(agg, dim, total_cost):
    rows = [stat_row(k[0], s) for k, s in agg.dims[dim].items()]
    rows.sort(key=lambda r: (-r["cost_usd"], r["bucket"]))
    for r in rows:
        r["share"] = r6(r["cost_usd"] / total_cost) if total_cost else 0.0
        r["quality"] = DIM_QUALITY[dim]
    return rows


def cause_rows(agg):
    rows = []
    for (cat, name), c in agg.cause.items():
        cost = c["cost_write"] + c["cost_read"]
        tag = "measured" if (c["measured"] and not c["estimated"]) or cat in ("output", "baseline", "cache_rewrite", "compaction") \
            or (cat in ("context_growth", "context_carried") and name == "unattributed") else "estimated"
        if cat in ("tool_result", "injected", "user_prompt", "assistant_output") and c["estimated"]:
            tag = "estimated"
        rows.append({"cause": cat, "name": name, "items": c["items"], "tokens_arrived": r6(c["tokens"]),
                     "carried_token_requests": r6(c["carried_token_requests"]), "cost_write_usd": r6(c["cost_write"]),
                     "cost_read_usd": r6(c["cost_read"]), "cost_usd": r6(cost), "items_measured": c["measured"],
                     "items_estimated": c["estimated"], "quality": tag})
    rows.sort(key=lambda r: (-r["cost_usd"], r["cause"], r["name"]))
    return rows


def finish_codex_sessions(agg):
    for s in agg.sessions.values():
        if "_ctx" in s:
            c = s.pop("_ctx"); k = s.pop("_cost")
            s["peak_context"] = max(c) if c else 0
            s["median_context"] = statistics.median(sorted(c)) if c else 0
            for ln, name in ((200000, "200k"), (500000, "500k")):
                s["requests_over_" + name] = sum(1 for x in c if x > ln)
                tot = sum(k)
                s["cost_share_over_" + name] = (sum(y for x, y in zip(c, k) if x > ln) / tot) if tot else 0.0


def build(res) -> dict:
    agg, cov, cfg, pb = res.agg, res.cov, res.cfg, res.pb
    finish_codex_sessions(agg)
    total_cost = agg.total[COST]
    S: dict = {"schema_version": SCHEMA_VERSION, "cost_note": NOTE_COST}
    S["options"] = {"since": res.opts.since, "until": res.opts.until, "project": res.opts.project,
                    "paths": res.opts.paths, "inputs": res.inputs}
    S["thresholds"] = cfg
    S["prices_used"] = pb.describe()
    S["unpriced_models"] = dict(agg.unpriced_models)
    # ---- coverage
    srcs = sorted(set(cov.files) | set(cov.lines) | set(cov.sessions))
    S["coverage"] = {
        "per_source": {s: {"files": cov.files[s], "lines": cov.lines[s], "bytes": cov.bytes[s],
                           "sessions": len(cov.sessions.get(s, ()))} for s in srcs},
        "skipped": [{"source": a, "reason": b, "count": n} for (a, b), n in sorted(cov.skipped.items())],
        "unknown_record_types": [{"source": a, "type": b, "count": n} for (a, b), n in sorted(cov.unknown_types.items())],
        "notes": dict(sorted(cov.notes.items())),
        "errors": [{"source": a, "exception": b, "count": n} for (a, b), n in sorted(cov.errors.items())],
        "chars_per_token_observed": {k: {"chars": v[0], "tokens": r6(v[1]), "chars_per_token": r6(v[0] / v[1]) if v[1] else None}
                                     for k, v in sorted(agg.calib.items()) if v[1] > 5000},
    }
    S["totals"] = {**{n: r6(v) for n, v in zip(STAT_FIELDS, agg.total)}, "quality": "measured",
                   "list_price_cost_usd": r6(total_cost)}
    S["tables"] = {d: dim_table(agg, d, total_cost) for d in agg.dims}
    # ---- sessions
    sess = []
    for k, s in agg.sessions.items():
        row = {kk: vv for kk, vv in s.items()}
        sess.append(clean(row))
    sess.sort(key=lambda r: (-r["cost_usd"], r["source"], r["session"], r["agent"]))
    S["tables"]["sessions"] = sess
    # ---- tools
    tools = []
    for name, t in agg.tools.items():
        cost = t["cost_write"] + t["cost_read"]
        tools.append({"tool": name, "kind": "mcp" if name.startswith("mcp__") else "builtin", "calls": t["calls"],
                      "result_tokens": r6(t["tokens"]), "result_chars": t["chars"],
                      "avg_result_tokens": r6(t["tokens"] / t["calls"]) if t["calls"] else 0.0,
                      "carry_cost_write_usd": r6(t["cost_write"]), "carry_cost_read_usd": r6(t["cost_read"]),
                      "carry_cost_usd": r6(cost), "quality": "measured" if t["measured"] and not t["estimated"] else "estimated"})
    tools.sort(key=lambda r: (-r["carry_cost_usd"], r["tool"]))
    S["tables"]["tools"] = tools
    S["tables"]["bash_first_word"] = sorted(
        [{"command": k, "calls": v["calls"], "result_tokens": r6(v["tokens"]), "carry_cost_usd": r6(v["cost"]),
          "quality": "estimated"} for k, v in agg.bash.items()], key=lambda r: (-r["carry_cost_usd"], r["command"]))
    cr = cause_rows(agg)
    S["tables"]["cause"] = cr
    S["tables"]["cause_by_skill"] = sorted(
        [{"cause": a, "name": b, "skill": c, "tokens_arrived": r6(v[0]), "cost_usd": r6(v[1]), "quality": "heuristic"}
         for (a, b, c), v in agg.cause_skill.items()], key=lambda r: (-r["cost_usd"], r["cause"], r["name"], r["skill"]))
    # ---- cache misses by session and reason
    miss: Dict[tuple, dict] = {}
    for e in agg.rewrites:
        k = (e["skey"][0], e["skey"][1], e["skey"][2], e["reason"])
        m = miss.setdefault(k, {"source": k[0], "session": k[1], "agent": k[2], "reason": k[3], "count": 0,
                                "tokens_rewritten": 0, "cost_usd": 0.0, "excess_over_read_usd": 0.0})
        m["count"] += 1; m["tokens_rewritten"] += e["tokens"]; m["cost_usd"] += e["cost"]; m["excess_over_read_usd"] += e["excess"]
    S["tables"]["cache_misses"] = sorted((clean({**m, "quality": "measured"}) for m in miss.values()),
                                         key=lambda r: (-r["cost_usd"], r["session"], r["agent"], r["reason"]))
    S["context_growth_writes"] = clean({**agg.growth, "quality": "measured"})
    S["tables"]["compactions"] = sorted((clean({"source": c["skey"][0], "session": c["skey"][1], "agent": c["skey"][2],
        "trigger": c["trigger"], "tokens_before": c["pre"], "tokens_after": c["post"],
        "context_first_request_after": c["ctx_first_after"], "cost_first_requests_usd": c["cost_first_requests"],
        "requests_costed": c["requests_costed"], "quality": "measured"}) for c in agg.compactions),
        key=lambda r: (-r["cost_first_requests_usd"], r["session"], r["agent"]))
    # ---- baseline
    S["baseline"] = baseline_table(agg)
    # ---- subagents
    S["tables"]["subagents"] = subagent_table(agg)
    S["tables"]["candidates"] = candidate_table(agg)
    S["reconciliation"] = reconcile(res)
    S["tables"]["runs_without_token_data"] = [
        {"provider": k[0], "run_source": k[1], "runs": v["runs"], "duration_s": r6(v["duration_ms"] / 1000), "tokens": "unknown"}
        for k, v in sorted(res.unknown_token_runs.items())]
    S["box"] = box_section(res)
    S["budget_view"] = budget_view(res, S, total_cost)
    S["not_covered"] = sorted(res.not_covered + [
        "Browser Use costs outside local sandboxctl records",
        "Providers without local token data (see runs_without_token_data): tokens unknown, never 0",
        "Long-context price tiers, if any, are not applied (the repo tables carry one rate per model)",
        "Server-tool costs (web search) are not priced",
    ])
    return clean(S)


def baseline_table(agg):
    out = {}
    by_role: Dict[str, list] = {}
    for b in agg.baselines:
        if b["first_counted"]:
            by_role.setdefault(b["role"], []).append(b)
    rows = []
    for role in sorted(by_role):
        bs = by_role[role]
        toks = sorted(b["tokens"] for b in bs)
        p10 = toks[max(0, int(len(toks) * 0.1) - 0)] if toks else 0
        rows.append({"role": role, "sessions": len(bs), "median_tokens": statistics.median(toks), "p10_tokens": p10,
                     "min_tokens": toks[0], "max_tokens": toks[-1],
                     "first_request_cache_read_median": statistics.median(sorted(b["first_request_cache_read"] for b in bs)),
                     "sessions_with_first_request_cache_hit": sum(1 for b in bs if b["first_request_cache_read"] > 0),
                     "lifetime_cost_usd": sum(b["lifetime_cost"] for b in bs),
                     "quality": "measured"})
    out["by_role"] = rows
    out["note"] = ("baseline = size of the first request of a session (system prompt, tool definitions, memory, "
                   "injected lists and the opening prompt). p10 = the part that repeats in nearly every session of the "
                   "role (heuristic). first_request_cache_read = prefix already cached by an earlier session "
                   "(measured evidence of repetition). lifetime cost = baseline tokens written once and read on each "
                   "later request (estimated allocation of billed tokens).")
    out["lifetime_cost_total_usd"] = sum(r["lifetime_cost_usd"] for r in rows)
    return out


def subagent_table(agg):
    own, subs = {}, {}
    for (src, sid, aid), s in agg.sessions.items():
        if aid:
            subs.setdefault((src, sid), []).append(s)
        else:
            own[(src, sid)] = s["cost_usd"]
    rows = []
    for k, lst in subs.items():
        parent_own = own.get(k, 0.0)
        tot = parent_own + sum(x["cost_usd"] for x in lst)
        for s in lst:
            rows.append({"source": k[0], "parent_session": k[1], "agent": s["agent"], "project": s["project"],
                         "requests": s["requests"], "cost_usd": s["cost_usd"], "parent_own_cost_usd": parent_own,
                         "share_of_parent_total": (s["cost_usd"] / tot) if tot else 0.0,
                         "skill_at_spawn": s.get("top_skill", ""), "quality": "measured",
                         "parent_found": k in own})
    rows.sort(key=lambda r: (-r["cost_usd"], r["parent_session"], r["agent"]))
    return clean(rows)


def candidate_table(agg):
    rows = []
    notes = {"repeat_file_read": "same file read >= threshold times in one session; tokens/cost are of the repeats only",
             "large_tool_result": "single tool results above the token threshold; cost = carry cost of those results",
             "session_context_over_threshold": "sessions whose context passed the threshold; tokens/cost = requests above it",
             "idle_gap_cache_miss": "cache rewritten after an idle gap longer than the cache lifetime",
             "large_baseline": "sessions whose first request is above the threshold; cost = baseline lifetime cost",
             "high_model_short_run": "expensive model on a run with few requests; cost = whole session",
             "repeat_identical_call": "identical tool call (by hash) repeated; overlaps repeat_file_read"}
    for rid, unit in RULES:
        c = agg.candidates.get(rid) or {"threshold": "", "unit": unit, "count": 0, "tokens": 0.0, "cost_usd": 0.0}
        rows.append({"rule_id": rid, "threshold": c["threshold"], "unit": c["unit"], "count": c["count"],
                     "tokens": c["tokens"], "cost_usd": c["cost_usd"], "quality": "heuristic",
                     "note": notes[rid] + "; rule-based flag, no verdict; rules overlap, do not add up"})
    return clean(rows)


def reconcile(res):
    """Compare our list-price cost with what AuricIDE recorded, per transcript session.

    A session enters a comparison only when every figure it needs is recorded: a run whose cost (or token
    field) is empty is counted in ``runs_without_recorded_cost`` and left out of both sides, never read as 0.
    Several runs of one session (a resume) are summed on the recorded side and our session counted once."""
    agg = res.agg
    by_sid: Dict[str, list] = {}
    unmatched = 0
    for row in res.auric_rows:
        sid = row.get("session_id")
        if sid and sid in agg.session_cost:
            by_sid.setdefault(sid, []).append(row)
        elif row.get("run_source") != "external":
            unmatched += 1
    ours_c = rec_c = 0.0
    tot = {"input": [0, 0], "output": [0, 0], "cache_read": [0, 0], "cache_write": [0, 0]}
    tok_n = {k: 0 for k in tot}
    no_cost_runs = 0
    cost_sessions = 0
    per_run = []
    fields = (("input", "input_tokens"), ("output", "output_tokens"),
              ("cache_read", "cache_read_tokens"), ("cache_write", "cache_write_tokens"))
    for sid in sorted(by_sid):
        rows_s = by_sid[sid]
        oc, ot = agg.session_cost[sid], agg.session_tokens[sid]
        costs = [r.get("cost_usd") for r in rows_s]
        missing = sum(1 for c in costs if not isinstance(c, (int, float)))
        no_cost_runs += missing
        rc = sum(c for c in costs if isinstance(c, (int, float))) if not missing else None
        if rc is not None:
            cost_sessions += 1
            ours_c += oc
            rec_c += rc
        for i, (k, rk) in enumerate(fields):
            vals = [r.get(rk) for r in rows_s]
            if all(isinstance(v, (int, float)) for v in vals):
                tok_n[k] += 1
                tot[k][0] += ot[i]; tot[k][1] += sum(vals)
        per_run.append({"run_id": "+".join(str(r.get("id")) for r in rows_s), "provider": rows_s[0].get("provider"),
                        "cost_source": rows_s[0].get("cost_source"), "ours_cost_usd": oc, "recorded_cost_usd": rc,
                        "diff_usd": (oc - rc) if rc is not None else None,
                        "ours_output": ot[1], "recorded_output": sum(r.get("output_tokens") or 0 for r in rows_s)})

    def line(scope, ours, rec):
        return {"scope": scope, "ours": ours, "recorded": rec, "diff": ours - rec,
                "diff_pct": ((ours - rec) / rec * 100) if rec else None}
    rows = [line("cost_usd (sessions whose runs all have a recorded cost, ours = transcripts incl. sub-agents)",
                 ours_c, rec_c)]
    for k, (o, r) in tot.items():
        rows.append(line("tokens_" + k + f" ({tok_n[k]} sessions with the field recorded)", o, r))
    cs_o = cs_r = 0.0
    cs_n = 0
    for sid, d in sorted(res.cost_states.items()):
        if sid in agg.session_cost and isinstance(d.get("totalCostUSD"), (int, float)):
            cs_n += 1
            cs_o += agg.session_cost[sid]; cs_r += d["totalCostUSD"]
    rows.append(line("cost_usd (sessions with a CLI cost-state record, ours vs CLI's own total)", cs_o, cs_r))
    per_run.sort(key=lambda r: (-abs(r["diff_usd"] or 0.0), str(r["run_id"])))
    return clean({"rows": rows, "matched_runs": sum(len(v) for v in by_sid.values()), "sessions_compared": cost_sessions,
                  "runs_without_recorded_cost": no_cost_runs, "auric_runs_without_transcript": unmatched,
                  "cost_state_sessions_compared": cs_n,
                  "note": "Both references are other estimates of the same spend, not ground truth. Differences are "
                          "shown as found; with --since/--until/--project the transcript side is a subset. Runs with an "
                          "empty recorded cost are counted separately and left out of the cost comparison.",
                  "per_run_top": per_run[:50], "per_run_all": per_run})


def box_section(res):
    brow = []
    for l in res.box_leases:
        b = l.get("browser_use") or {}
        if b:
            brow.append({"lease": l.get("lease"), "project": l.get("project"), "browser_usd": b.get("browser_usd"),
                         "proxy_usd": b.get("proxy_usd"), "agent_runs_usd": b.get("agent_runs_usd"),
                         "total_usd": b.get("total_usd"), "source": b.get("source"), "quality": "measured (recorded)"})
    brow.sort(key=lambda r: (-(r["total_usd"] or 0), str(r["lease"])))
    return clean({"leases": len(res.box_leases), "survival": res.box_survival,
                  "recorded_only_cost_usd": sum(x["cost"] for x in getattr(res, "recorded_only", [])),
                  "browser_use_recorded": brow})


def budget_view(res, S, total_cost):
    agg = res.agg
    out = {"total_cost_usd": total_cost, "note": NOTE_COST + "; recorded-only box cost is as sandboxctl recorded it"}
    for d in ("project", "role", "skill", "request_tool_group", "source"):
        out[d] = [{"bucket": r["bucket"], "cost_usd": r["cost_usd"], "share": r["share"], "quality": r["quality"]}
                  for r in S["tables"][d]]
    claude_like = sum(s[COST] for k, s in agg.dims["source"].items() if k[0] in ("claude", "box"))
    causes = [{"bucket": f"{r['cause']}:{r['name']}", "cost_usd": r["cost_usd"], "quality": r["quality"]} for r in S["tables"]["cause"]]
    explained = sum(c["cost_write"] + c["cost_read"] for c in agg.cause.values())
    other = total_cost - claude_like
    resid = claude_like - explained
    if abs(other) > 1e-9:
        causes.append({"bucket": "(no cause decomposition: codex / recorded-only box)", "cost_usd": other, "quality": "measured"})
    if abs(resid) > 1e-6:
        causes.append({"bucket": "(residual, unexplained by decomposition)", "cost_usd": resid, "quality": "measured"})
    for c in causes:
        c["share"] = r6(c["cost_usd"] / total_cost) if total_cost else 0.0
    causes.sort(key=lambda r: (-r["cost_usd"], r["bucket"]))
    out["cause"] = causes
    out["cause_residual_usd"] = resid
    line0 = res.cfg["context_lines"][0]
    out["context_over_line_by_role"] = [
        {"role": role, "line_tokens": line0, "requests": v[0], "requests_over_line": v[1], "cost_usd": v[2],
         "cost_over_line_usd": v[3], "share_over_line": (v[3] / v[2]) if v[2] else 0.0, "quality": "measured"}
        for role, v in sorted(agg.over_line.items(), key=lambda kv: (-kv[1][3], kv[0]))]
    ttl1 = res.cfg["cache_ttl_1h_s"]
    idle: Dict[tuple, dict] = {}
    paused: Dict[str, dict] = {}
    for e in agg.rewrites:
        if e["reason"] != "idle_gap":
            continue
        z = idle.setdefault((e["role"], e["lifetime"]), {"role": e["role"], "lifetime": e["lifetime"], "count": 0,
                            "tokens_rewritten": 0, "cost_usd": 0.0, "excess_over_read_usd": 0.0, "quality": "measured"})
        z["count"] += 1; z["tokens_rewritten"] += e["tokens"]; z["cost_usd"] += e["cost"]; z["excess_over_read_usd"] += e["excess"]
        if e["gap_s"] > ttl1:
            q = paused.setdefault(e["role"], {"role": e["role"], "count": 0, "sessions": set(), "tokens_rewritten": 0,
                                              "cost_usd": 0.0, "excess_over_read_usd": 0.0, "quality": "measured"})
            q["count"] += 1; q["sessions"].add(e["skey"]); q["tokens_rewritten"] += e["tokens"]
            q["cost_usd"] += e["cost"]; q["excess_over_read_usd"] += e["excess"]
    out["idle_gap_by_role_lifetime"] = sorted(idle.values(), key=lambda r: (-r["cost_usd"], r["role"], r["lifetime"]))
    for q in paused.values():
        q["sessions"] = len(q["sessions"])
    out["resumed_after_pause"] = sorted(paused.values(), key=lambda r: (-r["cost_usd"], r["role"]))
    out["resumed_after_pause_note"] = (f"idle-gap rewrites where the gap was longer than {ttl1} s, so no cache lifetime "
                                       "could have survived: a session picked up again after a pause. A session whose "
                                       "first request is the first line of its file has no earlier request to compare with.")
    return out


# ---------------------------------------------------------------- writers
def write_csv(path, rows, cols=None):
    rows = list(rows)
    if cols is None:
        cols = []
        for r in rows:
            cols.extend(k for k in r if k not in cols)
        cols = cols or ["empty"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(cols)
        for r in rows:
            w.writerow(["" if r.get(c) is None else ("%.6f" % r[c] if isinstance(r.get(c), float) else r.get(c)) for c in cols])


def write_all(res, S, out_dir, paths_rows=None):
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass
    slim = json.loads(json.dumps(S))
    slim["reconciliation"].pop("per_run_all", None)
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(slim, fh, sort_keys=True, indent=1, ensure_ascii=True)
        fh.write("\n")
    T = S["tables"]
    for name, rows in T.items():
        write_csv(os.path.join(out_dir, name + ".csv"), rows)
    write_csv(os.path.join(out_dir, "coverage_skipped.csv"), S["coverage"]["skipped"], ["source", "reason", "count"])
    write_csv(os.path.join(out_dir, "reconciliation.csv"), S["reconciliation"]["rows"])
    write_csv(os.path.join(out_dir, "reconciliation_runs.csv"), S["reconciliation"]["per_run_all"])
    write_csv(os.path.join(out_dir, "baseline_by_role.csv"), S["baseline"]["by_role"])
    write_csv(os.path.join(out_dir, "budget_cause.csv"), S["budget_view"]["cause"])
    if paths_rows is not None:
        write_csv(os.path.join(out_dir, "paths.csv"), paths_rows, ["path", "tool", "calls", "sessions"])
    with open(os.path.join(out_dir, "report.md"), "w", encoding="utf-8") as fh:
        fh.write(markdown(S))
    for f in os.listdir(out_dir):
        os.chmod(os.path.join(out_dir, f), 0o600)


def md_table(rows, cols, limit=15, fmts=None):
    fmts = fmts or {}
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows[:limit]:
        cells = []
        for c in cols:
            v = r.get(c)
            if v is None:
                cells.append("")
            elif c == "share" or c.endswith("_share") or c == "diff_pct":
                cells.append(f"{v * 100:.1f}%" if c != "diff_pct" else f"{v:.1f}%")
            elif isinstance(v, float):
                cells.append(f"{v:,.2f}" if abs(v) >= 1 else f"{v:.4f}")
            elif isinstance(v, int):
                cells.append(f"{v:,}")
            else:
                cells.append(str(v).replace("|", "/"))
        out.append("| " + " | ".join(cells) + " |")
    if len(rows) > limit:
        out.append(f"\n_{len(rows) - limit} more rows in the CSV._")
    return "\n".join(out) + "\n"


def markdown(S) -> str:
    c, T, B = S["coverage"], S["tables"], S["budget_view"]
    L = ["# Token budget report", "",
         f"Schema {S['schema_version']}. All costs are {NOTE_COST}. Quality tags: measured / estimated / heuristic. "
         "No judgement is made here: candidates are rule-based flags.", "",
         "## 1. Coverage", ""]
    L.append(md_table([{"source": s, **v} for s, v in c["per_source"].items()], ["source", "files", "lines", "sessions", "bytes"]))
    L.append("Lines skipped by reason:\n")
    L.append(md_table(c["skipped"], ["source", "reason", "count"], 40))
    L.append("Unknown record types:\n")
    L.append(md_table(c["unknown_record_types"], ["source", "type", "count"], 30) if c["unknown_record_types"] else "none\n")
    if c["errors"]:
        L.append("Errors:\n"); L.append(md_table(c["errors"], ["source", "exception", "count"]))
    if S["unpriced_models"]:
        L.append("Unpriced models (tokens kept, cost not counted): " + ", ".join(f"{k} ({v} requests)" for k, v in S["unpriced_models"].items()) + "\n")
    L.append("### Reconciliation against recorded totals\n")
    R = S["reconciliation"]
    L.append(md_table(R["rows"], ["scope", "ours", "recorded", "diff", "diff_pct"], 20))
    L.append(f"{R['matched_runs']} AuricIDE runs matched a transcript session ({R['sessions_compared']} sessions in the cost comparison, {R['runs_without_recorded_cost']} runs without a recorded cost left out); {R['auric_runs_without_transcript']} runs without transcript. {R['note']}\n")
    L.append(f"Prices used: " + "; ".join(f"{p['model']} in {p['input_per_mtok']}/out {p['output_per_mtok']} USD/Mtok ({p['table']})" for p in S["prices_used"]) + "\n")
    L.append(f"## 2. Budget view (total {B['total_cost_usd']:,.2f} USD list price)\n")
    for d, title in (("cause", "By cause"), ("project", "By area (project)"), ("skill", "By skill phase (heuristic)"),
                     ("request_tool_group", "Requests by the tool group they issued (heuristic, see rule below)"), ("role", "By role"), ("source", "By source")):
        L.append(f"### {title}\n")
        L.append(md_table(B[d], ["bucket", "cost_usd", "share", "quality"], 15))
    L.append("### Share of cost in requests above the context line, per role\n")
    L.append(md_table(B["context_over_line_by_role"], ["role", "line_tokens", "requests", "requests_over_line", "cost_usd", "cost_over_line_usd", "share_over_line"], 10))
    L.append("### Idle-gap cache misses by role and cache lifetime\n")
    L.append("Lifetime = what the last writing request used (5m, 1h, or mixed when it wrote both). A gap longer than the lifetime "
             "in force (5m, or 1h only when the cache is a pure 1h one) counts as idle.\n")
    L.append(md_table(B["idle_gap_by_role_lifetime"], ["role", "lifetime", "count", "tokens_rewritten", "cost_usd", "excess_over_read_usd"], 12))
    L.append("### Sessions picked up again after a long pause\n")
    L.append(B["resumed_after_pause_note"] + "\n")
    L.append(md_table(B["resumed_after_pause"], ["role", "count", "sessions", "tokens_rewritten", "cost_usd", "excess_over_read_usd"], 10))
    L.append("## 3. Tables\n")
    for name, cols, title in (
        ("model", ["bucket", "requests", "output", "reasoning", "cache_read", "cost_usd", "share"], "By model"),
        ("day", ["bucket", "requests", "cost_usd", "share"], "By day"),
        ("ticket", ["bucket", "requests", "cost_usd", "share"], "By ticket"),
        ("goal", ["bucket", "requests", "cost_usd", "share"], "By goal"),
        ("tools", ["tool", "calls", "result_tokens", "avg_result_tokens", "carry_cost_usd", "quality"], "Tool-result carry cost"),
        ("cache_misses", ["session", "agent", "reason", "count", "tokens_rewritten", "cost_usd"], "Cache misses"),
        ("compactions", ["session", "trigger", "tokens_before", "tokens_after", "cost_first_requests_usd"], "Compactions"),
        ("subagents", ["parent_session", "agent", "requests", "cost_usd", "share_of_parent_total"], "Sub-agents"),
        ("sessions", ["session", "agent", "role", "project", "requests", "cost_usd", "baseline_tokens", "peak_context", "median_context", "requests_over_200k", "cost_share_over_200k"], "Sessions"),
        ("runs_without_token_data", ["provider", "run_source", "runs", "duration_s", "tokens"], "Runs without token data"),
    ):
        L.append(f"### {title}\n")
        L.append(md_table(T[name], cols, 12))
    L.append("### Baseline\n")
    L.append(md_table(S["baseline"]["by_role"], ["role", "sessions", "median_tokens", "p10_tokens", "first_request_cache_read_median", "lifetime_cost_usd"]))
    L.append(S["baseline"]["note"] + "\n")
    L.append(f"Context-growth writes (normal, separate from misses): {S['context_growth_writes']['tokens']:,.0f} tokens, {S['context_growth_writes']['cost']:.2f} USD.\n")
    L.append("## 4. Candidates (rule-based, no verdict)\n")
    L.append(md_table(T["candidates"], ["rule_id", "threshold", "unit", "count", "tokens", "cost_usd", "quality"], 10))
    L.append("## 5. Boxes\n")
    L.append(f"Leases: {S['box']['leases']}. Survival: `{json.dumps(S['box']['survival'], sort_keys=True)}`\n")
    L.append("## 6. Not covered\n")
    L.extend("- " + x for x in S["not_covered"])
    L.append("\n## 7. Definitions\n")
    L.append("- Requests by tool group: every request is put in the group of the tools it issued (agent control > skill > edit > shell > read/search > web > PM tools > other MCP; no tool = respond), "
             "and the request's **whole** cost goes there, including all the context it carries. This is not the cost of the tool's work: "
             "a request that runs one shell command is billed for the entire context it reads, so a large shell share says shell is the last step most turns end on, not that shell work costs that much. "
             "For what a tool's own output costs, read the tool-result carry table.\n")
    L.append("- Request = one deduplicated API response (largest figure per field wins across repeated lines).\n"
             "- Skill phase (heuristic): from a Skill tool call (or attributionSkill) until the next real human message; "
             "sub-agents inherit the parent's phase at their first request.\n"
             "- Tool-result carry = size x requests it stays in context until compaction/end, cache read per request plus one write. "
             "Size is measured from the cache-write delta when a result is alone in the gap, else estimated from length and chars/token, scaled down to the measured gap.\n"
             "- Day = UTC date of the request.\n")
    return "\n".join(L) + "\n"
