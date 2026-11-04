import csv
import hashlib
import json
import os
import tempfile
import unittest

from tokenbudget import report
from tokenbudget.run import Options, run
from tests import fixtures

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def build(root, out, **kw):
    empty = os.path.join(root, "none")
    opts = Options(out=out, claude_root=os.path.join(root, "claude"), codex_root=empty, app_data=empty,
                   sandboxctl=empty, repo_root=REPO, **kw)
    res = run(opts)
    S = report.build(res)
    report.write_all(res, S, out)
    return res, S


def slurp(path, mode="rb"):
    with open(path, mode) as fh:
        return fh.read()


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        fixtures.write_session(os.path.join(self.root, "claude"), extra_days=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_repeated_lines_are_not_double_counted(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        # message 1 appears twice with output 20 then 50: counted once, largest output wins
        sess = [s for s in S["tables"]["sessions"] if s["agent"] == ""][0]
        self.assertEqual(sess["requests"], 9)
        outs = 50 + 40 + 60 + 30 + 25 + 20 + 15 + 10 + 10
        self.assertEqual(sess["output"], outs)
        self.assertGreater(S["coverage"]["notes"]["repeated_response_lines_merged"], 0)

    def test_every_dimension_sums_to_total_and_causes_explain_cost(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        total = S["totals"]["cost_usd"]
        self.assertGreater(total, 0)
        for dim in ("project", "session", "role", "model", "ticket", "goal", "skill", "activity", "day", "source"):
            self.assertAlmostEqual(sum(r["cost_usd"] for r in S["tables"][dim]), total, places=5, msg=dim)
            self.assertEqual(sum(r["requests"] for r in S["tables"][dim]), S["totals"]["requests"], dim)
        self.assertAlmostEqual(sum(r["cost_usd"] for r in S["budget_view"]["cause"]), total, places=5)
        self.assertLess(abs(S["budget_view"]["cause_residual_usd"]), 1e-6)

    def test_unpriced_model_keeps_tokens_not_cost(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        row = [r for r in S["tables"]["model"] if r["bucket"] == "mystery-model-9"][0]
        self.assertEqual(row["cost_usd"], 0)
        self.assertEqual(row["unpriced_requests"], 2)
        self.assertGreater(row["input"], 0)
        self.assertIn("mystery-model-9", S["unpriced_models"])

    def test_idle_gap_miss_compaction_and_measured_tool_result(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        miss = [m for m in S["tables"]["cache_misses"] if m["reason"] == "idle_gap"]
        self.assertEqual(len(miss), 1)
        self.assertEqual(miss[0]["count"], 1)
        self.assertEqual(len(S["tables"]["compactions"]), 1)
        self.assertEqual(S["tables"]["compactions"][0]["tokens_before"], 8300)
        read = [t for t in S["tables"]["tools"] if t["tool"] == "Read"][0]
        self.assertEqual(read["calls"], 3)
        self.assertGreater(read["carry_cost_usd"], 0)
        c = {(r["cause"], r["name"]): r for r in S["tables"]["cause"]}
        self.assertGreater(c[("baseline", "session_start")]["tokens_arrived"], 5000)
        self.assertIn(("cache_rewrite", "idle_gap"), c)

    def test_skill_phase_and_subagent_inherit(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        skills = {r["bucket"] for r in S["tables"]["skill"]}
        self.assertIn("demo-skill", skills)
        self.assertIn("(none)", skills)
        sub = S["tables"]["subagents"]
        self.assertEqual(len(sub), 1)
        self.assertTrue(sub[0]["parent_found"])
        self.assertTrue(0 < sub[0]["share_of_parent_total"] < 1)

    def test_candidates_and_unknown_records_visible(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        cand = {c["rule_id"]: c for c in S["tables"]["candidates"]}
        self.assertEqual(cand["repeat_file_read"]["count"], 2)       # three reads of one file -> two repeats
        self.assertEqual(cand["idle_gap_cache_miss"]["count"], 1)
        self.assertEqual(len(cand), 7)
        types = {u["type"] for u in S["coverage"]["unknown_record_types"]}
        self.assertIn("something-new", types)
        reasons = {s["reason"] for s in S["coverage"]["skipped"]}
        self.assertIn("bad_json", reasons)
        self.assertIn("attachment_not_rendered_into_context", reasons)

    def test_date_filter(self):
        res, S = build(self.root, os.path.join(self.root, "o"), until="2026-10-02")
        sess = [s for s in S["tables"]["sessions"] if s["agent"] == ""][0]
        self.assertEqual(sess["requests"], 8)
        res2, S2 = build(self.root, os.path.join(self.root, "o2"), since="2026-10-04")
        self.assertEqual(S2["totals"]["requests"], 1)
        self.assertAlmostEqual(sum(r["cost_usd"] for r in S2["tables"]["day"]), S2["totals"]["cost_usd"], places=6)

    def test_bash_word_is_short_and_plain(self):
        res, S = build(self.root, os.path.join(self.root, "o"))
        words = {r["command"] for r in S["tables"]["bash_first_word"]}
        self.assertEqual(words, {"git", "ls"})

    def test_project_filter(self):
        res, S = build(self.root, os.path.join(self.root, "o"), project="nomatch")
        self.assertEqual(S["totals"]["requests"], 0)

    def test_deterministic_bytes(self):
        a, b = os.path.join(self.root, "a"), os.path.join(self.root, "b")
        build(self.root, a)
        build(self.root, b)
        names = sorted(os.listdir(a))
        self.assertEqual(names, sorted(os.listdir(b)))
        self.assertIn("summary.json", names)
        for n in names:
            self.assertEqual(slurp(os.path.join(a, n)), slurp(os.path.join(b, n)), n)

    def test_no_content_in_any_output_and_private_mode(self):
        out = os.path.join(self.root, "o")
        build(self.root, out, paths=True)
        for n in os.listdir(out):
            data = slurp(os.path.join(out, n)).decode("utf-8", "replace")
            for c in fixtures.CANARIES:
                self.assertNotIn(c, data, n + " leaks " + c)
            self.assertEqual(os.stat(os.path.join(out, n)).st_mode & 0o077, 0, n)
        self.assertEqual(os.stat(out).st_mode & 0o077, 0)
        self.assertNotIn("/work/", slurp(os.path.join(out, "summary.json"), "r"))

    def test_inputs_are_not_modified(self):
        root = os.path.join(self.root, "claude")
        def snap():
            return {os.path.join(r, f): hashlib.sha256(slurp(os.path.join(r, f))).hexdigest()
                    for r, _, fs in os.walk(root) for f in fs}
        before = snap()
        build(self.root, os.path.join(self.root, "o"))
        self.assertEqual(before, snap())


if __name__ == "__main__":
    unittest.main()
