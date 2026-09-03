# Sketch run — 2026-09-03T09:11:40.292Z

Prompt version `sketch/2`. Each article has three files here:
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
| openai-huggingface | 36 | 36 | 3 | 1.00 | 11% | 0.0% | 2 | 0 | 216s |

### openai-huggingface

**Cycles of a Secret Civilization** — The piece is a chain of three rise-and-fall civilizations, each one collapsing into the birth of the next, ending in a debate that forks and converges on how to name what happened.

No faults.
