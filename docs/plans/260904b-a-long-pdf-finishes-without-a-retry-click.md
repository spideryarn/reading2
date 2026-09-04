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

**Thinking does not expand into the larger budget, and the postmortem's warning is an `effort: "high"`
phenomenon.** Measured 2026-09-04, eight real structure calls — two articles × two budgets × two
repeats, production's own `SYSTEM` and `PRODUCTION_EFFORT`, varying only `max_tokens`:

| article | budget | thinking (rep 1 / rep 2) | cost |
|---|---|---|---|
| claudes-constitution (120 blk) | 42,075 (old) | 9,983 / 5,644 | $0.148 / $0.108 |
| claudes-constitution | 80,425 (new) | 6,336 / 5,714 | $0.119 / $0.111 |
| replication-crisis (274 body blk) | 42,075 (old) | 20,803 / 31,083 | $0.340 / $0.439 |
| replication-crisis | 80,425 (new) | 18,279 / 18,714 | $0.320 / $0.310 |

Every call reached `end_turn`; none truncated at either budget. Thinking was **lower** at the larger
budget on both articles, and the difference is well inside the run-to-run noise already visible within
one budget — replication-crisis swung 20,803 → 31,083 between two *identical* calls, a 49% spread.

**This reconciles the contradiction that made the risk look real.**
[260826a](../postmortems/260826a-toc-max-tokens.md) measured expansion at `effort: "high"`; this stage
has run at `EFFORT = "medium"` since that postmortem moved it, and the live Kuhn call (47,289 of
128,000) is the same medium regime. At medium, thinking is governed by `effort`, not by the size of the
ceiling. So the extra cost of `STRUCTURE_HEADROOM` and the 81-section floor across every article is
**effectively zero** — which is what lets stage 4 ship as built, and it resolves GPT Sol's finding 5 in
the code review, which flagged the risk conditionally. **Re-check it if `EFFORT` ever goes back to
"high"**, because that is the regime where expansion was actually observed.

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

### Stage 2 — the structure answer is checkpointed — **DONE 2026-09-04**

Before anything admits long documents. Fingerprint built from **one canonical semantic request object
assembled on the same path the call uses** ⟨Sol finding 4⟩ — not a hand-copied subset, which is
exactly the blind spot `promptFingerprint` in [`src/pdf-read.ts`](../../src/pdf-read.ts) was written
to remove. The subset proposed in the earlier draft omitted `thinking`, `max_tokens`, the routing
`streamMessage` injects, and the difference between the stored model name and `modelFor("hierarchy")`'s
wire id. Deliberate exclusions are fine and must be written down as decisions.

**Save only an answer that has parsed and built successfully** — saving before `parseJson` and
`buildTree` would replay a malformed-but-complete answer for ever.

#### What landed

A new checkpoint namespace, `hierarchy-structure`
([`src/store/checkpoints.ts`](../../src/store/checkpoints.ts), and the CHECK on the table with it —
`drizzle/20260904115103_checkpoints_hierarchy_structure.sql`). The row holds the model's **raw answer
text**, not the tree: everything between the two is this stage's own code and would otherwise be
frozen into the row.

The key is a digest of `canonicalStructureRequest(params)`, and `params` is now *literally the object
handed to `streamMessage`* — `structureRequest` builds it and reads its own four legacy fields back
off it, so there is no second assembly to drift. Around it go `modelFor("hierarchy")` (read at call
time, so an env override moves the key), `MESSAGES_PROVIDER`, and `PROMPT_VERSION`. The mutation test
is written over `Object.keys` of that canonical object rather than over a list, so a field added to
the request tomorrow is covered without anybody remembering.

**Deliberate exclusions, all in the comment on the function:** the abort signal and `onProgress`
(they change whether an answer arrives, not what it would be); the slug and article id (the store is
bound to one article and refuses any other); the reader (nothing here depends on a person — the rule
if that ever changes is in the store's own header); and the blocks as blocks, because every id and
every word of them is already inside `request.messages`. That last one is what makes the ordering
constraint hold rather than merely be true today: a lost draft re-mints every block id, the ids are
in the user message, so a cached tree can never be replayed onto an article whose ids moved.

The write is after `parseJson`, `buildTree`, `appendSupplement` **and `assertTreeSound`** — one check
later than the plan asked for, because a complete answer that builds a tree the invariants then
reject would replay just as permanently as one that does not parse. Seen red both ways: the two
"stores nothing" tests fail when the write is moved above `parseJson`.

**What the code review changed** ⟨GPT Sol, 2026-09-04, second round⟩. Three of its four findings on
this stage were taken:

- **The canonical request no longer restates what the gateway injects.**
  `messagesWireBody(task, body)` is now exported from `src/messages-stream.ts`, `streamMessage` sends
  its output and `canonicalStructureRequest` fingerprints it. Restating `provider` and `model` here
  covered today's two fields and would have missed tomorrow's third **silently**, because a mutation
  test can only enumerate the fields an object already has.
- **The tests did not reproduce the window the feature exists for.** Every run in them succeeded, so
  a write placed *after* `generateLabels` would have passed all of them while losing the tree to
  exactly the failure the plan is about. There is now a test where the label pass throws after the
  structure answer lands and a second run resumes without a call — seen red under that mutation —
  and one where the answer builds a tree the invariants reject, which is what pins the write after
  `assertTreeSound` rather than merely after `buildTree`.
- **A poisoned row.** `{ fingerprint, answer: "not JSON" }` passed the entry gate, skipped the call
  and failed for ever. `usableStructure` now parses before it accepts.

**And then the whole of it, on the second review** ⟨GPT Sol, code review, finding 6⟩. The parse-only
gate left the same trap one step along: an answer that parses and then fails `buildTree`,
`appendSupplement` or `assertTreeSound` was accepted, skipped the call, and threw on **every** attempt
without ever overwriting itself — a permanently wedged article whose only lever was a `PROMPT_VERSION`
bump, i.e. a deploy, for one reader's PDF. The full fix turned out to be much less machinery than the
"retry loop around the whole call-and-build stretch" it was written off as: the parse-build-append-
assert stretch is now one local function, `treeFrom`, called **twice on two different questions** —
once on the stored answer, where a throw demotes the row to a miss and the call below replaces it,
and once on a fresh one, where a throw is the run failing. Both poisons are red first in
`tests/hierarchy-structure-checkpoint.test.ts`: one that fails `buildTree`, one that fails the
invariants, each asserted to buy exactly one call and to leave the good answer in the row.

**Two things the plan did not say.** `HierarchyRun` gained `structureResumed`, and the run's
`inputTokens`/`outputTokens` now come from a hoisted `structureUsage` that is zero on a resumed
run — a resumed attempt really did pay nothing for the tree, and without the flag beside them those
totals read as a broken meter. And `docs/project/database.md` needed nothing: it never listed the
namespaces, so there was no second copy to update.

**Done when:** a second run makes no structure call ✓; mutation tests show every generation-affecting
field changes the key ✓; a malformed answer is not stored ✓ —
`tests/hierarchy-structure-checkpoint.test.ts`.

### Stage 3 — a claimant that runs out of time pauses, keeping its draft — **DONE 2026-09-04**

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

#### What landed

A new store transition, `pauseForDeadline(id, attempt, requeueBudget)`
([`src/store/jobs.ts`](../../src/store/jobs.ts)), on both adapters, returning

```ts
type PauseOutcome =
  | { kind: "requeued"; job: Job }   // queued on this row, draft kept, `requeues + 1`
  | { kind: "cancelled" }            // Stop is on the row: end it as cancelled
  | { kind: "budget-spent" }         // no windows left: end it as today
  | { kind: "stale" };               // may not write at all: a lost claim
```

**Only `requeued` writes the row.** The other three leave it exactly as they found it, so the
claimant still holds a live claim and settles the job through its own **session** — which is the
transaction that disposes of the draft. A store method that terminalised the job here would have to
duplicate that and would leave `jobs.draft_revision_id` pointing at a revision
`sweepAbandonedDrafts` spares for ever.

**Atomic by locking rather than by counting.** `select … for update`, then decide, then the fenced
`UPDATE`, all in one `READ_COMMITTED` transaction. The obvious shape — one fenced `UPDATE` with a
fall-back when it moves nothing — cannot tell the four events apart, and a classifying `SELECT` after
a refused `UPDATE` would answer about a row that had moved in between. `liveAttempt` is re-asserted
on the write; under the row lock it can only agree, and a transition written without it is what
[`job-fence.ts`](../../src/store/job-fence.ts) exists to make impossible.

**`walkClaim`'s change is one branch**, in the `outcome === "cancelled" && overran()` case. The
steps written back are derived **in SQL from the row** (`settledSteps`), not taken from the
claimant's memory: `runStep`'s catch has by then written the *failure* narrative — `error`, and
`INTERRUPTED`'s sentence — onto the step, and a red step on a card that is waiting its turn is a lie.
On the `cancelled` outcome the step's sentence is corrected to `STEP_STOPPED`, so a reader cannot
tell which side of a step boundary their Stop landed on.

`Job.requeues` is new and crosses `publicJob` (which strips only `profile` and `ownerId`), absent at
zero. Postgres reads the column; the filesystem adapter writes the field from its in-memory budget
map — the two part company across a restart, which is the weaker parity that counter already had.
**Nothing renders it yet**, and that is a choice rather than an omission: the field is what the card
needs, but *what the card says* is a copy decision with two renderers behind it
([`src/job-state.ts`](../../src/job-state.ts), and `JobCard` vs `JobProgress`), and it is worth
Greg's word rather than mine. The data is on the wire the day somebody wants it.

**Tests, all watched red first.** `tests/store-jobs-parity.test.ts` gains five cases on both
adapters — the requeue's queue shape, the shared budget (lapse then overrun then refusal), Stop
winning, an unwind that crossed the lease, and a claim that moved.
`tests/claim-session-postgres.test.ts` gains three: the draft survives a mid-step pause **and the
next claim resumes on it** (asserted by counting that the completed step's fixture body is not
entered again, because `runStep` leaves an already-`done` step saying `done` rather than relabelling
it `skipped`); a Stop racing the overrun ends `cancelled` with the budget untouched; and a step that
never fits ends after `REQUEUE_BUDGET` windows rather than looping.

**And one bug the pause found in something older.** `fsJobStore.noteProgress` assigned the caller's
`steps` array to the index rather than copying it, so the filesystem store held a live reference to
`walkClaim`'s working copy and every later mutation of it landed in the store without a transition.
It was invisible while every transition passed its own explicit `steps`; the pause is the first one
that derives what to write from **the record the store already holds**, and it found `runStep`'s
failure narrative — `error`, `[jb-gone]`, a `finishedAt` — already written onto the step it was about
to put back in the queue. `sweepStopped` only resets a step that says `running`, so it left it there
and a card waiting its turn drew a red step with an interruption on it. `get` has always cloned on
the way out for exactly this reason (*"a caller that mutated what it was handed would be writing to
the store without going through it"*); this is the same rule on the way in. Watched red, and
`tests/step-failure-seam.test.ts` § *says nothing about a job it has merely put down* is the guard.

**Two things the plan and the review did not have quite right.**

- The draft's step-run rows after a pause are `{extract: "done", blocks: "running"}`, not
  `{extract: "done"}`. The aborted step's marker is deliberately *not* cleared — `beginStep`
  brackets a run and only the success path clears it — and `beginStepRun` already lets a later
  attempt reopen a row in that state. That is the marker discipline working, and the assertion says
  so.
- The plan's "a step under a short `leaseMs` that **ignores** its deadline" describes a different
  path from the one this stage fixes. A step that truly ignores the signal runs to completion and
  lands in `transitionAfter`, which ends the job there; the mid-step overrun this is about needs a
  step that *honours* the signal by throwing, which is what a model call does. Left alone: that
  sibling path has a completed step behind it, so progress is guaranteed and the existing `release`
  shape would be the right fix if it ever bites.

#### The code review, and the two things it changed

GPT Sol reviewed the built stage and returned **SHIP-WITH-CHANGES**. Its own summary of what checked
out is worth keeping: Stop, expiry, a duplicate pause and a claim cannot cause a lost Stop or a
double-spend under the row lock; the lock order cannot deadlock revision work, because a revision
transaction takes article-then-job and the pause takes only the job; aborted products are never
written, because the model call is outside the transaction; and **`queued` with a draft is not a new
invariant** — `releaseStepIn` has always left that pointer, `requestCancel` clears it when it
cancels a queued job, and retry, forget and trimming all operate on terminal rows.

Two findings were real.

**A relinquishing claimant could unregister its successor's `AbortController`** ⟨P1⟩. `standDown`'s
`aborts.delete(job.id)` was unconditional, on the reasoning that *"the claim is what stops two of us
being inside one job"* — true of two claimants *running* and not of one that has handed the claim
back and is still unwinding. The row is `queued` the moment the transition commits, so another
advance in the same process can claim it and install its own controller in the turn this one spends
returning. Deleting it removes half of Stop: the flag still lands on the row, but `cancelJob` finds
nothing to pull, so the new claimant's model call runs on to the next step boundary. Now
`if (aborts.get(job.id) === controller)`. **Not covered by a regression, deliberately**: no `await`
stands between the pause's commit and that line, so a test could only race for it.
`transitionAfter`'s `release` has had the same shape since 2026-08-30, so this is older than the
pause.

**The Stop test was sequential, and a barrier case found something worse than the review predicted**
⟨P2⟩. Sol pointed out that the parity Stop case completes `requestCancel` before calling
`pauseForDeadline`, so removing the row lock would leave every new test green. The barrier case
written for it — a second transaction holds the row, the pause blocks on it, Stop is written onto
the locked row, the lock is released — is red without the lock, and not in the way either of us
expected: the pause's `UPDATE` then tries to write `queued` onto a row carrying `cancelling`, which
`jobs_cancelling_is_running` **refuses**, so the reader gets a `db-failed` 500 on a job they simply
stopped. The schema is the only thing between that and the permanent *"Stopping…"* wedge.

Two things about writing that barrier are worth carrying elsewhere, because each reported the
opposite of the truth for a while:

- **A row-lock waiter waits on the holder's `transactionid`**, and a `transactionid` lock carries no
  `relation` — so the obvious `pg_locks where not granted and relation = 'spideryarn.jobs'::regclass`
  matches nothing at all.
- **Postgres caches the `pg_stat_activity` snapshot for the life of a transaction.** Polling it from
  the transaction that holds the lock re-reads the picture from before the waiter existed, for ever,
  however long it polls. It said the pause had sailed through the lock while the pause was blocked
  on it the whole time.

The other three findings were taken as written: the cancellation case now asserts the persisted
sentences on both surfaces rather than only the status (deleting the two corrective lines in
`walkClaim` left it green); the draft-identity case captures `draft_revision_id` from *inside* the
step that is about to be aborted, so it proves the same draft rather than *a* draft; and the stale
comments Sol listed are corrected — `src/store/pg-jobs.ts`'s "every transition is one statement" and
its "unreachable" zero-row branch, three more copies of "one claim covers one step"
(`src/jobs.ts`, `src/store/jobs.ts` § `claim`, `src/store/pg-session.ts`),
`src/store/pg-session.ts`'s "nothing real can run through it yet", `src/messages.ts` § `INTERRUPTED`
on when a deadline overrun now reaches that sentence, and `src/types.ts` § `requeues` on nothing
rendering it yet.

#### The second code review, and the three things it changed

GPT Sol reviewed the whole change again on 2026-09-04 and returned **DO-NOT-SHIP**, on the ground
that *"the clean deadline-pause path is sound, but the end-to-end guarantee still fails when a later
claim lapses or is deployed over"*. Three of its findings belong to this stage.

**1 — a lapsed claim still destroyed the identity the checkpoint is keyed on.** `pauseForDeadline`
kept `draft_revision_id`; **`settleExpired`'s requeue branch still nulled it**, so stages 2 and 3 did
not compose. The failing sequence is ordinary: hierarchy overruns and pauses cleanly (window 1); the
next claim is deployed over inside hierarchy; `settleExpired` spends window 2 *and clears the draft*;
window 3 opens an empty draft, `blocks` runs as a first ingest and re-mints every block id, the
structure fingerprint moves, and the ~508 s / ~$2 call bought in window 2 is unreachable. The budget
is then gone for a step measured at 658–778 s, and the reader gets the Retry click this whole job
exists to remove.

**Sol's argument that the old rationale was stale was checked against the code before it was acted
on, and it holds.** That rationale — a claimant that vanished mid-step leaves "whatever that process
had got to" — predates the transactional stage runner. [`pg-session.ts`](../../src/store/pg-session.ts)
now commits artefacts, the postcondition, the step completion, the publication and the job transition
**together or not at all**, with the model call outside that transaction, so a killed claim leaves a
wholly finished step or no trace of one. The step it was inside stays honestly `running`, and
`beginStepRun`'s `setWhere` explicitly allows *a different attempt* to reopen a row in that state
([`pg-revisions.ts`](../../src/store/pg-revisions.ts)); a swept claimant that keeps going is refused
by `requireLiveJobOwnsDraft`, because the sweep cleared its token. So the requeue now keeps the
pointer. **The terminal branch still clears it and must** — `sweepAbandonedDrafts` spares a revision
any job row names, so a terminal row holding one is a draft nothing will ever publish or reclaim. The
two field sets were deliberately identical and are not any more, and both statements now say so.

The test is end-to-end over four windows in
[`tests/claim-session-postgres.test.ts`](../../tests/claim-session-postgres.test.ts): a between-steps
release, a clean mid-step pause that pays for the structure answer, a claim that is deployed over and
swept by `settleExpired`, and the finish. Two things make it evidence rather than decoration — the
fixture `blocks` **mints fresh ids on every run**, as the real one does with no published blocks to
copy from, and the checkpoint is keyed on *those ids*, as the real one is keyed on a request that
contains them. Watched red on exactly the finding: `expected null to be '901d2e92-…'`.

**2 — the hand-back threshold started a step known not to fit.** `STEP_BUDGET_MS.hierarchy` was
320.4 s, measured on ordinary articles. On the 142-page paper the structure call **alone** is 508 s
and the whole step is 658–778 s, while the recorded `extract` requests took 305–347 s — so the walk
reached hierarchy with 393–435 s left, admitted it, bought most of a call it could not finish, and
spent one of only two requeues.

It is now **700 s**, which is `extract`'s number arrived at by `extract`'s reasoning: no threshold
can promise this step fits, because 778 s is more than the 740 s deadline, so the most a threshold
can do is stop it being *started on a remnant*. What that means in practice is that `hierarchy`
almost always begins a claim rather than continuing one — the walk runs its first runnable step
ungated, so a claim that opens on it gets the whole window, and a claim that reaches it after
`fetch → extract → blocks` hands back instead. **The cost is one extra request for an ordinary
article**, which is the cheap direction the budget table's own header names; a size-sensitive
threshold is the obvious later refinement and is not built, because the flat number is what removes
the retry click. `tests/jobs-lease-budget.test.ts` pins the *relationship* — greater than what the
worst measured PDF extract leaves behind, less than the claimant's own deadline — so re-tuning either
side stays free.

**3 — the filesystem adapter could return an internally contradictory outcome** (CONFIRMED; Sol ran
`pauseForDeadline` and `requestCancel` concurrently and got `{"pauseKind":"requeued",
"pauseStatus":"cancelled","current":"cancelled"}`). Every mutating method in
[`jobs-fs.ts`](../../src/store/jobs-fs.ts) worked on the record every caller shares and ended
`await persist(job); return structuredClone(job)` — so the clone was on the far side of a yield and
described whatever the *next* transition had left behind. The discriminated union was false at
runtime and `src/jobs.ts` answered `done: false` about a terminal job.

The fix is one shared helper, `committed(job)`, which snapshots at the transition's linearisation
point and **persists the snapshot as well as returning it**; every transition and `settleExpired`'s
per-job settlement go through it. Not a lock, and it does not need one: each method decides and
mutates in a single synchronous stretch, so the decision was already atomic on a single-threaded
runtime and only reading the answer back was not. Writing the live object instead was harmless only
as long as every queued write happened to end up writing the same final value, which is an accident
rather than a rule. Postgres gets the same property from `select … for update` plus `returning`, and
the new parity case asserts **agreement rather than which side won** — either order is legitimate,
and an outcome contradicting its own payload never is. Watched red on the filesystem adapter and
green on Postgres, which is exactly the shape Sol reported.

Findings 4 and 5 are stage 1's and stage 4's and were taken elsewhere.

### Stage 4 — the estimator counts nodes the prompt can actually produce — **DONE 2026-09-04**

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
thinking ✓; the adversarial test passes ✓; the new estimate is ≥ 1.25× actual on every tree in the
corpus ✓ (worst 2.46×); the stale sentence in
[hierarchy.md § Longer pieces](../project/hierarchy.md#long-articles) and the false *"1.5x–2.3x"*
claim on the function are both replaced with the measured range ✓.

#### What landed, and the thing the plan had not worked out

```ts
sections = max(81, headingSegments, ceil(blocks / 9))
nodes    = sections + the ancestors a nine-wide tree needs above them
estimate = 500 + nodes * 175
```

| article | blocks | headings | actual answer | old estimate | new estimate | new ÷ actual |
|---|---|---|---|---|---|---|
| todo | 10 | 1 | 648 | 2,075 | 16,425 | 25.35× |
| cargocult | 41 | 1 | 2,252 | 3,475 | 16,425 | 7.29× |
| fowler-phrenology | 72 | 8 | 4,299 | 4,700 | 16,425 | 3.82× |
| claudes-constitution | 120 | 11 | 3,339 | 6,800 | 16,425 | 4.92× |
| what-if-we-had-bigger-brains | 172 | 9 | 5,086 | 9,075 | 16,425 | 3.23× |
| towards-a-theory-of-bugs | 244 | 13 | 5,794 | 12,225 | 16,425 | 2.83× |
| **replication-crisis** | 551 | 37 | 6,666 | 25,700 | 16,425 | **2.46×** ← tightest |
| **Kuhn (live call)** | 2,025 | 254 | **10,996** | 90,275 | **51,075** | 4.64× |

Reservation: **`STRUCTURE_HEADROOM = 64,000`**, in `src/hierarchy.ts` beside `EFFORT`, following
`LABEL_HEADROOM`'s precedent that a stage-specific reservation lives with the stage. 64,000 is the
measured 47,289 with about a third again on top — the same shape as `THINKING_HEADROOM`'s own
derivation, and for the same reason: one observation is not a line to fit. Kuhn's total comes to
115,075 of 128,000, and the refusal boundary moves from 1,976 blocks to about **2,890** of headingless
prose (~180,000 words).

**The plan's own prescription does not work as literally written, and this is the finding.** It asks
for a term built from "heading-block count, splits for runs longer than ~9 blocks, and the ancestors
those require". Taken as a **sum** — which is the faithful reading of the prompt, since a heading
opens a node *and* a long run inside it still gets split — Kuhn comes to 344 sections and **68,575
tokens**. That fits one response beside the measured 47,289 of thinking (115,864 of 128,000); what it
does not fit is a reservation with real margin on top. So the two rules are treated as **competing
lower bounds and the larger is taken**, and `sectionsAsked` says so out loud rather than leaving it
as arithmetic.

**A first draft of this section said the sum exceeded the ceiling "under any reservation above
47,289", and that was arithmetically false** — it exceeds it under *this* reservation, 64,000. GPT
Sol caught it reviewing the code and the corrected sentence is now in the function's own comment.
The honest statement of the trade: the sum and a reservation with margin cannot both be had on this
document, and the choice made was to keep the margin.

**Sol's counterexample, kept because it is the strongest argument against the choice.** A 2,420-block
handbook with a heading every eleven blocks — each heading opening a section, each ten-block run
after it over the ~9 threshold — is 440 sections and about 87,300 tokens under the faithful reading,
against the estimate's 53,700. The sum would **refuse** that document (`blocked`, no Retry button);
the max admits it with a budget above every per-node cost ever measured but below a stacked worst
case. It is admitted, deliberately, because the corpus says the faithful reading is not what the
model does at scale — 254 authored headings produced 83 nodes and 59 *dropped* headings on the one
long document anybody has measured. The case is pinned in `tests/token-budget.test.ts` with what
would falsify it: a real structure answer larger than the estimate. Then the sum is what to move back
to, and the reservation or the per-node constant has to move with it. The earlier "adversarial" test
used a heading every **eight** blocks, so it had no run over the threshold and never exercised the
overlap at all — also Sol's catch.

**And the floor is empirical, not derived.** `MINIMUM_SECTIONS = 81` is the width of the section
level in the shape the prompt describes, but a 10-block article cannot be partitioned into 81
non-empty sections and *"aim for 5-9 children"* is not an instruction to fill every branch. Sol was
right that the first version of the comment overclaimed by calling them sections the article
"forces"; it now says what it is — the smallest answer this stage is willing to size for, chosen at
the shape the prompt asks for because that is where the corpus keeps landing.

**The second finding: the corpus is concave and no linear term fits both ends.** Real node density
falls with length — one node per 1.4 blocks on `fowler-phrenology`, one per 24 on Kuhn — so a divisor
tight enough for the 70–250 block band (where the model emits many *cheap* nodes: 86 tokens each on
fowler) explodes at 2,000 blocks. The floor is what resolves it, and it comes from the prompt too:
*"Go 3 levels deep"* × *"aim for 5-9 children"* at the top of the band is 1 + 9 + 81 = **91 nodes**,
the tree the prompt describes for any article at all. Note this is the same 91 that a draft of this
plan tried to use as a **ceiling** and Sol rejected. As a floor it is safe, and the corpus supports it
from the other side: Kuhn came in at 83 with fan-out max exactly 9.

**What the floor costs, named because nobody chose it explicitly before now.** Every article shorter
than ~740 blocks now gets the same 16,425-token answer estimate, so `estimateHierarchyTokens` is flat
across most of the real corpus and the old *"grows with the article"* test had to be re-pinned across
a wider span (800 vs 4,000 blocks) to stay a real assertion. Combined with the reservation, a short
article's `max_tokens` goes from ~48,000 to 80,425. Unspent allowance is not billed, but
[260826a](../postmortems/260826a-toc-max-tokens.md) is that adaptive thinking expands into whatever
room it is given — at `effort: "high"`. The counter-evidence is the Kuhn call itself: at `medium`,
given 128,000, it thought 47,289 rather than filling. **Worth watching on the bill**, and
`truncatedMessage` splits the two halves if it ever stops being true.

**Sol's one dissent that was not taken:** he would keep `THINKING_HEADROOM`'s 40,000 for short
documents and add a long-input tier, on the ground that one long call not filling 128,000 says
nothing about how ordinary short calls react when their allowance nearly doubles. Not built: the
boundary between the tiers would be a number nobody has measured either, and the direction of the
error matters — a *smaller* reservation on a short article is the tighter one, and truncation is the
expensive failure. Recorded here as an open risk rather than settled, with the bill as the place it
would show.

Two smaller corrections the plan had right and are worth recording as done: the fixture test
serialised its "actual" with `JSON.stringify(…, null, 1)`, inflating what it compared against by up
to 1.28× — now compact, and 2.5 chars/token is confirmed by the live call (27,460 chars, 10,996
tokens, 2.497). And `truncationFailure` at the structure call now passes `STRUCTURE_HEADROOM`, or the
sentence that exists to say which half overran would quote a number the call was never sized with.

### Stage 5 — extract's waste and its tail — **DONE 2026-09-04**

Three small independent things, none on the critical path, all of which this document proved. Three
commits, each with its test seen red first.

**The fused page-number affix** — `defusedFolios` in [`src/pdf-score.ts`](../../src/pdf-score.ts).
When the haystack is built, a line-initial token that is wholly a numbered heading (digits, dots, a
final dot) also enters it with **this page's printed folio** taken off the front. **Eight of the eight
false positives pass and both true positives still fail**, checked through the real `check` against
the real `pass0` output:

| verified through `check` | page | text layer holds | now |
|---|---|---|---|
| `9.5.10` `9.2.12` `9.4.4` `9.6.7` `9.10.4` | 37, 25, 30, 41, 56 | `649.5.10.` … `839.10.4.` | clean |
| `16.3` `17.7` `4` | 98, 109, 128 | `12516.3.` `13617.7.` `1554.` | clean |
| `12` `13` | 50, 71 | only inside `9.8.12.`, `2012a`, `13.5`, `13.2` | still invented |

**The first version of this was a hole and was rewritten** ⟨GPT Sol, code review, finding 4,
CONFIRMED and reproduced⟩. It stripped **1–4** leading digits from any line-initial numbered heading,
which admits far more than the `2012. → 12` cost written down at the time: Sol scored a page printing
`12.3. Genuine heading` against a transcription saying `2.3. Genuine heading` and the check passed it.
Corrupting a section number is the class `protect` exists to catch, and suppressing that retry
publishes a silently wrong article — **much worse than the ~8 wasted retries the rule saves**.

**Option (a) of the two offered, and the evidence is what chose it: the folio is knowable.** A new
`folioOffset` elects one offset for the whole document — every page votes for every offset its
line-initial digit runs could imply, and a winner needs support on **half the pages and twice the
runner-up**. On the real file, offset 27 (the paper starts at journal page 28) is line-initial on
**141 of 142 pages against a runner-up's 10**, so it is elected by a distance no coincidence reaches.
`defusedFolios` then strips **that one number on that one page**, and only when what is left is itself
a numbered heading — so folio 77 against `77.3.` leaves `.3.`, which is nothing, and a document that
elects no offset gets no defusing at all. **Measured narrowing on Kuhn: 260 extra haystack entries
became 11**, with all eight true fixes intact.

The eleven cases, run through the real `check` against the real text layer: eight clean, `12` and `13`
still invented, and Sol's `12.3. → 2.3.` now invented. The unit tests build the document rather than
one page, because the folio is only strippable when the document agrees what it is.

**Sol's stronger suggestion is still the right eventual answer and is not done:** `pass0`
([`src/pdf.ts`](../../src/pdf.ts)) knows the text-layer item boundary between the folio and the
heading and throws it away by concatenating with no separator. Keeping it would mean none of this had
to be inferred — no offset election, no folio arithmetic, and the *recall* side of the same defect
(the baseline holds `649.5.10.` too) would go with it. It is a change to what every page's text looks
like, so it needs its own measurement pass against the fixture corpus; noted on `folioOffset`.

**The letter-spaced `ARTICLE INFO` box was left alone**, and the "if it is cheap" test is what
decided it: it carries no digits, so it never touches the protected path at all — it costs *recall*,
and the only place to fix it is the shared `tokens`/`fold`, which every threshold in the file is
calibrated against. Not cheap, and not this plan's risk to take.

**A byte bound in `planChunks`** — `MAX_CHUNK_BYTES`, 3 MB, and named a *planning* bound where it
sits so it cannot be confused with `MAX_ENCODED_BYTES` (30 MB, the hard request ceiling). Weights are
per-page encoded sizes from `PdfCuts.measurePages`, and a page is charged only its **excess over the
lightest page**, because a one-page cut carries the fonts and catalogue too — 126 KB of a 156 KB
median page on Kuhn, so summing raw sizes would call a 205 KB chunk 468 KB. The estimate lands
between 0.81× and 1.33× of what goes on the wire. Run over four real documents:

| document | chunks before → after | largest chunk before → after |
|---|---|---|
| kuhn (142pp) | 69 → 69 | **4.54 MB → 2.58 MB** |
| easy (8pp) | 2 → 2 | 0.12 MB → 0.12 MB |
| harder (14pp) | 5 → 6 | 7.98 MB → 7.03 MB |
| much-harder (17pp) | 3 → 3 | 2.54 MB → 2.54 MB |

3 MB is where the corpus leaves a gap: `harder` and `much-harder` routinely make 2.5 MB chunks and
are not pathological, so anything below reshapes documents that work — at 1 MB `much-harder` goes
from 3 chunks to 14 and `harder` from 5 to 11, and chunk count is a copy of `SYSTEM` bought each
time. 4 MB is indistinguishable from 3 on all four, so this is the tighter of two the evidence cannot
separate. **It cannot split a page**: `harder` still sends one 7.0 MB page on its own.

**`cutPages` parses the source once** — now `openPdfCuts`, which parses and hands back a cutter;
`runPdfExtract` takes every cut it needs from that one parse *before* the fan-out, so a chunk asked
twice is cut once and nothing is cut concurrently. **The new RSS curve, same box and file and day as
the old one:**

| | old: one parse per cut | new: one parse, cuts up front |
|---|---|---|
| idle | 283 MB | 260 MB |
| the parse itself | — | 276 MB |
| 16 in flight | **466 MB** | — (width no longer appears) |
| 48 in flight | 948 MB | — |
| all 142 pages measured + all 71 chunks cut **and held** | — | **311 MB** |

So peak RSS is now **flat in `CHUNK_CONCURRENCY`** — ~52 MB over baseline against ~183 MB at width 16
and ~665 MB at 48 — and the bytes held are bounded by roughly the source (22.9 MB of cuts against an
8.4 MB source) rather than by N × the source. `CHUNK_CONCURRENCY` itself is deliberately unchanged;
its memory paragraph is rewritten against this curve, and memory has stopped being one of the two
arguments for the number.

The parse-once change is invisible to every existing test, because the *bytes* were always identical
— that is what the three `set…` calls are for. So the new test counts `PDFDocument.load` through a
`vi.mock` seam ([`tests/pdf-source-parsed-once.test.ts`](../../tests/pdf-source-parsed-once.test.ts)),
seen red at 6 against a deliberate reversion.

**One assertion moved and it is not a regression.**
`tests/pdf-chunk-concurrency.test.ts` § "neither starts nor pays" now expects
`CHUNK_CONCURRENCY + 1` started and aborted. p-queue starts the next task inside the failing task's
own `finally`, two microtask hops before `allOrStop` can call `stop()`, so one chunk behind the
failure always started — the `await` inside `cutPages` merely put its `onStart` *after* the
assertion. **Settled by measurement, not argument:** flushing the timers after the rejection turns 16
into 17 on the old code too. The extra call is signalled in the same turn, so it starts and does not
finish.

**Also corrected, both untrue since 2026-08-30:** the top-of-file *"Nothing is written until every
chunk passes"* and `ATTEMPTS`' *"then it fails… The failure is still visible and still hard"*. A
chunk that fails twice is published with a quality note.

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

### Stage 8 — the tree leans on the author's own table of contents

> Can we make a minimal update to the prompt […] to include a light suggestion to lean towards/make
> use of/be informed by/extend the author's existing Table of Contents approach if they've provided a
> good one. But this is tricky to get right, because their one may not [be] good or suitable for
> Spideryarn's purposes, so maybe provide guidance on when and when not to.
>
> — Greg, 2026-09-04

**Stage 1's measurements are the argument for it.** Kuhn has **254 authored heading blocks** (25 h1,
208 h2, 21 h3, numbered three deep), and the model produced 83 nodes and **dropped 59 headings** —
because the prompt tells it that headings are HARD boundaries *and* to go 3 levels deep with 5–9
children, and on this document those are **jointly unsatisfiable**. It resolved the conflict by
flattening the author's third level. The 241-block section above is the same fact seen from the other
end.

So this is not only a nicety: the author's structure is being discarded on exactly the documents
where it is best.

**After stage 7, not before.** It changes generation, so it invalidates every cached structure answer
(`PROMPT_VERSION`) and — more sharply — `estimateHierarchyTokens` was re-derived *today* against a
corpus produced under the **current** prompt. A prompt that made the model honour 254 headings instead
of 83 would change the node count the estimator was just fitted to. Shipping the two together would
mean neither could be judged.

**Fable answered, and the framing above is wrong in the way that matters.** ⟨2026-09-04⟩

**`droppedHeadings: 59` is mostly an off-by-one, not the author being overruled.** Of the model's 82
non-root nodes, 24 start *on* a heading block and **53 start on the block immediately after one**.
Every unbacked `sourceHeading` claim reproduced is at offset −1: the model named the heading correctly
and put the boundary on the first paragraph after it, so the heading fell into the previous section's
tail, `planChildRanges` believed the start, and the claim was then dropped as out of range. **75 of 82
nodes claim a `sourceHeading`** — the model is already leaning on the author, and is cutting one block
late. On the evidence this is Kuhn-specific: noema's three trees show 0 of 83 starts one-after-a-heading.

So **the light prompt suggestion would change nothing**, because the model is not ignoring the author.
Two real levers, in order:

1. **A heading-snap repair in `planChildRanges`, as code.** A kept child whose start is the block after
   a heading run moves back to that run's first heading, recorded as a new kind of `PartitionRepair` so
   it is counted like the others. On Kuhn this alone takes backed claims from 24 to ~75 **with no prompt
   change**, and it guards the prompt change, which a model can ignore.
2. **Re-scoping the depth and fan-out bullets** — the genuine capacity conflict. Kuhn's numbering wants
   four levels (26 → 120 `x.y` → 97 `x.y.z`) against a prompt that caps the tree near 91 nodes, so even
   with the off-by-one fixed ~180 of 253 headings could not start a node. Fable's replacement text keeps
   the fan-out and depth numbers as guidance for what the model *proposes* while letting the author's own
   hierarchy exceed them, adds one line excluding journal/site furniture from being a boundary, and tells
   the model to trust the author's numbering over the tag level.

**And the scaffolding route is wrong on this document.** Kuhn's tag levels lie about its numbering —
`9.4` and `9.6` are tagged `h1`, 76 third-level headings are `h2` — so `buildHeadingTree` gives 22
top-level parts, 241 internal nodes, one 92-block section and a missing section 24. Feeding that in
would hand the model a **worse** outline than it produces unaided. Notably, `evals/hierarchy-structure`
already has `headings-listed` and `headings-seeded` arms built and **neither has ever been run** — so
the scaffolding question can be answered for the cost of one panel rather than a build.

**Measure it with `headingsCut`, not `droppedHeadings`** ⟨Fable⟩: the snap repair drives
`droppedHeadings` to near zero on its own, so it would report success for the wrong reason. `headingsCut`
(the share of authored headings that start a node — Kuhn is 21/253 today) is two-sided: it must rise on
Kuhn and other numbered documents and must **not** rise on the ones that over-segment or carry furniture.
Add `maxSectionBlocks` and a count of sections over `MAX_BATCH` (Kuhn: 239 and 5), and keep headingless
controls where the change should be a no-op.

**Done when:** the change is evaluated in the harness rather than eyeballed, on documents that span
the cases — a deeply-numbered paper, a sparsely-headed web article, one whose headings are stock
labels; `droppedHeadings` and max section span both improve on the first without regressing the
others; the estimator is re-checked against trees generated under the new prompt.

## It worked — 2026-09-04, 16:19–16:39 UTC

A real upload of the real document, through the real picker, on the merged code, watched end to end.
**No human intervention, no Retry, and not one error-level line in the whole run.**

```
16:19:23  fetch                                       1.3 s
16:19:25  extract      142 pages, 69 chunks           6 min 34 s   (12 quality notes)
16:25:59  blocks       2,046 blocks                  36 s
16:26:35  ── hand-back: not enough window left for hierarchy ──
16:26:51  hierarchy    20 AI calls, $2.89            12 min 07 s
16:38:58  ── hand-back ──
16:39:04  assets → revision published → job done
```

**19 min 41 s, three lease windows, two automatic hand-backs, ~$3.50.**

Three things in that are the stages working rather than a lucky draw:

- **Both hand-backs happened before a step started, never partway through one.** That is stage 3's
  raised `STEP_BUDGET_MS.hierarchy`: the claimant declined to begin a twelve-minute step in the tail of
  a window and put the job down instead. The browser re-drove it in about sixteen seconds, unattended.
- **`hierarchy` took 727 s — longer than a whole 740 s deadline leaves once anything else has run.** It
  fits only because it got a window to itself. Under the old 320.4 s budget this document could not
  have completed at any point, whatever the token estimate said.
- **12 quality notes**, against 20 and 32 on two earlier runs of the same file — stage 5's folio fix
  showing up in the reader-visible outcome rather than only in a unit test. Run-to-run variance is
  high, so this is a direction, not a measurement.

The postmortem is
[260904c](../postmortems/260904c-a-document-refused-for-an-answer-it-never-had-to-give.md), and it
covers both bugs: the estimator, and the folio fix that briefly widened the hole it was narrowing.

**Not yet on production.** `main` is written only by `npm run deploy`, and the two dead Kuhn jobs there
are `blocked`, so they show no Retry and cannot be revived — recovery is a fresh upload, which re-buys
the transcription at about $0.66.

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
