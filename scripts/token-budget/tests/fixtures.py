"""Made-up transcripts. Every text value carries a canary so a leak test can find it."""
import json
import os

CANARIES = ["CANARY-PROMPT-7731", "CANARY-RESULT-5521", "CANARY-CMD-9913", "CANARY-PATH-2204", "CANARY-ASSISTANT-6642"]
SID = "11111111-aaaa-bbbb-cccc-000000000001"
CWD = "/work/demo-project"


def line(**kw):
    return json.dumps(kw)


def base(ts, **kw):
    d = {"sessionId": SID, "cwd": CWD, "timestamp": ts, "uuid": "u-" + ts, "isSidechain": False, "entrypoint": "cli"}
    d.update(kw)
    return d


def assistant(ts, mid, out, i=0, cr=0, cw=0, w1h=0, tools=(), model="claude-sonnet-5-5", think=0, agent=None, **extra):
    content = [{"type": "text", "text": CANARIES[4]}]
    for tid, name, inp in tools:
        content.append({"type": "tool_use", "id": tid, "name": name, "input": inp})
    d = base(ts, type="assistant", requestId="req-" + mid, **extra)
    if agent:
        d["agentId"], d["isSidechain"] = agent, True
    d["message"] = {"id": "msg-" + mid, "type": "message", "role": "assistant", "model": model, "content": content,
                    "usage": {"input_tokens": i, "output_tokens": out, "cache_read_input_tokens": cr,
                              "cache_creation_input_tokens": cw + w1h,
                              "cache_creation": {"ephemeral_5m_input_tokens": cw, "ephemeral_1h_input_tokens": w1h},
                              "output_tokens_details": {"thinking_tokens": think}, "speed": "standard"}}
    return d


def result(ts, tid, chars, agent=None):
    d = base(ts, type="user", toolUseResult={"stdout": CANARIES[1]})
    if agent:
        d["agentId"], d["isSidechain"] = agent, True
    d["message"] = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid,
                                                 "content": (CANARIES[1] + " ") * (chars // (len(CANARIES[1]) + 1))}]}
    return d


def human(ts, text=CANARIES[0], **kw):
    return base(ts, type="user", message={"role": "user", "content": text}, **kw)


def write_session(root, extra_days=False):
    proj = os.path.join(root, "-work-demo-project")
    os.makedirs(os.path.join(proj, SID, "subagents"), exist_ok=True)
    A = {"file_path": "/work/" + CANARIES[3]}
    L = [
        human("2026-10-01T10:00:00.000Z"),
        assistant("2026-10-01T10:00:01.000Z", "1", 20, i=10, cw=5000, tools=[("t1", "Read", A)]),
        assistant("2026-10-01T10:00:01.500Z", "1", 50, i=10, cw=5000, tools=[("t1", "Read", A)]),  # repeated line, output grew
        result("2026-10-01T10:00:03.000Z", "t1", 3500),
        assistant("2026-10-01T10:00:10.000Z", "2", 40, i=5, cr=5000, cw=1060,
                  tools=[("t2", "Read", A), ("t3", "Bash", {"command": "git status " + CANARIES[2]})]),
        result("2026-10-01T10:00:11.000Z", "t2", 3500),
        result("2026-10-01T10:00:11.100Z", "t3", 700),
        assistant("2026-10-01T10:00:20.000Z", "3", 60, i=3, cr=6060, cw=1200,
                  tools=[("t4", "Skill", {"skill": "demo-skill"}), ("t5", "Read", A)]),
        result("2026-10-01T10:00:21.000Z", "t4", 80),
        result("2026-10-01T10:00:21.100Z", "t5", 3500),
        assistant("2026-10-01T10:00:30.000Z", "4", 30, i=2, cr=7263, cw=900, tools=[("t6", "Bash", {"command": "ls"})]),
        result("2026-10-01T10:00:31.000Z", "t6", 350),
        # idle gap of 1000 s: the cache is gone, everything is written again
        assistant("2026-10-01T10:17:11.000Z", "5", 25, i=0, cr=0, cw=8300),
        base("2026-10-01T10:17:20.000Z", type="system", subtype="compact_boundary",
             compactMetadata={"trigger": "auto", "preTokens": 8300, "postTokens": 900}),
        assistant("2026-10-01T10:17:25.000Z", "6", 20, i=1, cr=0, cw=899),
        human("2026-10-01T10:17:40.000Z", "next question " + CANARIES[0]),
        assistant("2026-10-01T10:17:45.000Z", "7", 15, i=4, cr=900, cw=120),
        # attachment that is rendered into context, and one that is not
        base("2026-10-01T10:17:50.000Z", type="attachment", attachment={"type": "skill_listing", "text": CANARIES[0]},
             rendered=[CANARIES[0] * 20]),
        base("2026-10-01T10:17:51.000Z", type="attachment", attachment={"type": "deferred_tools_record"}),
        assistant("2026-10-01T10:17:55.000Z", "8", 10, i=2, cr=1020, cw=400),
        {"type": "cost-state", "sessionId": SID, "totalCostUSD": 0.05, "modelUsage": {}},
        {"type": "something-new", "sessionId": SID},
    ]
    if extra_days:
        L.append(assistant("2026-10-05T09:00:00.000Z", "9", 10, i=1, cr=1000, cw=10))
    with open(os.path.join(proj, SID + ".jsonl"), "w") as fh:
        fh.write("\n".join(json.dumps(x) for x in L) + "\nthis is not json " + CANARIES[0] + "\n")
    sub = [
        human("2026-10-01T10:00:12.000Z", "delegated " + CANARIES[0], agentId="agent-x", isSidechain=True),
        assistant("2026-10-01T10:00:13.000Z", "s1", 30, i=100, cw=2000, agent="agent-x", model="mystery-model-9"),
        assistant("2026-10-01T10:00:20.000Z", "s2", 30, i=10, cr=2100, cw=50, agent="agent-x", model="mystery-model-9"),
        assistant("2026-10-01T10:00:21.000Z", "s3", 30, i=10, cr=2160, cw=50, agent="agent-x"),
    ]
    with open(os.path.join(proj, SID, "subagents", "agent-x.jsonl"), "w") as fh:
        fh.write("\n".join(json.dumps(x) for x in sub) + "\n")
    return proj
