#!/usr/bin/env python3
"""Check that strings attributed to Greg were typed by a person, in a session transcript.

usage: python3 check-quotes.py <quotes.txt>

One distinctive substring per line (no quotation marks, nothing JSON would escape). For each, finds
transcript files containing it, then looks for a row that is a real user turn: type "user", not a
sidechain, and the substring in typed text rather than in a tool result. A hit in a tool result or
an assistant turn only shows that a model repeated it, and so does a subagent hand-back or a
peer message, which arrive as user turns: those are skipped by their markers. Prints the earliest typed hit's timestamp.
"""
import glob
import json
import os
import subprocess
import sys

SKIP = os.environ.get("SKIP_SESSION", "")  # the session doing the checking quotes them all
ROOTS = [os.path.expanduser(p) for p in ("~/.claude/projects", "~/.claude-gregmindstone/projects")]


def typed_text(row: dict) -> str:
    if row.get("type") != "user" or row.get("isSidechain"):
        return ""
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            out.append(b.get("text", ""))
    text = "\n".join(out)
    # A subagent's hand-back, a peer's message and a harness notice all arrive as user turns.
    if any(m in text for m in ("agent-message", "Subagent hand-back", "task-notification", "system-reminder")):
        return ""
    return text


def main() -> int:
    needles = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
    roots = [r for r in ROOTS if os.path.isdir(r)]
    bad = 0
    for needle in needles:
        files = subprocess.run(
            ["grep", "-rlF", "--include=*.jsonl", needle, *roots], capture_output=True, text=True
        ).stdout.split()
        best = None
        for f in files:
            if SKIP and SKIP in f:
                continue
            for line in open(f, encoding="utf-8", errors="replace"):
                if needle not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                text = typed_text(row)
                if needle in text:
                    # A pasted brief or a relayed message is typed text too; keep the shortest turn,
                    # which is the likeliest to be the original.
                    cand = (len(text), row.get("timestamp", "?"), os.path.basename(f))
                    if best is None or cand < best:
                        best = cand
        if best:
            print(f"✓ typed, {best[1]}, turn of {best[0]} chars, {best[2][:8]} — {needle[:60]}")
        else:
            bad += 1
            print(f"✗ NOT FOUND in a typed turn ({len(files)} files mention it) — {needle[:60]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
