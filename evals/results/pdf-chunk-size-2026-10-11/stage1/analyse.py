"""PDF transcription calls (purpose 'pdf') from ai_calls dumps: fit, per-extract table, prediction.
Usage: python3 -I analyse.py local.json prod.json"""
import json, sys, collections, statistics as st, random
from datetime import datetime

WAVE_S = 3.0          # a call starting within this many seconds of the step's first call is "first wave"
SMALL = 0.6           # a later call with input < SMALL x median first-wave input is "recover-like" (one page)
ERA = {"local": "2026-09-04T21:00", "prod": "2026-09-05T00:00"}  # width 100 from here (commit 954c23c48)

def ts(s): return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def load(path, src):
    rows = json.load(open(path))["rows"]
    for r in rows:
        r["src"] = src; r["s"] = ts(r["started_at"]); r["f"] = ts(r["finished_at"])
        r["d"] = (r["duration_ms"] or 0) / 1000; r["o"] = r["output_tokens"] or 0; r["i"] = r["reported_input_tokens"] or 0
    return [r for r in rows if r["started_at"] >= ERA[src]], rows

def fit(xs, ys):
    mx, my = st.mean(xs), st.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs); sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx; a = my - b * mx
    ss_res = sum((y - a - b * x) ** 2 for x, y in zip(xs, ys)); ss_tot = sum((y - my) ** 2 for y in ys)
    return a, b, 1 - ss_res / ss_tot, (ss_res / (len(xs) - 2)) ** 0.5

def q(v, p): v = sorted(v); return v[min(len(v) - 1, int(p * len(v)))]

wide, allrows = [], []
for path, src in zip(sys.argv[1:], ["local", "prod"]):
    w, a = load(path, src); wide += w; allrows += a

print("ALL ERAS rows:", len(allrows), "models:", collections.Counter((r["src"], r["answered_model"]) for r in allrows))
print("outcomes:", collections.Counter((r["src"], r["outcome"], r["failure_class"], r["failure_status"]) for r in allrows))
print("attempt column:", collections.Counter(r["attempt"] for r in allrows))

ok = [r for r in wide if r["outcome"] == "ok" and r["o"] > 0]
print(f"\nWIDTH-100 era ok rows: {len(ok)} (local {sum(r['src']=='local' for r in ok)}, prod {sum(r['src']=='prod' for r in ok)})")
for name, sub in [("all", ok), ("gpt-5.6-luna", [r for r in ok if r["answered_model"] == "openai/gpt-5.6-luna"]),
                  ("gpt-6-luna", [r for r in ok if r["answered_model"] == "openai/gpt-6-luna"]),
                  ("prod", [r for r in ok if r["src"] == "prod"]), ("local", [r for r in ok if r["src"] == "local"])]:
    if len(sub) < 5: continue
    a, b, r2, se = fit([r["o"] for r in sub], [r["d"] for r in sub])
    ratio = [r["d"] / (a + b * r["o"]) for r in sub]
    tps = [r["o"] / r["d"] for r in sub if r["d"] > 0]
    print(f"  fit[{name}] n={len(sub)} a={a:.1f}s b={b*1000:.2f}s/1k-tok R2={r2:.3f} resid-sd={se:.1f}s "
          f"actual/pred p10={q(ratio,.1):.2f} p50={q(ratio,.5):.2f} p90={q(ratio,.9):.2f} max={max(ratio):.2f} | tok/s p10={q(tps,.1):.0f} p50={q(tps,.5):.0f} p90={q(tps,.9):.0f}")
# input tokens as a second look
a_i, b_i, r2_i, _ = fit([r["i"] for r in ok], [r["d"] for r in ok]); print(f"  duration~input: R2={r2_i:.3f}")
os_ = sorted(r["o"] for r in ok); ds = sorted(r["d"] for r in ok)
print(f"  output tokens p10/50/90/max {q(os_,.1)}/{q(os_,.5)}/{q(os_,.9)}/{max(os_)}; duration p10/50/90/max {q(ds,.1):.0f}/{q(ds,.5):.0f}/{q(ds,.9):.0f}/{max(ds):.0f}s")
# binned
print("  bins by output tokens: ", end="")
for lo, hi in [(0, 1000), (1000, 2000), (2000, 3000), (3000, 4000), (4000, 5000), (5000, 7000), (7000, 99999)]:
    b_ = [r["d"] for r in ok if lo <= r["o"] < hi]
    if b_: print(f"[{lo}-{hi}) n={len(b_)} med={st.median(b_):.0f}s", end="; ")
print()

A, B, _, _ = fit([r["o"] for r in ok], [r["d"] for r in ok])
RATIOS = [r["d"] / (A + B * r["o"]) for r in ok]

groups = collections.defaultdict(list)
for r in wide: groups[(r["src"], r["run_id"], r["article_id"])].append(r)

def chain(g):
    """Critical path backwards from the last finisher: predecessor = a call that finished <= 5 s before this one started."""
    last = max(g, key=lambda r: r["f"]); path = [last]
    while path[-1]["s"] - g[0]["s"] > WAVE_S:
        cands = [r for r in g if r["f"] <= path[-1]["s"] + 0.5 and path[-1]["s"] - r["f"] < 5]
        if not cands: break
        path.append(max(cands, key=lambda r: r["f"]))
    return path[::-1]

def simulate(g, half, n_sims=400, rng=random.Random(1)):
    """Monte Carlo of one extract. Chunks = first-wave calls (each split in two when half). Each call takes
    (A + B*o) * ratio, ratio drawn from the empirical spread. A chunk is asked again with prob p_reask
    (the extract's own observed later-call rate, per first-wave call), serially, same output size."""
    first = [r for r in g if r["s"] - g[0]["s"] < WAVE_S]
    later = len(g) - len(first)
    fin = {r["i"] for r in first}
    p = len({r["i"] for r in g if r["s"] - g[0]["s"] >= WAVE_S} & fin) / len(first)
    outs = [r["o"] for r in first]
    if half: outs = [o / 2 for o in outs for _ in (0, 1)]
    walls = []
    for _ in range(n_sims):
        w = 0
        for o in outs:
            t = (A + B * o) * rng.choice(RATIOS)
            if rng.random() < p: t += (A + B * o) * rng.choice(RATIOS) + 1
            w = max(w, t)
        walls.append(w)
    return st.median(walls)

print("\nPER EXTRACT (width-100 era, >=3 calls)")
print("src | job | calls | 1st wave | later (reask-like/recover-like) | wall | wave end | slowest 1st | tail after wave | chain | pred now | pred half | half/now | chain-halved")
tot = collections.Counter(); ratios_now, ratios_half, ratios_chain = [], [], []
for k, g in sorted(groups.items(), key=lambda kv: min(r["s"] for r in kv[1])):
    g.sort(key=lambda r: r["s"])
    if len(g) < 3: continue
    t0 = g[0]["s"]
    first = [r for r in g if r["s"] - t0 < WAVE_S]; later = [r for r in g if r["s"] - t0 >= WAVE_S]
    fin = {r["i"] for r in first}
    small = [r for r in later if r["i"] not in fin]   # not a re-ask of a first-wave chunk => recover (one page)
    wall = max(r["f"] for r in g) - t0; wave_end = max(r["f"] for r in first) - t0
    slow = max(r["d"] for r in first)
    path = chain(g)
    # deterministic: halve each call on the critical path's model part, keep its residual and the gaps
    gaps = (path[-1]["f"] - t0) - sum(r["d"] for r in path)
    # full-chunk call: lose half its output; recover chain: half as many single-page calls
    halved = gaps + sum((r["d"] / 2) if r["i"] not in fin else (r["d"] - B * r["o"] / 2) for r in path)
    now, hf = simulate(g, False), simulate(g, True)
    ratios_now.append(wall / now); ratios_half.append(hf / now); ratios_chain.append(halved / wall)
    label = (g[0]["article_slug"] or "")[:18] if k[0] == "local" else (g[0]["job_id"] or "-")[:12]
    print(f"{k[0]:5} | {label:18} | {len(g):3} | {len(first):3} | {len(later)-len(small)}/{len(small)} | {wall:4.0f}s | {wave_end:4.0f}s | {slow:4.0f}s | {max(0,wall-wave_end):4.0f}s | {len(path)} | {now:4.0f}s | {hf:4.0f}s | {hf/now:.2f} | {halved:4.0f}s")
    tot["n"] += 1; tot["first"] += len(first); tot["later"] += len(later); tot["small"] += len(small)
print(tot)

print(f"actual/sim-now median {st.median(ratios_now):.2f} p10 {q(ratios_now,.1):.2f} p90 {q(ratios_now,.9):.2f}")
print(f"MC half/now median {st.median(ratios_half):.2f} range {min(ratios_half):.2f}-{max(ratios_half):.2f}")
print(f"critical-path halved/actual median {st.median(ratios_chain):.2f} p10 {q(ratios_chain,.1):.2f} p90 {q(ratios_chain,.9):.2f}")
