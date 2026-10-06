# Independent arithmetic for the 2026-10-06 review. Run from the repository root:
# python3 -S docs/plans/261006e-review-colours.py
# Source-over mixes encoded sRGB; OKLab and contrast use decoded linear RGB.
import math, json, re
from pathlib import Path
base=Path('styles/tokens.css').read_text().split(':root[data-theme="light"] {')[0]
web=Path('src/web/styles/tokens.css').read_text().split(':root[data-theme="light"] {')[0]
scales=Path('styles/colourscales.css').read_text().split(':root[data-theme="light"] {')[0]
def tok(css,n): return re.search(r'\s'+re.escape(n)+r':\s*([^;]+);',css)[1]
def dec(c):
    c/=255
    return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def enc(c): return 255*(12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055)
def lab(rgb):
    r,g,b=map(dec,rgb)
    l=(.4122214708*r+.5363325363*g+.0514459929*b)**(1/3)
    m=(.2119034982*r+.6806995451*g+.1073969566*b)**(1/3)
    s=(.0883024619*r+.2817188376*g+.6299787005*b)**(1/3)
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s]
def rgb(lab):
    L,A,B=lab
    l=(L+.3963377774*A+.2158037573*B)**3
    m=(L-.1055613458*A-.0638541728*B)**3
    s=(L-.0894841775*A-1.291485548*B)**3
    return list(map(enc,[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s]))
def grey(css,n): return [enc(float(re.search(r'oklch\(([\d.]+)',tok(css,n))[1])**3)]*3
def mix(f,b,a): return [a*x+(1-a)*y for x,y in zip(f,b)]
def lum(c): return sum(x*w for x,w in zip(map(dec,c),[.2126,.7152,.0722]))
def cr(a,b):
    x,y=sorted([lum(a),lum(b)])
    return (y+.05)/(x+.05)
def dist(a,b): return math.dist(lab(a),lab(b))
def chroma(c): return math.hypot(*lab(c)[1:])
page=grey(base,'--background'); ink=grey(base,'--foreground'); soft=grey(web,'--ink-soft')
muted=grey(base,'--muted'); orange=[219,138,69]
link=rgb(mix(lab(orange),lab([255]*3),.85))
cat=[list(map(float,tok(scales,f'--cat-{i}-rgb').split())) for i in range(16)]
variants={'lavender':([204,151,243],.28,.36),'yesterday':([151,48,208],.48,.60),'now':([143,70,189],.48,.58)}
rows={}
for name,(colour,lo,hi) in variants.items():
    faint=mix(colour,page,.7*lo); strong=mix(colour,page,hi)
    rows[name]={'source_L':lab(colour)[0],'source_C':chroma(colour),'source_h':math.degrees(math.atan2(lab(colour)[2],lab(colour)[1]))%360,'faint_C':chroma(faint),'strong_C':chroma(strong),'faint_distance':dist(faint,page),'faint_contrast':cr(faint,page),'ink':cr(ink,strong),'soft':cr(soft,strong),'link':cr(link,strong),'muted_soft':cr(soft,mix(colour,muted,hi)),'blue':cr(cat[4],strong),'tier_contrast':cr(mix(colour,page,.88*lo),mix(colour,page,.88*hi)),'gap':cr(page,strong),'glossary':cr(mix(orange,strong,.7),strong),'xref':cr(mix(soft,strong,.55),strong)}
print('TABLE',json.dumps(rows,indent=2))
print('SOURCE chroma cut',1-rows['now']['source_C']/rows['yesterday']['source_C'])
print('new colour at old heavy strength: muted soft',cr(soft,mix(variants['now'][0],muted,.6)))
print('strength-only .42/.54: faint C/distance',chroma(mix(variants['yesterday'][0],page,.7*.42)),dist(mix(variants['yesterday'][0],page,.7*.42),page))
L,A,B=lab(variants['yesterday'][0])
three_quarters=list(map(round,rgb([L,.75*A,.75*B])))
print('three quarters source chroma, rounded RGB',three_quarters,'faint distance',dist(mix(three_quarters,page,.7*.48),page))
for heavy in [.58,.575,.57]:
    print('three quarters heavy',heavy,'muted soft',cr(soft,mix(three_quarters,muted,heavy)),'tier contrast',cr(mix(three_quarters,page,.88*.48),mix(three_quarters,page,.88*heavy)))
old,new=variants['yesterday'],variants['now']
for hit in [0,.35,.45,.5,.675,.8,1]:
    a=.35+.65*hit
    print('OUTLINE hit-a',hit,'alpha',a)
    for i,col in enumerate(cat):
        fills=[mix(v[0],page,v[2]) for v in [old,new]]
        cs=[cr(mix(col,f,a),f) for f in fills]
        if cs[1]<cs[0]-.0005: print(i,*[round(x,6) for x in cs], 'loss',round(cs[0]-cs[1],6))
for name,ground in [('page',page),('card',grey(base,'--card')),('panel',grey(base,'--sidebar')),('muted',muted),('raised',grey(web,'--surface-raised'))]:
    print('GROUND',name)
    for desc,fn in [('ink',lambda f:cr(ink,f)),('soft',lambda f:cr(soft,f)),('link',lambda f:cr(link,f)),('blue',lambda f:cr(cat[4],f)),('glossary',lambda f:cr(mix(orange,f,.7),f)),('xref',lambda f:cr(mix(soft,f,.55),f)),('gap',lambda f:cr(page,f)),('faint_distance',lambda f:dist(f,ground)),('faint_chroma',chroma)]:
        alpha=1 if desc.startswith('faint') else 2
        fills=[mix(v[0],ground,.7*v[1] if alpha==1 else v[2]) for v in [old,new]]
        cs=[fn(f) for f in fills]
        print(desc,*[round(x,6) for x in cs])
for hue in ['yellow','green','blue','pink']:
    L,C,H,p=map(float,re.search(r'oklch\(([\d.]+) ([\d.]+) ([\d.]+)\) (\d+)%',tok(web,'--hl-'+hue)).groups())
    wash=rgb(mix([L,C*math.cos(math.radians(H)),C*math.sin(math.radians(H))],lab(page),p/100))
    print('WASH',hue,'rgb',wash)
    for end in ['faint','strong']:
        fills=[mix(v[0],page,.7*v[1] if end=='faint' else v[2]) for v in [old,new]]
        print(end,'distance',[dist(wash,f) for f in fills],'contrast',[cr(wash,f) for f in fills])

for end, alphas in [('faint', (.336, .336)), ('last light', (.4224, .4224)), ('first heavy', (.528, .5104)), ('strong', (.6, .58))]:
    fills=[mix(v[0],page,a) for v,a in zip([old,new],alphas)]
    print('ENDPOINT',end,'gap',[cr(page,f) for f in fills],'glossary',[cr(mix(orange,f,.7),f) for f in fills],'xref',[cr(mix(soft,f,.55),f) for f in fills])
    for hit in [.35,.45,.675,.8,.9]:
        losses=[]
        for i,c in enumerate(cat):
            cs=[cr(mix(c,f,.35+.65*hit),f) for f in fills]
            if cs[0]-cs[1]>.0005: losses.append((i,*[round(x,6) for x in cs]))
        print('outline hit-a',hit,'losses',losses)
