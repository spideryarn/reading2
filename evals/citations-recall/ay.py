"""Propose author-year citation candidates per block. Prints, per block that holds a
year token, each parsed (Surname, year) and the year tokens it could not attribute."""
import json, re, sys

NAME = r"(?:(?:van der|van den|van|de|von|den|der|da|di|le|la|du|dos|del)\s+)?[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F\u0300-\u036F'\u2019\-]+"
YEAR = r"(?:1[6-9]\d\d|20[0-2]\d)[a-z]?"
# Surname [et al.| and Surname | & Surname | , Surname, and Surname] [,] [(] year [, year]*
AUTH = rf"(?P<a>{NAME})(?P<rest>(?:\s+et\s+al\.?|\s+(?:and|&)\s+{NAME}|(?:,\s*{NAME})+,?\s+(?:and|&)\s+{NAME})?)"
PAT = re.compile(rf"{AUTH}(?:'s|’s)?,?\s*\(?\s*(?P<y>{YEAR}(?:\s*[,;]\s*{YEAR})*)")
YR = re.compile(rf"\b{YEAR}\b")
STOP = {"In","The","See","For","And","As","This","Since","From","By","Of","Figure","Table","Section","Fig","Eq","Equation","Appendix","Chapter","January","February","March","April","May","June","July","August","September","October","November","December","Spring","Summer","Fall","Winter","Proceedings","Conference","Vol","Volume","Page","Pages","Also","E.g","But","Thus","Note","Since","Before","After","Until","Around","Circa","AD","BC","CE","Retrieved","Archived","Year"}

def cands(text):
    out = []
    covered = set()
    for m in PAT.finditer(text):
        a = m.group("a")
        if a in STOP:
            continue
        years = re.findall(YEAR, m.group("y"))
        for y in years:
            out.append((a, y, m.group(0)))
        for ym in YR.finditer(text, m.start("y"), m.end("y")):
            covered.add(ym.start())
    loose = [ (ym.group(0), text[max(0,ym.start()-40):ym.end()+5]) for ym in YR.finditer(text) if ym.start() not in covered]
    return out, loose

if __name__ == "__main__":
    path = sys.argv[1]
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
    rows = json.load(open(path))
    for r in rows:
        if not (lo <= r["ordinal"] < hi):
            continue
        c, loose = cands(r["text"])
        if not c and not loose:
            continue
        print(f"## {r['ordinal']} {r['id']} {r['kind']} {r.get('role')}")
        print("   C:", "; ".join(f"{a}:{y}" for a, y, _ in c))
        for y, ctx in loose:
            print("   ?:", y, "|", ctx.replace("\n", " "))
