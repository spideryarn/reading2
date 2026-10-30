"""Print what an agent said and called after each push hint in one transcript (first N items)."""
import json, sys
path, N = sys.argv[1], int(sys.argv[2])
HINT = 'Push hint (never blocks)'
E = [json.loads(l) for l in open(path) if l.strip()]
for i, e in enumerate(E):
    a = e.get('attachment') or {}
    if a.get('type') == 'hook_additional_context' and any(HINT in c for c in a.get('content') or []):
        print('=== hint at', e.get('timestamp'), [c for c in a['content'] if HINT in c][0][90:330])
        k = 0
        for f in E[i+1:]:
            m = f.get('message') or {}
            if f.get('type') != 'assistant' or not isinstance(m.get('content'), list): continue
            for c in m['content']:
                if c.get('type') == 'text': print('  T:', c['text'][:260].replace('\n', ' ')); k += 1
                elif c.get('type') == 'tool_use': print('  C:', c['name'], json.dumps(c['input'])[:200]); k += 1
            if k >= N: break
