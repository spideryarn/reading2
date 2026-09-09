"""Does the codex bucket's used_percent actually MOVE over time?

If it is a live counter it should climb through a working day and step back to a
low number after a weekly reset. If it is a frozen cache it will not move at all.
Reads only the free session-log snapshots, so this costs nothing.
"""
import glob
import json
import os
from collections import OrderedDict

seen = {}
for f in glob.glob(os.path.expanduser("~/.codex/sessions/**/rollout-*.jsonl"), recursive=True):
    try:
        for line in open(f, encoding="utf-8", errors="replace"):
            if '"rate_limits"' not in line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            rl = (o.get("payload") or {}).get("rate_limits")
            ts = o.get("timestamp")
            if not isinstance(rl, dict) or not ts:
                continue
            if rl.get("limit_id") != "codex":
                continue
            p = rl.get("primary") or {}
            up, wm, ra = p.get("used_percent"), p.get("window_minutes"), p.get("resets_at")
            if up is None:
                continue
            seen[ts] = (up, wm, ra)
    except Exception:
        pass

ordered = OrderedDict(sorted(seen.items()))
print("distinct (used_percent, window_minutes, resets_at) transitions, oldest first:")
prev = None
n = 0
for ts, v in ordered.items():
    if v != prev:
        print(f"  {ts}  used={v[0]:>5}  window={v[1]}  resets_at={v[2]}")
        prev = v
        n += 1
print(f"\n{len(ordered)} snapshots, {n} transitions")
vals = sorted({v[0] for v in ordered.values()})
print("distinct used_percent values seen:", vals)
resets = sorted({v[2] for v in ordered.values()})
print("distinct resets_at values seen:", resets)
