#!/usr/bin/env python3
"""Mode coverage: how many independent single executions the ledger holds per
per-article step and per-interaction job, across BOTH ledgers.

The Postgres half is read by pg-modes.mjs and dumped to pg-rows.json first.
"""
import json, sys, collections, datetime, os

SCRATCH = os.path.dirname(os.path.abspath(__file__))
NAN = 1e9


def cost(r):
    if r.get("costSource") == "computed":
        return (r.get("computedCostNanos") or 0) / NAN, 0
    if r.get("isByok") is True:
        u = r.get("byokUpstreamNanos")
        return ((r.get("creditsUsedNanos") or 0) + (u or 0)) / NAN, (1 if u is None else 0)
    c = r.get("creditsUsedNanos")
    return (c or 0) / NAN, (1 if c is None else 0)


def load_fs(path):
    rows = []
    for l in open(path):
        r = json.loads(l)
        old = r.pop("upstreamInferenceNanos", None)
        r["byokUpstreamNanos"] = old if r.get("isByok") is True else None
        r["_ledger"] = "fs"
        rows.append(r)
    return rows


def load_pg(path):
    if not os.path.exists(path):
        return []
    rows = json.load(open(path))
    for r in rows:
        r["byokUpstreamNanos"] = r.get("upstreamInferenceNanos") if r.get("isByok") is True else None
        r["_ledger"] = "pg"
    return rows


def main():
    rows = load_fs("/home/greg/code/spideryarn2/data/_ai-calls.jsonl") + load_pg(os.path.join(SCRATCH, "pg-rows.json"))
    print("rows: fs=%d pg=%d" % (sum(1 for r in rows if r["_ledger"] == "fs"),
                                 sum(1 for r in rows if r["_ledger"] == "pg")))

    # --- per-article generations: one (slug, step, runId) = one execution
    print("\n## Per-article step generations (scope=job_step), one row per execution")
    g = collections.defaultdict(list)
    for r in rows:
        if r.get("scopeKind") != "job_step":
            continue
        g[(r.get("stepName"), r.get("articleSlug"), r.get("jobId"), r.get("runId"))].append(r)
    per_step = collections.defaultdict(list)
    for k, v in g.items():
        c = sum(cost(x)[0] for x in v)
        per_step[k[0]].append((k[1], k[2], k[3], len(v), c, v[0]["_ledger"]))
    for step, execs in sorted(per_step.items(), key=lambda kv: -max(x[4] for x in kv[1])):
        costs = sorted(x[4] for x in execs)
        slugs = sorted({x[0] for x in execs})
        print("  %-12s executions=%-3d distinct-articles=%-2d min=$%.4f max=$%.4f  %s"
              % (step, len(execs), len(slugs), costs[0], costs[-1], ", ".join(s[:34] for s in slugs)))

    # --- per-interaction jobs (scope=request), one runId = one interaction
    print("\n## Per-interaction jobs (scope=request), one row per runId")
    g = collections.defaultdict(list)
    for r in rows:
        if r.get("scopeKind") != "request":
            continue
        job = r.get("job") or r.get("stepName") or r.get("purpose")
        g[(job, r.get("runId"))].append(r)
    per_job = collections.defaultdict(list)
    for k, v in g.items():
        c, unp = sum(cost(x)[0] for x in v), sum(cost(x)[1] for x in v)
        per_job[k[0]].append((c, unp, v[0].get("articleSlug"), sum(x.get("cacheReadTokens") or 0 for x in v)))
    for job, ivs in sorted(per_job.items(), key=lambda kv: -sum(x[0] for x in kv[1])):
        cold = sorted(x[0] for x in ivs if x[3] == 0 and x[1] == 0)
        warm = sorted(x[0] for x in ivs if x[3] > 0 and x[1] == 0)
        f = lambda xs: ("n=%d median=$%.4f range=$%.4f-$%.4f" % (len(xs), xs[len(xs)//2], xs[0], xs[-1])) if xs else "n=0"
        print("  %-20s total=$%.4f  cold[%s]  warm[%s]" % (job, sum(x[0] for x in ivs), f(cold), f(warm)))

    # --- everything, by job kind, across both ledgers
    print("\n## Total by job kind, both ledgers")
    by = collections.defaultdict(list)
    for r in rows:
        by[r.get("job") or r.get("purpose") or "(none)"].append(r)
    for k, v in sorted(by.items(), key=lambda kv: -sum(cost(x)[0] for x in kv[1])):
        print("  %-20s rows=%-4d $%.4f unpriced=%d" % (k, len(v), sum(cost(x)[0] for x in v), sum(cost(x)[1] for x in v)))


if __name__ == "__main__":
    main()
