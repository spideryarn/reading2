# Cheap frontier models for the hierarchy structure pass

Greg, 2026-09-03:

> Ok, what about some of the other recent models on OpenRouter? Stick with ZDR, won't train on our
> data, etc. Try running some evals on them. Use Sonnet to get the latest web results for
> intelligence at low prices, e.g. maybe DeepSeek v4 Pro, GLM, etc.

The structure pass is one call to `anthropic/claude-sonnet-5` at `medium` effort, and on a
17,000-word article it costs about $0.13–0.24 — the largest single line in an ingest
([cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md)). The
question is whether a model priced 10–30× lower carves an article as well.

This follows [260902g](260902g-estimate-article-ingestion-and-mode-generation-costs.md) and the
effort eval it produced, whose finding sets the terms here:
[hierarchy-effort-2026-09-03.md](../../evals/results/hierarchy-effort-2026-09-03.md). Two things
carry over. **Blind judging is the primary outcome** — every mechanical measure in `score.ts` was
won by the arm the judges ranked below. And **`low` beat `medium`** for Sonnet, unanimously, so
`low` is not a concession here.

## What ZDR costs us, before any model is chosen

Greg's constraint is a routing constraint, and it is real rather than a formality. Challenger arms
send `provider: { zdr: true, require_parameters: true }`
([`arms.ts` § `ZDR`](../../evals/hierarchy-structure/arms.ts)), which narrows each model to the
upstreams OpenRouter lists at `GET /api/v1/endpoints/zdr`. `tencent/hy4-preview` has exactly one, so
its latency is that one provider's latency and nobody else's.

The incumbent arms deliberately do **not** send it, because production does not. An incumbent routed
differently from production is not the incumbent — the same rule that produced `PRODUCTION_EFFORT`.
That asymmetry is a known limitation of this run and is stated in the results file.

## The two traps found before any money was spent

Both are the house failure mode — a request that succeeds while doing something other than what it
says ([silent-success.md](../reusable/silent-success.md)).

**1. Most of the field has no `medium`.** From OpenRouter's own catalogue, read 2026-09-03:

| model | `reasoning.supported_efforts` |
|---|---|
| deepseek v4 flash, v4 pro, glm-5.3, glm-5.3-flash | `max, high, low` |
| qwen3.8-27b | `xhigh, medium, low` |
| gemini-3.8-flash, grok-4.3 | `high, medium, low` |

The obvious bake-off — every challenger at production's `medium` — would have sent **five of the
eight** a value they do not have. OpenRouter answers 200, and it does not refuse an unsupported
effort: it **maps the request onto the nearest level the model does have**. So the results file
would carry a "medium" column measuring some other rung, chosen by the router and differing per
model, with nothing in any response to give it away. So the field runs at **`low`**, the one value
all eight share, with `incumbent` (Sonnet at `medium`) kept as production's own number and
`smart-low` (Sonnet at `low`) as the nearest reference point.

**`smart-low` is a reference point, not a control** — GPT Sol's correction, and it stands. A
candidate differs from it in model family, wire, thinking semantics, routing, upstream, sampling
defaults, and what a given vendor means by `low`. Every challenger is a `bakeoff` arm, so nothing
here can say a candidate is intrinsically better or worse than Sonnet.

Pinned two ways: `tests/hierarchy-structure-eval.test.ts` § "the challenger field" compares the arm
against the table, seen red — and because both are literals in one file, which proves only
consistent typing, [`preflight.ts`](../../evals/hierarchy-structure/preflight.ts) asks OpenRouter's
live catalogue immediately before the first call and archives the answer into `run.json`.

**2. `max_completion_tokens` made the routing set empty.** It had been sent beside `max_tokens` as
belt-and-braces, on the premise that providers ignore parameters they do not take.
`require_parameters: true` is exactly the flag that revokes that premise. Measured one variable at a
time on two candidates: bare, `+reasoning`, `+provider.zdr` and `+require_parameters` all return 200
and bill normally; adding `max_completion_tokens` returns **404 "No endpoints found that can handle
the requested parameters"**, with and without `zdr`. Dropped — every model this wire serves lists
`max_tokens`, Luna included, so the second spelling was never buying anything.

## The field

Eight models, chosen to span vendors and price tiers rather than to be a top-eight of anything, all
with at least one zero-retention endpoint able to serve the ~48k `max_tokens` this stage asks for.
The table lives in [`arms.ts` § `CANDIDATES`](../../evals/hierarchy-structure/arms.ts) with prices
and effort lists; Sonnet is $2.00/$10.00 per MTok for comparison.

Three models were considered and dropped — `nvidia/nemotron-3.5-lightning`, `minimax/minimax-m3`,
`moonshotai/kimi-k2.6`. All advertise `reasoning` but **not `reasoning_effort`**, so there is no
setting to hold equal and their arm would be "whatever the provider felt like".

## Stages — all done, 2026-09-03

Results: [hierarchy-cheap-models-2026-09-03.md](../../evals/results/hierarchy-cheap-models-2026-09-03.md).
**Total spend $2.31** of the ~$20 authorised, every call reconciled against OpenRouter's own
generation records, every challenger call confirmed on a zero-retention upstream.

1. **Calibration** ✅ — three arms on the 561-word fixture, $0.0152.
2. **Screening** ✅ — all eight plus `smart-low`, `incumbent` and the free heading tree on the
   16,846-word fixture, $0.5879 over 10 calls.
3. **Finalists** ✅ — the survivors on two more articles, including a **one-heading control** where
   the author's headings cannot help. Then a two-draw panel, because the single-draw reliability
   reading turned out to be noise.
4. **Blind judging** ✅ — two sets, two judges from different families, four verdicts.

## What came out of it

**The answer is not a model.** Most failures were caused by the gateway's provider routing, not by
the model: all four DeepSeek failures were served by DigitalOcean returning reasoning and no answer,
while every other DeepSeek call succeeded. `zdr: true` with no pin load-balances across up to
twenty-two upstreams of very uneven quality; pinning gave 429s instead. Choosing a model is the easy
half.

**The actionable finding is about effort.** Sonnet `low` and `medium` produced a tree equally often
(6/7 each), `low` is 45% cheaper and about twice as fast, and it was judged better in **eight blind
judgements out of eight** across this eval and the effort eval. Recommended, with a retry at
`medium` on a `buildTree` throw — **not done here**, because the retry restructures
`generateHierarchy`'s call/parse/build path and adds a latency trade-off on a reader-facing call,
which is Greg's call to make rather than inherit.

**Three claims in the first draft were withdrawn.** Single draws were read as reliability records;
a two-draw panel broke `grok`'s and `glm-5.3`'s perfect records, and — the load-bearing one —
production `medium` failed the control article with the *same* error `low` had failed on, on a draw
where `low` passed. Claude Fable named that inversion as the brief's least-supported claim before
the panel confirmed it.

**A bug worth chasing separately:** three different arms failed `openai-huggingface` by leaving the
same 3 tail blocks outside the root's range. That is a fact about the article, and investigating it
needs no model call.

## The simpler option passed over

**Just switch to the cheapest model that produces valid JSON.** Rejected because the previous run
established that validity and the mechanical scores do not predict which tree a reader can navigate
— the arm with 2.6× less repair lost every blind judgment. Cheapness is only worth having if the
carving survives, and the only instrument that has detected a carving difference here is a judge who
does not know which arm made which tree.

## What this run cannot answer

- Whether a winner would still win at `medium`, since six of the eight cannot be asked.
- Whether the ZDR-eligible upstream's latency is representative of that model generally.
- Anything about the **label** pass, which is a separate and larger bill
  ([`src/labels.ts`](../../src/labels.ts)) and is still Sonnet.
