# Does thinking harder write better? — arc, thread and glossary at `high` vs `medium`

Run 2026-08-26. **Why it was run:** GPT Sol's review found that `arc` and `tweets` ask for
`output_config.effort: "high"` and `glossary` for `"medium"`, and that effort is part of the prompt
cache key — so the three emit a byte-identical article and still sit in two different caches
([prompt-caching.md](../../docs/project/prompt-caching.md)).

Aligning them would fix that. The question this answers is what aligning would cost, because the
answer decides which way to align — and "pick one and see" is not an answer when it changes what
readers get.

Two articles, three stages, both efforts. Same code, same model, `SPIDERYARN_PIPELINE_EFFORT`
switching the whole run. **`vocab` is the one that matters** — the proxy for the model still working
from the author's words rather than drifting into its own. `template` rising means more formulaic
writing.

## The numbers

| stage | article | vocab (high) | vocab (medium) | template (high) | template (medium) |
|---|---|---:|---:|---:|---:|
| arc | constitution | 0.80 | 0.80 | 0.00 | 0.00 |
| arc | noema | **0.79** | 0.68 | 0.00 | 0.00 |
| thread | constitution | 0.85 | **0.89** | 0.27 | **0.13** |
| thread | noema | 0.80 | **0.82** | 0.00 | 0.00 |
| glossary | constitution | 0.85 | **0.88** | **0.00** | 0.21 |
| glossary | noema | 0.65 | **0.69** | 0.35 | **0.09** |

Output tokens, which is where effort is actually spent:

| stage | article | high | medium |
|---|---|---:|---:|
| arc | constitution | 2,232 | 493 |
| arc | noema | 344 | 268 |
| thread | constitution | 1,092 | 1,048 |
| thread | noema | 894 | 801 |
| glossary | constitution | 3,257 | 2,689 |
| glossary | noema | 8,590 | 4,032 |

## What it says

**No value wins.** `arc` at medium drops 11 points of vocabulary retention on noema — well past the
"couple of points" that [reorder-quality-before.md](reorder-quality-before.md) sets as the line.
`glossary` at high gets markedly more formulaic on the same article (0.35 against 0.09) and spends
4,558 more output tokens to do it. The thread barely notices either way.

So the settings on disk are already the right ones per stage, and they were not chosen for cache
reasons: arc thinks hard because arc is one sentence per section carrying the whole shape of the
piece, and glossary does not because glossary is twenty short definitions.

**Judgment: do not align.** Aligning trades measured writing quality for a cache that the ordinary
execution path does not collect anyway — ingest stops at `arc`, and tweets and glossary are things a
reader asks for later, usually well past the 5-minute TTL. Paying in output quality for a saving
that is contingent on scheduling is the wrong way round.

What was done instead: the breakpoint is now conditional
([`sharesArticleCache`](../../src/pipeline.ts)), so the write premium is paid only when a stage that
can actually read it is scheduled behind — and the effort table in
[`src/models.ts`](../../src/models.ts) *is* the grouping, so the two can never disagree again.

## What this does not show

Two articles and one run each. `arc` on noema is the single result carrying the "do not align"
conclusion, and one sample of a stochastic process is thin — but it points the same way as the cost
argument, which does not depend on it. Nobody read all twelve outputs side by side; the metrics are
a proxy and the doc that defines them says so.
