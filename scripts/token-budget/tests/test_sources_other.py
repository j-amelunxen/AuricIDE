"""Tests for tokenbudget.sources_other. Every fixture is made up and built in a temp dir."""
import io
import json
import os
import sqlite3
import tarfile
import tempfile
import unittest

from tokenbudget.model import Coverage
from tokenbudget import sources_other as so

CANARY = "CANARY-7f3a91-do-not-leak"


class FakeBook:
    def __init__(self, priced=("model-a",)):
        self.priced = priced

    def cost(self, model, day, inp, out, cread, w5, w1, fast=False):
        if model not in self.priced:
            return None
        return (inp * 1 + out * 2 + cread * 0.1 + w5 * 1.25) / 1e6


def wj(path, obj, text=None):
    with open(path, "w") as fh:
        if text is None:
            json.dump(obj, fh)
        else:
            fh.write(text)


def jl(path, rows, raw_extra=()):
    with open(path, "wb") as fh:
        for r in rows:
            fh.write(json.dumps(r).encode() + b"\n")
        for r in raw_extra:
            fh.write(r)


def usage(i, c=0, o=0, r=0, w=0):
    return {"input_tokens": i, "cached_input_tokens": c, "cache_write_input_tokens": w,
            "output_tokens": o, "reasoning_output_tokens": r, "total_tokens": i + o}


def tc(ts, ordinal, total=None, last=None):
    info = {}
    if total is not None:
        info["total_token_usage"] = total
    if last is not None:
        info["last_token_usage"] = last
    return {"type": "event_msg", "timestamp": ts, "ordinal": ordinal,
            "payload": {"type": "token_count", "info": info}}


def meta(ordinal=0, **kw):
    p = {"id": "sess-1", "cwd": "/fake/root/demo-proj.auric-wt", "timestamp": "2026-01-01T00:00:00Z"}
    p.update(kw)
    return {"type": "session_meta", "timestamp": "2026-01-01T00:00:00Z", "ordinal": ordinal, "payload": p}


def turn(ordinal, model):
    return {"type": "turn_context", "timestamp": "2026-01-01T00:00:01Z", "ordinal": ordinal,
            "payload": {"model": model, "cwd": "/fake/root/x"}}


def text_item(ordinal):
    return {"type": "response_item", "timestamp": "2026-01-01T00:00:01Z", "ordinal": ordinal,
            "payload": {"type": "message", "content": [{"text": CANARY}]}}


class Base(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.tmp = self._td.name
        self.cov = Coverage()


class CodexTests(Base):
    def run_file(self, rows, seen=None, book=None, extra=()):
        p = os.path.join(self.tmp, "r%d.jsonl" % len(os.listdir(self.tmp)))
        jl(p, rows, extra)
        return list(so.iter_codex_requests(p, self.cov, set() if seen is None else seen,
                                           book or FakeBook()))

    def test_basic_semantics_and_dedupe_of_repeat(self):
        u1 = usage(100, c=60, o=20, r=5)
        rows = [meta(), turn(1, "model-a"), text_item(2),
                tc("2026-01-01T10:00:00.1234Z", 3, total=u1, last=u1),
                tc("2026-01-01T10:00:01Z", 4, total=u1, last=u1),  # repeat
                tc("2026-01-01T10:00:02+01:00", 5, total=usage(150, 70, 40, 5), last=usage(50, 10, 20))]
        reqs = self.run_file(rows)
        self.assertEqual(len(reqs), 2)
        r = reqs[0]
        self.assertEqual((r.input, r.cache_read, r.output, r.reasoning), (40, 60, 20, 5))
        self.assertEqual(r.ts, "2026-01-01T10:00:00.123Z")
        self.assertEqual((r.model, r.role, r.project, r.agent, r.session, r.source),
                         ("model-a", "interactive", "demo-proj", "", "sess-1", "codex"))
        self.assertAlmostEqual(r.cost, (40 + 40 + 6) / 1e6)
        self.assertEqual(reqs[1].ts, "2026-01-01T09:00:02.000Z")
        self.assertEqual(self.cov.skipped[("codex", "duplicate_token_count")], 1)

    def test_forked_history_skipped_and_subagent_fields(self):
        u = usage(10, 0, 5)
        rows = [meta(parent_thread_id="parent-9", agent_role="worker", id="child-1",
                     subagent_history_start_ordinal=3),
                turn(1, "model-a"),
                tc("2026-01-01T10:00:00Z", 2, total=u, last=u),         # copied history
                tc("2026-01-01T10:05:00Z", 3, total=usage(20, 0, 10), last=u)]
        reqs = self.run_file(rows)
        self.assertEqual(len(reqs), 1)
        self.assertEqual((reqs[0].role, reqs[0].agent, reqs[0].session),
                         ("subagent", "child-1", "parent-9"))
        self.assertEqual(self.cov.skipped[("codex", "forked_history")], 1)

    def test_delta_fallback_when_only_totals(self):
        rows = [meta(), turn(1, "model-a"),
                tc("2026-01-01T10:00:00Z", 2, total=usage(100, 0, 10)),
                tc("2026-01-01T10:00:05Z", 3, total=usage(250, 100, 30))]
        reqs = self.run_file(rows)
        self.assertEqual([(r.input, r.cache_read, r.output) for r in reqs], [(100, 0, 10), (50, 100, 20)])

    def test_unpriced_model_cost_none_and_unknown_fallback(self):
        u = usage(10, 0, 5)
        reqs = self.run_file([meta(), turn(1, "mystery"), tc("2026-01-01T10:00:00Z", 2, total=u, last=u)])
        self.assertIsNone(reqs[0].cost)
        reqs = self.run_file([meta(), tc("2026-01-01T11:00:00Z", 2, total=u, last=u)])
        self.assertEqual(reqs[0].model, "unknown")

    def test_seen_across_files(self):
        u = usage(10, 0, 5)
        rows = [meta(), turn(1, "model-a"), tc("2026-01-01T10:00:00Z", 2, total=u, last=u)]
        seen = set()
        self.assertEqual(len(self.run_file(rows, seen)), 1)
        self.assertEqual(len(self.run_file(rows, seen)), 0)
        self.assertEqual(len(seen), 1)

    def test_records_shadow_token_count_events(self):
        u = usage(10, 4, 5)
        rec = {"type": "token_usage_record", "timestamp": "2026-01-01T10:00:00.5Z", "ordinal": 3,
               "payload": {"response_id": "resp-1", "usage": u, "thread_token_usage": u}}
        rows = [meta(), turn(1, "model-a"), tc("2026-01-01T10:00:00Z", 2, total=u, last=u), rec, dict(rec)]
        reqs = self.run_file(rows)
        self.assertEqual(len(reqs), 1)
        self.assertEqual((reqs[0].input, reqs[0].cache_read), (6, 4))

    def test_bad_lines_unknown_types_and_no_usage(self):
        u = usage(10, 0, 5)
        rows = [meta(), turn(1, "model-a"), {"type": "weird_new_type", "ordinal": 2, "payload": {}},
                {"type": "event_msg", "ordinal": 3, "timestamp": "2026-01-01T10:00:00Z",
                 "payload": {"type": "token_count", "info": None}},
                tc("2026-01-01T10:00:01Z", 4, total=u, last=u)]
        reqs = self.run_file(rows, extra=[b"{not json\n", b"[1,2]\n", b"\n"])
        self.assertEqual(len(reqs), 1)
        self.assertEqual(self.cov.skipped[("codex", "bad_json")], 1)
        self.assertEqual(self.cov.skipped[("codex", "no_usage")], 1)
        self.assertEqual(self.cov.unknown_types[("codex", "weird_new_type")], 1)

    def test_canary_never_in_output(self):
        u = usage(10, 0, 5)
        rows = [meta(cwd="/fake/%s/proj" % "demo"), turn(1, "model-a"), text_item(2),
                tc("2026-01-01T10:00:00Z", 3, total=u, last=u)]
        reqs = self.run_file(rows)
        self.assertNotIn(CANARY, repr([vars(r) if hasattr(r, "__dict__") else r for r in reqs]))
        self.assertNotIn(CANARY, repr(reqs))
        self.assertNotIn(CANARY, repr(self.cov.__dict__))


class DbTests(Base):
    def make_project(self, name, wal=False, with_table=True):
        d = os.path.join(self.tmp, name)
        os.makedirs(os.path.join(d, ".auric"))
        conn = sqlite3.connect(os.path.join(d, ".auric", "project.db"))
        if wal:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA wal_autocheckpoint=0")
        if with_table:
            conn.execute("CREATE TABLE pm_agent_usage (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, "
                         "started_at TEXT NOT NULL, input_tokens INTEGER, note_text TEXT)")
            conn.execute("INSERT INTO pm_agent_usage VALUES ('b','ag1','2026-01-02',5,?)", (CANARY,))
            conn.execute("INSERT INTO pm_agent_usage VALUES ('a','ag2','2026-01-02',7,?)", (CANARY,))
            conn.execute("INSERT INTO pm_agent_usage VALUES ('c','ag3','2026-01-01',9,?)", (CANARY,))
            conn.commit()
        return d, conn

    def test_wal_db_copied_not_opened_in_place(self):
        d, conn = self.make_project("alpha.auric-wt", wal=True)
        self.addCleanup(conn.close)
        adir = os.path.join(d, ".auric")
        self.assertTrue(os.path.exists(os.path.join(adir, "project.db-wal")))
        before = {n: (os.path.getsize(os.path.join(adir, n)), os.stat(os.path.join(adir, n)).st_mtime_ns)
                  for n in os.listdir(adir)}
        rows = so.read_agent_usage([d], self.cov)
        after = {n: (os.path.getsize(os.path.join(adir, n)), os.stat(os.path.join(adir, n)).st_mtime_ns)
                 for n in os.listdir(adir)}
        self.assertEqual(before, after)
        self.assertEqual([r["id"] for r in rows], ["c", "a", "b"])  # started_at, then id
        self.assertEqual(rows[0]["project"], "alpha")
        self.assertNotIn(self.tmp, repr(rows))
        self.assertEqual(rows[0]["input_tokens"], 9)  # data lived only in the WAL

    def test_missing_table_and_missing_db(self):
        d, conn = self.make_project("beta", with_table=False)
        conn.close()
        self.assertEqual(so.read_agent_usage([d, os.path.join(self.tmp, "nope")], self.cov), [])
        self.assertEqual(self.cov.skipped[("agent_usage", "no_table")], 1)
        self.assertEqual(self.cov.skipped[("agent_usage", "db_missing")], 1)

    def test_discover(self):
        app = os.path.join(self.tmp, "app")
        os.makedirs(app)
        d1, c1 = self.make_project("p1")
        d2, c2 = self.make_project("p2")
        c1.close()
        c2.close()
        gone = os.path.join(self.tmp, "gone")
        wj(os.path.join(app, "recent-projects.json"), {"projects": [{"path": d2}, {"path": gone}]})
        wj(os.path.join(app, "starred-projects.json"), {"projects": [{"path": d1}, {"path": d2}]})
        wj(os.path.join(app, "supervisor-policy.json"), None, "{broken")
        self.assertEqual(so.discover_project_dbs(app, self.cov), sorted([d1, d2]))
        wj(os.path.join(app, "supervisor-policy.json"), {"projects": {d1: {}, gone: {}}})
        self.assertEqual(so.discover_project_dbs(app, self.cov), sorted([d1, d2]))
        self.assertGreaterEqual(self.cov.skipped[("projects", "unreadable_json")], 1)


class TaskLogTests(Base):
    def test_labels_and_no_free_text(self):
        d = os.path.join(self.tmp, "logs")
        os.makedirs(d)
        row = {"title": CANARY, "name": CANARY, "cwd": "/fake/" + CANARY, "projectPath": "/fake/zeta.auric-wt",
               "agentId": "a1", "role": "worker", "provider": "p", "model": "m", "status": "done",
               "startedAt": "2026-01-02T00:00:00Z", "finishedAt": "2026-01-02T00:01:00Z", "durationMs": 60000,
               "costUsd": 0.5, "inputTokens": 3, "outputTokens": 4, "cacheReadTokens": 1}
        early = dict(row, agentId="a0", startedAt="2026-01-01T00:00:00Z")
        jl(os.path.join(d, "tasks-2026-01.jsonl"), [row, early], raw_extra=[b"oops\n"])
        out = so.read_task_logs(d, self.cov)
        self.assertEqual([r["agentId"] for r in out], ["a0", "a1"])
        self.assertEqual(out[0]["project"], "zeta")
        self.assertNotIn(CANARY, repr(out))
        self.assertNotIn("/fake", repr(out))
        self.assertEqual(self.cov.skipped[("task_log", "bad_json")], 1)

    def test_missing_dir(self):
        self.assertEqual(so.read_task_logs(os.path.join(self.tmp, "nope"), self.cov), [])
        self.assertEqual(self.cov.notes["task_log_dir_missing"], 1)


def make_tgz(path, members):
    with tarfile.open(path, "w:gz") as tf:
        for name, data in members:
            if data is None:
                ti = tarfile.TarInfo(name)
                ti.type = tarfile.DIRTYPE
                tf.addfile(ti)
                continue
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))


class SandboxTests(Base):
    def make_state(self):
        st = os.path.join(self.tmp, "state")
        u = os.path.join(st, "usage")
        os.makedirs(u)
        doc = {"lease": "lease-1", "box": "box-1", "project": "demo", "worker": "w1", "owner": CANARY,
               "agent_runs": {"200": {"active_seconds": 5.5}, "100": {"active_seconds": 3}},
               "browser_use": {"total_usd": 1.5, "source": CANARY, "over_limit": False},
               "runs": {"s-2": {"cost_usd": 0.2, "messages": 4, "subagent_messages": 1, "day": "2026-01-02",
                                 "models": {"model-a": {"input_tokens": 1, "output_tokens": 2,
                                                         "cache_read_tokens": 3, "cache_write_tokens": 4,
                                                         "cost_usd": 0.1}},
                                 "tool_uses": {"Bash": 3}, "skills_invoked": {"demo-skill": 2},
                                 "clocks": {"transcript_span_seconds": 9, "cli_api_ms": None}},
                        "s-1": {"cost_usd": None, "messages": 1, "models": {}, "tool_uses": None}}}
        wj(os.path.join(u, "lease-1.json"), doc)
        wj(os.path.join(u, "lease-2.json"), {"lease": "lease-2", "runs": {}})
        make_tgz(os.path.join(u, "lease-1.transcripts.tgz"),
                 [("a/one.jsonl", b'{"x":1}\n{"x":2}\n'), ("a/two.jsonl", b"{}\n"), ("a/readme.txt", b"hi"),
                  ("dir", None)])
        return st

    def test_usage_and_survival(self):
        st = self.make_state()
        leases = so.read_sandboxctl_usage(st, self.cov)
        self.assertEqual([l["lease"] for l in leases], ["lease-1", "lease-2"])
        l1 = leases[0]
        self.assertNotIn("owner", l1)
        self.assertNotIn(CANARY, repr(leases))
        self.assertEqual([r["session"] for r in l1["runs"]], ["s-1", "s-2"])
        self.assertEqual(l1["agent_runs"], [3, 5.5])
        self.assertEqual(l1["browser_use"], {"over_limit": False, "total_usd": 1.5})
        self.assertEqual(l1["runs"][1]["models"]["model-a"]["cache_write_tokens"], 4)
        self.assertEqual(l1["runs"][1]["tool_uses"], {"Bash": 3})
        self.assertTrue(l1["transcripts_tgz"].endswith("lease-1.transcripts.tgz"))
        self.assertIsNone(leases[1]["transcripts_tgz"])
        s = so.sandboxctl_survival(st)
        self.assertEqual((s["leases"], s["totals_only"], s["with_archive"]), (2, 1, 1))
        self.assertEqual(s["member_ext_counts"], {"<non-file>": 1, "jsonl": 2, "txt": 1})
        self.assertNotIn("one", repr(s))

    def test_tgz_streaming_no_disk_extraction(self):
        st = self.make_state()
        tgz = os.path.join(st, "usage", "lease-1.transcripts.tgz")
        before = sorted(os.listdir(self.tmp)), sorted(os.listdir(os.path.join(st, "usage")))
        got = [(i, list(lines)) for i, lines in so.iter_box_transcripts(tgz, self.cov)]
        self.assertEqual([g[0] for g in got], [0, 1])
        self.assertEqual(got[0][1], [b'{"x":1}\n', b'{"x":2}\n'])
        self.assertEqual(before, (sorted(os.listdir(self.tmp)), sorted(os.listdir(os.path.join(st, "usage")))))
        self.assertEqual(self.cov.skipped[("box", "non_jsonl_member")], 1)

    def test_unconsumed_member_is_skipped_and_unsafe_names_refused(self):
        p = os.path.join(self.tmp, "x.tgz")
        make_tgz(p, [("/abs/bad.jsonl", b"{}\n"), ("a/../../esc.jsonl", b"{}\n"),
                     ("ok/one.jsonl", b"1\n2\n"), ("ok/two.jsonl", b"3\n")])
        seen = [(i, next(lines)) for i, lines in so.iter_box_transcripts(p, self.cov)]
        self.assertEqual(seen, [(0, b"1\n"), (1, b"3\n")])
        self.assertEqual(self.cov.skipped[("box", "unsafe_member_name")], 2)

    def test_corrupt_archive_tolerated(self):
        p = os.path.join(self.tmp, "bad.tgz")
        with open(p, "wb") as fh:
            fh.write(b"not a tar at all")
        self.assertEqual(list(so.iter_box_transcripts(p, self.cov)), [])
        self.assertTrue(self.cov.errors)

    def test_missing_dir(self):
        self.assertEqual(so.read_sandboxctl_usage(os.path.join(self.tmp, "none"), self.cov), [])


if __name__ == "__main__":
    unittest.main()
