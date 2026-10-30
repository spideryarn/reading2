"""Group the push hints an agent was shown into push episodes and say, for each, what followed.
An episode is a run of hints in one transcript less than 10 minutes apart (retries, a merge then a re-push).
Hints copied into a forked subagent's transcript are counted once (same timestamp and text).
For each episode, up to the next episode or CAP tool calls: did the agent
  - say anything about the hint (text matching hint|hook|stale|now false|still true|docs? .* (name|mention|lists?))
  - edit a docs/project/*.md (Edit/Write, a Bash sed -i on one, or a Python script Written then run that names one)
Usage: python3 episodes.py ~/.claude/projects > episodes.tsv"""
import json, os, re, sys, datetime as dt
root = sys.argv[1]; CAP = 40
HINT = 'Push hint (never blocks): these docs name files you changed and were not touched: '
seen = set(); eps = []
def ts(e): return dt.datetime.fromisoformat(e['timestamp'].replace('Z', '+00:00'))
for dp, _, fs in os.walk(root):
    for fn in sorted(fs):
        if not fn.endswith('.jsonl'): continue
        path = os.path.join(dp, fn)
        try: E = [json.loads(l) for l in open(path) if l.strip()]
        except Exception: continue
        idx = []
        for i, e in enumerate(E):
            a = e.get('attachment') or {}
            if a.get('type') == 'hook_additional_context' and any(HINT in c for c in a.get('content') or []):
                key = (e.get('timestamp'), next(c for c in a['content'] if HINT in c))
                if key in seen: continue
                seen.add(key); idx.append(i)
        groups = []
        for i in idx:
            if groups and (ts(E[i]) - ts(E[groups[-1][-1]])).total_seconds() < 600: groups[-1].append(i)
            else: groups.append([i])
        for g, grp in enumerate(groups):
            start, end = grp[0], (groups[g+1][0] if g+1 < len(groups) else len(E))
            named = set()
            for i in grp:
                body = next(c for c in E[i]['attachment']['content'] if HINT in c).split(HINT, 1)[1]
                named |= set(m.group(1) for m in re.finditer(r'(?:^|; )([^;()]+?\.md) \(', body))
            calls, said, edits, scripts = 0, [], [], {}
            for e in E[start+1:end]:
                m = e.get('message') or {}
                if e.get('type') != 'assistant' or not isinstance(m.get('content'), list): continue
                for c in m['content']:
                    if c.get('type') == 'text':
                        t = c['text']
                        if re.search(r'\bhint\b|\bhook\b.{0,40}docs|docs? (the|it) (names|lists)|now (false|stale)|still true', t, re.I):
                            said.append(t[:200].replace('\n', ' ').replace('\t', ' '))
                        continue
                    if c.get('type') != 'tool_use': continue
                    calls += 1
                    inp = c.get('input', {}); s = json.dumps(inp)
                    fp = str(inp.get('file_path', ''))
                    found = re.findall(r'docs/project/(\w[\w/-]*(?:\.\w[\w-]*)*\.md)', s)
                    if c['name'] in ('Edit', 'MultiEdit') and '/docs/project/' in fp and '..' not in fp and fp.endswith('.md'):
                        edits.append(fp.split('/docs/project/', 1)[1])
                    elif c['name'] == 'Write' and fp.endswith('.py') and found: scripts[os.path.basename(fp)] = found
                    elif c['name'] == 'Write' and '/docs/project/' in fp and '..' not in fp: edits.append(fp.split('/docs/project/', 1)[1])
                    elif c['name'] == 'Bash':
                        cmd = inp.get('command', '')
                        if re.search(r'sed -i|perl -pi', cmd) and found: edits += found
                        for sc, fd in scripts.items():
                            if sc in cmd: edits += fd
                        if 'python3 - <<' in cmd and found and re.search(r'write|open\([^)]*["\']w', cmd): edits += found
                if calls >= CAP: break
            eps.append(dict(t=E[start]['timestamp'][:16], file=path.split('projects/')[-1], n=len(grp),
                            named=named, said=said, edits=sorted(set(edits))))
print('episodes', len(eps), 'said', sum(bool(e['said']) for e in eps), 'edited', sum(bool(e['edits']) for e in eps), file=sys.stderr)
for e in sorted(eps, key=lambda e: e['t']):
    print('\t'.join([e['t'], e['file'][:100], str(e['n']), ','.join(e['edits']),
                     ','.join(d for d in e['edits'] if d in e['named']), ' || '.join(e['said'])[:400]]))
