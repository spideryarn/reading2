"""Build the 261101a citations-recall truth files from block dumps, with the manual
adjudications written out below. Prints a check summary per article."""
import json, re, sys, os, unicodedata
from collections import OrderedDict
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ay import PAT, YEAR, STOP

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

def load(name):
    return json.load(open(os.path.join(HERE, name)))

def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().replace("’", "'")

def strip_poss(a):
    return re.sub(r"(’s|'s)$", "", a)

def form_of(m):
    rest = m.group("rest") or ""
    if "et al" in rest:
        return "et-al", None
    mm = re.search(r"(?:and|&)\s+(\S+)$", rest.strip())
    if mm:
        return "two", strip_poss(mm.group(1))
    return "sole", None

def ay_cites(rows, lo, hi, drop=()):
    """Every author-year cite in blocks [lo, hi): dicts with ord, id, a, y, form, second, s."""
    out = []
    for r in rows:
        if not (lo <= r["ordinal"] < hi):
            continue
        t = r["text"]
        for m in PAT.finditer(t):
            a = strip_poss(m.group("a"))
            if a in STOP or a in drop:
                continue
            f, second = form_of(m)
            ys = re.findall(YEAR, m.group("y"))
            # "2021a, b": a bare letter after a lettered year
            tail = re.match(r"((?:,\s*[a-z]\b)+)", t[m.end():])
            if tail and ys and re.search(r"[a-z]$", ys[-1]):
                for L in re.findall(r"[a-z]", tail.group(1)):
                    ys.append(ys[-1][:4] + L)
            for y in ys:
                out.append(dict(ord=r["ordinal"], id=r["id"], a=a, y=y, form=f, second=second, s=m.group(0)))
    return out

def finish(slug, style, works, extra=None, notes=None):
    # ambiguous: surname (folded) + year-without-letter shared with another truth work
    base = {}
    for w in works:
        if w.get("surname") and w.get("year"):
            k = (fold(w["surname"]), str(w["year"])[:4])
            base.setdefault(k, []).append(w)
    for k, ws in base.items():
        if len(ws) > 1:
            for w in ws:
                w["ambiguous"] = True
    keys = [w["key"] for w in works]
    assert len(keys) == len(set(keys)), [k for k in keys if keys.count(k) > 1]
    doc = OrderedDict(slug=slug, style=style, n=len(works))
    if notes:
        doc["notes"] = notes
    doc["works"] = works
    if extra:
        doc.update(extra)
    with open(os.path.join(OUT, f"{slug}.json"), "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    return doc

def group_ay(cites, keyfn, manual_names=None):
    """Group cites into works by keyfn(c) -> (workid, meta). Preserves first-seen order."""
    works = OrderedDict()
    for c in cites:
        wid, meta = keyfn(c)
        if wid is None:
            continue
        w = works.get(wid)
        if not w:
            w = works[wid] = dict(meta=meta, citedIn=[], citingWords=c["s"], forms=set())
        if c["id"] not in w["citedIn"]:
            w["citedIn"].append(c["id"])
        w["forms"].add((c["form"], c["second"]))
    return works

def keyed(works_raw, make):
    """Turn grouped works into truth rows; disambiguate same Surname:Year keys with /coauthor."""
    rows = [make(wid, w) for wid, w in works_raw.items()]
    by = {}
    for r in rows:
        by.setdefault(r["key"], []).append(r)
    for k, rs in by.items():
        if len(rs) > 1:
            for r in rs:
                f = r.pop("_form")
                r["key"] = f"{k}/{f}"
    for r in rows:
        r.pop("_form", None)
    return rows

def form_label(forms):
    f, second = sorted(forms, key=lambda x: (x[0] != "two", x[0]))[0]
    return second if f == "two" else f

report = {}

# ------------------------------------------------------------------ LeCun
rows = load("lecun.json")
cites = ay_cites(rows, 0, 10**6)
W = group_ay(cites, lambda c: ((c["a"], c["y"], c["form"] if (c["a"], c["y"]) == ("Hinton", "2006") else ""), None))
def mk_simple(wid, w):
    a, y, _ = wid
    return dict(key=f"{a}:{y}", surname=a, year=y, inList=False, citedIn=w["citedIn"], citingWords=w["citingWords"], _form=form_label(w["forms"]))
works = keyed(W, mk_simple)
report["lecun"] = finish("10356-a-path-towards-autonomous-mach-spya-jwqnrf", "author-year", works,
    notes="Production article, read only. No reference list in the blocks. Henaff:2019 (Henaff et al., model-predictive policy learning) and Hénaff:2019 (Hénaff et al., CPC) are two works, as in the 261027a hand count; both ambiguous.")

# ------------------------------------------------------------------ Dropout
rows = load("jmlr-v15-srivastava14a-spya-sd3uzs.json")
cites = [c for c in ay_cites(rows, 0, 10**6, drop={"ILSVRC-", "Text", "However"})]
for c in cites:
    if c["a"] == "However":
        c["a"] = "Wang"
W = group_ay(cites, lambda c: ((c["a"], c["y"], c["form"] if (c["a"], c["y"]) == ("Hinton", "2006") else ""), None))
works = keyed(W, mk_simple)
report["jmlr"] = finish("jmlr-v15-srivastava14a-spya-sd3uzs", "author-year", works,
    notes="No reference list in the blocks. Cites inside tables (media blocks) count. Hinton:2006/Salakhutdinov (Hinton and Salakhutdinov, 2006) and Hinton:2006/et-al (Hinton et al., 2006) are two works, as in the hand count.")

# ------------------------------------------------------------------ Clark & Chalmers
rows = load("clark-chalmers-1998-spya-uwb4tn.json")
cites = ay_cites(rows, 0, 10**6)
for c in cites:
    if c["a"] == "Maglio":  # "David Kirsh and Paul Maglio (1994)": first author is Kirsh
        c["a"], c["form"], c["second"], c["s"] = "Kirsh", "two", "Maglio", "David Kirsh and Paul Maglio (1994)"
ch = next(r for r in rows if "Chalmers (forthcoming)" in r["text"])
cites.append(dict(ord=ch["ordinal"], id=ch["id"], a="Chalmers", y="forthcoming", form="sole", second=None, s="Chalmers (forthcoming)"))
cites.sort(key=lambda c: c["ord"])
W = group_ay(cites, lambda c: ((c["a"], c["y"], ""), None))
works = keyed(W, mk_simple)
report["clark"] = finish("clark-chalmers-1998-spya-uwb4tn", "author-year (no comma before year) and footnotes", works,
    notes="Footnote blocks count as body. No reference list. Blocks spya-swankj and spya-fpgbaw are the same paragraph twice; both are in citedIn.")

# ------------------------------------------------------------------ Vaswani
rows = load("arxiv-1706-03762v7-spya-wv4w9s.json")
REF = next(r["ordinal"] for r in rows if r["kind"] == "heading" and r["text"].strip() == "References")
BR = re.compile(r"\[\s*(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\s*\]")
def expand(s):
    out = []
    for part in re.split(r"\s*,\s*", s):
        m = re.match(r"(\d+)\s*[-–]\s*(\d+)$", part)
        out += list(range(int(m.group(1)), int(m.group(2)) + 1)) if m else ([int(part)] if part.strip() else [])
    return out
refs = {}
for r in rows:
    m = re.match(r"\[(\d+)\]\s*(.*)", r["text"])
    if r["ordinal"] > REF and m:
        refs[int(m.group(1))] = (r["id"], m.group(2))
used = OrderedDict()
for r in rows:
    if r["ordinal"] >= REF:
        continue
    for m in BR.finditer(r["text"]):
        for n in expand(m.group(1)):
            u = used.setdefault(n, dict(citedIn=[], words=r["text"][max(0, m.start() - 40): m.end()]))
            if r["id"] not in u["citedIn"]:
                u["citedIn"].append(r["id"])
def entry_surname_year(text):
    first = re.split(r",| and |\. ", text, maxsplit=1)[0].strip()
    first = first.split("&")[0].strip()
    sur = first.split()[-1] if first else None
    ys = re.findall(r"\b(?:19|20)\d\d\b", text)
    return sur, (ys[-1] if ys else None)
works = []
for n in sorted(used):
    rid, txt = refs[n]
    sur, yr = entry_surname_year(txt)
    works.append(dict(key=f"#{n}", number=n, surname=sur, year=yr, inList=True, refBlock=rid,
                      citedIn=used[n]["citedIn"], citingWords=used[n]["words"]))
report["vaswani"] = finish("arxiv-1706-03762v7-spya-wv4w9s", "numbered [n]", works,
    notes="Reference list in the blocks after the References heading, one block per entry; surname/year parsed from the entry (entry 37 reads 'Vinyals & Kaiser, ...').")

# ------------------------------------------------------------------ Layfield
rows = load("fd-src-s41598-023-33209-9-spya-hxekgz-spya-pwtq9e.json")
G = re.compile(r"(?<=[A-Za-z\)\.,;:’'”\]])(\d{1,2}(?:\s?[–\-]\s?\d{1,2})?(?:,\d{1,2}(?:\s?[–\-]\s?\d{1,2})?)*)(?=[\s\.,;:\)]|$)")
# Read by hand: a glued number is a citation only when it follows a word or "et al."
# and is not part of a decimal, unit (cm2), supplementary label (S1), construct
# (eNpHR3.0, CA1), statistic or author affiliation (block 1).
NOT_CITE_BLOCKS = {"spya-wsc84s"}
def is_cite(t, m):
    before = t[max(0, m.start() - 6): m.start()]
    after = t[m.end(): m.end() + 2]
    if re.search(r"\d\.$|[\d]$", before):  # decimal like 33.2
        return False
    if re.search(r"(cm|S|CA|HR|MF|est\.|p=|p =)$", before):
        return False
    if before.endswith(".") and not before.endswith("al."):  # "3.0", "0.13" handled above; "al.18" ok
        # a sentence-final word then number would be "memory.12" which this paper never has
        return False
    if after.startswith("."+"") and re.match(r"\.\d", after):
        return False
    return True
used = OrderedDict()
for r in rows:
    if r["id"] in NOT_CITE_BLOCKS:
        continue
    t = r["text"]
    for m in G.finditer(t):
        if not is_cite(t, m):
            continue
        ns = []
        for part in m.group(1).split(","):
            mm = re.match(r"(\d+)\s?[–\-]\s?(\d+)$", part.strip())
            ns += list(range(int(mm.group(1)), int(mm.group(2)) + 1)) if mm else [int(part)]
        for n in ns:
            u = used.setdefault(n, dict(citedIn=[], words=t[max(0, m.start() - 40): m.end()]))
            if r["id"] not in u["citedIn"]:
                u["citedIn"].append(r["id"])
works = [dict(key=f"#{n}", number=n, surname=None, year=None, inList=False,
              citedIn=used[n]["citedIn"], citingWords=used[n]["words"]) for n in sorted(used)]
assert [w["number"] for w in works] == list(range(1, 71)), [w["number"] for w in works]
report["layfield"] = finish("fd-src-s41598-023-33209-9-spya-hxekgz-spya-pwtq9e", "numbered, superscripts flattened to glued digits", works,
    notes="No reference list in the blocks, so surname/year are null and there is no refBlock. Numbers adjudicated by reading every glued-digit hit: decimals, cm2, S1–S4, eNpHR3.0, CA1, statistics and the author-affiliation line are not citations.")

# ------------------------------------------------------------------ Synesthesia
rows = load("synesthesia-spya-xkeccf.json")
foot = [r for r in rows if r.get("role") == "footnote"]
BODY_END = next(r["ordinal"] for r in rows if r["kind"] == "heading" and r["text"].strip() == "See also")
used = OrderedDict()
for r in rows:
    if r["ordinal"] >= BODY_END:
        continue
    for m in BR.finditer(r["text"]):
        for n in expand(m.group(1)):
            u = used.setdefault(n, dict(citedIn=[], words=r["text"][max(0, m.start() - 40): m.end()], uses=0))
            u["uses"] += 1
            if r["id"] not in u["citedIn"]:
                u["citedIn"].append(r["id"])
order = list(used)
assert order == sorted(order), "first appearance not in numeric order"
assert len(foot) == len(used) == 152
mismatch = []
for n, fb in enumerate(foot, 1):
    t = fb["text"]
    backlinks = 1 if t.startswith("↑") else len(re.match(r"((?:\d+ )+)", t).group(1).split())
    if backlinks != used[n]["uses"]:
        mismatch.append((n, backlinks, used[n]["uses"]))
def ident(t):
    ids = set()
    for pat in [r"doi:\s*(\S+?)\.?(?:\s|$)", r"PMID\s*(\d+)", r"ISBN\s*([\d\-X]+)"]:
        for v in re.findall(pat, t):
            ids.add(v.lower().replace("-", ""))
    m = re.search(r"\"([^\"]{12,})\"", t) or re.search(r"\)\.\s*([^.]{12,})\.", t)
    if m:
        tk = re.sub(r"[^a-z0-9]", "", fold(m.group(1)))
        if len(tk) >= 25:  # short titles ("Synesthesia", "Linda Anderson") name different sources
            ids.add("T:" + tk[:60])
    return ids
def fsur_year(t):
    t2 = re.sub(r"^(↑|(?:\d+ )+)\s*", "", t)
    t2 = re.sub(r"^(?:\[[^\]]*\]\s*)+", "", t2)
    if t2.startswith('"') or t2.startswith("“"):
        sur = None
    else:
        m = re.match(r"([^,;(]+?)(?:,|\s[A-Z]{1,3}[,\s(]|\s\()", t2)
        sur = m.group(1).strip() if m else None
        if sur and len(sur.split()) > 3:
            sur = None
    y = re.search(r"\((?:[^()]*?\s)?((?:1[5-9]|20)\d\d[a-z]?)\)", t2)
    return sur, (y.group(1) if y else None)
canon = []  # list of (ids, [numbers])
num2canon = {}
for n, fb in enumerate(foot, 1):
    ids = ident(fb["text"])
    hit = next((i for i, (cids, _) in enumerate(canon) if ids & cids), None)
    if hit is None:
        canon.append((set(ids), [n]))
        num2canon[n] = len(canon) - 1
    else:
        canon[hit][0].update(ids)
        canon[hit][1].append(n)
        num2canon[n] = hit
# Short-form footnotes that point at a full one elsewhere, read by hand:
# 40 "Simner & Hubbard 2006." = 43 (Simner J, Hubbard EM, December 2006);
# 41 "Flournoy 2001." = 53 (Flournoy T 2001, Des phénomènes de synopsie).
for short, full in {40: 43, 41: 53}.items():
    a, b = num2canon[short], num2canon[full]
    if a != b:
        canon[a][1].extend(canon[b][1])
        canon[a][1].sort()
        for n in canon[b][1]:
            num2canon[n] = a
        canon[b] = (set(), [])
canon = [g for g in canon if g[1]]
works = []
for cids, nums in canon:
    n0 = nums[0]
    fb = foot[n0 - 1]
    sur, yr = None, None
    for n in nums:  # the first alias whose entry names an author and a year
        s2, y2 = fsur_year(foot[n - 1]["text"])
        if s2 and y2:
            sur, yr = s2, y2
            break
    else:
        sur, yr = fsur_year(fb["text"])
        if sur and not yr:
            m = re.search(r"\b((?:19|20)\d\d)\b", fb["text"])
            yr = m.group(1) if m else None
    cited = []
    for n in nums:
        for b in used[n]["citedIn"]:
            if b not in cited:
                cited.append(b)
    w = dict(key=f"#{n0}", number=n0, surname=sur, year=yr, inList=True, refBlock=fb["id"],
             citedIn=cited, citingWords=used[n0]["words"])
    if len(nums) > 1:
        w["aliases"] = [dict(number=n, refBlock=foot[n - 1]["id"]) for n in nums]
    works.append(w)
syn_extra = dict(citationNumbers=152, canonicalWorks=len(works))
report["syn"] = finish("synesthesia-spya-xkeccf", "numbered Wikipedia footnotes [n]", works, extra=syn_extra,
    notes="Body = blocks before 'See also'; See also, Further reading and External links are excluded, as in the hand count. Footnote n is the n-th role=footnote block (checked: first appearances run 1..152 in order, and each footnote's backlink count equals its uses in the body). Footnotes that are the same source (same DOI/PMID/ISBN or title) are one work with aliases.")
print("syn backlink mismatches", mismatch)
print("syn aliases", [w["aliases"] for w in works if "aliases" in w])

# ------------------------------------------------------------------ Butlin
rows = load("arxiv-2308-08708-spya-w598t3.json")
BIB = next(r["ordinal"] for r in rows if r["kind"] == "heading" and r["text"].strip() == "Bibliography")
entries = {}
for r in rows:
    if r["ordinal"] <= BIB:
        continue
    t = r["text"]
    m = re.match(r"\s*(.*?)[,.(]\s*\(?((?:1[89]\d\d|20[0-2]\d)[a-z]?|forthcoming)\)?[,.]", t)
    surs = re.findall(r"(?:^|&\s*|,\s*)((?:van der |van den |van |de |De |O’|Mc)?[A-ZÀ-Þ][\wÀ-ɏ’'\-]+(?: [A-Z][a-z]+)?),\s*(?:[A-Z]\.|[A-Z]\w*\.)", m.group(1) + ",")
    first = re.match(r"\s*([^,]+),", t).group(1)
    entries[r["ordinal"]] = dict(ord=r["ordinal"], id=r["id"], first=first, year=m.group(2), n=len(surs), surs=surs)
cites = ay_cites(rows, 0, BIB, drop={"ERC-", "TWCF-"})
for c in cites:
    if c["a"] == "Team":
        c["a"] = "DeepMind Adaptive Agents Team"
def add(pattern, a, y, form="two", second=None):
    for r in rows:
        if r["ordinal"] < BIB and re.search(pattern, r["text"]):
            cites.append(dict(ord=r["ordinal"], id=r["id"], a=a, y=y, form=form, second=second, s=re.search(pattern, r["text"]).group(0)))
add(r"Michel forthcoming", "Michel", "forthcoming", "sole")
add(r"Russell and Norvig", "Russell", "2010", "two", "Norvig")
cites.sort(key=lambda c: c["ord"])
by_ord = lambda o: entries[o]
MANUAL = {  # (a, y, form, second) -> list ordinal, or None for a work not in the list
    ("Birch", "2020", "et-al", None): 440,   # UAL paper (Birch, Ginsburg & Jablonka): every context is UAL
    ("Birch", "2020", "sole", None): 438,
    ("Clark", "2008", "two", "Kiverstein"): 546,  # list dates Clark & Kiverstein 2007
    ("Tishby", "2000", "sole", None): 644,
    ("Dijkstra", "2019", "sole", None): 487,
    ("Dijkstra", "2023", "sole", None): 490,
    ("LeCun", "2015", "two", "Hinton"): 557,  # "LeCun, Bengio, & Hinton (2015)"
    ("Elmoznino", "2023", "et-al", None): 537,  # "Ji, Elmoznino et al. (2023)": first author Ji
    ("Vaswani", "2017", "et-al", None): 655,  # list 2023
    ("Złotowski", "2015", "et-al", None): 666,  # list spells Zlotowski
    ("Zador", "2022", "et-al", None): 663,  # list 2023
    ("Wu", "2022", "et-al", None): 661,  # list 2023 (DayDreamer)
    ("Oprea", "2020", "et-al", None): 598,  # list 2022
    ("Summerfield", "2022", "sole", None): 638,  # list 2023
    ("Lau", "2022", "et-al", None): None,  # Lau et al. 2022 (quality space); list has only Lau 2022 sole-authored
    ("Michel", "2020", "two", "Lau"): None,  # Michel & Lau 2020; list's 2020 Michel entry is Michel & Morales
    ("Lau", "2021", "two", "Michel"): None,  # "Lau & Michel 2021": perhaps Michel & Lau 2021 reversed; kept as written
    ("Kahn", "2006", "et-al", None): None,  # list has Kahn et al. 2008, a different paper
}
NOTES = {
    ("Lau", "2021"): "cited as 'Lau & Michel 2021'; possibly the list's Michel & Lau 2021 with authors reversed",
    ("Kahn", "2006"): "not in list; the list's Kahn et al. 2008 is a different paper",
    ("Bostrom", "2022"): "not in list; the list's Shulman & Bostrom 2021 is a different paper, cited separately",
}
def agrees(c, e):
    if c["form"] == "sole":
        return e["n"] == 1
    if c["form"] == "two":
        return e["n"] == 2 and fold(e["surs"][1]).startswith(fold(c["second"])[:4])
    return e["n"] >= 3
def resolve(c):
    mk = (c["a"], c["y"], c["form"], c["second"])
    if mk in MANUAL:
        o = MANUAL[mk]
        return ("L", o) if o else ("S", c["a"], c["y"], c["form"], c["second"])
    cands = [e for e in entries.values() if fold(e["first"]) == fold(c["a"]) and e["year"] == c["y"]]
    ok = [e for e in cands if agrees(c, e)]
    if len(ok) == 1:
        return ("L", ok[0]["ord"])
    if len(cands) == 1 and not ok:
        raise SystemExit(f"form disagrees, adjudicate: {c}")
    if len(cands) > 1:
        raise SystemExit(f"several list entries, adjudicate: {c} {[e['ord'] for e in cands]}")
    return ("S", c["a"], c["y"], c["form"], c["second"])
W = group_ay(cites, lambda c: (resolve(c), None))
works = []
for wid, w in W.items():
    c0 = next(c for c in cites if resolve(c) == wid)
    if wid[0] == "L":
        e = entries[wid[1]]
        r = dict(key=f"{c0['a'] if wid[1] != 537 else 'Ji'}:{c0['y']}", surname=c0["a"] if wid[1] != 537 else "Ji", year=c0["y"],
                 inList=True, refBlock=e["id"])
        if e["year"] != c0["y"]:
            r["listYear"] = e["year"]
        if fold(e["first"]) != fold(r["surname"]):
            r["listSurname"] = e["first"]
    else:
        r = dict(key=f"{wid[1]}:{wid[2]}", surname=wid[1], year=wid[2], inList=False)
        if (wid[1], wid[2]) in NOTES:
            r["note"] = NOTES[(wid[1], wid[2])]
    r.update(citedIn=w["citedIn"], citingWords=w["citingWords"], _form=form_label(w["forms"]))
    works.append(r)
by = {}
for r in works:
    by.setdefault(r["key"], []).append(r)
for k, rs in by.items():
    if len(rs) > 1:
        for r in rs:
            r["key"] = f"{k}/{r['_form']}"
for r in works:
    r.pop("_form")
cited_refs = {r["refBlock"] for r in works if r.get("refBlock")}
list_only = [dict(surname=e["first"], year=e["year"], refBlock=e["id"]) for e in entries.values() if e["id"] not in cited_refs]
report["butlin"] = finish("arxiv-2308-08708-spya-w598t3", "author-year, comma-separated lists", works,
    extra=dict(listEntries=len(entries), listOnly=list_only),
    notes="Body = blocks before the Bibliography heading; the reference list is the blocks after it (one entry per block, not role-marked). Each truth work is a work the body cites, adjudicated from the body; inList/refBlock say whether and where the list has it. listYear/listSurname where the list dates or spells it differently. listOnly = list entries no body block cites.")

for k, d in report.items():
    print(k, d["n"], ("listOnly=%d" % len(d["listOnly"])) if "listOnly" in d else "")
