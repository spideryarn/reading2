"""Baseline: for every `git push` an agent ran (any transcript), did it edit a docs/project/*.md within the
next CAP tool calls (from its first push to the next push episode)? Split by period (before the hook / after) and, after,
by whether a hint was shown. Push episodes: pushes in one transcript less than 10 minutes apart are one.
Usage: python3 baseline.py ~/.claude/projects"""
import json, os, re, sys, datetime as dt, collections
root = sys.argv[1]; CAP = 40
HOOK = dt.datetime(2026, 10, 7, 7, 16, tzinfo=dt.timezone.utc)
PUSH = re.compile(r'(^|[;&|(]|\s)git(\s+-\S+(\s+[^-\s]\S*)?)*\s+push(\s|$)')
HINT = 'Push hint (never blocks)'
stats = collections.Counter(); seen = set(); first = None
def ts(e): return dt.datetime.fromisoformat(e['timestamp'].replace('Z', '+00:00'))
for dp, _, fs in os.walk(root):
    if 'spideryarn' not in dp and 'reading2' not in dp: continue
    for fn in fs:
        if not fn.endswith('.jsonl'): continue
        try: E = [json.loads(l) for l in open(os.path.join(dp, fn)) if l.strip()]
        except Exception: continue
        pushes = []
        for i, e in enumerate(E):
            m = e.get('message') or {}
            if e.get('type') != 'assistant' or not isinstance(m.get('content'), list) or 'timestamp' not in e: continue
            for c in m['content']:
                if c.get('type') == 'tool_use' and c['name'] == 'Bash' and PUSH.search(c['input'].get('command', '')):
                    key = (e['timestamp'], c['input']['command'])
                    if key not in seen: seen.add(key); pushes.append(i)
        groups = []
        for i in pushes:
            if groups and (ts(E[i]) - ts(E[groups[-1][-1]])).total_seconds() < 600: groups[-1].append(i)
            else: groups.append([i])
        for g, grp in enumerate(groups):
            start, end = grp[0], (groups[g+1][0] if g+1 < len(groups) else len(E))
            t = ts(E[start]); first = min(first or t, t)
            hinted = any(HINT in json.dumps(E[k].get('attachment') or {}) for k in range(start, end))
            calls, edited = 0, False
            for e in E[start+1:end]:
                m = e.get('message') or {}
                if e.get('type') != 'assistant' or not isinstance(m.get('content'), list): continue
                for c in m['content']:
                    if c.get('type') != 'tool_use': continue
                    calls += 1; inp = c.get('input', {}); s = json.dumps(inp); fp = str(inp.get('file_path', ''))
                    if (c['name'] in ('Edit', 'MultiEdit', 'Write') and '/docs/project/' in fp and '..' not in fp and fp.endswith('.md')) or \
                       (c['name'] == 'Bash' and re.search(r'docs/project/(?!\.\.)[\w/-][\w./-]*\.md', s) and re.search(r'sed -i|perl -pi|open\([^)]*["\']w|write_text|\.write\(', s)):
                        edited = True
                if calls >= CAP: break
            k = 'before' if t < HOOK else ('after, hinted' if hinted else 'after, no hint')
            stats[k, 'n'] += 1; stats[k, 'edited'] += edited
print('earliest push in transcripts:', first)
for k in ('before', 'after, hinted', 'after, no hint'):
    n, e = stats[k, 'n'], stats[k, 'edited']
    print(f'{k:15} push episodes {n:4}  followed by a docs/project edit {e:3} = {e/max(n,1):.1%}')
