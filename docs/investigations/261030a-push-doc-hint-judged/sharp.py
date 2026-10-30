"""Sharper measure: among lineage commits after a hint (window W), did one change a line of a
named doc that mentions one of the files the hint gave for that doc? Prints counts and the cases."""
import subprocess, sys, re, datetime as dt
sys.argv = [sys.argv[0], '.', '.git/push-doc-hint.log']
exec(open(__file__.rsplit('/',1)[0] + '/analyse.py').read().split("print(f'distinct")[0])
lines = {}
for line in open(logf):
    ts, head, shown = line.rstrip('\n').split('\t')
    lines.setdefault(head, shown)
def diff_lines(c, doc):
    out = git('show', '--format=', '-U0', c, '--', 'docs/project/' + doc)
    return [l for l in out.splitlines() if l[:1] in '+-' and not l.startswith(('+++', '---'))]
for W in (6, 24):
    n_hint, cases = 0, []
    for r in rows:
        pairs = {m.group(1): [x.strip() for x in m.group(2).split(',')]
                 for m in re.finditer(r'(?:^|; )([^;()]+?\.md) \(([^)]*)\)', lines[r['head']])}
        cs = [c for c in r['desc'] if r['t'] < commits[c]['t'] <= r['t'] + W*3600
              and len(commits[c]['parents']) == 1 and first_parent_has(c, r['H'], r['t'] - 86400*3)]
        found = []
        for c in cs:
            for doc in commits[c]['docs'] & set(pairs):
                dl = diff_lines(c, doc)
                names = [f for f in pairs[doc] if any(f in l for l in dl)]
                if names: found.append((c[:9], doc, names))
        if found: n_hint += 1; cases.append((r['ts'], r['head'], found))
    print(f'window {W}h: hints followed by an edit to a line naming the hinted file: {n_hint}/{len(rows)} = {n_hint/len(rows):.1%}')
    if W == 24:
        for ts, h, f in cases:
            for c, doc, names in f:
                subj = git('log', '-1', '--format=%s', c).strip()
                print(f'  {ts} {h} -> {c} {doc} {names} | {subj[:90]}')
