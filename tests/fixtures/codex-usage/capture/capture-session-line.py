"""Capture one real session-rollout `token_count` line as the fallback source's fixture.

The fallback reads `~/.codex/sessions/**/rollout-*.jsonl`. Only the `rate_limits`
half of the payload is shape-bearing for us, but the whole line is kept so the
parser is tested against the real envelope rather than a tidied one. Token counts
are real numbers about Greg's own usage and harmless; nothing here identifies a
person or a project.
"""
import glob
import json
import os
import sys

out = sys.argv[1]
files = sorted(
    glob.glob(os.path.expanduser("~/.codex/sessions/**/rollout-*.jsonl"), recursive=True),
    key=os.path.getmtime,
    reverse=True,
)
picked = None
for f in files:
    for line in open(f, encoding="utf-8", errors="replace"):
        if '"rate_limits"' not in line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if isinstance((o.get("payload") or {}).get("rate_limits"), dict):
            picked = o
            break
    if picked:
        break

if picked is None:
    print("no session line carrying rate_limits found", file=sys.stderr)
    raise SystemExit(1)

with open(out, "w", encoding="utf-8") as fh:
    json.dump(picked, fh, indent=2, sort_keys=True)
    fh.write("\n")
print("wrote", out, "from", f)
