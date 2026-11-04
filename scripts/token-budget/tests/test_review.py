"""Review round: one failing test per defect found or reported, written before the fix."""
import json
import os
import subprocess
import tempfile
import unittest
from types import SimpleNamespace

from tokenbudget import claude, report
from tokenbudget.aggregate import Agg
from tests import fixtures
from tests.test_core import build

A = fixtures.assistant
SID2 = "22222222-aaaa-bbbb-cccc-000000000002"


def write_lines(root, sid, lines, cwd=fixtures.CWD):
    proj = os.path.join(root, "claude", "-work-demo-project")
    os.makedirs(proj, exist_ok=True)
    out = []
    for d in lines:
        d = dict(d)
        d["sessionId"] = sid
        d["cwd"] = cwd
        out.append(json.dumps(d))
    with open(os.path.join(proj, sid + ".jsonl"), "w") as fh:
        fh.write("\n".join(out) + "\n")


class BashWordTests(unittest.TestCase):
    def test_wrappers_are_skipped(self):
        f = claude.bash_first_word
        self.assertEqual(f("cd /x/scratchpad && git status"), "git")
        self.assertEqual(f('cd "a b" && cd c; sudo -n ls -la'), "ls")
        self.assertEqual(f("FOO=1 BAR=2 pnpm test"), "pnpm")
        self.assertEqual(f("cd a && export X=1 && node x.js"), "node")
        self.assertEqual(f("/usr/bin/env FOO=1 python3 x.py"), "python3")
        self.assertEqual(f("(cd a && ls)"), "ls")
        self.assertEqual(f("timeout 30 nice -n 5 cargo build"), "cargo")
        self.assertEqual(f("cd /only/a/dir"), "cd")
        self.assertEqual(f("   "), "")
        self.assertEqual(f("a" * 40 + " x"), "<other>")
        self.assertEqual(f("FOO=1"), "<env-assign>")


class SlashTests(unittest.TestCase):
    def test_slash_name_only(self):
        f = claude.slash_command
        self.assertEqual(f("<command-message>x</command-message>\n<command-name>/demo-cmd</command-name>\n<command-args>SECRET</command-args>"), "demo-cmd")
        self.assertEqual(f("/other-cmd some SECRET words"), "other-cmd")
        self.assertEqual(f("/plugin:thing"), "plugin:thing")
        self.assertEqual(f("/etc/passwd is odd"), "")
        self.assertEqual(f("hello /x"), "")

    def test_opening_slash_prompt_opens_a_phase_and_leaks_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            L = [fixtures.human("2026-10-01T10:00:00.000Z", "/demo-cmd " + fixtures.CANARIES[0]),
                 A("2026-10-01T10:00:01.000Z", "a", 10, i=10, cw=2000),
                 A("2026-10-01T10:00:05.000Z", "b", 10, i=5, cr=2000, cw=50),
                 fixtures.human("2026-10-01T10:01:00.000Z", "/clear"),
                 A("2026-10-01T10:01:05.000Z", "c", 10, i=5, cr=2050, cw=50)]
            write_lines(root, fixtures.SID, L)
            out = os.path.join(root, "o")
            res, S = build(root, out)
            rows = {r["bucket"]: r for r in S["tables"]["skill"]}
            self.assertEqual(rows["demo-cmd"]["requests"], 2)
            self.assertEqual(rows["(none)"]["requests"], 1)      # /clear is not a skill
            for n in os.listdir(out):
                with open(os.path.join(out, n)) as fh:
                    self.assertNotIn("CANARY", fh.read())


class ProjectTests(unittest.TestCase):
    def tearDown(self):
        claude.configure_projects(None)

    def test_patterns(self):
        f = claude.project_label
        self.assertEqual(f("/h/WebstormProjects/proj-a/backend"), "proj-a")
        self.assertEqual(f("/h/WebstormProjects/proj-a/app/src"), "proj-a")
        self.assertEqual(f("/h/WebstormProjects/open-source/proj-b/web"), "proj-b")
        self.assertEqual(f("/h/Other/proj-c/.claude/worktrees/wt-9"), "proj-c")
        self.assertEqual(f("/h/Other/proj-c/.worktrees/wt-9/sub"), "proj-c")
        self.assertEqual(f("/h/WebstormProjects/proj-b.auric-wt/feat-1/sub"), "proj-b")
        self.assertEqual(f("/h/.auric/supervisors/x"), "(supervisor)")
        self.assertEqual(f("/elsewhere/leaf"), "leaf")

    def test_local_map_wins_and_is_optional(self):
        claude.configure_projects({"prefixes": {"/h/Work/area": "Group"}, "aliases": {"wt-1": "Group"}})
        self.assertEqual(claude.project_label("/h/Work/area/deep/er"), "Group")
        self.assertEqual(claude.project_label("/q/wt-1"), "Group")
        self.assertEqual(claude.project_label("/h/WebstormProjects/proj-a/backend"), "proj-a")

    def test_git_root_from_a_worktree_folder(self):
        with tempfile.TemporaryDirectory() as t:
            main = os.path.join(t, "main-repo")
            os.makedirs(main)
            subprocess.run(["git", "init", "-q", main], check=True)
            subprocess.run(["git", "-C", main, "-c", "user.email=a@b", "-c", "user.name=n", "commit", "-q",
                            "--allow-empty", "-m", "x"], check=True)
            wt = os.path.join(t, "random-wt-name")
            subprocess.run(["git", "-C", main, "worktree", "add", "-q", wt, "-b", "side"], check=True)
            os.makedirs(os.path.join(wt, "sub"))
            self.assertEqual(claude.project_label(os.path.join(wt, "sub")), "main-repo")
            os.makedirs(os.path.join(main, "backend"))
            self.assertEqual(claude.project_label(os.path.join(main, "backend")), "main-repo")


class ReviewReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_idle_gap_uses_the_lifetime_of_the_cache_in_force(self):
        L = [fixtures.human("2026-10-01T10:00:00.000Z"),
             A("2026-10-01T10:00:01.000Z", "a", 10, i=10, w1h=5000),
             A("2026-10-01T10:00:11.000Z", "b", 10, i=5, cr=5000),               # read only: refreshes the 1h entry
             A("2026-10-01T10:10:11.000Z", "c", 10, i=5, w1h=5100),              # 600 s later, cache lost, not idle
             A("2026-10-01T11:30:00.000Z", "d", 10, i=5, cr=0, cw=5200)]         # >1h later: idle
        write_lines(self.root, fixtures.SID, L)
        S5 = [fixtures.human("2026-10-02T10:00:00.000Z"),
              A("2026-10-02T10:00:01.000Z", "e", 10, i=10, cw=5000),
              A("2026-10-02T10:20:01.000Z", "f", 10, i=5, cw=5100)]             # 5m cache, 1200 s: idle
        write_lines(self.root, SID2, S5)
        res, S = build(self.root, os.path.join(self.root, "o"))
        reasons = sorted((m["reason"], m["count"]) for m in S["tables"]["cache_misses"])
        self.assertEqual(reasons, [("idle_gap", 1), ("idle_gap", 1), ("other", 1)])
        rows = {(r["role"], r["lifetime"]): r for r in S["budget_view"]["idle_gap_by_role_lifetime"]}
        self.assertEqual(rows[("interactive", "1h")]["count"], 1)
        self.assertEqual(rows[("interactive", "5m")]["count"], 1)
        paused = S["budget_view"]["resumed_after_pause"]
        self.assertEqual(paused[0]["count"], 1)    # only the >1h gap

    def test_share_of_cost_above_the_context_line_per_role(self):
        L = [fixtures.human("2026-10-01T10:00:00.000Z"),
             A("2026-10-01T10:00:01.000Z", "a", 10, i=10, cw=250000),
             A("2026-10-01T10:00:11.000Z", "b", 10, i=5, cr=250000, cw=100),
             A("2026-10-01T10:00:21.000Z", "c", 10, i=5, cr=250100, cw=100)]
        write_lines(self.root, fixtures.SID, L)
        res, S = build(self.root, os.path.join(self.root, "o"))
        row = S["budget_view"]["context_over_line_by_role"][0]
        self.assertEqual((row["role"], row["requests"], row["requests_over_line"]), ("interactive", 3, 3))
        self.assertEqual(row["line_tokens"], 200000)
        self.assertAlmostEqual(row["share_over_line"], 1.0, places=6)

    def test_activity_is_renamed_and_the_rule_is_stated(self):
        write_lines(self.root, fixtures.SID, [fixtures.human("2026-10-01T10:00:00.000Z"),
                                              A("2026-10-01T10:00:01.000Z", "a", 10, i=10, cw=2000)])
        out = os.path.join(self.root, "o")
        res, S = build(self.root, out)
        self.assertNotIn("activity", S["tables"])
        self.assertIn("request_tool_group", S["tables"])
        self.assertIn("request_tool_group", S["budget_view"])
        with open(os.path.join(out, "report.md")) as fh:
            md = fh.read()
        self.assertIn("not the cost of the tool's work", md)

    def test_duplicate_request_in_two_traces_of_one_file_is_counted_once(self):
        main = A("2026-10-01T10:00:01.000Z", "a", 10, i=10, cw=2000)
        copy = dict(main)
        copy["agentId"], copy["isSidechain"] = "agent-z", True
        write_lines(self.root, fixtures.SID, [fixtures.human("2026-10-01T10:00:00.000Z"), main, copy])
        res, S = build(self.root, os.path.join(self.root, "o"))
        self.assertEqual(S["totals"]["requests"], 1)


class ReconcileTests(unittest.TestCase):
    def test_missing_recorded_cost_is_counted_not_zeroed(self):
        agg = Agg()
        agg.session_cost.update({"s1": 2.0, "s2": 1.5})
        agg.session_tokens.update({"s1": [1, 2, 3, 4], "s2": [1, 1, 1, 1]})
        rows = [{"session_id": "s1", "id": "r1", "cost_usd": None, "provider": "p", "cost_source": "none"},
                {"session_id": "s2", "id": "r2", "cost_usd": 1.0, "provider": "p", "cost_source": "cli",
                 "input_tokens": 1, "output_tokens": 1, "cache_read_tokens": 1, "cache_write_tokens": 1},
                {"session_id": "s2", "id": "r3", "cost_usd": 0.5, "provider": "p", "cost_source": "cli",
                 "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}]
        res = SimpleNamespace(agg=agg, auric_rows=rows, cost_states={})
        R = report.reconcile(res)
        cost = R["rows"][0]
        self.assertAlmostEqual(cost["ours"], 1.5)       # s2 once, s1 left out
        self.assertAlmostEqual(cost["recorded"], 1.5)
        self.assertEqual(R["runs_without_recorded_cost"], 1)
        self.assertEqual(R["sessions_compared"], 1)


if __name__ == "__main__":
    unittest.main()
