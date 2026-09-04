# A long PDF finishes without a retry click

Greg uploaded Kuhn's *A Landscape of Consciousness* (2024) — 142 pages, 8.4 MB — to **production**
repeatedly over two days and it never became an article.

> I've been trying to upload this to the production site, and failing for a while. […] ideally it
> would fail in a way that we could tell it to retry, resuming from where it left off... Although
> better to make it work first time, even if it takes a while.
>
> — Greg, 2026-09-04

Continuation of [260903k](260903k-pdf-page-cap-refused-with-no-reason-given.md), which fixed the
*refusal* and the *message*. That work deployed at 09:11 UTC on 2026-09-04 and moved the failure one
step along. This plan is about the step it moved to.

## Where it actually fails now

**The page cap is no longer the blocker and the lease is not either.** Two production ingests on
2026-09-04 (`spya-y807kg` 09:26, `spya-bub4bd` 10:42, release `436d6b56`) both transcribed the paper:
142 pages, 69 chunks, $0.66, ~5.5 minutes, ~2,024 blocks, and the whole `POST /api/jobs/:id/advance`
returned 200 in **347 s** and **305 s** — against a 740 s deadline and an 800 s `maxDuration`. No
timeout, no 5xx, no memory event in the Vercel logs.

Both then died at `hierarchy`, on `TooLongForOnePass` from `budgetFor`:

> The table of contents needs about 89,575–90,100 tokens for this article, and one model response
> holds 128,000 including the model's own reasoning. This article has to be processed in sections,
> which is not built yet.

It is `blocked` ([`src/token-budget.ts`](../../src/token-budget.ts)), so **there is no Retry button**.
Nothing Greg could press would ever have worked, which is why it read as failing "for a while".

## The estimator is too conservative — and it is *not* because the answer is bounded

An earlier draft of this plan claimed the structure prompt bounds the tree to ~91 internal nodes
however long the article is, making the ceiling a pure artefact. **GPT Sol returned DO-NOT-SHIP on
that and was right; the claim is recorded here because building on it would have cost a stage.**

`estimateHierarchyTokens` ([`src/hierarchy.ts`](../../src/hierarchy.ts)) charges one internal node per
**four blocks**:

```ts
const internal = Math.ceil(blocks.length / 4) + 6;
return 500 + internal * 175;
```

The prompt does say *"Go 3 levels deep"* and *"Aim for 5-9 children per node"* — but **"aim for" is
guidance, not a constraint, and the other rules contradict the bound**:

- Headings are **hard** boundaries, so an article with more than 81 heading sections cannot fit under
  root → 9 chapters → 81 sections at all.
- The long-run rule — propose boundaries inside any run longer than ~9 blocks — needs
  `ceil(2024 / 9) = 225` sections for a headingless article of Kuhn's length. Grouping those by nine
  needs 25 chapters: **251 internal nodes**, three levels but a root with 25 children. Holding fan-out
  at nine instead needs a fourth level.
- **The runtime enforces neither.** `ModelNode.children` is recursive and `buildTree` descends with no
  depth or fan-out check. Sol reproduced it: `buildTree` accepted a proposal with internal depths
  `[0,1,2,3,4]`.

**A finite corpus cannot prove a bound** ⟨Sol⟩ — so the guard stays adversarial rather than becoming
"bounded above for large N". But the corpus can say what actually happens, and stage 1 measured it.

### What stage 1 found — 32 real trees, and one live call on Kuhn

**Every real tree is depth 2, and the node count saturates.** Across 32 trees (about 20 distinct
articles) from 10 to 2,025 blocks, no tree anywhere grows like `N/4` past ~340 blocks:

| article | blocks | headings | internal nodes | `N/4+6` says |
|---|---|---|---|---|
| cargocult | 41 | 1 | 25 | 17 |
| claudes-constitution | 120 | 11 | 36 | 36 |
| constitution (full) | 360 | 36 | 58 | 96 |
| replication-crisis | 551 | 37 | 61 | 144 |
| llm-survey (144pp PDF) | 1,093 | 262 | ~112 | 279 |
| **Kuhn (142pp PDF)** | **2,025** | **254** | **83** | **513** |

Over-prediction climbs monotonically — 1.35× → 2.2× → 3.8× → 4.0× → **8.21×** — which is the
signature of a linear term over a bounded reality. **Kuhn came in at 83 nodes with fan-out median
*and* max both exactly 9**, pressed flat against the prompt's `3 levels × ≤9 children = ≤91`. It is
not tracking heading count either: 254 authored headings produced 83 nodes and **59 dropped
headings**. The estimator's own comment — *"every real tree comes out 1.5x–2.3x under"* — is wrong in
both directions; the measured range is 1.09× to 8.21×.

**175 tokens per node holds** (worst observed 145; Kuhn 132). Do not touch it. Compact serialisation
matters: pretty-printing inflates by 1.16–1.28×.

**The decisive call.** One real structure call on Kuhn, byte-identical prompt, `max_tokens` forced to
128,000: `stop_reason: end_turn`, **10,996 answer tokens** against the estimator's 90,275, a valid
tree (`checkTree`: 0 problems) tiling all 2,025 blocks, 508 s, ~$2. **69,715 of the budget unused.**
So this paper does not need sectioning at all.

### Two things behind the token ceiling that are real

**Thinking took 47,289 tokens — more than `THINKING_HEADROOM`'s 40,000.** This is the finding that
would have bitten. Had we merely corrected the answer term to ~11,000, `budgetFor` would have granted
about 51,000, and **this very call would have hit `max_tokens`** — trading a free refusal for an
eight-minute paid truncation. Sol flagged exactly this risk and was right to. So stage 4 raises the
reservation to a measured, hierarchy-specific number as well as re-rating the node term. Note the
counter-evidence to the postmortem's fear, worth recording: given 128,000 the call thought 47,289
rather than expanding to fill it.

**The step is marginal against the deadline, and that is the real ceiling.** Structure 508 s, then 34
label batches at concurrency 4 — **658 s / 708 s / 778 s** at the measured 15/20/27 s per batch,
against a 740 s deadline, *before* `extract` has taken any of the same window. This is not
hypothetical: `llm-survey` died this way today (job 06:59:08 → 07:11:28, extract 353 s, then
`hierarchy` cut off at 380 s having already paid for its structure call, "0 of 21 sections
labelled"). **Stages 2 and 3 are what make this document work, not stage 4.**

**And the tree that comes back is valid but not good.** Section spans: p50 18, p75 31, **max 241** —
one section swallows 241 paragraphs, five exceed 60. That flows into `planBatches` as batches of
16 / 54 / **241**, one of them four times `MAX_BATCH`, and `oversizedSets` only *reports* it. This is
[260826h](260826h-toc-scaling.md) § J — variable tree depth, "a defect, already biting" — arriving at
book scale. Named here, not fixed here.

## What else the evidence turned up

**`hierarchy` may not fit one window on this document, whatever the budget says.** The structure call
reads every block's text (~150k input tokens for Kuhn), then ~30 label batches at `CONCURRENCY = 4`
([`src/labels.ts`](../../src/labels.ts)). **Only the labels are checkpointed** — the structure answer
is not, so a window that runs out re-buys the most expensive call in the pipeline.

**A step that overruns ends the job instead of putting it down.** The claimant's deadline aborts the
shared controller, `runStep` returns `cancelled`, and the walk calls `endJob` with
`interruptedEnding` — terminal `error`, Retry button. `src/jobs.ts` says so itself: *"An automatic
second window for the cooperative case is listed as recommended, not built."*

**Extract, measured locally on the real document**, twice (2026-09-04, contended box, width 16, model
`openai/gpt-5.6-luna`): 69 chunks, **9 min 13 s** and **8 min 33 s**, **$0.54** and **$0.52**, peak
RSS 737 MB, mean recall 0.979. Four things in those numbers matter more than the totals:

- **Ninety model calls for sixty-nine chunks** — 21 chunks retried. **This is cost and latency, not a
  cliff**: since 2026-08-30 a chunk that fails twice is *published with a quality note* rather than
  throwing (Greg's call; the reasoning is on the function). The top-of-file header still says
  *"Nothing is written until every chunk passes"*, and the `ATTEMPTS` comment still says *"Two runs,
  then it fails… The failure is still visible and still hard"* — **both stale**.
- **Of those 21 retries, 8 were provably wasted** — see the confirmed checker defect below — and 15
  chunks still failed on their final attempt, so the article publishes with **20 quality notes**.
  Three missing-run failures I had assumed were scoring artefacts are **genuine**: real body and
  footnote prose, present on the page, absent from the transcription. So this document reaches the
  shelf with real gaps in it, quietly. That is worth its own look and is not this plan's job.
- **The per-call tail is far worse than the concurrency arithmetic assumes.** Over 177 calls: mean
  52 s, median 42 s, p95 96 s, **max 354 s** — one chunk took **5.9 minutes**, against a table built
  on a 45 s mean and a 98 s tail.
- **That outlier has a cause, and it is a planner defect.** `planChunks` bounds a chunk by *words* and
  by `MAX_CHUNK_PAGES`, never by **encoded bytes**, so image-heavy sparse pages grow to the six-page
  maximum and produce a **4.54 MB** chunk against a 200 KB median. That chunk is the 354 s call.

### The checker defect, confirmed twice and independently

⟨GPT Sol, and a separate investigation, both on the real file⟩ `pass0`
([`src/pdf.ts`](../../src/pdf.ts) ~637) concatenates pdf.js text items **with no separator unless the
item carries `hasEOL`**. This journal prints a page number at the top of each page, and this paper's
sections are numbered three deep, so a page very often *starts* with a numbered heading. The text
layer therefore holds:

```
…Molecular Biology 190 (2024) 28–169␊649.5.10. Mansell's perceptual control theory␊…
```

`64` is the printed page number; `9.5.10.` is the heading. `protect()`
([`src/pdf-score.ts`](../../src/pdf-score.ts) ~266) tokenises on whitespace, so the haystack contains
`649.5.10` and never `9.5.10`. `protectedFaults` can *join* adjacent tokens to recover a split URL but
has no way to *split* one pdf.js already merged. So the model, correctly obeying rule 6 and dropping
the running furniture, writes a clean `9.5.10.` and is scored as having invented it.

Verified against the real text layer for eight values — `9.5.10`, `9.2.12`, `9.4.4`, `9.6.7`,
`9.10.4`, `16.3`, `17.7`, `4` — every one genuinely printed where the model put it, every one fused to
its page number. Two others, `12` and `13`, are **true** positives: neither appears as a standalone
token anywhere, and `protect()` exists precisely to catch `2012 → 12`. So the check is not generally
unreliable; it has one specific reproducible blind spot at the page-number/heading boundary.

**A second instance of the same class**, found on the way: Elsevier's letter-spaced `ARTICLE INFO`
box reaches the text layer as eight single-character tokens (`a r t i c l e i n f o`), which no
sensible transcription can ever align against.

## Stages

**Ordered so every intermediate stage is deployable** ⟨Sol finding 5⟩. The earlier draft changed the
estimator *before* building the checkpoint and the hand-back, which would have deployed a state where
a fast free refusal becomes a long paid call that can still end at the deadline needing a click.

### Stage 1 — measure, and let the measurement decide — **DONE 2026-09-04**

Results are in § What stage 1 found above. In short: one pass fits Kuhn comfortably (10,996 answer
tokens of a 128,000 budget, valid tree, whole article covered), the node term is the wrong shape, and
the two things that actually bite are the **thinking reservation** (47,289 measured against a 40,000
reservation) and the **wall clock** (658–778 s for the step alone against a 740 s deadline).

Sample-size caveat, stated because it bounds what the next stages may claim: 32 trees but only ~20
distinct articles, and **production could not be read** — the Supabase MCP on this box points at
localhost and `.env.local` holds no remote credential, so every figure is local. Production may hold
longer articles than anything measured.

### Stage 2 — the structure answer is checkpointed

Before anything admits long documents. Fingerprint built from **one canonical semantic request object
assembled on the same path the call uses** ⟨Sol finding 4⟩ — not a hand-copied subset, which is
exactly the blind spot `promptFingerprint` in [`src/pdf-read.ts`](../../src/pdf-read.ts) was written
to remove. The subset proposed in the earlier draft omitted `thinking`, `max_tokens`, the routing
`streamMessage` injects, and the difference between the stored model name and `modelFor("hierarchy")`'s
wire id. Deliberate exclusions are fine and must be written down as decisions.

**Save only an answer that has parsed and built successfully** — saving before `parseJson` and
`buildTree` would replay a malformed-but-complete answer for ever.

**Done when:** a second run makes no structure call; mutation tests show every generation-affecting
field changes the key; a malformed answer is not stored.

### Stage 3 — a claimant that runs out of time pauses, keeping its draft

**The draft must survive, and this is the finding that reshaped the plan** ⟨Sol finding 2,
reproduced⟩. The earlier draft routed the overrun through `settleExpired`'s requeue because it carries
the `REQUEUE_BUDGET` cap. But that statement **nulls `draft_revision_id`**, and on a first ingest
there is no published revision to copy from — so `blocks` re-runs as a genuine first ingest and
**mints every block id afresh** ([`src/ids.ts`](../../src/ids.ts); Sol reproduced `same: false` over
identical HTML). The structure request contains those ids, so its fingerprint changes *and* the cached
tree's ranges name ids that no longer exist. Stages 2 and 3 would not have composed at all.

So: a **capped cooperative pause that preserves the draft**. Unlike a lapsed claimant this one has
unwound cleanly, and `beginStepRun` already supports a later attempt reopening a running step row.

One atomic transition, fenced on `liveAttempt(id, attempt)`, returning a **discriminated outcome** —
`requeued | cancelled | budget-spent | stale` ⟨Sol finding 3⟩. Zero rows moved does **not** mean the
budget was spent: it can equally mean Stop set `cancelling`, the lease expired during the unwind
margin, another sweep got there first, or the attempt changed. Falling through to today's
`interruptedEnding` on the Stop case would end as `error` a job the reader chose to stop, because
`finishIn` clears `cancelling` and keeps the supplied ending. **Cancellation wins.**

The cap counter is shared with the lapsed-lease path, so three windows is three *in total*, not three
cooperative overruns — say that where the constant is.

**Done when:** all four outcomes are exercised; mixed-path tests exist for lapse-then-overrun, Stop
racing the overrun, and an unwind crossing lease expiry; the draft and the block ids survive a pause,
asserted rather than assumed; the stale comments at `src/jobs.ts` § `LEASE_MS`, `src/store/jobs.ts`
("one claim covers one step") and `src/routes.ts` ("`vercel.json` caps a function at 300 seconds" —
it is 800) are corrected.

### Stage 4 — the estimator counts nodes the prompt can actually produce

**Two changes, and the second is the one stage 1 says we would have got wrong.**

`ceil(N/4) + 6` becomes a growth term built from **heading count, long-run splits, and the ancestors
those require**, still growing with the article because nothing in the runtime bounds the answer —
but rated against what 32 real trees actually do rather than against a node every four blocks. `175`
stays: worst observed is 145 and Kuhn is 132.

**And `THINKING_HEADROOM` rises for this stage, to a measured number above 47,289.** Correcting only
the answer term would grant Kuhn's call ~51,000 and truncate the very run that proved it fits. The
reservation is already documented as per-call rather than per-stage, so a hierarchy-specific measured
value is the shape the file already has — not a global raise, and **not** a shrink to force
admission.

Re-pin `tests/token-budget.test.ts` on an **adversarial** case — a long article with many headings —
rather than on the number 1,976 or on an asymptotic claim a corpus cannot support.

**Done when:** Kuhn's estimate fits one response with margin *and* leaves more than the measured
thinking; the adversarial test passes; the new estimate is ≥ 1.25× actual on every tree in the corpus;
the stale sentence in [hierarchy.md § Longer pieces](../project/hierarchy.md#long-articles) and the
false *"1.5x–2.3x"* claim on the function are both replaced with the measured range.

### Stage 5 — extract's waste and its tail

Three small independent things, none on the critical path, all of which this document proved.

- **The fused page-number affix.** Strip only a known page-number/furniture affix when building the
  protected haystack, keeping the regression that stops `12` matching `2012`. The letter-spaced
  `ARTICLE INFO` variant is the same class and worth handling if it is cheap.
- **A byte bound in `planChunks`**, so image-heavy pages cannot produce a 4.54 MB chunk.
- **`cutPages` parses the source once**, not once per chunk. Prerequisite for any later width raise,
  and it takes wall-clock off the deadline today because pdf-lib's parse is synchronous on the one
  event loop.

**Done when:** a correct hierarchical heading no longer scores as invented, with the fused-affix case
as the red test; no chunk exceeds the byte bound; `cutPages` parses once with the RSS curve
re-measured; the two stale comments in `src/pdf-read.ts` are corrected.

### Stage 6 — sectioning, only if stage 1 says one pass cannot safely fit

Its first step is nearly free: put the mechanical skeleton from
[`src/heading-tree.ts`](../../src/heading-tree.ts) into the structure prompt as fixed scaffolding and
ask the model only for sub-boundaries in long runs, titles and gists. For a document with authored
numbering the skeleton *is* the global outline, so the section cards and the global pass buy nothing.
Build those only when a long **headingless** document arrives.

### Stage 7 — deploy, and watch the real document go through

**The two dead Kuhn jobs cannot be recovered with a `steps: ["hierarchy"]` job** ⟨Sol finding 6⟩: a
failed initial ingest fails its draft and clears the job's pointer, and a later draft copies only the
*published* revision — of which a first ingest has none. So there are no blocks for hierarchy to read.
Recovery is to retry the original job with its full steps and source provenance, on the same article,
so the PDF chunk checkpoints are found and the transcription is not re-bought.

Then a fresh upload end to end in a browser, on production, watched.

## Deliberately not doing

- **Lowering `effort` or shrinking `THINKING_HEADROOM`** to buy headroom.
  [260826a](../postmortems/260826a-toc-max-tokens.md) found that adaptive thinking expands into
  whatever room it is given, so it cannot converge.
- **Shipping the mechanical heading tree as the tree.** No gists, so an internal node has nothing to
  render at its zoom level and it can only ship `provisional` — a publication seam that is not built.
- **Splitting `extract` into several steps.** `StepName` is a closed union with a `never`
  exhaustiveness check and `Record<StepName, …>` tables closing over it.
- **Raising `CHUNK_CONCURRENCY` now.** Extract fits its window. Width is the last lever, and it raises
  the one failure the pause does not cover — a rate limit into a single upstream routed
  `allow_fallbacks: false`.
- **Chasing the genuine transcription gaps.** Fifteen chunks failed their final attempt and three
  verified missing runs are real dropped prose. That is a quality problem in its own right, it
  predates this document, and folding it in here would swallow the plan.
