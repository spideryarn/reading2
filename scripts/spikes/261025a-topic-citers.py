"""Trial 261025a: **topic-matched citers** — the works that cite a piece and whose title or
abstract mention its subject — asked of OpenAlex by hand, with the subject words chosen two
code-owned ways and nothing written by a model. Saves each exact query and answer to
output/sources-trial/topic-citers/ (gitignored). No key, anonymous allowance: a few requests.

    python3 -I scripts/spikes/261025a-topic-citers.py

docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md § 5.
"""
import json, os, re, urllib.parse, urllib.request

OUT = "output/sources-trial/topic-citers"
os.makedirs(OUT, exist_ok=True)
MAILTO = "mailto=greg@gregdetre.com"

# The confirmed works (from the trial's Cited by), and every OpenAlex record of the same work.
PIECES = {
    "dropout": ["W2095705004"],
    "extended-mind": ["W393180982", "W4239232206"],  # the same 1998 paper, held twice
    "consciousness-in-ai": ["W4386113651"],
    "agents-md": None,  # filled from the DOI below
}
AGENTS_DOI = "10.48550/arxiv.2602.11988"


def get(url: str, name: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        body = json.load(r)
    json.dump({"url": url, "answer": body}, open(f"{OUT}/{name}.json", "w"), indent=1)
    return body


work = get(f"https://api.openalex.org/works/doi:{AGENTS_DOI}?select=id&{MAILTO}", "agents-md-id")
PIECES["agents-md"] = [work["id"].rsplit("/", 1)[-1]]

for piece, ids in PIECES.items():
    first = get(
        f"https://api.openalex.org/works/{ids[0]}?select=id,display_name,publication_year,keywords,primary_topic&{MAILTO}",
        f"{piece}-work",
    )
    keywords = [k["display_name"] for k in first.get("keywords") or []]
    topic = (first.get("primary_topic") or {}).get("display_name")
    print(f"\n## {piece}: {first['display_name'][:70]} ({first['publication_year']})")
    print(f"   OpenAlex keywords: {keywords[:6]} · primary topic: {topic}")
    # Rule 1: OpenAlex's own top keyword for the work. Rule 2: none (most cited citers, as today).
    for rule, words in (("top-keyword", keywords[0] if keywords else None), ("unfiltered", None)):
        flt = "cites:" + "|".join(ids)
        params = {"filter": flt, "sort": "cited_by_count:desc", "per-page": "10",
                  "select": "display_name,publication_year,cited_by_count"}
        if words:
            params["search.title_and_abstract"] = f'"{words}"'
        url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params) + "&" + MAILTO
        body = get(url, f"{piece}-{rule}")
        print(f"   [{rule}{': ' + words if words else ''}] {body['meta']['count']} citers")
        for r in body["results"][:8]:
            print(f"     {r['publication_year']} · {r['cited_by_count']} · {r['display_name'][:85]}")
