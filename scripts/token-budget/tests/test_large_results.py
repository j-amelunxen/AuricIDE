"""Classification of large tool results: classes, bands, concentration, repetition, caps."""
import csv
import json
import os
import tempfile
import unittest

from tests import fixtures
from tests.test_core import build, slurp

SID_A = "22222222-aaaa-bbbb-cccc-00000000000a"
SID_B = "22222222-aaaa-bbbb-cccc-00000000000b"
CMD = "pytest -q " + fixtures.CANARIES[2]
READ_A = {"file_path": "/work/" + fixtures.CANARIES[3] + "/a.py"}
READ_B = {"file_path": "/work/" + fixtures.CANARIES[3] + "/notes.md"}
MCP_IN = {"query": fixtures.CANARIES[1]}


def chars_for(tokens):
    return int(tokens * 3.5)


def session(root, sid, steps):
    """steps: list of (tool, input, result_tokens). One request per step, sole result in each gap."""
    proj = os.path.join(root, "-work-demo-project")
    os.makedirs(proj, exist_ok=True)
    L = [fixtures.human("2026-10-02T10:00:00.000Z")]
    carried = 100
    L.append(fixtures.assistant("2026-10-02T10:00:01.000Z", sid[-1] + "0", 10, i=5, cw=carried))
    prev_tool = None
    for n, (name, inp, tok) in enumerate(steps, start=1):
        t0 = f"2026-10-02T10:0{n}:00.000Z"
        t1 = f"2026-10-02T10:0{n}:05.000Z"
        t2 = f"2026-10-02T10:0{n}:10.000Z"
        tid = f"{sid[-1]}t{n}"
        L.append(fixtures.assistant(t0, f"{sid[-1]}a{n}", 10, i=2, cr=carried, cw=0, tools=[(tid, name, inp)]))
        L.append(fixtures.result(t1, tid, chars_for(tok)))
        carried += tok
        L.append(fixtures.assistant(t2, f"{sid[-1]}b{n}", 10, i=2, cr=carried - tok, cw=tok))
    for d in L:
        d["sessionId"] = sid
    with open(os.path.join(proj, sid + ".jsonl"), "w") as fh:
        fh.write("\n".join(json.dumps(x) for x in L) + "\n")


def rows(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


class LargeResultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        c = os.path.join(self.root, "claude")
        session(c, SID_A, [("Read", READ_A, 12000), ("Read", READ_A, 12000), ("Bash", {"command": CMD}, 34000),
                           ("mcp__demo-srv__lookup", MCP_IN, 120000), ("Read", READ_B, 600)])
        session(c, SID_B, [("Read", READ_A, 12000), ("Bash", {"command": CMD}, 34000), ("Read", READ_B, 12000)])
        self.out = os.path.join(self.root, "o")
        self.res, self.S = build(self.root, self.out)
        self.T = self.S["tables"]
        cand = {c["rule_id"]: c for c in self.T["candidates"]}
        self.rule = cand["large_tool_result"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_classes_reconcile_with_the_rule(self):
        t = self.T["large_results_by_class"]
        self.assertEqual(sum(r["count"] for r in t), self.rule["count"])
        self.assertEqual(self.rule["count"], 7)
        self.assertAlmostEqual(sum(r["tokens"] for r in t), self.rule["tokens"], places=3)
        self.assertAlmostEqual(sum(r["carry_cost_usd"] for r in t), self.rule["cost_usd"], places=4)
        self.assertAlmostEqual(sum(r["share"] for r in t), 1.0, places=4)
        names = {r["class"]: r for r in t}
        self.assertEqual(names["Read:.py"]["count"], 3)
        self.assertEqual(names["Read:.md"]["count"], 1)
        self.assertEqual(names["Bash:pytest"]["count"], 2)
        self.assertEqual(names["mcp__demo-srv__lookup"]["count"], 1)
        for r in t:
            self.assertIn(r["quality"], ("measured", "estimated"))
            self.assertLessEqual(r["avg_tokens"], r["max_tokens"])

    def test_bands_reconcile(self):
        t = self.T["large_results_size_bands"]
        tot = [r for r in t if r["class"] == "(all)"]
        self.assertEqual(sum(r["count"] for r in tot), 7)
        by = {r["band"]: r["count"] for r in tot}
        self.assertEqual(by["10k-25k"], 4)
        self.assertEqual(by["25k-50k"], 2)
        self.assertEqual(by["above 100k"], 1)
        per_class = sum(r["count"] for r in t if r["class"] != "(all)")
        self.assertEqual(per_class, 7)

    def test_concentration(self):
        m = {r["metric"]: r["value"] for r in self.T["large_results_concentration"]}
        self.assertEqual(m["distinct_classes"], 4)
        self.assertLessEqual(m["classes_for_50pct_of_cost"], m["classes_for_80pct_of_cost"])
        self.assertLessEqual(m["classes_for_80pct_of_cost"], 4)
        dims = self.T["large_results_by_dimension"]
        for d in ("project", "role", "skill"):
            sel = [r for r in dims if r["dimension"] == d]
            self.assertEqual(sum(r["count"] for r in sel), 7, d)
            self.assertAlmostEqual(sum(r["carry_cost_usd"] for r in sel), self.rule["cost_usd"], places=4)

    def test_repetition_split(self):
        t = {r["group"]: r for r in self.T["large_results_repetition"]}
        self.assertEqual(sum(r["count"] for r in t.values()), 7)
        self.assertAlmostEqual(sum(r["carry_cost_usd"] for r in t.values()), self.rule["cost_usd"], places=4)
        # A reads a.py twice in one session (2 results); B's a.py read is the same call in another session.
        self.assertEqual(t["repeated_in_same_session"]["count"], 2)
        # pytest in A and B, a.py in B, notes.md in B: seen in another session but not repeated within one.
        self.assertEqual(t["identical_in_other_sessions"]["count"], 3)
        self.assertEqual(t["unique"]["count"], 2)
        for r in t.values():
            self.assertEqual(r["quality"], "heuristic")

    def test_repeat_by_class(self):
        t = {r["class"]: r for r in self.T["large_results_repeat_by_class"]}
        py = t["Read:.py"]
        self.assertEqual(py["sessions"], 2)
        self.assertEqual(py["distinct_hashes"], 1)
        self.assertEqual(py["top_repeat_counts"], "3")
        self.assertEqual(t["Bash:pytest"]["top_repeat_counts"], "2")
        self.assertEqual(t["mcp__demo-srv__lookup"]["distinct_hashes"], 1)
        for r in t.values():
            self.assertEqual(r["same_session_repeat"] + r["other_sessions"] + r["unique"], r["count"])

    def test_caps_are_estimates(self):
        t = {r["cap_chars"]: r for r in self.T["large_results_cap_effect"]}
        self.assertEqual(sorted(t), [15000, 30000, 50000])
        self.assertEqual(t[15000]["results_above_cap"], 7)  # all large ones; the 600-token result is below
        self.assertGreaterEqual(t[15000]["results_above_cap"], t[30000]["results_above_cap"])
        self.assertGreaterEqual(t[30000]["results_above_cap"], t[50000]["results_above_cap"])
        self.assertGreaterEqual(t[15000]["carry_cost_usd"], t[50000]["carry_cost_usd"])
        self.assertEqual(t[50000]["results_above_cap"], 3)
        for r in t.values():
            self.assertEqual(r["quality"], "estimated")
            self.assertLessEqual(r["cost_removed_by_cap_usd"], r["carry_cost_usd"])

    def test_no_value_reaches_the_output(self):
        for f in sorted(os.listdir(self.out)):
            data = slurp(os.path.join(self.out, f), "rb")
            for c in fixtures.CANARIES:
                self.assertNotIn(c.encode(), data, f)
        md = slurp(os.path.join(self.out, "report.md"), "r")
        self.assertIn("Large tool results", md)
        for name in ("large_results_by_class", "large_results_repetition", "large_results_cap_effect"):
            self.assertTrue(os.path.exists(os.path.join(self.out, name + ".csv")))

    def test_deterministic(self):
        out2 = os.path.join(self.root, "o2")
        build(self.root, out2)
        for f in sorted(os.listdir(self.out)):
            self.assertEqual(slurp(os.path.join(self.out, f)), slurp(os.path.join(out2, f)), f)


if __name__ == "__main__":
    unittest.main()
