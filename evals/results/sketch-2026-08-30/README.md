# Sketch run — 2026-08-30T09:13:41.013Z

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
| noema-mythology-of-conscious-ai | 34 | 34 | 3 | 0.95 | 9% | 0.0% | 0 | 0 | 144s |
| constitution | 32 | 32 | 3 | 0.95 | 16% | 0.0% | 0 | 0 | 124s |
| scaling-hypothesis | 25 | 25 | 3 | 1.00 | 25% | 0.0% | 0 | 0 | 143s |

### noema-mythology-of-conscious-ai

**Converge, Fork, Return** — The essay funnels a wide worry about conscious AI into three psychological biases that converge on 'it's pareidolia,' then into four independent arguments that converge on 'functionalism is shaky,' then forks into two distinct ethical risks, before looping back to its opening warning that mistaking machines for us means underestimating ourselves.

No faults.

### constitution

**Spine with a closing loop** — The constitution runs as a single spine through Anthropic's stated priority order—helpfulness, guidelines, ethics, safety, nature—each part elaborated in article order down the page, before the closing section loops back to endorse the opening commitment to cultivated judgment over rigid rules.

No faults.

### scaling-hypothesis

**Scaling's Spine and Its Shadow** — A seven-step spine — evidence, theory, mechanism, politics, vindication — that ends by turning the same scaling logic on itself and finding it also breeds agency.

No faults.
