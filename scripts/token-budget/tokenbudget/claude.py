"""Streaming reader for Claude Code transcripts (and the same files inside box archives).

One line at a time. A line is parsed, measured, and dropped: the only things that
survive are token figures, lengths, timestamps, model, tool names, skill names,
agent ids and one-way hashes of tool-call inputs. Lines of one API response repeat
with the same ``message.id`` + ``requestId`` (one line per content block, output
tokens growing); they are merged here, the largest figure per field wins.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from .model import Coverage

KNOWN_IGNORED = {
    "ai-title", "api-request", "api-request-blob", "api-request-shape", "atis-latch", "file-history-delta",
    "file-history-snapshot", "last-prompt", "mode", "permission-mode", "queue-operation", "tools-used",
    "summary", "custom-title", "agent-name", "pr-link", "agent-setting", "progress", "worktree-state",
}
SKIP_PREFIX = (b'{"type":"api-request',)  # request echoes: content-bearing, never needed
BASH_WORD = re.compile(r"^[A-Za-z0-9_.+-]{1,24}$")
IDENT = re.compile(r"^[A-Za-z0-9_.:/@+-]{1,80}$")
NAME_OK = re.compile(r"^[A-Za-z0-9_.:@-]{1,100}$")


def epoch(ts: str) -> float:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0.0


def norm_ts(ts: str) -> str:
    """Normalise to UTC millisecond ISO, 'Z' suffix."""
    try:
        d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if d.tzinfo is None:
            return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
        d = d.astimezone(__import__("datetime").timezone.utc)
        return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    except (ValueError, AttributeError):
        return ""


def project_label(cwd: str) -> str:
    if not cwd:
        return "(unknown)"
    if "/.auric/supervisors/" in cwd:
        return "(supervisor)"
    parts = [p for p in cwd.split("/") if p]
    for p in parts:
        if p.endswith(".auric-wt"):
            return p[: -len(".auric-wt")]
    return parts[-1] if parts else "(unknown)"


def digest(obj) -> str:
    try:
        raw = json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8", "replace")
    except (TypeError, ValueError):
        raw = b"?"
    return hashlib.blake2b(raw, digest_size=6).hexdigest()


def text_len(v) -> int:
    """Characters of a content value; images are counted separately by the caller."""
    if isinstance(v, str):
        return len(v)
    if isinstance(v, list):
        return sum(text_len(x) for x in v)
    if isinstance(v, dict):
        t = v.get("type")
        if t == "text":
            return len(v.get("text") or "")
        if t == "image":
            return 0
        if t == "tool_reference":
            return 64
        return len(json.dumps(v, ensure_ascii=False))
    return 0


def image_count(v) -> int:
    if isinstance(v, list):
        return sum(image_count(x) for x in v)
    if isinstance(v, dict):
        return 1 if v.get("type") == "image" else 0
    return 0


class Item:
    """Something that entered the context between two requests. Size only."""
    __slots__ = ("cat", "name", "chars", "images", "tuid", "tok", "tag", "skill", "cw", "cr", "reqs",
                 "counted", "phash", "last_use")

    def __init__(self, cat, name, chars, images=0, tuid=""):
        self.cat, self.name, self.chars, self.images, self.tuid = cat, name, chars, images, tuid
        self.tok = 0.0
        self.tag = "estimated"
        self.skill = "(none)"
        self.cw = 0.0
        self.cr = 0.0
        self.reqs = 0
        self.counted = False
        self.phash = ""
        self.last_use = 0


class ToolUse:
    __slots__ = ("id", "name", "ihash", "skill", "bash", "phash", "path")

    def __init__(self, id_, name, ihash, skill="", bash="", phash="", path=""):
        self.id, self.name, self.ihash, self.skill, self.bash, self.phash, self.path = id_, name, ihash, skill, bash, phash, path


class ReqRec:
    __slots__ = ("key", "ts", "t", "model", "fast", "i", "o", "think", "cr", "w5", "w1", "arrivals", "tools",
                 "skill_attr", "compact", "human", "miss_reason", "counted", "dup", "web")

    def __init__(self):
        self.arrivals: List[Item] = []
        self.tools: List[ToolUse] = []
        self.skill_attr = ""
        self.compact = None
        self.human = False
        self.miss_reason = ""
        self.counted = False
        self.dup = False
        self.web = 0

    @property
    def ctx(self) -> int:
        return self.i + self.cr + self.w5 + self.w1


class Trace:
    """One request chain: a main session, or one sub-agent."""

    def __init__(self, session: str, agent: str):
        self.session, self.agent = session, agent
        self.reqs: List[ReqRec] = []
        self.index: Dict[str, ReqRec] = {}
        self.cwd = ""
        self.entrypoint = ""
        self.pending: List[Item] = []
        self.pending_compact = None
        self.pending_human = False
        self.tool_by_id: Dict[str, ToolUse] = {}
        self.item_by_tuid: Dict[str, Item] = {}
        self.sidechain = False
        self.first_ts = ""
        self.skip_rest = False
        self.attachments_unrendered = 0


def _usage_int(u, k):
    v = u.get(k)
    return v if isinstance(v, int) and v > 0 else 0


def parse_lines(lines: Iterable[bytes], source: str, cov: Coverage, cfg: dict, want_project=None,
                default_agent: str = "", cost_states: Optional[dict] = None):
    """Yield finished Traces. ``want_project(label)->bool`` lets a file be dropped early."""
    traces: Dict[tuple, Trace] = {}
    env = cfg["envelope_chars"]
    for raw in lines:
        cov.line(source)
        if not raw.strip():
            continue
        if raw.startswith(SKIP_PREFIX):
            cov.skip(source, "content_echo_record")
            continue
        try:
            d = json.loads(raw)
        except ValueError:
            cov.skip(source, "bad_json")
            continue
        if not isinstance(d, dict):
            cov.skip(source, "not_an_object")
            continue
        rtype = d.get("type")
        if rtype in KNOWN_IGNORED:
            cov.skip(source, "ignored_type:" + rtype)
            continue
        if rtype == "cost-state":
            if cost_states is not None and isinstance(d.get("sessionId"), str):
                cost_states[d["sessionId"]] = d
            cov.skip(source, "cost_state_record_read")
            continue
        if rtype not in ("assistant", "user", "attachment", "system"):
            cov.unknown(source, rtype if isinstance(rtype, str) else "<none>")
            continue
        sid = d.get("sessionId") or d.get("session_id") or ""
        aid = d.get("agentId") or default_agent or ""
        if not isinstance(sid, str) or not isinstance(aid, str):
            cov.skip(source, "bad_ids")
            continue
        tr = traces.get((sid, aid))
        if tr is None:
            tr = traces[(sid, aid)] = Trace(sid, aid)
            tr.sidechain = bool(d.get("isSidechain")) or bool(aid)
        if tr.skip_rest:
            cov.skip(source, "project_filter")
            continue
        if not tr.cwd and isinstance(d.get("cwd"), str):
            tr.cwd = d["cwd"]
            tr.entrypoint = d.get("entrypoint") if isinstance(d.get("entrypoint"), str) else ""
            if want_project is not None and not want_project(project_label(tr.cwd)):
                tr.skip_rest = True
                cov.skip(source, "project_filter")
                continue
        ts = d.get("timestamp")
        if not tr.first_ts and isinstance(ts, str):
            tr.first_ts = ts
        if rtype == "assistant":
            _assistant(d, tr, cov, source)
        elif rtype == "user":
            _user(d, tr, cov, source, cfg)
        elif rtype == "attachment":
            _attachment(d, tr, raw, env, cov, source)
        else:
            _system(d, tr, cov, source)
    for key in sorted(traces):
        tr = traces[key]
        if tr.skip_rest and not tr.reqs:
            continue
        cov.session(source, key[0] + ("/" + key[1] if key[1] else ""))
        yield tr


def _assistant(d, tr: Trace, cov, source):
    msg = d.get("message")
    if not isinstance(msg, dict):
        cov.skip(source, "assistant_without_message")
        return
    usage = msg.get("usage")
    model = msg.get("model")
    if not isinstance(usage, dict) or not isinstance(model, str):
        cov.skip(source, "assistant_without_usage")
        return
    if model.startswith("<") or model == "":
        cov.skip(source, "synthetic_message")
        return
    mid = msg.get("id") if isinstance(msg.get("id"), str) else ""
    rid = d.get("requestId") if isinstance(d.get("requestId"), str) else ""
    key = (mid + "|" + rid) if (mid or rid) else "uuid:" + str(d.get("uuid"))
    new = key not in tr.index
    if new:
        r = ReqRec()
        r.key = key
        r.ts = norm_ts(d.get("timestamp") or "")
        r.t = epoch(d.get("timestamp") or "")
        r.model = model
        r.fast = usage.get("speed") == "fast"
        r.i = r.o = r.think = r.cr = r.w5 = r.w1 = 0
        r.arrivals = tr.pending
        tr.pending = []
        r.compact, tr.pending_compact = tr.pending_compact, None
        r.human, tr.pending_human = tr.pending_human, False
        diag = msg.get("diagnostics")
        if isinstance(diag, dict) and isinstance(diag.get("cache_miss_reason"), dict):
            t = diag["cache_miss_reason"].get("type")
            r.miss_reason = t if isinstance(t, str) and NAME_OK.match(t) else ""
        tr.index[key] = r
        tr.reqs.append(r)
    else:
        cov.note("repeated_response_lines_merged")
        r = tr.index[key]
    r.i = max(r.i, _usage_int(usage, "input_tokens"))
    r.o = max(r.o, _usage_int(usage, "output_tokens"))
    det = usage.get("output_tokens_details")
    if isinstance(det, dict):
        r.think = max(r.think, _usage_int(det, "thinking_tokens"))
    r.cr = max(r.cr, _usage_int(usage, "cache_read_input_tokens"))
    total_w = _usage_int(usage, "cache_creation_input_tokens")
    cc = usage.get("cache_creation")
    w5 = w1 = 0
    if isinstance(cc, dict):
        w5, w1 = _usage_int(cc, "ephemeral_5m_input_tokens"), _usage_int(cc, "ephemeral_1h_input_tokens")
    if w5 + w1 < total_w:
        w5 += total_w - (w5 + w1)
    r.w5, r.w1 = max(r.w5, w5), max(r.w1, w1)
    stu = usage.get("server_tool_use")
    if isinstance(stu, dict):
        r.web = max(r.web, _usage_int(stu, "web_search_requests"))
    sk = d.get("attributionSkill")
    if isinstance(sk, str) and IDENT.match(sk) and not r.skill_attr:
        r.skill_attr = sk
    content = msg.get("content")
    if isinstance(content, list):
        known = {t.id for t in r.tools}
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_use" and isinstance(b.get("name"), str):
                tid = b.get("id") if isinstance(b.get("id"), str) else ""
                if tid in known:
                    continue
                inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                name = b["name"] if NAME_OK.match(b["name"]) else "<other-tool>"
                skill = bash = phash = path = ""
                if name == "Skill":
                    s = inp.get("skill")
                    skill = s if isinstance(s, str) and IDENT.match(s) else "<other-skill>"
                elif name == "Bash":
                    c = inp.get("command")
                    first = c.split(None, 1)[0] if isinstance(c, str) and c.strip() else ""
                    first = first.rsplit("/", 1)[-1]
                    bash = first if BASH_WORD.match(first) else ("<env-assign>" if "=" in first else "<other>")
                fp = inp.get("file_path") or inp.get("path") or inp.get("notebook_path")
                if isinstance(fp, str):
                    phash = hashlib.blake2b(fp.encode("utf-8", "replace"), digest_size=6).hexdigest()
                    path = fp
                tu = ToolUse(tid, name, digest([name, inp]), skill, bash, phash, path)
                r.tools.append(tu)
                if tid:
                    tr.tool_by_id[tid] = tu


def _user(d, tr: Trace, cov, source, cfg):
    msg = d.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    meta = bool(d.get("isMeta"))
    origin = d.get("origin")
    okind = origin.get("kind") if isinstance(origin, dict) else ""
    if d.get("isCompactSummary"):
        return  # sized through the compact_boundary record, not as an item
    ratio_img = cfg["image_tokens_each"] * cfg["chars_per_token"]
    if isinstance(content, str):
        chars, imgs, results, texts = len(content), 0, [], 1
    elif isinstance(content, list):
        results, chars, imgs, texts = [], 0, 0, 0
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                tid = b.get("tool_use_id") if isinstance(b.get("tool_use_id"), str) else ""
                results.append((tid, text_len(b.get("content")), image_count(b.get("content"))))
            elif b.get("type") == "text":
                chars += len(b.get("text") or "")
                texts += 1
            elif b.get("type") == "image":
                imgs += 1
    else:
        cov.skip(source, "user_without_content")
        return
    for tid, c, im in results:
        tu = tr.tool_by_id.get(tid)
        it = Item("tool_result", tu.name if tu else "(unknown_tool)", c + int(im * ratio_img), im, tid)
        if tu:
            it.phash = tu.phash
        tr.pending.append(it)
        if tid:
            tr.item_by_tuid[tid] = it
    if chars or imgs:
        if meta:
            tr.pending.append(Item("injected", "user_meta", chars + int(imgs * ratio_img)))
        elif okind == "task-notification":
            tr.pending.append(Item("injected", "task_notification", chars))
        else:
            tr.pending.append(Item("user_prompt", "human", chars + int(imgs * ratio_img)))
            tr.pending_human = True


def _attachment(d, tr: Trace, raw: bytes, env: int, cov, source):
    a = d.get("attachment")
    atype = a.get("type") if isinstance(a, dict) else None
    if not isinstance(atype, str) or not NAME_OK.match(atype):
        atype = "<other>"
    rendered = d.get("rendered")
    if not rendered and not d.get("renderedInHumanTurn"):
        tr.attachments_unrendered += 1
        cov.skip(source, "attachment_not_rendered_into_context")
        return
    size = len(json.dumps(rendered, ensure_ascii=False)) if rendered else max(0, len(raw) - env)
    tr.pending.append(Item("injected", atype, size))


def _system(d, tr: Trace, cov, source):
    st = d.get("subtype")
    if st == "compact_boundary":
        cm = d.get("compactMetadata") if isinstance(d.get("compactMetadata"), dict) else {}
        pre, post = cm.get("preTokens"), cm.get("postTokens")
        trig = cm.get("trigger") if isinstance(cm.get("trigger"), str) and NAME_OK.match(cm.get("trigger")) else "unknown"
        tr.pending_compact = (pre if isinstance(pre, int) else None, post if isinstance(post, int) else None, trig)
        tr.pending = []  # the old context is gone; what is queued now belongs to the new one
    elif st in ("turn_duration", "away_summary", "informational", "local_command", "stop_hook_summary",
                "api_error", "bridge_status", "scheduled_task_fire", "memory_saved", "hook"):
        cov.skip(source, "system_subtype:" + st)
    else:
        cov.unknown(source, "system/" + (st if isinstance(st, str) else "<none>"))
