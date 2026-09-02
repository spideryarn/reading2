#!/usr/bin/env python3
"""Every number quoted in stage1-baseline.md, printed with its label.

Reads both ledgers: data/_ai-calls.jsonl and pg-rows.json (dumped by pg-dump.mjs
from the LOCAL Postgres, non-fixture rows only).
"""
import json, collections, datetime, os

SCRATCH = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/greg/code/spideryarn2"
NAN = 1e9


def load():
    fs = []
    for l in open(os.path.join(REPO, "data/_ai-calls.jsonl")):
        r = json.loads(l)
        old = r.pop("upstreamInferenceNanos", None)
        r["byokUpstreamNanos"] = old if r.get("isByok") is True else None
        r["_ledger"] = "fs"
        fs.append(r)
    pg = json.load(open(os.path.join(SCRATCH, "pg-rows.json")))
    for r in pg:
        r["byokUpstreamNanos"] = r.get("upstreamInferenceNanos") if r.get("isByok") is True else None
        r["_ledger"] = "pg"
    return fs, pg


def total(rows):
    """totalRows() from src/store/ai-calls.ts."""
    credits = upstream = computed = 0
    unpriced = 0
    for r in rows:
        if r.get("costSource") == "computed":
            computed += r.get("computedCostNanos") or 0
            continue
        if r.get("isByok") is True:
            if r.get("byokUpstreamNanos") is None:
                unpriced += 1
            else:
                upstream += r["byokUpstreamNanos"]
            credits += r.get("creditsUsedNanos") or 0
            continue
        if r.get("creditsUsedNanos") is None:
            unpriced += 1
        else:
            credits += r["creditsUsedNanos"]
    return credits, upstream, computed, unpriced


def money(rows):
    c, u, m, _ = total(rows)
    return (c + u + m) / NAN


def unp(rows):
    return total(rows)[3]


def ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def runs(rows, pred=lambda r: True):
    """Group into executions: (slug, stepName-or-job, jobId, runId)."""
    g = collections.defaultdict(list)
    for r in rows:
        if not pred(r):
            continue
        g[(r.get("articleSlug"), r.get("stepName") or r.get("job"), r.get("jobId"), r.get("runId"))].append(r)
    out = []
    for k, v in g.items():
        lo = min(ts(x["startedAt"]) for x in v)
        hi = max(ts(x["finishedAt"]) for x in v if x.get("finishedAt"))
        out.append(dict(slug=k[0], step=k[1], jobId=k[2], runId=k[3], calls=len(v),
                        cost=money(v), unpriced=unp(v), start=lo, finish=hi,
                        wall=(hi - lo).total_seconds(), rows=v))
    return sorted(out, key=lambda r: r["start"])


def h(t):
    print("\n" + "=" * 78 + "\n" + t + "\n" + "=" * 78)


fs, pg = load()
both = fs + pg

h("1. TOTAL HISTORICAL SPEND")
for name, rows in (("filesystem ledger data/_ai-calls.jsonl", fs),
                   ("local Postgres spideryarn.ai_calls, non-fixture rows", pg),
                   ("both, de-duplicated (they do not overlap)", both)):
    c, u, m, n = total(rows)
    print(f"  {name}: {len(rows)} rows  ${(c+u+m)/NAN:.4f}"
          f"  (credits ${c/NAN:.4f} + BYOK upstream ${u/NAN:.4f} + computed ${m/NAN:.6f})  unpriced={n}")
naive = sum((json.loads(l).get("creditsUsedNanos") or 0) + (json.loads(l).get("upstreamInferenceNanos") or 0)
            + (json.loads(l).get("computedCostNanos") or 0)
            for l in open(os.path.join(REPO, "data/_ai-calls.jsonl"))) / NAN
print(f"  the WRONG naive SUM over the fs ledger's money columns: ${naive:.4f}")

h("2. DUPLICATE EXECUTION")
allruns = runs(fs)
groups = collections.defaultdict(list)
for r in allruns:
    if r["jobId"]:
        groups[(r["jobId"], r["step"])].append(r)
tot_keepmax = tot_keepmed = spend_in_groups = 0.0
for (jid, step), v in sorted(groups.items(), key=lambda kv: kv[1][0]["start"]):
    if len(v) < 2:
        continue
    v.sort(key=lambda x: x["start"])
    overlapping = any(v[j]["start"] < v[i]["finish"] for i in range(len(v)) for j in range(i + 1, len(v)))
    if not overlapping:
        continue
    costs = sorted(x["cost"] for x in v)
    t = sum(costs)
    med = costs[len(costs) // 2] if len(costs) % 2 else (costs[len(costs)//2 - 1] + costs[len(costs)//2]) / 2
    spend_in_groups += t
    tot_keepmax += t - costs[-1]
    tot_keepmed += t - med
    print(f"  {v[0]['slug'][:44]:44} step={step:10} job={jid} execs={len(v)} "
          f"total=${t:.4f} median=${med:.4f} max=${costs[-1]:.4f} "
          f"waste(keep-max)=${t-costs[-1]:.4f} waste(keep-median)=${t-med:.4f} "
          f"window={v[0]['start'].strftime('%m-%d %H:%M')}")
print(f"  spend inside duplicated groups: ${spend_in_groups:.4f}")
print(f"  waste, keep-max convention (the postmortem's):    ${tot_keepmax:.4f}")
print(f"  waste, keep-median convention (honest unit cost): ${tot_keepmed:.4f}")
print(f"  as a share of the ${money(both):.2f} both-ledger total: "
      f"{tot_keepmax/money(both)*100:.0f}%-{tot_keepmed/money(both)*100:.0f}%")
print("  no duplicate-execution group exists in the Postgres ledger:",
      all(len(v) < 2 for v in collections.defaultdict(list, {
          (r['jobId'], r['step']): [r] for r in runs(pg) if r['jobId']}).values()) or "see below")
gp = collections.defaultdict(list)
for r in runs(pg):
    if r["jobId"]:
        gp[(r["jobId"], r["step"])].append(r)
print("  Postgres (jobId, step) groups with >1 runId:", [k for k, v in gp.items() if len(v) > 1] or "none")

h("3. POSTMORTEM CROSS-CHECK (structure calls only, job='hierarchy')")
j = collections.defaultdict(list)
for r in fs:
    if r.get("stepName") == "hierarchy" and r.get("job") == "hierarchy":
        j[(r.get("jobId"), r.get("articleSlug"))].append(r)
s = 0.0
for k, v in sorted(j.items(), key=lambda kv: min(ts(x["startedAt"]) for x in kv[1])):
    c = money(v)
    s += c
    ceil = sum(1 for x in v if (x.get("outputTokens") or 0) >= 52000)
    print(f"  {k[0]} {(k[1] or '')[:40]:40} calls={len(v)} runIds={len({x['runId'] for x in v})} "
          f"${c:.4f} at-ceiling={ceil} below={sum(1 for x in v if 0 < (x.get('outputTokens') or 0) < 52000)} "
          f"non-ok={sum(1 for x in v if x.get('outcome') != 'ok')}")
storm = [k for k in j if len({x['runId'] for x in j[k]}) > 1]
print(f"  four storm jobs, structure-only: ${sum(money(j[k]) for k in storm):.4f}   (postmortem says $11.36)")
print(f"  keep-max waste over those four: "
      f"${sum(money(j[k]) - max(money([x]) for x in j[k]) for k in storm):.4f}   (postmortem says $9.62)")
print(f"  all hierarchy structure calls, all jobs: ${s:.4f}")

h("4. SINGLE-EXECUTION COST PER (slug, step) — per-article steps, scope=job_step")
sizes = {  # blocks / gistable / words, from data/*/blocks.json and spideryarn.revision_blocks
    "read": (23, 21, 459), "todo": (10, 9, 243), "own-spya-bf6g9b": (61, 59, 2530),
    "openai-huggingface": (95, None, 4187), "revistes-ub-30977": (43, None, 3106),
    "towards-a-theory-of-bugs-the-ruliology-of-the-unexpected": (244, 164, 8001),
    "fowler-phrenology": (72, 71, 8717), "noema-mythology-of-conscious-ai": (141, None, 8283),
    "what-if-we-had-bigger-brains-imagining-minds-beyond-ours": (172, 165, 12975),
    "scaling-hypothesis": (186, 177, 16855), "replication-crisis-spya-hrjamq": (551, 542, 21200),
}
per = collections.defaultdict(list)
for r in runs(both, lambda r: r.get("scopeKind") == "job_step"):
    per[(r["step"], r["slug"])].append(r)
for (step, slug), v in sorted(per.items(), key=lambda kv: -max(x["cost"] for x in kv[1])):
    costs = sorted(x["cost"] for x in v)
    med = costs[len(costs) // 2] if len(costs) % 2 else (costs[len(costs)//2-1] + costs[len(costs)//2]) / 2
    b, gi, w = sizes.get(slug, (None, None, None))
    per1k = f"${med/(w/1000):.4f}" if w else "-"
    print(f"  {step:10} {slug[:50]:50} words={str(w):6} blocks={str(b):5} gistable={str(gi):5} "
          f"execs={len(v):2} median=${med:.4f} range=${costs[0]:.4f}-${costs[-1]:.4f} "
          f"per-1k-words={per1k} calls={sorted(x['calls'] for x in v)} "
          f"wall={sorted(round(x['wall']) for x in v)}s ledger={v[0]['rows'][0]['_ledger']}")

h("5. MODE COVERAGE — how many independent per-article generations exist")
paying_steps = ["extract", "hierarchy", "arc", "tweets", "glossary", "quotes", "ideas", "timeline", "quiz", "sketch"]
js = collections.Counter()
for r in runs(both, lambda r: r.get("scopeKind") == "job_step"):
    js[r["step"]] += 1
other = collections.Counter()
for r in runs(both, lambda r: r.get("scopeKind") in ("cli", "eval")):
    other[r["step"]] += 1
for s in paying_steps:
    print(f"  {s:10} job_step executions={js.get(s,0):3}   cli/eval runs of the same job={other.get(s,0):3}")
print("  (steps absent from both columns have NO ledger evidence at all)")

h("6. PER-INTERACTION UNIT COSTS (scope=request), cold vs warm by cache-read tokens")
g = collections.defaultdict(list)
for r in both:
    if r.get("scopeKind") != "request":
        continue
    g[(r.get("job") or r.get("purpose"), r.get("runId"))].append(r)
per = collections.defaultdict(list)
for k, v in g.items():
    per[k[0]].append((money(v), unp(v), sum(x.get("cacheReadTokens") or 0 for x in v)))
for job, v in sorted(per.items(), key=lambda kv: -sum(x[0] for x in kv[1])):
    cold = sorted(x[0] for x in v if x[2] == 0 and x[1] == 0)
    warm = sorted(x[0] for x in v if x[2] > 0 and x[1] == 0)
    f = lambda xs: (f"n={len(xs)} median=${xs[len(xs)//2]:.4f} range=${xs[0]:.4f}-${xs[-1]:.4f}") if xs else "n=0"
    print(f"  {job:20} total=${sum(x[0] for x in v):.4f}  cold[{f(cold)}]  warm[{f(warm)}]")

h("7. UNPRICED ROWS")
u = [r for r in both if r.get("costSource") != "computed" and (
    (r.get("isByok") is True and r.get("byokUpstreamNanos") is None) or
    (r.get("isByok") is not True and r.get("creditsUsedNanos") is None))]
print(f"  {len(u)} unpriced rows across both ledgers (cost UNKNOWN, not zero)")
for k, n in collections.Counter((r["_ledger"], r.get("scopeKind"), r.get("job"), r.get("outcome")) for r in u).most_common():
    print(f"   {k} x{n}")

h("8. BYOK PDF EXTRACTION (isByok rows)")
for k, v in sorted(collections.defaultdict(list, {}).items()):
    pass
g = collections.defaultdict(list)
for r in both:
    if r.get("isByok") is True:
        g[(r.get("runId"), r.get("answeredModel"))].append(r)
for k, v in sorted(g.items(), key=lambda kv: -money(kv[1])):
    print(f"  run={k[0][:8]} {k[1]:22} calls={len(v):3} upstream=${money(v):.4f} "
          f"in={sum(x.get('reportedInputTokens') or 0 for x in v)} out={sum(x.get('outputTokens') or 0 for x in v)}")
