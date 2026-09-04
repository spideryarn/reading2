# Waves on the real corpus — 2026-09-04

The corrected run behind
[hierarchy-waves-2026-09-04.md](hierarchy-waves-2026-09-04.md), whose `constitution` turned out to be
an 84-block fixture cut rather than the 360-block document. This one measures the real thing, adds
two arms that had never been run, and **says something quite different**.

```
npm run eval:hierarchy-structure -- --arm waves --arm incumbent --arm smart-low \
  --arm headings-seeded --repeat 2 data/constitution data/gwern-scaling-long
```

`constitution` is 360 blocks under 36 headings; `gwern-scaling-long` is 184 blocks, 16,846 words,
well-headed. Both `matchesManifest: true` this time — checked before quoting anything.

## The headline: the unpacked waves arm is worse on the real corpus, and it fails

Both draws of every cell, summed call time (**not** wall clock — see the caveats):

| arm | constitution (360 blocks) | gwern-scaling-long (184) |
|---|---|---|
| `incumbent` (medium) | $0.293/172s · $0.323/207s — 7, 7 parts | $0.234/164s · $0.253/171s — 6, 7 parts |
| `smart-low` | **$0.264/150s · $0.247/136s** — 7, 7 | **$0.135/81s** — 8 parts; **threw once** |
| `headings-seeded` | $0.339/225s · $0.254/137s — 7, 7 | $0.203/125s · $0.190/130s — 7, 7 |
| `waves` | **threw twice** · $0.517, $0.631 | **threw twice** · $0.385, $0.373 |

`waves` is **0 for 4**. Every other arm produced a tree on both draws except `smart-low`, which was
3 for 4.

### The four `waves` failures are all the harness, and three are one fault

Three of four say *"a later wave answered about a different range than the part it was given"*: the
arm asks each sub-call to echo its parent's range and refuses a mismatch. That is the design fault
GPT Sol named — **an expansion answer must not be able to restate its own range at all**, because
the target ordinal already identifies a parent the code owns. The fourth is the strict-parsing one
below. **None of the four is evidence about the cascade idea**; all four are fixed by construction
once the eval runs the shared production executor, which is what stage 1 of
[the plan](../../docs/plans/260904c-hierarchy-structure-in-waves.md) is for.

**Both `waves` cells threw**, and neither throw is about the idea:

- `constitution`: *"a later-wave response is not valid JSON: a complete JSON document ends at
  position 1,922, and 51 more characters follow it"*. `runWaves` parses with
  `parseJsonFrom(stripFence(raw))`; **production parses with `parseJsonAnswer`**, which finds the
  document inside a preamble or a sign-off and refuses only when a second `{` follows. Production
  would very likely have survived this response. A recipe that parses more strictly than the pipeline
  measures the harness, not the recipe.
- `gwern-scaling-long`: *"a later wave answered about a different range than the part it was given"*.
  The arm asks each sub-call to echo its parent's range back and refuses a mismatch. That is the
  design fault GPT Sol named: **an expansion answer must not be able to restate its own range at
  all** — the target ordinal already identifies a parent the code owns.

Both are fixed by construction once the eval runs the shared production executor, which is what
stage 1 of [the plan](../../docs/plans/260904c-hierarchy-structure-in-waves.md) is for. Until then,
**this arm's throw rate is not evidence about waves.**

## What *is* evidence, and it cuts both ways

### There is no per-call reasoning floor — confirmed, and more strongly than before

`docs/research/260830a-opening-an-article-before-the-toc.md` measured ~6,300 reasoning tokens per
call at `effort: "high"` and concluded a cascade would multiply it. Per call on `constitution`:

```
call 1  (whole article → 7 chapters)   in 49,096   out   985   reasoning     0    11.1s
call 2  (subdivide one chapter)        in  4,307   out   628   reasoning     0     7.3s
call 3                                 in  5,336   out   726   reasoning     0     8.7s
call 4                                 in  2,467   out 1,194   reasoning   488    13.7s
call 5                                 in  7,117   out 3,812   reasoning 3,004    37.6s
call 6                                 in  8,196   out 6,643   reasoning 4,337    59.8s
call 7                                 in 19,339   out 7,645   reasoning 6,871    82.3s
call 8                                 in  9,211   out 9,029   reasoning 6,269    83.1s
```

Four of eight calls spent **under 500 reasoning tokens**, three of them zero. A floor of 6,300 per
call does not exist at `medium`. That finding survives the corpus correction, because it is a
property of the calls and not of the article's length.

### But total reasoning goes *up* on a long article, and I said the opposite

The short-fixture run showed waves using *less* total reasoning than the incumbent (7,628 against
11,184) and the first write-up said so. On the real corpus it is the other way round: **20,969
against 14,177** on `constitution`, **15,810 against 13,378** on `gwern-scaling-long`. More calls
over more prose think more in total, even though no single call thinks much.

**So "waves think less" is withdrawn.** What is true is narrower and still useful: *a scoped call
thinks in proportion to what it is asked*, which is why the cheap calls are cheap — and it means the
saving has to come from **asking fewer, better-scoped questions**, not from the shape alone.

### The expensive calls are the deep ones, and that is what packing is for

Calls 1–4 cost almost nothing and took 7–14 seconds. Calls 5–8 took 37–83 seconds and did most of the
thinking, because each one subdivides a large part with a lot of prose in front of it. Making one
call per parent means the article's biggest parts each get their own long call, serially, per wave.
Packing several parents into one call is what turns four deep calls into one or two.

### Latency still favours waves, even failing and unoptimised

Reconstructed wall clock over three waves (`wave 1 + max(wave 2) + max(wave 3)`) is roughly **108s
against the incumbent's 172s** on `constitution`. Treat that as a lower bound and as an inference:
`run.ts` records no run-level elapsed time, which stage 1 fixes.

### `smart-low` is cheaper, faster and less prone to welding — and it threw once

On `constitution`, both draws: **$0.256 and 143s against the incumbent's $0.308 and 190s** — 17%
cheaper, 25% faster — for the same seven depth-1 parts. On `gwern-scaling-long` its surviving draw
cost $0.135 against $0.244 (45% less) and found **eight parts where the incumbent found six and
then seven**, which is the welding fault happening in front of us: the incumbent fused sections the
author had separated, differently on each draw.

**And it threw once**, on `gwern-scaling-long` r2: *"the node at root > child 7 > child 1 has a range
that runs backwards"*. That is a genuine model fault at `low`, not a harness one — and it is the
*loud* failure mode: `buildTree` refuses, the job card says so, and a Retry re-draws.

Reliability, pooled with the earlier evidence, is the honest counterweight and it is close: **`low`
9 of 11, `medium` 10 of 11** across four articles. The case for `low` is not that it fails less. It
is that its failure is visible and recoverable while `medium`'s named failure — welding the author's
sections under one title — is valid, silent, shipped, and paid by every reader of that article.
**The right response to a louder failure mode is to absorb it**, which is why the automatic retry
that this harness recommended on 2026-09-03 now ships beside the flip rather than after it.

### `headings-seeded` is worth another look

$0.296 and 181s on `constitution` against the incumbent's $0.308 and 190s; **$0.196 and 128s on
`gwern-scaling-long` against $0.244 and 168s** — 20% cheaper and 24% faster — and **seven parts on
both draws of both documents**, where the incumbent gave six then seven. Cheaper, faster and *more
stable* than production, on its first ever run, on two documents.

That is the opposite of what draw 1 alone suggested (225s, the slowest cell in the run), and it is a
reminder of how much a single draw of this stage says. Two draws is still not a finding — but it is
enough to make this the arm to run next, and it bears directly on the plan's open question of whether
wave 1 should be seeded with the author's carving.

## What this run cannot support

- **Two draws per cell.** Nothing here is a rate. `headings-seeded` moved from the slowest cell in
  the run to a contender between its two draws, which is how little one draw says about this stage.
- **Nothing about waves' quality**, because all four cells threw, and because the arm's
  normalise-at-the-end hole means a subtree can be written about one stretch of prose and attached to
  another.
- **No cache figures**, no `providerCostUsd` reconciliation.
- **Wall clock is reconstructed** from per-call `ms` and misses parsing, batching and barrier time.

## What to do

1. **Do not ship the unpacked recipe.** 7–8 calls at 1.7×–1.8× the incumbent's cost, failing 4 for 4,
   is not a trade worth making for latency.
2. **Stage 1, as planned**: shared executor (which fixes all four throws by construction), packing,
   and measured `elapsedMs`.
3. **Flip `EFFORT` to `low`, and ship the automatic retry with it** — done 2026-09-04. The flip is
   supported by this run as well as by the blind judging; the retry is what makes its louder failure
   mode a non-event, and shipping one without the other would be trading a silent fault for a visible
   one and calling it a win.
4. **Run `headings-seeded` properly.** Cheaper, faster and more stable than the incumbent on both
   documents, on its first outing. It is now the most promising unexplored arm, and it bears on
   whether the cascade's wave 1 should be seeded at all.
5. **Re-measure with ≥4 repeats** once the packed executor exists, requiring the direction to hold
   per document rather than pooled.
