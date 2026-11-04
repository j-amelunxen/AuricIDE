"""Pipeline: find inputs, stream them, attribute, aggregate. Read-only on every input."""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from . import config as config_mod
from .aggregate import Agg
from .analyze import analyze_trace
from .claude import parse_lines
from .model import Coverage
from .pricing import PriceBook


class Ctx:
    def __init__(self, cfg, pb, agg, want_paths):
        self.cfg, self.pb, self.agg, self.want_paths = cfg, pb, agg, want_paths
        self.phases: Dict[str, list] = {}


class Options:
    def __init__(self, **kw):
        self.out = kw.get("out")
        self.since = kw.get("since")
        self.until = kw.get("until")
        self.project = kw.get("project")
        self.paths = bool(kw.get("paths"))
        self.config = kw.get("config")
        self.claude_root = kw.get("claude_root", "~/.claude/projects")
        self.codex_root = kw.get("codex_root", "~/.codex/sessions")
        self.app_data = kw.get("app_data", "~/Library/Application Support/com.auricide.ide")
        self.sandboxctl = kw.get("sandboxctl", "~/Library/Application Support/sandboxctl")
        self.project_db = list(kw.get("project_db") or [])
        self.task_log_dir = kw.get("task_log_dir")
        self.repo_root = kw.get("repo_root")
        self.skip = set(kw.get("skip") or [])   # claude, codex, box, auric


def tilde(path: str) -> str:
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path.startswith(home) else path


def _h(key: str) -> int:
    return int.from_bytes(hashlib.blake2b(key.encode("utf-8", "replace"), digest_size=8).digest(), "big")


def find_jsonl(root: str) -> List[str]:
    out = []
    for r, ds, fs in os.walk(root):
        ds.sort()
        for f in fs:
            if f.endswith(".jsonl"):
                out.append(os.path.join(r, f))
    return sorted(out)


def day_of_mtime(path: str) -> str:
    return datetime.fromtimestamp(os.stat(path).st_mtime, timezone.utc).strftime("%Y-%m-%d")


class Result:
    def __init__(self):
        self.cfg = None
        self.pb = None
        self.agg = Agg()
        self.cov = Coverage()
        self.opts = None
        self.auric_rows: list = []
        self.task_log: list = []
        self.box_leases: list = []
        self.box_survival: dict = {}
        self.cost_states: Dict[str, dict] = {}
        self.codex_rows: int = 0
        self.not_covered: List[str] = []
        self.inputs: Dict[str, str] = {}


def run(opts: Options) -> Result:
    from . import sources_other as so  # imported late: needs sqlite3/tarfile only
    res = Result()
    res.opts = opts
    cfg = config_mod.load(opts.config)
    res.cfg = cfg
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = opts.repo_root or os.path.abspath(os.path.join(here, "..", "..", ".."))
    pb = PriceBook.load(repo_root)
    res.pb = pb
    agg, cov = res.agg, res.cov
    ctx = Ctx(cfg, pb, agg, opts.paths)
    app_data = os.path.expanduser(opts.app_data)
    # ---- AuricIDE records ---------------------------------------------------------
    link: Dict[str, dict] = {}
    if "auric" not in opts.skip:
        dbs = so.discover_project_dbs(app_data) if os.path.isdir(app_data) else []
        dbs = sorted(set(dbs) | {os.path.abspath(os.path.expanduser(p)) for p in opts.project_db})
        res.auric_rows = so.read_agent_usage(dbs, cov)
        tl_dir = os.path.expanduser(opts.task_log_dir) if opts.task_log_dir else os.path.join(app_data, "task-logs")
        res.task_log = so.read_task_logs(tl_dir, cov)
        for row in res.auric_rows:
            sid = row.get("session_id")
            if sid and row.get("run_source") != "external":
                link.setdefault(sid, row)
        res.inputs["auric_projects_with_db"] = str(len(dbs))
    seen: set = set()
    since, until = opts.since, opts.until
    want = (lambda lab: opts.project.lower() in lab.lower()) if opts.project else None

    def process(source, lines, path_kind, default_agent=""):
        file_traces = list(parse_lines(lines, source, cov, cfg, want, default_agent, res.cost_states))
        new_hashes = []
        for tr in file_traces:
            if not tr.reqs:
                continue
            row = link.get(tr.session)
            label = _project_of(tr, row)
            if want and not want(label):
                cov.skip(source, "project_filter_trace")
                continue
            for r in tr.reqs:
                h = _h(r.key)
                r.dup = h in seen
                new_hashes.append(h)
                day = r.ts[:10]
                if r.dup:
                    cov.skip(source, "duplicate_request_across_files")
                r.counted = (not r.dup) and bool(day) and (not since or day >= since) and (not until or day <= until)
                if not r.dup and day and not r.counted:
                    cov.skip(source, "outside_date_range_requests")
            sidechain = bool(tr.agent) or path_kind == "subagent"
            role = "box" if source == "box" else "subagent" if sidechain else \
                "supervisor" if "/.auric/supervisors/" in tr.cwd else "worker" if row else "interactive"
            inherit = None
            if sidechain and tr.session in ctx.phases:
                inherit = _phase_at(ctx.phases[tr.session], tr.reqs[0].t)
            info = {
                "skey": (source, tr.session, tr.agent), "source": source, "session": tr.session,
                "session_label": tr.session + ("/" + tr.agent if tr.agent else ""), "role": role, "project": label,
                "ticket": (row or {}).get("ticket_id") or "(unlinked)", "goal": (row or {}).get("goal_id") or "(unlinked)",
                "provider": (row or {}).get("provider", ""), "sidechain": sidechain, "inherit": inherit,
            }
            analyze_trace(tr, info, ctx)
        seen.update(new_hashes)

    # ---- Claude Code --------------------------------------------------------------
    if "claude" not in opts.skip:
        root = os.path.expanduser(opts.claude_root)
        res.inputs["claude_root"] = tilde(root)
        files = find_jsonl(root) if os.path.isdir(root) else []
        if not files:
            cov.note("claude_root_missing_or_empty")
        for pass_sub in (False, True):   # main sessions first, so sub-agents can inherit the parent's skill
            for f in files:
                is_sub = "/subagents/" in f
                if is_sub != pass_sub:
                    continue
                if since and day_of_mtime(f) < since:
                    cov.skip("claude", "file_older_than_since")
                    continue
                try:
                    cov.file("claude", os.path.getsize(f))
                    with open(f, "rb") as fh:
                        process("claude", fh, "subagent" if is_sub else "main")
                except OSError as e:
                    cov.error("claude", e)
    # ---- Box transcripts ----------------------------------------------------------
    sb = os.path.expanduser(opts.sandboxctl)
    if "box" not in opts.skip and os.path.isdir(sb):
        res.inputs["sandboxctl"] = tilde(sb)
        res.box_leases = so.read_sandboxctl_usage(sb, cov)
        res.box_survival = so.sandboxctl_survival(sb)
        for lease in res.box_leases:
            tgz = lease.get("transcripts_tgz")
            if not tgz:
                continue
            try:
                cov.file("box", os.path.getsize(tgz))
                for _idx, lines in so.iter_box_transcripts(tgz, cov):
                    process("box", lines, "main")
            except (OSError, ValueError) as e:
                cov.error("box", e)
        _book_recorded_only(res, agg)
    elif "box" not in opts.skip:
        cov.note("sandboxctl_state_missing")
    # ---- Codex ---------------------------------------------------------------------
    if "codex" not in opts.skip:
        root = os.path.expanduser(opts.codex_root)
        res.inputs["codex_root"] = tilde(root)
        files = find_jsonl(root) if os.path.isdir(root) else []
        if not files:
            cov.note("codex_root_missing_or_empty")
        seen_codex: set = set()
        for f in files:
            if since and day_of_mtime(f) < since:
                cov.skip("codex", "file_older_than_since")
                continue
            try:
                cov.file("codex", os.path.getsize(f))
                for r in so.iter_codex_requests(f, cov, seen_codex, pb):
                    _book_codex(res, ctx, r, since, until, want)
            except OSError as e:
                cov.error("codex", e)
    _book_unknown_runs(res)
    return res


def _phase_at(timeline, t):
    label = None
    for ts, lab in timeline:
        if ts <= t:
            label = lab
        else:
            break
    return label if label and label != "(none)" else None


def _project_of(tr, row):
    from .claude import project_label
    lab = project_label(tr.cwd)
    if lab == "(unknown)" and row and row.get("project"):
        return row["project"]
    return lab


def _book_codex(res, ctx, r, since, until, want):
    cov, agg = res.cov, res.agg
    day = r.day
    if want and not want(r.project):
        cov.skip("codex", "project_filter_trace")
        return
    if (since and day < since) or (until and day > until):
        cov.skip("codex", "outside_date_range_requests")
        return
    cov.session("codex", r.session + ("/" + r.agent if r.agent else ""))
    res.codex_rows += 1
    labels = {"project": r.project, "session": r.session + ("/" + r.agent if r.agent else ""), "role": r.role,
              "model": r.model, "ticket": "(unlinked)", "goal": "(unlinked)", "skill": "(no transcript content read)",
              "activity": "(not derivable)", "day": day, "source": "codex"}
    pu = ctx.pb.unit_prices(r.model, day)
    c_out = r.output * pu[1] if pu else 0.0
    c_reas = r.reasoning * pu[1] if pu else 0.0
    agg.add_request(labels, [r.input, r.output, r.reasoning, r.cache_read, r.cache_write_5m, r.cache_write_1h,
                             r.cost, c_out - c_reas, c_reas])
    if r.cost is None:
        agg.unpriced_models[r.model] += 1
    key = ("codex", r.session, r.agent)
    s = agg.sessions.setdefault(key, {
        "source": "codex", "session": r.session, "agent": r.agent, "role": r.role, "project": r.project,
        "ticket": "(unlinked)", "goal": "(unlinked)", "provider": "codex", "first_ts": r.ts, "last_ts": r.ts,
        "requests": 0, "models": r.model, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "cost_usd": 0.0,
        "peak_context": 0, "median_context": 0, "_ctx": [], "_cost": []})
    s["requests"] += 1
    s["last_ts"] = max(s["last_ts"], r.ts)
    s["first_ts"] = min(s["first_ts"], r.ts)
    s["input"] += r.input; s["output"] += r.output; s["cache_read"] += r.cache_read; s["cache_write"] += r.cache_write
    s["cost_usd"] += r.cost or 0.0
    s["_ctx"].append(r.context); s["_cost"].append(r.cost or 0.0)
    if r.model not in s["models"].split("+"):
        s["models"] = "+".join(sorted(set(s["models"].split("+")) | {r.model}))


def _book_recorded_only(res, agg):
    """Boxes with a usage record but no transcript archive: tokens and cost as recorded by sandboxctl.

    Not recomputed at list price and not API requests (request count stays 0)."""
    res.recorded_only = []
    for lease in res.box_leases:
        if lease.get("transcripts_tgz"):
            continue
        for run in lease.get("runs", []):
            models = run.get("models") or {}
            if not models and isinstance(run.get("cost_usd"), (int, float)):
                models = {"(recorded total)": {"cost_usd": run["cost_usd"]}}
            for model in sorted(models):
                m = models[model]
                cost = m.get("cost_usd")
                if not isinstance(cost, (int, float)):
                    continue
                day = run.get("day") or "(unknown)"
                labels = {"project": lease.get("project") or "(unknown)", "session": "box:" + str(lease.get("lease")),
                          "role": "box", "model": model, "ticket": "(unlinked)", "goal": "(unlinked)",
                          "skill": "(no transcript)", "activity": "(no transcript)", "day": day,
                          "source": "box_recorded_cost_only"}
                agg.add_request(labels, [m.get("input_tokens", 0), m.get("output_tokens", 0), 0,
                                         m.get("cache_read_tokens", 0), m.get("cache_write_tokens", 0), 0,
                                         float(cost), 0.0, 0.0], count=False)
                res.recorded_only.append({"lease": lease.get("lease"), "project": labels["project"], "model": model,
                                          "cost": float(cost), "cost_source": run.get("cost_source"), "day": day})


def _book_unknown_runs(res):
    """Providers without token data stay visible as runs with duration and tokens unknown."""
    res.unknown_token_runs = {}
    for row in res.auric_rows:
        known = (row.get("input_tokens") or 0) + (row.get("output_tokens") or 0) > 0
        if row.get("cost_source") == "none" or not known:
            k = (row.get("provider") or "(none)", row.get("run_source") or "")
            e = res.unknown_token_runs.setdefault(k, {"runs": 0, "duration_ms": 0})
            e["runs"] += 1
            e["duration_ms"] += int(row.get("duration_ms") or 0)
