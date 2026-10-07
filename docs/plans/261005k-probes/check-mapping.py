#!/usr/bin/env python3
"""Check a memory-mapping table against the memory directory.

usage: python3 docs/plans/261005k-probes/check-mapping.py <mapping.md> [<more.md> ...]

Reads every table row whose first cell is a backticked memory file name and whose second cell is a
backticked 12-character sha256 prefix. Fails if a file in the directory has no row, a row names a
file that is not there, a file has two rows, a hash no longer matches the file, or a verdict is
neither `eligible` nor `retain`. Run it again before deleting anything: a hash that has moved means
the file changed after it was read.
"""
import hashlib
import os
import re
import sys

MEMORY = os.path.expanduser("~/.claude/projects/-home-greg-code-spideryarn2/memory")
ROW = re.compile(r"^\|\s*`([a-z0-9-]+)(?:\.md)?`\s*\|\s*`([0-9a-f]{12})`\s*\|(.*)\|\s*\**(\w+)\**\s*\|\s*$")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    rows: dict[str, tuple[str, str]] = {}
    problems: list[str] = []
    for path in sys.argv[1:]:
        for line in open(path, encoding="utf-8"):
            m = ROW.match(line.rstrip("\n"))
            if not m:
                continue
            name, sha, _lessons, verdict = m.groups()
            if name in rows:
                problems.append(f"two rows: {name}")
            rows[name] = (sha, verdict)
    on_disk = {f[:-3] for f in os.listdir(MEMORY) if f.endswith(".md") and f != "MEMORY.md"}
    for name in sorted(on_disk - rows.keys()):
        problems.append(f"no row: {name}")
    for name in sorted(rows.keys() - on_disk):
        problems.append(f"row for a file that is not there: {name}")
    for name in sorted(rows.keys() & on_disk):
        sha, verdict = rows[name]
        actual = hashlib.sha256(open(os.path.join(MEMORY, name + ".md"), "rb").read()).hexdigest()[:12]
        if actual != sha:
            problems.append(f"hash moved: {name} (row {sha}, file {actual})")
        if verdict not in ("eligible", "retain"):
            problems.append(f"verdict is neither eligible nor retain: {name} ({verdict})")
    for p in problems:
        print("✗", p)
    eligible = sum(1 for _, v in rows.values() if v == "eligible")
    print(f"{len(rows)} rows, {len(on_disk)} files, {eligible} eligible, {len(rows) - eligible} retain")
    if problems:
        print(f"FAILED: {len(problems)} problem(s)")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
