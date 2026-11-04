"""Per-trace attribution: where did every billed token of a session come from?

Each request is split into pools whose costs add up to the request's list-price cost:

* ``read``   cache-read tokens (the context carried forward) -> baseline, live items, unattributed
* ``new``    tokens written/uncached because content arrived -> the items that arrived
* ``rewrite`` tokens written again because the cache was lost (miss) -> cache_rewrite:<reason>
* ``output`` generated tokens -> output / reasoning

Sizes of arriving items are *measured* when one item is alone in the gap between two
requests (the cache-write delta is its size), otherwise *estimated* from length and
``chars_per_token``, scaled down (never up) so the gap's measured total is not exceeded.
What cannot be explained stays in ``unattributed`` buckets, so everything sums to the total.
"""
from __future__ import annotations

import statistics
from typing import Optional

from .claude import Item, ToolUse
from .config import activity_of

MEASURED, ESTIMATED = "measured", "estimated"


def _flush(item: Item, tr, agg, cfg):
    cost = item.cw + item.cr
    key = (item.cat, item.name)
    c = agg.cause[key]
    if item.counted:
        c["items"] += 1
        c["tokens"] += item.tok
        c[item.tag] += 1
    c["carried_token_requests"] += item.tok * item.reqs
    c["cost_write"] += item.cw
    c["cost_read"] += item.cr
    if cost or item.counted:
        s = agg.cause_skill[(item.cat, item.name, item.skill)]
        s[0] += item.tok if item.counted else 0
        s[1] += cost
    if item.cat == "tool_result":
        t = agg.tools[item.name]
        if item.counted:
            t["calls"] += 1
            t["tokens"] += item.tok
            t["chars"] += item.chars
            t[item.tag] += 1
        t["cost_write"] += item.cw
        t["cost_read"] += item.cr
        tu = tr.tool_by_id.get(item.tuid)
        if tu is not None and tu.name == "Bash":
            b = agg.bash[tu.bash or "<none>"]
            if item.counted:
                b["calls"] += 1
                b["tokens"] += item.tok
            b["cost"] += cost
        if item.counted and item.tok >= cfg["candidates"]["large_tool_result_tokens"]:
            cd = agg.cand("large_tool_result", cfg["candidates"]["large_tool_result_tokens"], "tool results")
            cd["count"] += 1
            cd["tokens"] += item.tok
            cd["cost_usd"] += cost


def analyze_trace(tr, info: dict, ctx) -> None:
    cfg, pb, agg = ctx.cfg, ctx.pb, ctx.agg
    reqs = tr.reqs
    n = len(reqs)
    if n == 0:
        return
    cpt = cfg["chars_per_token"]
    skey = info["skey"]
    unit = [pb.unit_prices(r.model, r.ts[:10], r.fast) for r in reqs]
    live: list = []
    base = 0.0
    base_cost = 0.0
    phase: Optional[str] = None
    ctxs, costs = [], []
    n_counted = 0
    first_ts = last_ts = ""
    compaction_marks = []
    models = set()
    idle_events = 0
    session_cost = 0.0
    tok_totals = [0, 0, 0, 0]
    overall_skill = {}

    for j, r in enumerate(reqs):
        pu = unit[j]
        p_in, p_out, p_rd, p_w5, p_w1 = pu if pu else (0, 0, 0, 0, 0)
        counted = r.counted
        if r.human:
            phase = None
        label = r.skill_attr or phase or info.get("inherit") or "(none)"
        win = r.w5 + r.w1 + r.i
        c_win = r.w5 * p_w5 + r.w1 * p_w1 + r.i * p_in
        c_read = r.cr * p_rd
        c_out_all = r.o * p_out
        c_reas = r.think * p_out
        req_cost = (c_read + c_win + c_out_all) if pu else None
        if counted:
            n_counted += 1
            models.add(r.model)
            first_ts = first_ts or r.ts
            last_ts = r.ts
            activity = activity_of(cfg, [t.name for t in r.tools])
            labels = {
                "project": info["project"], "session": info["session_label"], "role": info["role"],
                "model": r.model, "ticket": info["ticket"], "goal": info["goal"], "skill": label,
                "activity": activity, "day": r.ts[:10], "source": info["source"],
            }
            agg.add_request(labels, [r.i, r.o, r.think, r.cr, r.w5, r.w1, req_cost, c_out_all - c_reas, c_reas])
            if not pu:
                agg.unpriced_models[r.model] += 1
            ctxs.append(r.ctx)
            costs.append(req_cost or 0.0)
            session_cost += req_cost or 0.0
            tok_totals[0] += r.i; tok_totals[1] += r.o; tok_totals[2] += r.cr; tok_totals[3] += r.w5 + r.w1
            overall_skill[label] = overall_skill.get(label, 0.0) + (req_cost or 0.0)
            if r.o:
                oc = agg.cause[("output", "generated")]
                oc["items"] += 0
                oc["tokens"] += r.o - r.think
                oc["cost_write"] += c_out_all - c_reas
                rc = agg.cause[("output", "reasoning")]
                rc["tokens"] += r.think
                rc["cost_write"] += c_reas

        # ---- context decomposition -------------------------------------------------
        if j == 0:
            base = float(r.ctx)
            base_cost += c_win + c_read
            if counted:
                c = agg.cause[("baseline", "session_start")]
                c["items"] += 1
                c["tokens"] += base
                c["cost_write"] += c_win + c_read
                c[MEASURED] += 1
        elif r.compact is not None:
            for it in live:
                _flush(it, tr, agg, cfg)
            live = []
            rb = min(base, float(r.cr))
            c_rb = c_read * (rb / r.cr) if r.cr else 0.0
            base_cost += c_rb
            summ = Item("compaction", "summary", 0)
            summ.tok = max(0.0, r.ctx - base)
            summ.tag = MEASURED
            summ.skill = label
            summ.counted = counted
            summ.reqs = 1 if counted else 0
            if counted:
                summ.cw = c_win
                summ.cr = c_read - c_rb
                bc = agg.cause[("baseline", "session_start")]
                bc["carried_token_requests"] += rb
                bc["cost_read"] += c_rb
            live.append(summ)
            pre, post, trig = r.compact
            compaction_marks.append({"idx": j, "pre": pre, "post": post, "trigger": trig,
                                     "ctx_first": r.ctx, "counted": counted})
        else:
            p = reqs[j - 1]
            ctx_p = p.ctx
            nocache = (r.cr + r.w5 + r.w1) == 0 and (p.cr + p.w5 + p.w1) == 0
            rewritten, reason = 0, ""
            if nocache:
                carried = min(r.i, ctx_p)
                read_tok, read_cost = float(carried), carried * p_in
                new_tok = r.i - carried
                new_cost = new_tok * p_in
                rew_cost = 0.0
            else:
                read_tok, read_cost = float(r.cr), c_read
                miss = ctx_p >= cfg["miss_min_prev_tokens"] and r.cr < cfg["miss_read_ratio"] * ctx_p
                if miss:
                    rewritten = min(win, max(0, ctx_p - r.cr))
                    gap = (r.t - p.t) if (r.t and p.t) else 0.0
                    ttl = cfg["cache_ttl_1h_s"] if p.w1 > 0 else cfg["cache_ttl_5m_s"]
                    if gap > ttl:
                        reason = "idle_gap"
                    elif r.model != p.model:
                        reason = "model_change"
                    elif r.miss_reason:
                        reason = "reported_" + r.miss_reason
                    else:
                        reason = "other"
                unit_w = c_win / win if win else 0.0
                rew_cost = rewritten * unit_w
                new_tok = win - rewritten
                new_cost = new_tok * unit_w
            if rewritten and counted:
                excess = rewritten * (((c_win / win) if win else 0.0) - p_rd)
                agg.rewrites.append({"skey": skey, "reason": reason, "tokens": rewritten, "cost": rew_cost,
                                     "excess": excess, "day": r.ts[:10], "gap_s": round(r.t - p.t) if (r.t and p.t) else 0})
                c = agg.cause[("cache_rewrite", reason)]
                c["items"] += 1
                c["tokens"] += rewritten
                c["cost_write"] += rew_cost
                c[MEASURED] += 1
                if reason == "idle_gap":
                    idle_events += 1
                    cd = agg.cand("idle_gap_cache_miss", "gap > cache lifetime ("
                                  f"{cfg['cache_ttl_5m_s']}s / {cfg['cache_ttl_1h_s']}s)", "requests")
                    cd["count"] += 1
                    cd["tokens"] += rewritten
                    cd["cost_usd"] += rew_cost
            # arrivals
            items = list(r.arrivals)
            out_item = None
            remaining = float(new_tok)
            if p.o > 0 and r.compact is None:
                out_item = Item("assistant_output", "carried_output", 0)
                out_item.tok = min(float(p.o), remaining)
                out_item.tag = ESTIMATED
                remaining -= out_item.tok
            est = [it.chars / cpt for it in items]
            E = sum(est)
            leftover = remaining
            if len(items) == 1:
                it = items[0]
                it.tok = max(0.0, remaining)
                it.tag = MEASURED if not nocache else ESTIMATED
                leftover = 0.0
                if it.chars > 0 and not it.images and not nocache:
                    cal = agg.calib[it.name if it.cat == "tool_result" else it.cat + ":" + it.name]
                    cal[0] += it.chars
                    cal[1] += it.tok
            elif E > 0:
                scale = min(1.0, remaining / E)
                for it, e in zip(items, est):
                    it.tok = e * scale
                    it.tag = ESTIMATED
                leftover = remaining - sum(it.tok for it in items)
            unit_new = (new_cost / new_tok) if new_tok > 0 else 0.0
            for it in items + ([out_item] if out_item else []):
                it.skill, it.counted = label, counted
                if counted:
                    it.cw = it.tok * unit_new
                    it.reqs = 1
            if counted:
                agg.growth["tokens"] += new_tok
                agg.growth["cost"] += new_cost
                agg.growth["requests"] += 1
                if leftover > 0:
                    c = agg.cause[("context_growth", "unattributed")]
                    c["tokens"] += leftover
                    c["cost_write"] += leftover * unit_new
            # carried context
            if read_tok > 0:
                live_sum = sum(it.tok for it in live)
                S = base + live_sum
                f = min(1.0, read_tok / S) if S > 0 else 0.0
                unit_r = read_cost / read_tok
                if counted:
                    b = base * f
                    base_cost += b * unit_r
                    bc = agg.cause[("baseline", "session_start")]
                    bc["carried_token_requests"] += b
                    bc["cost_read"] += b * unit_r
                    for it in live:
                        it.cr += it.tok * f * unit_r
                        it.reqs += 1
                    un = max(0.0, read_tok - S)
                    if un:
                        c = agg.cause[("context_carried", "unattributed")]
                        c["tokens"] += un
                        c["cost_read"] += un * unit_r
                else:
                    base_cost += base * f * unit_r
            live.extend(items)
            if out_item:
                live.append(out_item)
        # phase for the *next* request
        for tu in r.tools:
            if tu.name == "Skill" and tu.skill:
                phase = tu.skill
        if not info["sidechain"]:
            ctx.phases.setdefault(info["session"], []).append((r.t, label))

    for it in live:
        _flush(it, tr, agg, cfg)
    # items that never made it into `live` (arrivals after the last request) are not billed
    # ---- compactions -------------------------------------------------------------
    for m in compaction_marks:
        if not m["counted"]:
            continue
        N = cfg["post_compaction_requests"]
        cost_after = sum(costs_at(reqs, unit, m["idx"], N))
        agg.compactions.append({"skey": skey, "trigger": m["trigger"], "pre": m["pre"], "post": m["post"],
                                "ctx_first_after": m["ctx_first"], "cost_first_requests": cost_after,
                                "requests_costed": N})
    if n_counted == 0:
        return
    # ---- baseline, curve, candidates ---------------------------------------------
    first = reqs[0]
    lines = cfg["context_lines"]
    srt = sorted(ctxs)
    median = statistics.median(srt)
    cur = {"peak": max(ctxs), "median": median, "n_over": [], "share_over": [], "tokens_over": []}
    total_c = sum(costs) or 0.0
    for ln in lines:
        sel = [(c, k) for c, k in zip(ctxs, costs) if c > ln]
        cur["n_over"].append(len(sel))
        cur["tokens_over"].append(sum(c for c, _ in sel))
        cur["share_over"].append((sum(k for _, k in sel) / total_c) if total_c else 0.0)
    agg.baselines.append({"skey": skey, "role": info["role"], "model": reqs[0].model, "tokens": base,
                          "first_request_cache_read": first.cr, "requests": n_counted, "lifetime_cost": base_cost,
                          "first_counted": reqs[0].counted})
    cd = cfg["candidates"]
    if base >= cd["large_baseline_tokens"] and reqs[0].counted:
        c = agg.cand("large_baseline", cd["large_baseline_tokens"], "sessions")
        c["count"] += 1; c["tokens"] += base; c["cost_usd"] += base_cost
    if cur["peak"] > cd["session_context_over_tokens"]:
        c = agg.cand("session_context_over_threshold", cd["session_context_over_tokens"], "sessions")
        sel = [(cx, k) for cx, k in zip(ctxs, costs) if cx > cd["session_context_over_tokens"]]
        c["count"] += 1; c["tokens"] += sum(x for x, _ in sel); c["cost_usd"] += sum(k for _, k in sel)
    top_price = max((u[1] * 1e6 for u in unit if u), default=0)
    if top_price >= cd["high_model_output_usd_per_mtok"] and n_counted <= cd["short_run_max_requests"]:
        c = agg.cand("high_model_short_run", f"output >= {cd['high_model_output_usd_per_mtok']} USD/Mtok and <= "
                     f"{cd['short_run_max_requests']} requests", "sessions")
        c["count"] += 1; c["tokens"] += sum(tok_totals); c["cost_usd"] += session_cost
    _repeat_candidates(tr, reqs, cfg, agg, ctx.want_paths, info)
    sess = {
        "source": info["source"], "session": info["session"], "agent": tr.agent, "role": info["role"],
        "project": info["project"], "ticket": info["ticket"], "goal": info["goal"], "provider": info.get("provider", ""),
        "first_ts": first_ts, "last_ts": last_ts, "requests": n_counted, "models": "+".join(sorted(models)),
        "input": tok_totals[0], "output": tok_totals[1], "cache_read": tok_totals[2], "cache_write": tok_totals[3],
        "cost_usd": session_cost, "baseline_tokens": base, "first_request_cache_read": first.cr,
        "peak_context": cur["peak"], "median_context": median,
        "requests_over_200k": cur["n_over"][0], "requests_over_500k": cur["n_over"][1] if len(lines) > 1 else 0,
        "cost_share_over_200k": cur["share_over"][0], "cost_share_over_500k": cur["share_over"][1] if len(lines) > 1 else 0,
        "compactions": sum(1 for m in compaction_marks if m["counted"]), "idle_gap_misses": idle_events,
        "top_skill": max(sorted(overall_skill), key=lambda k: overall_skill[k]) if overall_skill else "(none)",
        "parent_session": info["session"] if tr.agent else "",
    }
    agg.sessions[skey] = sess
    agg.session_cost[info["session"]] += session_cost
    st = agg.session_tokens[info["session"]]
    for k in range(4):
        st[k] += tok_totals[k]


def costs_at(reqs, unit, start, n):
    out = []
    for r, pu in zip(reqs[start:start + n], unit[start:start + n]):
        if r.counted and pu:
            p_in, p_out, p_rd, p_w5, p_w1 = pu
            out.append(r.i * p_in + r.o * p_out + r.cr * p_rd + r.w5 * p_w5 + r.w1 * p_w1)
    return out


def _repeat_candidates(tr, reqs, cfg, agg, want_paths, info):
    cd = cfg["candidates"]
    reads, calls = {}, {}
    for r in reqs:
        if not r.counted:
            continue
        for tu in r.tools:
            if tu.name == "Read" and tu.phash:
                reads.setdefault(tu.phash, []).append(tu)
            calls.setdefault(tu.ihash, []).append(tu)
            if want_paths and tu.path and tu.name in ("Read", "Edit", "Write", "NotebookEdit"):
                p = agg.paths.setdefault((tu.path, tu.name), {"calls": 0, "sessions": set()})
                p["calls"] += 1
                p["sessions"].add(info["session"])
    for rule, groups, minimum, unit in (
        ("repeat_file_read", reads, cd["repeat_file_read_min_reads"], "extra reads"),
        ("repeat_identical_call", calls, cd["repeat_identical_call_min_calls"], "extra calls"),
    ):
        for uses in groups.values():
            if len(uses) < minimum:
                continue
            c = agg.cand(rule, minimum, unit)
            for tu in uses[1:]:
                it = tr.item_by_tuid.get(tu.id)
                c["count"] += 1
                if it is not None:
                    c["tokens"] += it.tok
                    c["cost_usd"] += it.cw + it.cr
