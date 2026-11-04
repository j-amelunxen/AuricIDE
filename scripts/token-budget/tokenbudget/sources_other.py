"""Readers for everything that is not a plain Claude transcript.

Sources: the per-project ``pm_agent_usage`` tables, the app's task logs, the
sandboxctl usage ledgers and their transcript archives, and Codex rollouts.

Nothing here ever keeps message content: only ids, counts, token figures,
timestamps, model / tool / skill names and short labels.

Codex token semantics (checked with a numbers-only probe over 1444 real
``token_count`` events, both ``last_token_usage`` and ``total_token_usage``):

* ``total_tokens == input_tokens + output_tokens`` in every case, so
  ``input_tokens`` INCLUDES ``cached_input_tokens`` (cached <= input always).
  Fresh input is therefore ``input - cached - cache_write``
  (``cache_write_input_tokens`` was 0 in the sample, treated like cached).
* ``reasoning_output_tokens <= output_tokens`` always and the total never adds
  reasoning on top, so reasoning is a SUBSET of output.
* Newer builds additionally write a top-level ``token_usage_record`` line per
  response (same figures as the matching ``token_count`` event, one to one, in
  80 of 80 sampled files). When a rollout has such records they are used and
  the ``token_count`` events are dropped, otherwise everything would count
  twice.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tarfile
import tempfile
import urllib.parse
from typing import Dict, Iterator, List, Optional, Tuple

from .model import Coverage, Req

_IDENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-\[\]/ ]{0,79}$")
_MAX_MEMBER = 4 * 1024 ** 3
_WT_SUFFIX = ".auric-wt"


def label_of(path) -> str:
    """Basename of a project dir, ``.auric-wt`` stripped. Never a full path."""
    if not isinstance(path, str) or not path:
        return ""
    base = os.path.basename(path.rstrip("/\\")) or ""
    base = base.replace("\\", "/").rsplit("/", 1)[-1]
    if base.endswith(_WT_SUFFIX):
        base = base[: -len(_WT_SUFFIX)]
    return base[:120]


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _ident(v) -> str:
    return v if isinstance(v, str) and _IDENT.match(v) else "<other>"


def _load_json(path: str, source: str, cov: Coverage):
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        cov.file(source, len(raw))
        return json.loads(raw)
    except FileNotFoundError:
        cov.skip(source, "file_missing")
    except (OSError, ValueError) as exc:
        cov.error(source, exc)
        cov.skip(source, "unreadable_json")
    return None


# 1. discovery -------------------------------------------------------------

def discover_project_dbs(app_data_dir: str, cov: Optional[Coverage] = None) -> List[str]:
    cov = cov or Coverage()
    paths = set()
    for name, kind in (("recent-projects.json", "list"), ("starred-projects.json", "list"),
                       ("supervisor-policy.json", "policy")):
        doc = _load_json(os.path.join(app_data_dir, name), "projects", cov)
        if not isinstance(doc, dict):
            if doc is not None:
                cov.skip("projects", "bad_shape")
            continue
        projects = doc.get("projects")
        if kind == "policy" and isinstance(projects, dict):
            cands = list(projects.keys())
        elif kind == "list" and isinstance(projects, list):
            cands = [p.get("path") if isinstance(p, dict) else p for p in projects]
        else:
            cov.skip("projects", "bad_shape")
            continue
        for c in cands:
            if isinstance(c, str) and c:
                paths.add(c)
    out = sorted(p for p in paths if os.path.isfile(os.path.join(p, ".auric", "project.db")))
    if len(paths) != len(out):
        cov.skip("projects", "no_project_db", len(paths) - len(out))
    return out


# 2. pm_agent_usage --------------------------------------------------------

_USAGE_COLUMNS = (
    "id agent_id ticket_id goal_id run_kind run_source provider model headless session_id "
    "ticket_status_at_start started_at finished_at duration_ms outcome input_tokens output_tokens "
    "cache_read_tokens cache_write_tokens reasoning_tokens cost_usd cost_source match_kind "
    "estimate_cost_usd estimate_input_tokens estimate_output_tokens estimate_cache_read_tokens "
    "estimate_cache_write_tokens unpriced_models model_usage_json num_turns "
    "active_ms on_ms agent_runs runtime_partial external_id external_run_id closed_by"
).split()


def _open_copy(db_path: str, tmp: str) -> sqlite3.Connection:
    dst = os.path.join(tmp, "p.db")
    shutil.copyfile(db_path, dst)
    for suffix in ("-wal", "-shm"):
        if os.path.isfile(db_path + suffix):
            shutil.copyfile(db_path + suffix, dst + suffix)
    uri = "file:" + urllib.parse.quote(dst) + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchall()
        return conn
    except sqlite3.OperationalError:
        # A read-only WAL open can need to create its -shm; the copy is ours.
        return sqlite3.connect(dst)


def read_agent_usage(project_dirs, cov: Coverage) -> List[dict]:
    rows: List[dict] = []
    for pdir in sorted(set(project_dirs)):
        db_path = os.path.join(pdir, ".auric", "project.db")
        if not os.path.isfile(db_path):
            cov.skip("agent_usage", "db_missing")
            continue
        label = label_of(pdir)
        try:
            with tempfile.TemporaryDirectory(prefix="tb-") as tmp:
                conn = _open_copy(db_path, tmp)
                try:
                    have = [r[1] for r in conn.execute("PRAGMA table_info(pm_agent_usage)")]
                    cols = [c for c in _USAGE_COLUMNS if c in have]
                    if not cols:
                        cov.skip("agent_usage", "no_table")
                        continue
                    cov.file("agent_usage", os.path.getsize(db_path))
                    for rec in conn.execute("SELECT %s FROM pm_agent_usage" % ", ".join(cols)):
                        d = dict(zip(cols, rec))
                        d["project"] = label
                        rows.append(d)
                        cov.line("agent_usage")
                finally:
                    conn.close()
        except (sqlite3.Error, OSError) as exc:
            cov.error("agent_usage", exc)
            cov.skip("agent_usage", "db_unreadable")
    rows.sort(key=lambda r: (str(r.get("started_at") or ""), str(r.get("id") or ""), r["project"]))
    return rows


# 3. task logs -------------------------------------------------------------

_TASK_KEYS = (
    "agentId role provider model status startedAt finishedAt durationMs spawnedByAgentId ticketId goalId "
    "costUsd inputTokens outputTokens source externalId runId onMs activeMs runtimePartial agentRuns "
    "closedBy costSource cacheReadTokens cacheWriteTokens"
).split()
_TASK_FILE = re.compile(r"^tasks-\d{4}-\d{2}\.jsonl$")


def read_task_logs(dir: str, cov: Coverage) -> List[dict]:  # noqa: A002 - name fixed by the contract
    if not os.path.isdir(dir):
        cov.note("task_log_dir_missing")
        return []
    out: List[dict] = []
    for name in sorted(os.listdir(dir)):
        if not _TASK_FILE.match(name):
            continue
        try:
            fh = open(os.path.join(dir, name), "rb")
        except OSError as exc:
            cov.error("task_log", exc)
            continue
        with fh:
            cov.file("task_log", os.path.getsize(os.path.join(dir, name)))
            for raw in fh:
                if not raw.strip():
                    continue
                cov.line("task_log")
                try:
                    o = json.loads(raw)
                except ValueError:
                    cov.skip("task_log", "bad_json")
                    continue
                if not isinstance(o, dict):
                    cov.skip("task_log", "not_object")
                    continue
                d = {}
                for k in _TASK_KEYS:
                    v = o.get(k)
                    if isinstance(v, str):
                        v = v[:200]
                    if v is None or isinstance(v, (str, int, float, bool)):
                        d[k] = v
                d["project"] = label_of(o.get("projectPath"))
                out.append(d)
    out.sort(key=lambda r: (str(r.get("startedAt") or ""), str(r.get("agentId") or ""), str(r.get("runId") or "")))
    return out


# 4. sandboxctl ------------------------------------------------------------

def _usage_dir(state_dir: str) -> str:
    return os.path.join(state_dir, "usage")


def _tok_block(d) -> dict:
    out = {}
    if isinstance(d, dict):
        for k in sorted(d):
            v = _num(d[k])
            if v is not None:
                out[k] = v
    return out


def _model_map(m) -> Dict[str, dict]:
    out = {}
    if isinstance(m, dict):
        for k in sorted(m):
            out[_ident(k)] = _tok_block(m[k])
    return out


def _count_map(m) -> Dict[str, int]:
    out: Dict[str, int] = {}
    if isinstance(m, dict):
        for k in sorted(m):
            v = _num(m[k])
            if v is not None:
                out[_ident(k)] = out.get(_ident(k), 0) + v
    return out


def _norm_run(sid, r) -> dict:
    r = r if isinstance(r, dict) else {}
    return {
        "session": _ident(sid) if isinstance(sid, str) else "<other>",
        "day": r["day"] if isinstance(r.get("day"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", r["day"]) else None,
        "cost_usd": _num(r.get("cost_usd")),
        "cost_source": _ident(r.get("cost_source")) if r.get("cost_source") is not None else None,
        "is_error": bool(r.get("is_error")),
        "partial": bool(r.get("partial")),
        "messages": _num(r.get("messages")),
        "subagent_messages": _num(r.get("subagent_messages")),
        "models": _model_map(r.get("models")),
        "transcript_models": _model_map(r.get("transcript_models")),
        "tool_uses": _count_map(r.get("tool_uses")),
        "skills_invoked": _count_map(r.get("skills_invoked")),
        "clocks": _tok_block(r.get("clocks")),
    }


def _agent_runs(m) -> List[float]:
    if not isinstance(m, dict):
        return []

    def key(k):
        try:
            return (0, float(k), "")
        except (TypeError, ValueError):
            return (1, 0.0, str(k))
    out = []
    for k in sorted(m, key=key):
        v = m[k]
        n = _num(v.get("active_seconds")) if isinstance(v, dict) else None
        if n is not None:
            out.append(n)
    return out


def read_sandboxctl_usage(state_dir: str, cov: Coverage) -> List[dict]:
    udir = _usage_dir(state_dir)
    if not os.path.isdir(udir):
        cov.note("sandboxctl_usage_dir_missing")
        return []
    leases = []
    for name in sorted(os.listdir(udir)):
        if not name.endswith(".json"):
            continue
        doc = _load_json(os.path.join(udir, name), "sandboxctl", cov)
        if not isinstance(doc, dict):
            continue
        stem = name[: -len(".json")]
        tgz = os.path.join(udir, stem + ".transcripts.tgz")
        runs_in = doc.get("runs") if isinstance(doc.get("runs"), dict) else {}
        runs = [_norm_run(sid, runs_in[sid]) for sid in sorted(runs_in, key=str)]
        for r in runs:
            cov.session("sandboxctl", r["session"])
            cov.line("sandboxctl")
        bu = doc.get("browser_use")
        leases.append({
            "lease": _ident(doc.get("lease")) if doc.get("lease") is not None else _ident(stem),
            "box": _ident(doc.get("box")) if doc.get("box") is not None else None,
            "project": _ident(doc.get("project")) if doc.get("project") is not None else None,
            "worker": _ident(doc.get("worker")) if doc.get("worker") is not None else None,
            "runs": runs,
            "browser_use": {k: v for k, v in sorted(bu.items())
                            if isinstance(v, (int, float, bool))} if isinstance(bu, dict) else {},
            "agent_runs": _agent_runs(doc.get("agent_runs")),
            "transcripts_tgz": tgz if os.path.isfile(tgz) else None,
        })
    leases.sort(key=lambda d: (d["lease"], d["box"] or ""))
    return leases


def _ext_of(name: str) -> str:
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    return ext if re.match(r"^[a-z0-9]{1,8}$", ext) else ("<none>" if not ext else "<other>")


def sandboxctl_survival(state_dir: str) -> dict:
    """Do full box transcripts survive? Counts only: extensions, never member names."""
    udir = _usage_dir(state_dir)
    res = {"leases": 0, "totals_only": 0, "with_archive": 0, "archives_without_totals": 0,
           "archives_unreadable": 0, "member_ext_counts": {}, "per_archive": []}
    if not os.path.isdir(udir):
        return res
    names = sorted(os.listdir(udir))
    jsons = {n[:-5] for n in names if n.endswith(".json")}
    tgzs = {n[: -len(".transcripts.tgz")] for n in names if n.endswith(".transcripts.tgz")}
    res["leases"] = len(jsons)
    res["with_archive"] = len(jsons & tgzs)
    res["totals_only"] = len(jsons - tgzs)
    res["archives_without_totals"] = len(tgzs - jsons)
    total: Dict[str, int] = {}
    for stem in sorted(tgzs):
        per: Dict[str, int] = {}
        try:
            with tarfile.open(os.path.join(udir, stem + ".transcripts.tgz"), "r|gz") as tf:
                for m in tf:
                    ext = _ext_of(m.name) if m.isfile() else "<non-file>"
                    per[ext] = per.get(ext, 0) + 1
        except (tarfile.TarError, OSError, EOFError):
            res["archives_unreadable"] += 1
        for k, v in per.items():
            total[k] = total.get(k, 0) + v
        res["per_archive"].append(dict(sorted(per.items())))
    res["member_ext_counts"] = dict(sorted(total.items()))
    res["per_archive"].sort(key=lambda d: sorted(d.items()))
    return res


# 5. box transcripts -------------------------------------------------------

def _safe_member_name(name: str) -> bool:
    n = name.replace("\\", "/")
    return not (n.startswith("/") or ".." in n.split("/") or re.match(r"^[A-Za-z]:", n))


def _member_lines(fh, cov: Coverage) -> Iterator[bytes]:
    for line in fh:
        cov.line("box")
        yield line


def iter_box_transcripts(tgz_path: str, cov: Coverage) -> Iterator[Tuple[int, Iterator[bytes]]]:
    """Yield ``(index, lines)`` per ``*.jsonl`` member, streamed from the archive.

    ``r|gz`` cannot seek backwards: consume (or drop) ``lines`` before asking for
    the next item; skipping forward discards the unread rest of the member.
    Nothing is extracted to disk and member names are never yielded.
    """
    try:
        tf = tarfile.open(tgz_path, "r|gz")
    except (tarfile.TarError, OSError) as exc:
        cov.error("box", exc)
        return
    index = 0
    with contextlib.closing(tf):
        try:
            for m in tf:
                if not m.isreg():
                    cov.skip("box", "not_regular_member")
                    continue
                if not _safe_member_name(m.name):
                    cov.skip("box", "unsafe_member_name")
                    continue
                if not m.name.endswith(".jsonl"):
                    cov.skip("box", "non_jsonl_member")
                    continue
                if m.size > _MAX_MEMBER:
                    cov.skip("box", "member_too_large")
                    continue
                fh = tf.extractfile(m)
                if fh is None:
                    cov.skip("box", "unreadable_member")
                    continue
                cov.file("box", m.size)
                yield index, _member_lines(fh, cov)
                index += 1
        except (tarfile.TarError, OSError, EOFError) as exc:
            cov.error("box", exc)


# 6. codex -----------------------------------------------------------------

_CODEX_KNOWN = {"session_meta", "turn_context", "event_msg", "response_item", "compacted",
                "world_state", "token_usage_record", "inter_agent_communication_meta",
                "inter_agent_communication_metadata"}
_FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens",
           "reasoning_output_tokens")


def _usage_tuple(u) -> Optional[Tuple[int, int, int, int, int]]:
    if not isinstance(u, dict):
        return None
    vals = []
    for k in _FIELDS:
        v = u.get(k, 0)
        if v is None:
            v = 0
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            return None
        vals.append(v)
    return tuple(vals)  # type: ignore[return-value]


def _iso_ms(ts) -> Optional[str]:
    if not isinstance(ts, str):
        return None
    try:
        d = _dt.datetime.fromisoformat(ts.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    d = d.replace(tzinfo=_dt.timezone.utc) if d.tzinfo is None else d.astimezone(_dt.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def _seen_key(ts: str, tup) -> int:
    h = hashlib.blake2b(("%s|%s" % (ts, ",".join(map(str, tup)))).encode(), digest_size=8)
    return int.from_bytes(h.digest(), "big")


def _delta(cur, prev):
    if prev is None:
        return cur
    return tuple(max(0, a - b) for a, b in zip(cur, prev))


def _build_req(ctx: dict, ts: str, tup, pricebook) -> Req:
    inp, cached, cw, out, reas = tup
    fresh = max(0, inp - cached - cw)
    model = ctx["model"]
    cost = pricebook.cost(model, ts[:10], fresh, out, cached, cw, 0) if pricebook is not None else None
    return Req(source="codex", session=ctx["session"], agent=ctx["agent"], role=ctx["role"],
               project=ctx["project"], model=model, ts=ts, input=fresh, output=out,
               reasoning=min(reas, out), cache_read=cached, cache_write_5m=cw, cost=cost)


def iter_codex_requests(path: str, cov: Coverage, seen: set, pricebook) -> Iterator[Req]:
    ctx = {"model": "unknown", "session": "", "agent": "", "role": "interactive", "project": ""}
    have_meta = False
    start_ordinal = None
    prev_total = None
    from_events: List[Tuple[int, Req]] = []
    from_records: List[Tuple[int, Req]] = []
    record_ids = set()
    try:
        fh = open(path, "rb")
    except OSError as exc:
        cov.error("codex", exc)
        return
    with fh:
        cov.file("codex", os.path.getsize(path))
        for raw in fh:
            if not raw.strip():
                continue
            cov.line("codex")
            try:
                o = json.loads(raw)
            except ValueError:
                cov.skip("codex", "bad_json")
                continue
            if not isinstance(o, dict):
                cov.skip("codex", "not_object")
                continue
            rtype = o.get("type")
            p = o.get("payload")
            p = p if isinstance(p, dict) else {}
            ordinal = o.get("ordinal")
            if rtype == "session_meta":
                if not have_meta:
                    have_meta = True
                    sid = p.get("id") if isinstance(p.get("id"), str) else ""
                    parent = p.get("parent_thread_id") if isinstance(p.get("parent_thread_id"), str) else ""
                    sub = bool(parent or p.get("agent_role"))
                    ctx["project"] = label_of(p.get("cwd"))
                    ctx["role"] = "subagent" if sub else "interactive"
                    ctx["agent"] = sid if sub else ""
                    ctx["session"] = (parent or sid) if sub else sid
                    so = p.get("subagent_history_start_ordinal")
                    start_ordinal = so if isinstance(so, int) and not isinstance(so, bool) else None
                    cov.session("codex", ctx["session"])
                continue
            if rtype == "turn_context":
                m = p.get("model")
                if isinstance(m, str) and m:
                    ctx["model"] = m
                continue
            in_history = (start_ordinal is not None and isinstance(ordinal, int) and ordinal < start_ordinal)
            cand = None  # (kind, total, last, response_id)
            if rtype == "event_msg" and p.get("type") == "token_count":
                info = p.get("info") if isinstance(p.get("info"), dict) else p
                total = _usage_tuple(info.get("total_token_usage") or p.get("thread_token_usage"))
                last = _usage_tuple(info.get("last_token_usage") or p.get("usage") or p.get("turn_token_usage"))
                if total is None and last is None:
                    cov.skip("codex", "no_usage")
                    continue
                cand = ("event", total, last, None)
            elif rtype == "token_usage_record":
                last = _usage_tuple(p.get("usage"))
                if last is None:
                    cov.skip("codex", "no_usage")
                    continue
                rid = p.get("response_id") if isinstance(p.get("response_id"), str) else None
                cand = ("record", _usage_tuple(p.get("thread_token_usage")), last, rid)
            elif rtype not in _CODEX_KNOWN:
                cov.unknown("codex", rtype)
                continue
            if cand is None:
                continue
            kind, total, last, rid = cand
            # The repeat check runs on events only: a record carries its own response id.
            if kind == "event":
                if total is not None and total == prev_total:
                    cov.skip("codex", "duplicate_token_count")
                    continue
                if total is not None:
                    before, prev_total = prev_total, total
                else:
                    before = None
            else:
                before = None
            if in_history:
                cov.skip("codex", "forked_history")
                continue
            if kind == "record" and rid is not None:
                if rid in record_ids:
                    cov.skip("codex", "duplicate_token_count")
                    continue
                record_ids.add(rid)
            use = last if last is not None else _delta(total, before)
            if not any(use):
                cov.skip("codex", "zero_usage")
                continue
            ts = _iso_ms(o.get("timestamp"))
            if ts is None:
                cov.skip("codex", "bad_timestamp")
                continue
            key = _seen_key(ts, use)
            if key in seen:
                cov.skip("codex", "duplicate_across_files")
                continue
            req = _build_req(ctx, ts, use, pricebook)
            (from_records if kind == "record" else from_events).append((key, req))
    chosen = from_records if from_records else from_events
    if from_records and from_events:
        cov.skip("codex", "token_count_shadowed_by_record", len(from_events))
    for key, req in chosen:
        if key in seen:
            cov.skip("codex", "duplicate_across_files")
            continue
        seen.add(key)
        yield req
