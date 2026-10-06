import json, re, sys
S='/tmp/claude-1000/-home-greg-code-spideryarn2/a08cd297-eeb1-41d6-aeaa-79b8eaf09fcc/scratchpad/'
m=json.load(open(S+'arb-marking.json'))
R='evals/results/skim-cue-2026-10-06-'
mode=sys.argv[1] if len(sys.argv)>1 else 'tally'
if mode=='tally':
  for s in ['s1','s5','s6']:
    kk=json.load(open(R+f'key-{s}.json')); k={e['pair']:e for e in kk['key']}
    j=json.load(open(R+f'judgment-{s}.json'))['judgments']
    f,g=kk['first'],kk['second']
    print(s,f,g,'pairs',len(k),'judged',len(j))
    def tally(sel,name):
        c={q:{f:0,g:0,'tie':0,'both':0,'neither':0} for q in ['a','giveaway','invent']}
        n=0
        for x in j:
            e=k[x['pair']]
            if not sel(e): continue
            n+=1
            for q in c:
                v=x[q]
                c[q][e[v] if v in('A','B') else v]+=1
        print(f'  {name:14} n={n}  prep {f}:{c["a"][f]} {g}:{c["a"][g]} tie:{c["a"]["tie"]} | giveaway {f}:{c["giveaway"][f]} {g}:{c["giveaway"][g]} both:{c["giveaway"]["both"]} | invent {f}:{c["invent"][f]} {g}:{c["invent"][g]} both:{c["invent"]["both"]}')
    tally(lambda e:True,'all')
    tally(lambda e:e['dangling'],'regex28')
    tally(lambda e:e['quoteId'] in m['strict'],'strict13')
    tally(lambda e:e['quoteId'] in m['strict']+m['borderline'],'strict+bord18')
    tally(lambda e:e['quoteId'] in m['not'],'regex-not10')
    if s!='s1':
        for x in j:
            e=k[x['pair']]
            if e['quoteId'] in m['strict']+m['borderline']:
                r=lambda v: e[v] if v in('A','B') else v
                print('     ',e['quoteId'],'S' if e['quoteId'] in m['strict'] else 'b', r(x['a']), r(x['giveaway']), r(x['invent']),'|',x['note'][:170])
else:
    s=mode
    kk=json.load(open(R+f'key-{s}.json')); k={e['pair']:e for e in kk['key']}
    j={x['pair']:x for x in json.load(open(R+f'judgment-{s}.json'))['judgments']}
    t=open(R+f'pairs-{s}.md').read()
    ps=re.split(r'\n## Pair (\d+)\n',t)
    want=set(sys.argv[2:])
    for i in range(1,len(ps),2):
        p=int(ps[i]); e=k[p]; b=ps[i+1]
        tag='S' if e['quoteId'] in m['strict'] else 'b' if e['quoteId'] in m['borderline'] else 'n' if e['quoteId'] in m['not'] else '-'
        if want and tag not in want and str(p) not in want: continue
        q=re.search(r'\*\*The quote:\*\*(.*?)\n',b).group(1).strip()
        ca=re.search(r'\*\*Cue A:\*\*(.*?)\n',b).group(1).strip()
        cb=re.search(r'\*\*Cue B:\*\*(.*?)\n',b).group(1).strip()
        x=j.get(p,{})
        r=lambda v: e[v] if v in('A','B') else v
        print(f'[{p}] {e["quoteId"]} {tag}  judge: {r(x.get("a"))}/{r(x.get("giveaway"))}/{r(x.get("invent"))}')
        print('  Q:',q[:260])
        print(f'  {e["A"]}:',ca); print(f'  {e["B"]}:',cb); print()
