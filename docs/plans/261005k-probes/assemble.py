#!/usr/bin/env python3
"""Assemble the mapping doc from the four batch reports.

usage: python3 assemble.py <head.md> <out.md> [--skipped=AE1,BE3]

Takes every table row from report-A..D, sets each file's verdict from its lessons (a file with any
lesson still `propose`, an edit named in --skipped, or a line in overrides.txt, is `retain`; otherwise `eligible`), and
appends each report's Proposals section. The verdicts in the reports were written before the edits
landed, so they are recomputed here, not copied.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
head, out = sys.argv[1], sys.argv[2]
skipped = set()
for a in sys.argv[3:]:
    if a.startswith("--skipped="):
        skipped = {s for s in a.split("=", 1)[1].split(",") if s}

ROW = re.compile(r"^\| `([a-z0-9-]+)` \| `([0-9a-f]{12})` \| (.*) \| (\w+) \|\s*$")
overrides = {}
for line in open(os.path.join(HERE, "overrides.txt"), encoding="utf-8"):
    if "|" in line:
        k, v = line.split("|", 1)
        overrides[k.strip()] = v.strip()
rows, proposals = [], []
for letter in "ABCD":
    text = open(os.path.join(HERE, f"report-{letter}.md"), encoding="utf-8").read()
    for line in text.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        name, sha, lessons, _ = m.groups()
        edits = set(re.findall(r"\bedit ([A-D]E\d+)", lessons))
        pending = bool(re.search(r"\bpropose\b|rides in [A-D]P\d+", lessons)) or bool(edits & skipped)
        for e in edits:
            lessons = re.sub(rf"\bedit {e}\b", f"edit {e} (not applied)" if e in skipped else f"moved ({e})", lessons)
        if name in overrides:  # a review finding: the file is retained, and the row says why
            lessons, pending = lessons + " " + overrides.pop(name), True
        rows.append((name, sha, lessons, "retain" if pending else "eligible", letter))
    i = text.index("\n## Proposals")
    j = text.index("\n## Quotes, and doubts")
    body = text[i:j].strip().split("\n", 1)[1].strip()
    # Proposed text holds headings of its own, inside fences; demote only the report's own.
    body = re.sub(r"^### ([A-D]P\d+)", r"### \1", body, flags=re.M)
    proposals.append(body)

assert not overrides, f"override for a file with no row: {sorted(overrides)}"
proposals.append(open(os.path.join(HERE, "proposals-R.md"), encoding="utf-8").read().strip())
rows.sort()
table = ["| memory file | sha256 (first 12) | lessons | verdict |", "|---|---|---|---|"]
table += [f"| `{n}` | `{s}` | {l} | {v} |" for n, s, l, v, _ in rows]
eligible = sum(1 for r in rows if r[3] == "eligible")
doc = open(head, encoding="utf-8").read()
doc = doc.replace("{{TABLE}}", "\n".join(table))
doc = doc.replace("{{PROPOSALS}}", "\n\n".join(proposals))
doc = doc.replace("{{N}}", str(len(rows))).replace("{{ELIGIBLE}}", str(eligible))
doc = doc.replace("{{RETAIN}}", str(len(rows) - eligible))
doc = doc.replace("{{NPROPOSALS}}", str(len(re.findall(r"^### [A-DR]P\d+", doc, flags=re.M))))
open(out, "w", encoding="utf-8").write(doc)
print(f"{len(rows)} rows, {eligible} eligible, {len(rows) - eligible} retain -> {out}")
