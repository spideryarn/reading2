# Sketch run — 2026-08-30T10:20:25.871Z

Prompt version `sketch/1`. Each article has three files here:
`<slug>.raw.json` (what the model sent, before any checking),
`<slug>.json` (the scene after `readSketch`) and `<slug>.png`.

Prompt: the shipping `SYSTEM` in `src/sketch.ts`.

`flow` is Kendall's tau between a node's height on the canvas and where its
block sits in the article: 1 means the picture runs strictly top-to-bottom
with the piece, 0 means the two are unrelated. It is the one measure that
can catch a beautiful picture that a reader cannot keep their place in.

`widest gap` is the longest stretch of the article that no node points
into, as a fraction of the whole — how much of the piece the picture has
nothing to say about.

**None of these numbers say the picture is good.** They say it is not
broken. Look at the PNGs.

| article | nodes | linked | scenes | flow | widest gap | overlap | overflow | faults | time |
|---|---|---|---|---|---|---|---|---|---|
| noema-mythology-of-conscious-ai | 30 | 30 | 3 | 0.92 | 13% | 0.0% | 1 | 0 | 181s |
| constitution | 33 | 33 | 3 | 0.94 | 16% | 0.0% | 0 | 0 | 194s |

### noema-mythology-of-conscious-ai

**Two Funnels, A Fork, A Loop** — A funnel of psychological temptations converges on 'pareidolia', a funnel of four technical arguments converges on 'functionalism is shaky', that uncertainty forks into two distinct ethical risks, and the close loops back to the opening question of what makes us us.

No faults.

### constitution

**Diverge then chain, looping home** — The document fans out from one mission into four co-equal values (safe, ethical, guideline-following, helpful), then walks through each in turn — but in the reverse order of priority — before closing on Claude's nature and a hoped-for return to the opening mission.

No faults.
