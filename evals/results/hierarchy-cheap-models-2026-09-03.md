# Cheap models for the hierarchy structure pass, 2026-09-03

**Nine models, three articles, four blind judgements. The headline is not a model — it is that the
gateway's provider routing, not the model, caused most of the failures.**

Plan: [260903i](../../docs/plans/260903i-cheap-frontier-models-for-the-hierarchy-structure-pass.md).
Written by `npm run eval:hierarchy-structure`, every cost OpenRouter's own in-band figure reconciled
per call against its generation records
([`verify-costs.ts`](../hierarchy-structure/verify-costs.ts)), every challenger call confirmed on a
zero-retention upstream ([`verify-zdr.ts`](../hierarchy-structure/verify-zdr.ts)).

This follows [hierarchy-effort-2026-09-03.md](hierarchy-effort-2026-09-03.md), whose finding sets
the terms: **blind judging is the primary outcome, because every mechanical measure in `score.ts`
was won by the arm the judges ranked below.** That happened again here, harder.

## What was asked, and the two traps found before spending

Greg, 2026-09-03: *"what about some of the other recent models on OpenRouter? Stick with ZDR, won't
train on our data… maybe DeepSeek v4 Pro, GLM, etc."*

Eight candidates, spanning vendors and price tiers, each with at least one zero-retention endpoint
able to serve the ~48k `max_tokens` this stage asks for — the table is
[`arms.ts` § `CANDIDATES`](../hierarchy-structure/arms.ts). Three models were dropped before
running: `nvidia/nemotron-3.5-lightning`, `minimax/minimax-m3` and `moonshotai/kimi-k2.6` advertise
`reasoning` but not `reasoning_effort`, so there is no setting to hold equal.

**Five of the eight have no `medium`.** Production runs `medium`, so the obvious bake-off would have
sent five of them a rung they do not have — and OpenRouter does not refuse an unsupported effort, it
**remaps it to the nearest one the model has**. The results file would have carried a "medium"
column measuring some other level, chosen by the router, differing per model, with nothing in any
response to say so. The field therefore runs at **`low`**, the one rung all eight share. Guarded two
ways: a test comparing arm against table, and — because both are literals in one file, which proves
only consistent typing — [`preflight.ts`](../hierarchy-structure/preflight.ts) asks the live
catalogue before the first call and archives the answer into `run.json`.

**`max_completion_tokens` made the routing set empty.** It was sent beside `max_tokens` as
belt-and-braces on the premise that providers ignore parameters they do not take;
`require_parameters: true` is precisely the flag that revokes that premise. Measured one variable at
a time: bare, `+reasoning`, `+provider.zdr` and `+require_parameters` all return 200 and bill
normally; adding `max_completion_tokens` returns **404 "No endpoints found that can handle the
requested parameters"**. Dropped — every model this wire serves lists `max_tokens`, Luna included.

## Reliability across three articles

Three articles: the 16,846-word essay with 24 headings, an 8,283-word essay with 9, and a control —
4,192 words, **one heading**, a 93-block headingless run, so the model must invent every boundary
and the free heading tree cannot compete by construction (it yields a flat root with 95 leaves).

**Draws, not records.** An earlier draft of this file gave one draw per cell and read the results as
reliability records; three of those readings did not survive a second draw, and the corrected
version is below. Counts pool every draw this study took — the five run directories listed at the
end — and exclude the calibration runs and the separate effort eval.

| model | $/MTok in/out | trees produced | total spend | notes |
|---|---|---:|---:|---|
| `z-ai/glm-5.3` | 1.40 / 4.40 | **6/7** | $0.2152 | 3/3 on the control, the only arm that managed that |
| `anthropic/claude-sonnet-5` `medium` **(production)** | 2.00 / 10.00 | **6/7** | $0.9708 | 2/3 on the control |
| `anthropic/claude-sonnet-5` `low` | 2.00 / 10.00 | **6/7** | $0.5346 | 2/3 on the control |
| `deepseek/deepseek-v4-pro-0813` | 1.12 / 3.35 | 3/4 | $0.2486 | its one failure was DigitalOcean |
| `x-ai/grok-4.3` | 1.25 / 2.50 | 5/7 | $0.1396 | passed both shorter articles on draw 1, failed both on draw 2 |
| `z-ai/glm-5.3-flash` | 0.07 / 0.25 | 4/7 | $0.0124 | **0/3 on the control**, same error every time |
| `google/gemini-3.8-flash` | 0.75 / 3.75 | 1/3 | $0.0460 | truncated, then invented a block id |
| `deepseek/deepseek-v4-flash-0731` | 0.07 / 0.18 | 0/4 | $0.0028 | every draw served by DigitalOcean — see below |
| `qwen/qwen3.8-27b` | 0.42 / 2.55 | 0/1 | $0.0350 | backwards range |
| `tencent/hy4-preview` | 0.83 / 2.50 | 1/1 | $0.0786 | 346s, 2.3× slower than production |

**The row that matters: production and Sonnet `low` produced a tree equally often — 6 of 7 each —
and `low` cost 45% less to do it.** There is no reliability case for `medium` in this data.

`glm-5.3` matches that success rate for **4.5× less money**, and is the only arm that passed the
control article on all three draws. It was also judged 5th of six, twice — which is the tension this
eval cannot resolve from here.

Cost and latency on the long article, for the arms that produced a tree:

| arm | latency | cost | vs production |
|---|---:|---:|---|
| production (Sonnet `medium`) | 149s | $0.2216 | — |
| Sonnet `low` | 76s | $0.1342 | 1.7× cheaper |
| `gemini-3.8-flash` | **18s** | $0.0216 | 10× cheaper, 8× faster |
| `grok-4.3` | 22s | $0.0297 | 7× cheaper, 7× faster |
| `glm-5.3` | 83s | $0.0642 | 3.5× cheaper |
| `glm-5.3-flash` | 131s | **$0.0031** | **71× cheaper** |
| `hy4-preview` | 346s | $0.0786 | cheaper, and 2.3× *slower* |
| `deepseek-v4-pro` | 185–289s | ~$0.080 | 2.7× cheaper, slower |

## The provider lottery is the real finding

`zdr: true` with no provider pin load-balances across every zero-retention upstream for the model —
**twenty-two of them** for DeepSeek V4 Flash — and they are not equivalent.

- **All four DeepSeek failures were served by DigitalOcean**, which returned reasoning and no
  answer: 823 completion tokens of which 816 were reasoning, then 82, then 398. Every
  non-DigitalOcean DeepSeek call succeeded — 3 of 3 — and a direct probe of the *identical* request
  returned 6,251 characters of well-formed JSON through OpenInference for $0.0029.
- So for `deepseek-v4-flash`, "this model cannot do the task" and "that one endpoint cannot" are
  perfectly confounded: all three of its draws happened to land on DigitalOcean. **Reported as a
  model failure, this would have written off the cheapest model in the field — and the one Greg
  named — on the strength of one provider.** The probe is what broke the tie.
- **Pinning is not free.** `deepseek-flash-pinned` (the same model, `only: ["OpenInference"]`,
  chosen because the diagnostic probe had used it, before this arm existed) returned **429** on both
  attempts. Pinning trades the lottery for a single point of failure.
- `gemini-3.8-flash` is the exception that proves the rule: Google is its only zero-retention
  provider, so its two failures are its own.

**Choosing a model is the easy half. Any of these would need its provider pinned, and that pin is
then a dependency with no fallback.** Production's Sonnet has this problem least — it pins
`order: ["anthropic"]` with fallbacks allowed.

## Blind judging — the primary outcome

Two judges from different families (GPT Sol; Claude Fable), two arm sets on the long article,
labels shuffled per set, keys never shown, the free heading tree always in the lineup as a non-model
anchor. Sets share both Sonnet arms, so they can be read against each other.
Materials and verdicts: [`hierarchy-structure/judging-cheap-2026-09-03/`](hierarchy-structure).

**Set 1** — Sonnet `medium`, Sonnet `low`, `gemini-flash`, `grok`, `deepseek-pro`, free headings:

| rank | Fable | Sol |
|---|---|---|
| 1 | `deepseek-pro` | free headings |
| 2 | Sonnet `low` | `deepseek-pro` |
| 3 | free headings | Sonnet `low` |
| 4 | **Sonnet `medium`** | **Sonnet `medium`** |
| 5 | `grok` | `grok` |
| 6 | `gemini-flash` | `gemini-flash` |

**Set 2** — Sonnet `medium`, Sonnet `low`, `glm-5.3`, `glm-5.3-flash`, `hunyuan`, free headings:

| rank | Fable | Sol |
|---|---|---|
| 1 | `glm-5.3-flash` | free headings |
| 2 | `hunyuan` | `glm-5.3-flash` |
| 3 | Sonnet `low` | `hunyuan` |
| 4 | **Sonnet `medium`** | Sonnet `low` |
| 5 | `glm-5.3` | `glm-5.3` |
| 6 | free headings | **Sonnet `medium`** |

What survives across all four:

- **Sonnet `low` beat Sonnet `medium` 4 times out of 4**, independently reproducing the previous
  eval's finding on a different arm set.
- **Production placed 4th, 4th, 4th and 6th of six.** The recurring complaint is *welding* — fusing
  two of the author's own distinct arguments under one title, exactly the behaviour the mechanical
  table records neutrally as "fewer parts". One judge called its titles "generic".
- `glm-5.3-flash` (1st, 2nd) and `deepseek-pro` (1st, 2nd) both beat production.
- **`glm-5.3` placed 5th in both — below its own 20×-cheaper `flash` sibling.** Bigger is not better
  here.
- **`gemini-flash` placed last in both set-1 judgements while holding the best mechanical scores in
  the whole field**: zero repairs, the best-balanced carving (cv 0.27), 10× cheaper, 8× faster. Both
  judges independently found the same fault, verified against block numbers — its first entry welds
  four of the article's real sections under a title naming only the first, and the essay's namesake
  Scaling Hypothesis section gets no entry at all.
- The judges disagree sharply on one thing only: the free heading tree (1st for Sol both times; 3rd
  then 6th for Fable). Treat its placement as unsettled.

**This is the third time here that the mechanical scores have pointed the wrong way.** They are
proxies for specific failure modes and they describe the model's raw *proposal*; the judges rate the
*delivered* tree, after `buildTree`'s repairs. Do not rank arms by repair count.

## The inversion I over-read, and the correction

This document first said the crux was an inversion: *the two arms that passed all three articles
(`grok-4.3`, `glm-5.3`) were both judged 5th of six, while both judged winners and the
judged-better Sonnet `low` each failed an article.* **Every cell in that claim was a single draw,
and none of it survived a second one.**

Claude Fable, asked to arbitrate the decision, named that as the least-supported conclusion in the
brief. A two-draw panel run immediately afterwards agreed, three times over:

- **`grok-4.3` failed both shorter articles on its second draw** — an invented block id, then a
  backwards range — having passed both on its first. Its perfect record was luck.
- **`glm-5.3` failed on its second draw** of the 8.3k-word article, likewise.
- **Production `medium` failed the control article with the exact error `low` had failed on** — a
  tree skipping the last 3 blocks — on a draw where **`low` passed it.** The roles simply swapped.

That last one is the important one, because it was the whole objection to changing the effort. It is
not a property of the setting. Three different arms — Sonnet `low`, Sonnet `medium`, `glm-5.3-flash`
— have now failed that article by dropping the same 3-block tail, which makes it **a fact about the
article**, and one worth chasing separately: the piece ends in three blocks that models keep leaving
outside the root's range. `glm-5.3-flash` did it on all three of its draws.

The same panel shows `incumbent` needing **14 repairs moving 43 blocks** on a draw of an article
where its previous draw needed one repair moving one block. Run-to-run variance inside one arm is
larger than most of the gaps between arms.

So the honest version is narrower: *on these draws*, no arm here is failure-free, and reliability
differences at two draws per cell are not measurable. **What is measurable is the judged-quality
gap, because it replicated** — eight blind judgements across two evals, two judge families and two
arm sets, all agreeing.

## The asymmetry that actually decides it

Fable's argument, which corrects the framing above and which I accept:

**The two failure classes are not commensurable.** Sonnet `low`'s control-article failure was a
tiling violation — `buildTree` **throws**, the job card says so, and the reader gets a Retry button.
It is loud, detectable and recoverable. Sonnet `medium`'s welding is **valid, silent and shipped**:
it fuses two of the author's own arguments under one title, nothing in the pipeline can detect it,
and every reader of that article gets the worse map. A results table that lists "failed 1 of 3"
beside "judged 4th of 6" is comparing a cost of one retry against a cost paid by every reader on
every article.

**And the pooled draws make the case stronger than Fable had it.** Its argument assumed `low` fails
more often and reasoned that the failures are cheap; the data says `low` and `medium` produced a
tree equally often (6/7 each), and the control-article failure happened to *both*. So the trade
is not "worse reliability for better carving" — it is **the same reliability, 45% cheaper, twice as
fast, and better carved in eight of eight blind judgements.**

The recommendation is therefore **Sonnet `medium` → `low`**, and a **retry at `medium` when
`buildTree` throws** is worth adding on its own merits rather than as the price of the flip. Retries
today are *manual* — "a retry is a new job today" ([`src/jobs.ts`](../../src/jobs.ts)), a button the
reader presses, which re-runs the same recipe — so an automatic second attempt would help every
article, at either effort, including the 3-block-tail case that bit three different arms.

**Neither is done in this session.** The retry restructures the call/parse/build path of
`generateHierarchy` and adds a latency trade-off on a reader-facing call (a failed `low` plus a
`medium` retry is ~225s against 149s today), which is a trade-off for Greg to decide rather than
inherit. The effort flip is a one-line change and the evidence for it is the strongest thing in
either eval, but it is a production change nobody asked this session to make.

## What to do

1. **Flip the structure pass to `low`.** Same success rate as `medium` on these draws, 45% cheaper,
   about twice as fast, and better carved in eight of eight blind judgements across two evals. One
   line in [`src/hierarchy.ts`](../../src/hierarchy.ts) § `EFFORT`, no new vendor, no ZDR question,
   no provider pin.
2. **Add a retry at `medium` when `buildTree` throws** — now justified on its own, not as the price
   of item 1. Retries are manual today, and an automatic second attempt would cover the 3-block-tail
   failure that hit three different arms.
3. **Chase the 3-block tail on `openai-huggingface`.** Sonnet at both efforts and `glm-5.3-flash`
   all failed it the same way. That looks like a bug or a prompt gap, not a model preference, and it
   is the cheapest quality win here because it needs no model call to investigate.
4. **Run `headings-seeded`.** Still unrun, still the most promising experiment, and this run adds
   evidence: on the 8.3k-word article *every arm* reproduced the free heading tree's top-level split
   exactly, so the paid call bought the level below and the gists, not the carving. It does nothing
   for the headingless case by construction, so it complements a model choice rather than replacing
   one.
5. **`glm-5.3` is the one challenger worth a proper finalist round.** It matched production's 6/7 at
   4.5× less money and was the only arm to pass the control article on all three draws — but it was
   judged 5th of six twice, which is exactly the disagreement between mechanical and judged
   evidence this eval keeps finding. Multi-draw, pinned, judged, before it is believed.
6. **`glm-5.3-flash` is a tempting trap.** 71× cheaper and judged 1st/2nd, and **0 for 3 on the
   headingless article** — the case where a reader has nothing else to navigate by.
7. **Drop `gemini-3.8-flash`, `qwen3.8-27b`, `hy4-preview` and both DeepSeek arms for now.** The
   first managed 1 of 3 while holding the best mechanical scores in the field; the second returned a
   backwards range; the third is 2.3× slower than production; DeepSeek is unresolved because the
   only pinned provider rate-limited both attempts.
8. **Do not read the cost saving as urgent.** The absolute stake is $0.13–0.22 per article in an
   alpha with no readers. The prize on this call is latency and judged quality.

## What this run cannot support

Every challenger differs from Sonnet in model, wire (chat vs Messages), thinking semantics (a fixed
`reasoning.effort` versus adaptive thinking plus output effort), routing (ZDR-constrained versus
production's), upstream, and what a vendor means by `low`. These are **whole-recipe** comparisons;
nothing here isolates model quality, and no gap may be attributed to model choice. One draw per cell
cannot support a reliability rate or a representative latency. `low` does not mean equal reasoning
across vendors. And the ZDR check is *consistency with OpenRouter's own routing records*, not proof
of non-retention — the response label and the endpoint list come from the same control plane.

## An honest note about the panel that died

The first finalist panel was killed by the box at load average 53 with 12 of 16 cells done, no error
and no message. **It was caught by the run's own `completedAt` marker**, added earlier the same day
on GPT Sol's review of this change, and both verifiers refused the directory — 16 expected, 12
recorded, the four missing named. That is the guard working on the day it was written, and without
it the surviving twelve would have looked like a finished panel.
