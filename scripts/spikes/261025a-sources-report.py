"""Trial 261025a: turn output/sources-trial/<slug>-{dump,free}.json into one readable
markdown file per article (gitignored, beside them). Run after `261025a-sources-trial.ts dump`.

    python3 -I scripts/spikes/261025a-sources-report.py <slug>
"""
import json, sys
slug = sys.argv[1]
base = f"output/sources-trial/{slug}"
d = json.load(open(f"{base}-dump.json"))
try:
    f = json.load(open(f"{base}-free.json"))
except FileNotFoundError:
    f = None
out = [f"# {d['title']}  ({slug})", f"doi {d['doi']} · year {d['published_year']} · {d['word_count']} words · {d['final_url']}", ""]
out.append("## Ledger")
tot = 0
for l in d["ledger"]:
    usd = int(l["nanos"]) / 1e9; tot += usd
    out.append(f"- {l['step_name']}: {l['calls']} calls, ${usd:.3f}, {l['searches'] or 0} searches, {l['ms']} ms")
out.append(f"- **total ${tot:.3f}**\n")
b = d.get("bibliography") or {}
cites = b.get("citations") or b.get("works") or []
out.append(f"## Bibliography: {len(cites)} works\n")
s = d.get("situate")
if s:
    se = s["searched"]
    out.append(f"## Situate: {s['kind']} / {s['angle']} / year {s['year']} · {s['outcome']} · {s['elapsedMs']/1000:.0f} s")
    out.append(f"pages {se['pages']} · citers {se['citers']} (skipped: {se.get('citersSkipped')}) · cited {se['cited']}")
    out.append(f"counts {json.dumps(s['counts'])}\n")
    out.append("**Overview.** " + s["overview"] + "\n")
    for x in s["findings"]:
        out.append(f"- **{x['kind']}** ({x['strength']}) — “{x['quote'][:90]}” — {x['note']}")
        for src in x["sources"]:
            out.append(f"    - [{src['origin']}{' '+str(src.get('year')) if src.get('year') else ''}] {src['title'][:110]} <{src['url']}> — “{src['quote'][:160]}”")
    out.append("\n**Questions.** " + " | ".join(s["questions"]) + "\n")
    out.append("**Queries.**")
    for q in se["queries"]:
        out.append(f"- [{q['group']}/{q['outcome']}/{q['pages']}] {q['q']}")
    out.append("")
r = d.get("reception")
if r:
    out.append("## Reception (stored artefact, raw keys: " + ", ".join(r.keys()) + ")")
    out.append("```json\n" + json.dumps(r, indent=1)[:6000] + "\n```\n")
if f:
    c = f["citedBy"]
    out.append(f"## Cited by: {c['kind']}" + (f" via {c['via']}, {c['count']} citers, {c['returned']} returned" if c['kind']=='found' else ""))
    if c["kind"] == "found":
        for x in c["citers"][:15]:
            out.append(f"- {x.get('year')} · {x.get('citedByCount')} · {x['title'][:110]}")
    n = f["notCited"]
    out.append(f"\n## Not cited: {n['kind']}" + (f", {len(n['works'])} listed, {n['excluded']} excluded" if n['kind']=='found' else ""))
    if n["kind"] == "found":
        for x in n["works"][:25]:
            out.append(f"- {x.get('year')} · {x.get('citedByCount')} · {x['title'][:110]}")
open(f"{base}.md", "w").write("\n".join(out))
print(f"{base}.md")
