"""Thresholds and rules, loaded from thresholds.json (overridable with --config)."""
import json
import os

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "thresholds.json")


def load(path=None):
    with open(path or DEFAULT_PATH, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg.pop("_doc", None)
    return cfg


def activity_of(cfg, tool_names):
    """Request activity from the tools it issued; the first matching group in priority wins."""
    if not tool_names:
        return "respond"
    for group, prefixes in cfg["activity_priority"]:
        for t in tool_names:
            for p in prefixes:
                if t == p or (p.endswith("_") or p.endswith("-") or p.startswith("mcp__")) and t.startswith(p):
                    return group
    return "other_tool"
