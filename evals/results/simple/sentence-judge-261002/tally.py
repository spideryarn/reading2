import json, re, collections, os
J = os.path.dirname(os.path.abspath(__file__))
key = {}
for l in open(f"{J}/key.jsonl"):
    d = json.loads(l); key[d["n"]] = d
v = {}
for l in open(f"{J}/verdicts-pairs.md"):
    m = re.match(r"\s*(\d+): Q1=(\w+); Q2=(\w+)", l)
    if m: v[int(m[1])] = (m[2], m[3])
print(len(v), "verdicts")
eff = collections.Counter(); ctl = collections.Counter(); flags = collections.Counter()
per = collections.defaultdict(collections.Counter)
for n, (q1, q2) in v.items():
    k = key[n]; arm = {"X": k["X"], "Y": k["Y"]}
    if k["kind"] == "effect":
        w = "same" if q1 == "SAME" else ("after" if arm[q1].startswith("sentafter") else "before")
        eff[w] += 1; per[k["slug"][:10]][w] += 1
        for side in ("X", "Y"):
            if q2 in (side, "BOTH"): flags["after" if arm[side].startswith("sentafter") else "before"] += 1
    else:
        w = "same" if q1 == "SAME" else arm[q1]
        ctl[w] += 1
        for side in ("X", "Y"):
            if q2 in (side, "BOTH"): flags["ctl-" + arm[side]] += 1
print("effect Q1", dict(eff)); print("per article", {k: dict(c) for k, c in per.items()})
print("control Q1", dict(ctl)); print("Q2 flags", dict(flags))
