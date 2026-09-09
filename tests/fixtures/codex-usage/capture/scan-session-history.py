import json,glob,os,collections
files=sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'),recursive=True))
wm=collections.Counter(); sec=collections.Counter(); plans=collections.Counter()
limit_ids=collections.Counter(); reached=collections.Counter()
newest=None; nfiles_with=0; total=0
for f in files:
    found=False
    try:
        for line in open(f,encoding='utf-8',errors='replace'):
            if '"rate_limits"' not in line: continue
            try: o=json.loads(line)
            except Exception: continue
            rl=(o.get('payload') or {}).get('rate_limits')
            if not isinstance(rl,dict): continue
            found=True; total+=1
            limit_ids[rl.get('limit_id')]+=1
            plans[rl.get('plan_type')]+=1
            reached[rl.get('rate_limit_reached_type')]+=1
            p=rl.get('primary'); s=rl.get('secondary')
            wm[('primary', (p or {}).get('window_minutes'))]+=1
            wm[('secondary',(s or {}).get('window_minutes'))]+=1
            if s: sec[json.dumps(s,sort_keys=True)]+=1
            ts=o.get('timestamp')
            if ts and (newest is None or ts>newest[0]): newest=(ts,rl,f)
    except Exception as e: pass
    if found: nfiles_with+=1
print("session files:",len(files),"with rate_limits:",nfiles_with,"snapshots:",total)
print("window_minutes:",dict(wm))
print("limit_id:",dict(limit_ids)); print("plan_type:",dict(plans)); print("reached:",dict(reached))
print("non-null secondary samples:",list(sec.items())[:5])
if newest:
    print("NEWEST",newest[0],newest[2])
    print(json.dumps(newest[1],indent=1))
