# Hierarchy's structure pass: which effort, which model, and one call or a cascade

Written 2026-10-02 from the eval results of 2026-09-03 and 2026-09-04 and the plans that owned them:
[260902g](../plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md) (the effort
eval), [260903i](../plans/260903i-cheap-frontier-models-for-the-hierarchy-structure-pass.md) (the
cheap-model field) and [260904c](../plans/260904c-hierarchy-structure-in-waves.md) (the cascade).
The full tables stay in `evals/results/`; this is the one place that says what was asked, what
was decided and what was ruled out. The later thinking-off comparison (2026-10-01) is in
[261001c § Hierarchy](261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md),
not here. The live design is [hierarchy.md](../project/structure-step.md).

## The questions

1. Does the structure call (one Sonnet call, the biggest paid step of an ingest) need `medium`
   effort, or does `low` carve the article as well?
2. Could a model priced 10-30x lower do it? Greg, 2026-09-03 (from 260903i):
   > what about some of the other recent models on OpenRouter? Stick with ZDR, won't train on our
   > data, etc. ... maybe DeepSeek v4 Pro, GLM, etc.
3. Does splitting the call into a cascade of smaller calls (waves) make it faster or cheaper?

## What was measured, and the headline numbers

**Effort, `medium` vs `low`** ([hierarchy-effort-2026-09-03.md](../../evals/results/hierarchy-effort-2026-09-03.md);
one 16,846-word article, 184 blocks, ten `medium` draws and eight `low`):
- `low` cost $0.13 per draw against $0.21, and took 74 s against 141 s. It produced a tree 7/8 times
  against 10/10.
- Every mechanical proxy favoured `medium` (2.6x less boundary repair, 0/10 against 3/7 draws
  dropping a depth-2 section). Blind judging reversed that: four judgements (GPT Sol and Claude
  Fable, two draw sets) all ranked `low` first, the free author-heading tree second, both `medium`
  arms below. The named fault against `medium` is welding two of the author's arguments under one
  title.

**Model field** ([hierarchy-cheap-models-2026-09-03.md](../../evals/results/hierarchy-cheap-models-2026-09-03.md);
plan says $2.31 spent, every call reconciled against OpenRouter's generation records and checked as
zero-retention): eight challengers, three articles including a one-heading control, pooled draws.
- Production `medium` and Sonnet `low` each produced a tree 6/7 times; `low` cost 45% less
  ($0.5346 against $0.9708 total).
- `glm-5.3` also 6/7 at about 4.5× less cost, but judged 5th of 6 twice. `glm-5.3-flash`
  was judged 1st/2nd and cost $0.0031 a long article but produced 0/3 on the headingless control.
  `gemini-3.8-flash` (18 s, 10x cheaper) held the best mechanical scores and was judged last in
  both judgements (it welded four sections under one title).
- Sonnet `low` beat `medium` in 8 of 8 blind judgements across the two evals.

**Waves** ([hierarchy-waves-2026-09-04.md](../../evals/results/hierarchy-waves-2026-09-04.md),
then [the corrected real-corpus run](../../evals/results/hierarchy-waves-real-corpus-2026-09-04.md);
command in the latter's header):
- The first run measured an 84-block cut, not the 360-block `constitution` (the copy that should
  have replaced it used `cp -rn`; `matchesManifest: false` on every cell). Found by Sol reading
  `run.json`. Only its reasoning-token finding survived.
- On the real corpus the unpacked `waves` arm threw on 4 of 4 draws (harness faults: a strict
  parser, and an echoed parent range that could mismatch), at 1.7-1.8x the incumbent's cost.
- The old "~6,300 reasoning tokens per call floor" (measured at `high`) is false at `medium`: four of
  eight calls on one run spent under 500. But total reasoning went **up** on the long articles
  (20,969 against 14,177 on `constitution`), so the first write-up's "waves think less" was withdrawn.
- `headings-seeded` (the author's boundaries given to the model, which writes titles and gists) was
  20% cheaper and 24% faster than the incumbent on `gwern-scaling-long`, with seven parts on all
  four draws. Two draws per cell; named the next arm to run, and not shown in the plans to have been
  run since (search of `docs/plans` on 2026-10-02).

## Decisions, and where they live

- **Effort `medium` to `low`**, shipped 2026-09-04. The real-corpus file says an automatic retry
  shipped beside it, but the later implementation record supersedes that: the observed range
  failures were made non-throwing instead, and an automatic retry remained a possible follow-up.
  Reason, from Sol and Fable's argument in the cheap-models file: `low`'s failure is loud and
  recoverable (the build throws, the reader can retry), `medium`'s welding is valid, silent and
  shipped to every reader. Pooled reliability was
  `low` 9/11 against `medium` 10/11 across four articles. The thinking-off check of 2026-10-01
  left it at `low` ([261001c](261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md)).
- **No model change.** Plan 260903i's list: drop gemini-flash, qwen, hy4-preview and both DeepSeek
  arms; `glm-5.3` is the one worth a proper finalist round, not run. Nothing was adopted.
- **Cascade**: 260904c is marked superseded by
  [260904d](../plans/260904d-deepen-fat-sections.md) (deepening wave, behind a switch that is off:
  [hierarchy.md § deepening](../project/structure-step.md#deepening)).

## Dead ends and surprises

- **Provider routing, not the model, caused most failures.** `zdr: true` without a pin load-balances
  across up to 22 upstreams. All four DeepSeek V4 Flash failures were served by DigitalOcean
  (reasoning, no answer); a direct probe of the identical request via OpenInference returned good
  JSON. Pinning that provider returned 429 on both attempts. Reporting it as a model failure
  would have written off the cheapest model on one provider's fault.
- **Five of eight challengers have no `medium`**, and OpenRouter silently remaps an unsupported
  effort to the nearest one. The field ran at `low`, the one rung all share, and `preflight.ts`
  reads the live catalogue before the first call.
- **`max_completion_tokens` beside `max_tokens`** with `require_parameters: true` gave 404 "No
  endpoints found". Dropped.
- **A first-draft claim withdrawn**: "the two arms that passed every article were judged 5th of
  6". One draw each; a second draw broke grok's and glm's perfect records, and `medium` failed the
  control with the same error `low` had failed on, on a draw where `low` passed.
- **A 3-block tail** (an empty paragraph, a stranded footnote, a footer) was left outside the root
  range by three different arms on `openai-huggingface`. Fixed as the root clamp
  ([hierarchy.md § root-clamp](../project/structure-step.md#root-clamp)), not by a model change.
- **A panel killed by the box** (load average 53) was caught by the run's `completedAt` marker.

## Caveats

Whole-recipe comparisons (model, wire, thinking semantics, routing all differ), so nothing isolates
model quality. The effort eval used one article; the later runs added three more. Judges are
models, though two families agreed and the free heading tree ranking second is evidence against
pure style preference. The cost saving is $0.13-0.22 an article, which the plan itself calls not
urgent: the prize was latency and judged quality. Waves latency is inferred from per-call times.

## Re-run

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-low data/gwern-scaling-long
npx tsx evals/hierarchy-structure/verify-costs.ts evals/results/hierarchy-structure/<run-dir>
npm run eval:hierarchy-structure -- --arm waves --arm incumbent --arm smart-low --arm headings-seeded --repeat 2 data/constitution data/gwern-scaling-long
```
Blind judging materials: `evals/results/hierarchy-structure/judging-2026-09-03/` and
`judging-cheap-2026-09-03/`. These calls cost money.

Up: [research.md](../project/research.md)
