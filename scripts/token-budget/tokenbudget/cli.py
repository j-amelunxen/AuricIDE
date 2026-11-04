import argparse
import os
import sys

from . import report
from .run import Options, run


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="token_budget.py", description="Offline, deterministic token-budget attribution. Read-only on inputs.")
    ap.add_argument("--out", required=True, help="report directory (created, mode 0700)")
    ap.add_argument("--since"); ap.add_argument("--until"); ap.add_argument("--project", help="substring of the project label")
    ap.add_argument("--paths", action="store_true", help="also write paths.csv (file paths, local report only)")
    ap.add_argument("--config"); ap.add_argument("--claude-root"); ap.add_argument("--codex-root")
    ap.add_argument("--app-data"); ap.add_argument("--sandboxctl"); ap.add_argument("--task-log-dir")
    ap.add_argument("--project-db", action="append", help="additional project dir whose .auric/project.db to read")
    ap.add_argument("--skip", action="append", choices=["claude", "codex", "box", "auric"])
    ap.add_argument("--repo-root")
    ap.add_argument("--project-map", help="optional local JSON mapping folders to project names (kept outside the repo)")
    a = ap.parse_args(argv)
    try:
        os.nice(10)
    except (OSError, AttributeError):
        pass
    kw = {k: v for k, v in vars(a).items() if v is not None and k != "project_db"}
    kw["project_db"] = a.project_db
    res = run(Options(**kw))
    S = report.build(res)
    paths_rows = None
    if a.paths:
        paths_rows = [{"path": p, "tool": t, "calls": v["calls"], "sessions": len(v["sessions"])}
                      for (p, t), v in sorted(res.agg.paths.items())]
    report.write_all(res, S, a.out, paths_rows)
    print(f"report written: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
