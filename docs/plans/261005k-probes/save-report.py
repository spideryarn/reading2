#!/usr/bin/env python3
"""Save a subagent's final report from its transcript, without reading it into the caller's context.

usage: python3 save-report.py <transcript.jsonl> <out.md>

The harness refuses a subagent's own Write of a report file, so the report comes back as the last
assistant text in its transcript. This takes the longest text block of the last assistant turns that
contains a "## Table" heading, and writes it from the first "# Report" heading on.
"""
import json
import sys

src, out = sys.argv[1], sys.argv[2]
best = ""
for line in open(src, encoding="utf-8"):
    try:
        row = json.loads(line)
    except ValueError:
        continue
    msg = row.get("message") or {}
    if msg.get("role") != "assistant":
        continue
    content = msg.get("content")
    blocks = content if isinstance(content, list) else []
    for b in blocks:
        texts = []
        if b.get("type") == "text":
            texts.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            texts += [v for v in (b.get("input") or {}).values() if isinstance(v, str)]
        for t in texts:
            if "## Table" in t and len(t) > len(best):
                best = t
if not best:
    sys.exit("no report found")
i = best.find("# Report")
body = best[i:] if i >= 0 else best
open(out, "w", encoding="utf-8").write(body.rstrip() + "\n")
print(f"wrote {out}: {len(body)} chars, {body.count(chr(10))} lines")
