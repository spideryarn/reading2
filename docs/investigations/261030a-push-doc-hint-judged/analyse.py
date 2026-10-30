"""Judge push-doc-hint: for each hint, did a later commit edit a doc it named?
Usage: python3 analyse.py <repo> <logfile>   (prints a summary, writes rows.tsv next to itself)"""
import subprocess, sys, re, os, datetime as dt, random
repo, logf = sys.argv[1], sys.argv[2]
def git(*a): return subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True, check=True).stdout
# Every commit on origin/dev since the hook existed: parents, time, docs/project files touched.
out = git('log', 'origin/dev', '--since=2026-10-06', '--no-renames', '--format=@@%H %ct %P', '--name-only')
commits = {}
cur = None
for line in out.splitlines():
    if line.startswith('@@'):
        f = line[2:].split(); cur = f[0]
        commits[cur] = {'t': int(f[1]), 'parents': f[2:], 'docs': set()}
    elif line.strip() and cur and line.startswith('docs/project/') and line.endswith('.md'):
        commits[cur]['docs'].add(line[len('docs/project/'):])
full = {h[:9]: h for h in commits}
def resolve(short): return git('rev-parse', short).strip()
children = {}
for h, c in commits.items():
    for p in c['parents']: children.setdefault(p, []).append(h)
def descendants(h):
    seen, stack = set(), [h]
    while stack:
        x = stack.pop()
        for ch in children.get(x, []):
            if ch not in seen: seen.add(ch); stack.append(ch)
    return seen
def first_parent_has(c, h, floor):
    x = c
    while x in commits and commits[x]['t'] >= floor:
        if x == h: return True
        ps = commits[x]['parents']; x = ps[0] if ps else None
    return x == h
all_docs = set(l[len('docs/project/'):] for l in git('ls-tree', '-r', '--name-only', 'origin/dev', 'docs/project/').splitlines() if l.endswith('.md'))
seen_heads, rows = set(), []
for line in open(logf):
    ts, head, shown = line.rstrip('\n').split('\t')
    if head in seen_heads: continue
    seen_heads.add(head)
    t = int(dt.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp())
    named = [m.group(1) for m in re.finditer(r'(?:^|; )([^;()]+?\.md) \(', shown)]
    more = re.search(r'and (\d+) more', shown)
    H = resolve(head)
    desc = descendants(H)
    rows.append(dict(ts=ts, t=t, head=head, H=H, named=named, more=int(more.group(1)) if more else 0, desc=desc))
def measure(window_h, lineage):
    hits_hint, named_n, named_hit, ctrl_n, ctrl_hit, examples = 0, 0, 0, 0, 0, []
    for r in rows:
        cs = [c for c in r['desc'] if r['t'] < commits[c]['t'] <= r['t'] + window_h*3600
              and len(commits[c]['parents']) == 1
              and (not lineage or first_parent_has(c, r['H'], r['t'] - 86400*3))]
        edited = set().union(*[commits[c]['docs'] for c in cs]) if cs else set()
        nm = set(r['named'])
        hit = nm & edited
        named_n += len(nm); named_hit += len(hit)
        unnamed = all_docs - nm
        ctrl_n += len(unnamed); ctrl_hit += len(unnamed & edited)
        if hit:
            hits_hint += 1
            examples.append((r['ts'], r['head'], sorted(hit), [c[:9] for c in cs if commits[c]['docs'] & hit]))
    return hits_hint, named_n, named_hit, ctrl_n, ctrl_hit, examples
print(f'distinct hints (by HEAD): {len(rows)}; docs in docs/project now: {len(all_docs)}')
print(f'mean docs shown per hint: {sum(len(r["named"]) for r in rows)/len(rows):.1f}; hints truncated at 10: {sum(1 for r in rows if r["more"])}')
for lineage in (False, True):
    for w in (1, 6, 24, 72):
        hh, nn, nh, cn, ch, ex = measure(w, lineage)
        print(f'{"lineage" if lineage else "any-desc"} window {w:>2}h: hints with a named doc edited {hh}/{len(rows)} = {hh/len(rows):.1%}; '
              f'named-doc edit rate {nh}/{nn} = {nh/nn:.2%}; unnamed-doc rate {ch}/{cn} = {ch/cn:.2%}')
_,_,_,_,_,ex = measure(6, True)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hits-lineage-6h.tsv'), 'w') as f:
    for e in ex: f.write('\t'.join([e[0], e[1], ','.join(e[2]), ','.join(e[3])]) + '\n')
print('lineage 6h hits written:', len(ex))
