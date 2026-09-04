# Waves against the incumbent, first paid run — 2026-09-04

> [!WARNING]
> **This run measured an 84-block `constitution`, not the 360-block one the corpus manifest names**,
> and every cell it produced records `matchesManifest: false`. The worktree seeds `data/` from
> `tests/fixtures/data-root/`, whose `constitution` is an 84-block cut; the copy that was meant to
> replace it with the real corpus used `cp -rn`, which skips files that already exist, so nothing was
> replaced and nothing said so. Found by GPT Sol reading `run.json` rather than the write-up.
>
> **What survives**: the reasoning-token finding below, which is a within-run comparison on identical
> input and does not depend on the article's length. **What does not**: every latency and cost figure
> is from an 84-block and a 72-block document, so nothing here describes a long article, which is the
> case the whole plan is about. The corrected run is
> [hierarchy-waves-real-corpus-2026-09-04.md](hierarchy-waves-real-corpus-2026-09-04.md).

**The question:** does splitting the structure call into a cascade of smaller calls make it faster,
and what does that cost? And underneath it, the one that decides whether the idea is viable at all:
**is there a per-call reasoning floor that more calls would multiply?**

`docs/research/260830a-opening-an-article-before-the-toc.md` § "The cost model was wrong by 3x"
measured **~6,300 reasoning tokens per call regardless of how small the question is**, and concluded
that waves "buy latency and sell cost" — dramatically, at ~39 calls per article. That floor was
measured when this stage ran at `effort: "high"`. It has run at `medium` since 2026-08-30 and
**nobody re-measured it**.

A `waves` arm has existed in `evals/hierarchy-structure/arms.ts` since that research and had never
been run. This is that run.

## What was run

```
npm run eval:hierarchy-structure -- --arm waves --arm incumbent --repeat 2 \
  data/constitution data/fowler-phrenology
```

Two arms × two documents × two interleaved repeats = 8 cells, all of which produced a tree. $1.19.
Raw results: `evals/results/hierarchy-structure/2026-09-04-11-12-21-waves+incumbent/`.

The two documents were *meant* to be the long/well-headed and long/unheaded halves of the corpus's
calibration stratum (`corpus.ts`). `fowler-phrenology` is what it should be — 72 blocks whose eight
headings are all catalogue front-matter in the first ten blocks, so no heading rule can carve it.
**`constitution` was the 84-block fixture cut, not the 360-block document** — see the warning above.

Both arms send byte-identical production bytes through `structureRequest`; `waves` appends a scoped
addendum and is otherwise the incumbent recipe at `PRODUCTION_EFFORT`. Its `deltas` are declared in
`arms.ts`.

## The floor is not a floor at `medium`

**This is the finding, and everything else follows from it.**

`runWaves` passes `structureRequest(body).maxTokens` straight through to wave 1 — the whole-article
budget, the incumbent's own number. So wave 1 and the incumbent differ in **the question asked and
nothing else**: same article, same model, same effort, same ceiling.

| `constitution`, run 1 | reasoning tokens |
|---|---|
| `incumbent` — carve the whole article, three levels | **11,184** |
| `waves` wave 1 — carve the whole article, depth 1 only | **3,423** |
| `waves` waves 2–4 — subdivide one part each | 1,131 · 1,358 · 1,716 |

Across all **17 wave calls** in the run, no call exceeded 3,423 reasoning tokens, wave 1 used
2,231–3,423, and the four incumbent calls used 6,311, 6,553, 8,036 and 11,184. That falsifies a
literal 6,300-token minimum. **It does not establish the stronger claim** that fewer levels generally
makes `medium` Sonnet think much less — that needs the longer and headingless documents, and would
be contradicted if wave-1 medians came back near the incumbent's on either.

A smaller question thinks less, **at an unchanged ceiling**. That is the opposite of what
[260826a-toc-max-tokens.md](../../docs/postmortems/260826a-toc-max-tokens.md) found at `high`, where
adaptive thinking expanded to fill whatever room it was given, and it is why a cascade is worth
building rather than a way of buying latency with money.

It also settles a question the plan had open: **`max_tokens` does not need squeezing.** The effect we
want comes from the question, not from the room, so the budget can stay generous — which matters,
because a tight budget's failure mode is truncation and a truncation costs the whole call.

## Latency and cost

Wall clock is `first call + max(the parallel calls)`, because `runWaves` issues each wave's calls
inside one `Promise.all`. It is an inference from `CallStats.ms` rather than a measurement — see
[what this run cannot support](#what-this-run-cannot-support).

| arm | document | draw 1 | draw 2 | mean |
|---|---|---|---|---|
| `incumbent` | constitution | $0.1484 / 134s | $0.1060 / 83s | **$0.127 / 108s** |
| `waves` | constitution | $0.1670 / 73s | $0.1439 / 60s | **$0.156 / 66s** |
| `incumbent` | fowler-phrenology | $0.1593 / 116s | $0.1189 / 83s | **$0.139 / 100s** |
| `waves` | fowler-phrenology | $0.1737 / 67s | $0.1958 / 85s | **$0.185 / 76s** |

**The pooled means say about 1.4× faster and about 23% dearer, and the pooled means hide the
important thing.** Read the pairs instead:

| pair | waves | incumbent | latency | cost |
|---|---|---|---|---|
| constitution r1 | 73.7s / $0.1670 | 134.9s / $0.1484 | **1.8× faster** | +13% |
| constitution r2 | 74.9s / $0.1439 | 83.3s / $0.1060 | 1.11× faster | +36% |
| fowler r1 | 67.7s / $0.1737 | 116.7s / $0.1593 | 1.7× faster | +9% |
| fowler r2 | 85.6s / $0.1958 | 83.3s / $0.1189 | **no faster** | +65% |

**In two of four pairs there is essentially no latency win**, and the cost premium ranges from 9% to
65%. The incumbent's own two `constitution` draws differ from each other by 51 seconds — more than
the gap being claimed. "Waves are ~74s" is not supportable from this; "there is no per-call reasoning
floor" is.

The cost premium is **re-sent input**: on `constitution` run 1, 21,438 input tokens against the
incumbent's 11,114, because every later call ships its own slice of the article again. Total
reasoning went *down* on three pairs of four (7,628 against 11,184 on r1) and *up* on the fourth
(8,801 against 6,553); the bill went up on all four.

`providerCostUsd` is `null` on every call, so these are in-band figures and the run is not quotable
as provider-reconciled until `verify-costs.ts` has filled them.

**This is the unoptimised arm**, and the two things that would close the gap are both in the plan and
neither is in this code: **packing several parents into one call** (this arm makes one call per long
part, so `constitution` used four and five calls where two would do), and **a cached shared prefix**
(this arm has no `cache_control` anywhere).

## The quality signal, which is one draw and points the other way from the bill

| | parts at depth 1 | fan-out within 5–9 |
|---|---|---|
| `incumbent`, constitution r1 | **2** | 0.33 |
| `waves`, constitution r1 | **7** | 0.15 |

Two parts for an 84-block, well-headed document is the **welding** fault that blind judging named in
[hierarchy-effort-2026-09-03.md](hierarchy-effort-2026-09-03.md) — the incumbent fusing the author's
own arguments under one title, valid and silent and shipped. Waves' seven is much closer to the
free heading tree's carving of the same document.

Waves' fan-out is worse, and that is a real defect rather than noise: the arm subdivides a long part
**once**, with no target for how many children it should produce, so a 12-block part becomes two
children. The plan's answer is a predicted-children target derived from the span. Nothing here says
whether that fixes it.

**Neither figure is a quality verdict.** `score.ts` is mechanical and has pointed the wrong way three
times on this stage; the plan's eval is blind-judged with ≥4 repeats and framed as non-inferiority.

## What this run cannot support

- **The document it thought it was measuring.** See the warning at the top: `constitution` here is
  the 84-block fixture cut. Nothing in this run describes a long article.
- **n = 2 per cell.** The incumbent's two `constitution` draws differ by 51 seconds and 4 cents from
  each other, which is most of the gap being claimed. The latency ratio needs the repeats the plan
  asks for before anything is decided on it.
- **Wall clock is inferred, not recorded.** `run.ts` stores per-call `ms` and no run-level elapsed
  time, so "66s" is arithmetic over the call list and misses whatever sits between calls. Adding
  `elapsedMs` and `firstTextMs` to the harness is stage 1 of the plan, and until then every latency
  number here is a lower bound.
- **Two documents, both long.** Nothing here says what a 19-block post costs, where a cascade's fixed
  overhead has the least to amortise it.
- **No cache figures at all**, because the arm marks no prefix. The plan's caching claims are
  unmeasured.
- **The arm has a known semantic hole**, found by review rather than by running it: `runWaves` slices
  later calls from the *raw* wave-1 ranges but only calls `buildTree` at the end, and
  `planChildRanges` can move those ranges afterwards. A subtree can be written about one stretch of
  prose and finally attached to another, and nothing detects it. **So the latency and cost numbers
  above stand and the titles and gists cannot be trusted** — which is exactly why the plan normalises
  every answer before it becomes input to another call.

## What to do

1. **Build the cascade**, on the strength of the reasoning-token finding and the removed ceiling
   rather than on the 1.4×, which is n=2.
2. **Pack parents into calls, and cache the shared prefix** — the two things that turn a 23% premium
   into something nearer parity, both already in the plan.
3. **Record `elapsedMs`** in the harness before quoting another latency number.
4. **Re-run with ≥4 repeats on three documents** including a short one, blind-judged.

## See also

- [260904c-hierarchy-structure-in-waves.md](../../docs/plans/260904c-hierarchy-structure-in-waves.md)
  — the plan this run was taken for
- [hierarchy-effort-2026-09-03.md](hierarchy-effort-2026-09-03.md) — `medium` vs `low`, and the
  welding fault
- [hierarchy-cheap-models-2026-09-03.md](hierarchy-cheap-models-2026-09-03.md) — the model field, and
  recommendation 3, the tail bug fixed alongside this run
