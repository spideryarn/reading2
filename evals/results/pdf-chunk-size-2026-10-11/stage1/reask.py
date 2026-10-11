"""A deliberately rough re-ask signal from a ledger that has no chunk id.

A re-ask sends the same body and instruction as its first ask, so its reported_input_tokens should
equal a first-wave call's. The converse is not safe: unrelated calls can have the same count, and
duplicate counts in the first wave collapse distinct chunks. Print those collisions so the output
cannot be mistaken for an exact classification; stage 2 instruments the reader instead.
"""
import json, sys, collections
from datetime import datetime
ERA = {"local": "2026-09-04T21:00", "prod": "2026-09-05T00:00"}
def ts(s): return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
c = collections.Counter(); per = []
for path, src in zip(sys.argv[1:], ["local", "prod"]):
    rows = [r for r in json.load(open(path))["rows"] if r["started_at"] >= ERA[src]]
    g = collections.defaultdict(list)
    for r in rows: g[(r["run_id"], r["article_id"])].append(r)
    for k, rs in g.items():
        rs.sort(key=lambda r: r["started_at"]); t0 = ts(rs[0]["started_at"])
        first = [r for r in rs if ts(r["started_at"]) - t0 < 3]; later = [r for r in rs if ts(r["started_at"]) - t0 >= 3]
        fin = collections.Counter(r["reported_input_tokens"] for r in first)
        match = sum(1 for r in later if r["reported_input_tokens"] in fin)
        dup_first = sum(v - 1 for v in fin.values() if v > 1)
        # Input-size signatures seen again, not identified chunks.
        reasked = len({r["reported_input_tokens"] for r in later} & set(fin))
        c["first"] += len(first); c["later"] += len(later); c["match"] += match; c["reasked_chunks"] += reasked; c["dup_first"] += dup_first
        if len(rs) >= 3:
            per.append((src, len(first), len(later), match, reasked))
print(c)
print("distinct first-wave input-token counts seen again:", c["reasked_chunks"], "/", c["first"], f"= {c['reasked_chunks']/c['first']:.0%}")
print("later calls not matching a first-wave input (recover-like or re-ask of a recover):", c["later"] - c["match"])
small = [p for p in per if p[1] <= 10]; big = [p for p in per if p[1] > 10]
for name, ps in [("<=10 chunks", small), (">10 chunks", big)]:
    f = sum(p[1] for p in ps); r = sum(p[4] for p in ps)
    print(name, "extracts", len(ps), "chunks", f, "asked again", r, f"{r/f:.0%}")
