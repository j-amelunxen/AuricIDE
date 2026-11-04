#!/usr/bin/env python3
"""Print the *shape* of JSONL files: key names, JSON types and counts. Never values.

The only values ever printed are short identifier-like strings of a fixed
whitelist of discriminator keys (type, subtype, role, stop_reason, ...), plus a
tool name when a sibling ``type`` is ``tool_use``. Everything else is a type name.
Use this, and only this, to learn the format of transcripts that hold real data.

    python3 schema_dump.py --max-files 40 --max-lines 2000 FILE_OR_DIR ...
"""
import argparse
import collections
import json
import os
import re
import sys

IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,40}$")
MAX_DEPTH = 6
KEY_OK = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
VALUE_KEYS = {"type", "subtype", "role", "stop_reason", "speed", "service_tier",
              "operation", "level", "originator", "source", "kind", "status"}


def jtype(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    return "array" if isinstance(v, list) else "object"


def walk(node, path, acc, parent=None, depth=0):
    t = jtype(node)
    acc[(path, t)] += 1
    if depth >= MAX_DEPTH:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            kk = k if KEY_OK.match(k) else "<key>"
            p = f"{path}.{kk}"
            if isinstance(v, str) and IDENT.match(v):
                if k in VALUE_KEYS or (k == "name" and node.get("type") == "tool_use"):
                    acc[(p + "=" + v, "value")] += 1
            walk(v, p, acc, node, depth + 1)
    elif isinstance(node, list):
        for v in node:
            walk(v, path + "[]", acc, node, depth + 1)


def files(paths):
    for p in paths:
        if os.path.isdir(p):
            for r, _, fs in os.walk(p):
                for f in sorted(fs):
                    if f.endswith(".jsonl") or f.endswith(".json"):
                        yield os.path.join(r, f)
        else:
            yield p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--max-files", type=int, default=40)
    ap.add_argument("--max-lines", type=int, default=2000)
    ap.add_argument("--max-depth", type=int, default=6)
    a = ap.parse_args()
    global MAX_DEPTH
    MAX_DEPTH = a.max_depth
    acc = collections.Counter()
    nfiles = nlines = bad = 0
    for f in sorted(files(a.paths))[: a.max_files]:
        nfiles += 1
        with open(f, "rb") as fh:
            for i, line in enumerate(fh):
                if i >= a.max_lines:
                    break
                nlines += 1
                try:
                    walk(json.loads(line), "$", acc)
                except ValueError:
                    bad += 1
    print(f"files={nfiles} lines={nlines} unparsable={bad}")
    for (p, t), n in sorted(acc.items()):
        print(f"{n:8d} {t:6s} {p}")


if __name__ == "__main__":
    sys.exit(main())
