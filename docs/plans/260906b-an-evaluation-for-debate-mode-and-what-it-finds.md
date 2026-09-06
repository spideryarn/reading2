# An eval for Debate mode, and fixing what it finds

Greg, 2026-09-06:

> It sounds like this needs a good eval (with a few representative examples), if we don't have one
> already (although it might be a bit tricky, since the web is always changing, but perhaps we can
> pick at least some older articles where things won't change so fast, or something else to make
> this workable). Get input from Fable.
>
> Then proceed autonomously using engineering-manager.md to get this working well.

**Status:** planning, revised after GPT Sol's round-one refusal
([the review](260906b-plan-review-sol.md), F34–F46). The mode itself is
[260905f](260905f-debate-mode-what-the-web-says-about-this-piece.md); its measurements are
[the spike results](260905f-debate-mode-stage-0-spike-results.md).

## The one thing to understand before anything else

**Every debate call is two things wearing one coat: a *search* and a *reading*.** The search decides
which pages come back — it is where all the nondeterminism lives, all the cost variance (2.4× run to
run), and all of the moving web. The reading decides which rows are written and what `relation`,
`valence` and `applies` say about them.

Almost everything worth tuning is in the reading. Almost all the reasons an eval is hard are in the
search. So the eval splits along that seam rather than along "articles" or "arms", and the split is
what makes the moving web a non-problem for the part we actually want to iterate on.

> Nearly everything you want to tune is in the reading; nearly all the nondeterminism is in the
> search.
>
> — Fable, 2026-09-06

## What the live runs left us with

Three findings from [Stage 3½](260905f-debate-mode-stage-0-spike-results.md):

1. **The valence bug.** Three of seven Cargo Cult rows point `valence` at the source's own subject
   rather than at the row's target. `relation` and `applies` are correctly targeted on the same
   rows; only `valence` drifts. On screen that is a red **Critical** chip over a source that
   supports the article.
2. **Group one is empty for a reason nobody hardened against.** Both Cargo Cult direct rows died at
   `unverifiedSource` — the model's quotations were not in the *search extract*, a 236–4,945
   character slice the engine chose. `directnessUnverified` was zero, so the article-naming rule two
   review rounds were spent on never fired.
3. **The $0.6252 bought no replayable evidence.** Only *kept* rows are stored. The two lost direct
   rows — their URLs, their quotes, the extracts they were checked against — are gone.

### The overlap between `relation` and `valence`, and what it is not

**Round one of this plan claimed `disputes`+`positive` and `corroborates`+`negative` are
contradictions, and built a metric, a production coercion and a stopping rule on that. Sol's F35
refused it, and is right.** The claim is recorded here as a reversal rather than quietly removed,
because it is the sort of thing a later reader will re-derive.

`relation` names the argumentative move; `valence` is drawn as **Supportive** / **Critical**
([`VALENCE_APPEARANCE`](../../src/web/DebatePanel.tsx)) and summarises overall stance toward the
row's target. Those genuinely can diverge, one honest example per group:

- **group two** — *"The stated 10% is wrong; it is at least 30%, which makes the warning stronger."*
  Truthfully `disputes` + `positive`.
- **group one** — *"The reported figures are right, but the conclusion drawn from them is
  indefensible."* Truthfully `corroborates` + `negative`.

So the pairing is **a screen, not a gate**. Rows where the two fields point opposite ways are routed
to the judge; the flag rate is a diagnostic to interpret, never a pass mark. On the one real sample
we have it flagged three rows and all three were genuinely mis-targeted — which is n=3, a hypothesis
about where to look, and not a rate.

**Sol's F9 is untouched by any of this.** F9 refused *deriving* valence from relation, and its
example was `follow-up`, which F19 has since cut. Nothing here derives anything: valence stays an
independent field with its shipped meaning.

### A second prompt defect, found while checking the first

[`src/debate.ts`](../../src/debate.ts) § `READING` scopes the two fields to different subjects:

    relation  what the outside PAGE does to the thing it is answering
    valence   which way the QUOTED PASSAGE leans toward this row's target

A page and the one sentence quoted from it are not the same thing, so the fields do not even share a
subject. **Both should be about the quoted passage**, which is the only thing the reader is shown
and the only thing the row's evidence supports. This does not rescue any of the three wrong rows —
in all three the page and the passage agree with each other, and both differ from what `valence`
reported — and it does not make the screen a gate, since Sol's counterexamples are single passages.
It is a separate defect that the prompt work should fix in the same pass.

## Two things to do before the eval, both nearly free

Fable's strongest note, and it reorders the work:

> The eval is the right second move, not the first.
>
> — Fable, 2026-09-06

### The two-curl experiment

**Fetch the pages group one lost, and look for the model's quotations in the full text.** If they are
there, the extract is the constraint and full-page fetching rescues real rows. If they are not, the
model paraphrased or invented, fetching rescues nothing, and the repair is in the prompt. Two
outcomes, opposite builds, and nobody should build either before knowing which.

It cannot be run on the runs already made (finding 3), so it needs one fresh pass A on Cargo Cult —
about $0.10 — which is also the first capture the next item produces.

### Capture, at the provider-response boundary

Every attempted pass from here writes one append-safe record. **Sol's F40 moved where it is taken**,
and the reasoning is the point: `runPass` throws before returning on an unreadable answer, a bad
`finish_reason` or a zero search count, and `admissible` is already downstream of
`collectSearchEvidence` and the `selfSource` filter. A sink handed `{text, admissible}` would
therefore capture *nothing at all* for the paid failure that motivated capture in the first place,
and could never replay the collection it sits after.

So the record is taken immediately after the provider answers, before any validation, and holds:

| | |
|---|---|
| pass kind | `direct` / `claims` |
| raw assistant text | before `parsePass` |
| **raw annotations** | before `collectSearchEvidence` and before the self-source filter |
| raw usage, finish reason, model | before the allowlist |
| provider and search configuration | engine, `max_total_results`, `max_results` |
| sha256 of the exact system and user prompts | so an arm cannot be confused with another |
| article `inputFingerprint` and identity | § the corpus |
| status | `ok` / `aborted` / classified error — **a failed paid pass is captured too** |

`admissible` is *derived during replay*, never stored as raw input. **No change to what is stored on
the article** — a reader's artefact is not a debugging record.

## What the eval measures, and what it refuses to

| quality | scored how | why |
|---|---|---|
| **Attribution** — quotes real, located | loss-reason counts, free | already enforced in code and unit-tested; a judge would be paid to re-check a `String.includes` |
| **Interpretation — valence target** | the cross-field screen routes rows; **the judge decides** | the bug. The screen is free and catches the obvious half; the judge is the only thing that can see a mis-target inside a legitimate pair |
| **Engagement** — does the source passage actually answer the claim? | judge | **the only relationship the code cannot check.** `claimQuote` is in the block and `sourceQuote` is in the extract, and neither fact says they are about the same thing |
| **Discovery** — did the search find the famous replies? | live, against a hand-verified gold URL list | only measurable live, and only where reception is settled |
| **Usefulness of `applies`** | **not scored** | Greg reading two rendered panels. A rubric for "does this send the reader back into the prose with a sharper question" is our arithmetic dressed as judgment — [quotes.md](../project/quotes.md)'s objection |

**The judge sees every row.** Round one excluded `qualifies` and `extends` from the interpretation
score as ambiguous, and Sol's F37 caught the contradiction: the same table claimed the judge would
catch a mis-target *inside* `qualifies`. An arm can reach a clean screen while pointing every
`qualifies` valence at the wrong subject. So **only the mechanical screen is stratified by relation**;
the judged targeting and engagement metrics cover every frozen packet, with denominators printed per
relation.

**Every rate prints its numerator over its denominator, and an undersized denominator is
`not measured`** — never a zero that reads like a pass (F42).

## The moving web, and why it stops being a problem

### Layer 1 — replay the validation, no model at all

Stored raw records → `collectSearchEvidence` → `parsePass` → `readDirectGroup` / `readClaimGroup`.
Deterministic, free, millisecond. It is the regression test for every change to the validation layer,
and the only thing that can tell you a rule change dropped rows that used to survive.

### Layer 2 — one reading per frozen packet, no search, no choosing

**Sol's F36 rebuilt this, and the version it replaced would have rewarded an arm for answering
less.** If each arm picks its own URLs, quotes and claims, an arm that returns two easy rows beats
one that returns seven hard ones on any absolute count, and `incumbent-repeat` measures sampling
noise rather than that selection bias.

So Layer 2 runs over a **manifest of frozen row packets**. Each packet fixes: its id, its pass, the
article identity, the URL, the source title, the exact `sourceQuote`, the target (article identity,
or `blockId` + `claimQuote`), the exact evidence haystack, and hashes of every input. **Every arm
returns exactly one reading for every packet.** Missing, duplicated or foreign packet ids invalidate
the run. Arms select nothing. Every report prints packet coverage *before* any quality figure.

Cheap (~$0.05–0.15 per arm over the whole manifest), and it is where prompt arms are compared.

**The caveat, stated once and carried into every results file:** this is not production's path.
Production searches inside the generation, so the model reads the extracts in the same breath it
chose them. Layer 2 measures the reading prompt under a different frame — acceptable *precisely
because* it is the search half being held still, but a Layer 2 winner is confirmed by one live run
before it lands.

### Layer 3 — the live sweep

Five articles, two repeats each, ~$3. Scored **only on things no judge is needed for**:
`returnedSources`, kept rows per group, losses by reason, gold-URL hits, `webSearches`, cost,
elapsed. One repeat is not a comparison at 2.4× cost variance.

Run at most once per `PROMPT_VERSION` bump or search-side change. Not a place for small-effect
tuning: the changes worth making to the search half are large-effect (fetch or don't; Exa or the
default engine), and honest statistics on anything smaller are not affordable here.

### Layer 0 — deterministic packets, and only deterministic ones

Hand-built `(rows, GroupInput)` pairs handed straight to the group readers. No model, no network, so
they live in `tests/`, not `evals/`. **Sol's F45 removed one of them:** *"a same-topic page that
answers no claim"* is not a shape production can deterministically refuse — that is the engagement
question, which is exactly what the plan says code cannot check. It moves to the judged corpus.

What is left is deterministic:

| # | shape | must come out as |
|---|---|---|
| **P3** | `articleReferenceQuote` locatable in the extract but naming no article | `directnessUnverified` |
| **P4** | `sourceQuote` present in the full page, absent from the extract | `unverifiedSource` today; **kept** once Stage F exists |
| **P5** | two genuine quotations from an *unrelated* returned page | `directnessUnverified` — Sol's F24, which passed the code for a day |
| **P6** | the article citing itself, everything else valid | `selfSource`, **not** `uncited` — the ordering in `readShared` is load-bearing |
| **P7** | out-of-vocabulary `relation` and `valence` | `unclear` / `unknown`, and **the row kept** |

**P4 earns its keep twice**: today it pins the loss; after Stage F it is the only thing that could
tell a working fetch from a fetch that silently hands back the extract again.

**P7 is the one the prompt work could break.** If an arm's answer vocabulary changes and the mapping
is not extended, `RELATIONS.has` / `VALENCES.has` fall through and **every row silently becomes
`unclear`/`unknown`** — every panel goes grey with nothing red. That is the
[silent-success](../reusable/silent-success.md) shape exactly, and it is why no prompt lands without
this packet.

## The corpus

Five articles. Four are already on the shelf with blocks and a tree, which matters: a fresh ingest
costs the whole pipeline and can exceed the debate run it exists to feed.

| slug | words | what it is for |
|---|---|---|
| `writes` — PG, *Writes and Write-Nots* | 561 | **the cheapest group-one gold.** Famous, heavily replied to, and small enough that pass B costs almost nothing |
| `cargocult-spya-rz663q` — Feynman | 3,822 | **the control**, already measured. Carries every failure mode at once |
| `claudes-constitution-spya-cr8bzk` | 3,295 | recent and much discussed; also the article whose run failed to write (§ below) |
| `revistes-ub-30977` — *Forms of Memory in Post-colonial Australia* | 3,106 | **the honesty case.** Real, obscure, argumentative: pass B has claims to search, pass A must come back empty |
| Carr, *Is Google Making Us Stupid?* (2008) | ~4,000 | **needs an ingest.** The canonical settled reception — Shirky's and Cascio's replies are named in named venues and have not moved in fifteen years |

**Pinned by production's own fingerprint, not by two file hashes** (Sol's F41). Round one pinned
`blocks.json` and `tree.json`; pass A searches the web for the article's **URL**, and every returned
citation is compared against it, so metadata could change while the corpus gate stayed green and
produce a different search under the same corpus identity. Each entry pins
`inputFingerprint(blocks, tree, meta)` — [`src/debate.ts`](../../src/debate.ts), the blocks, the tree
and the cited head. The loader recomputes it and refuses drift before generation or replay, and every
capture records the same `sourceHash`.

**Two slugs are poison and are named so nobody reaches for them.** `scaling-hypothesis` and every
`evalcost-*` carry `https://cost-eval.invalid/…` as their URL, so pass A would search the web for a
domain that does not exist. Several others (`openai-huggingface`, the ball-lightning copies) have no
URL at all, which changes what pass A can even ask.

**One gap, worth filling rather than skipping:** an article whose author published a later correction
on a separate page — the row type § 4 of the parent plan calls the most valuable the mode can
produce. No confident candidate yet.

## The prompt arm

**Keep valence's product meaning and name its target in the question**, per Sol's F35(b) — group-specific,
because group one has no quoted claim to point at:

- group one — *"Overall, is the quoted passage supportive of this article, critical of it, neither,
  or impossible to classify?"*
- group two — *"Overall, is the quoted passage supportive of the quoted claim, critical of it,
  neither, or impossible to classify?"*

Mapped to `positive` / `negative` / `neutral` / `unknown`, with P7 covering the mapping.

**Fable's version is recorded and not taken.** It proposed reframing the field as agreement —
*agrees / disagrees / mixed / cannot tell*. Refused because the chips a reader sees say **Supportive**
and **Critical**: putting agreement into a field drawn as support changes its meaning without
changing its name or its UI. If agreement is what we actually want, the field and the chips get
renamed together, which is a product change and not this job's.

The same pass makes `relation` a property of the quoted passage rather than of the page, so the two
fields at least share a subject.

## The write failure, folded in here rather than left open

The second live run generated `1 about this piece, 5 about what it claims` and then errored on the
write, losing $0.1948. Job `spya-ttcxz7`, `requeues: 1`.

**The "another worktree claimed it" story is probably wrong**, and the evidence is worth recording:

- The step's `detail` string exists only in this branch's `src/pipeline.ts`, so the claiming process
  had recent code.
- The step finished the same second as its last `ai_calls` row, so both passes completed and the
  failure is in the write.
- The first attempt was an OOM-killed background process. An OOM kill does not unwind, so the requeue
  came from a **lapsed lease**, not from `pauseForDeadline` — and it is `pauseForDeadline` whose
  docblock promises *"the job goes back to queued on its own row with its draft intact"*.

**Refined hypothesis: a lease-lapse requeue can leave a job unable to write its artefact.** If true
that is a product bug costing a reader a whole purchase, it is not debate-specific, and it gets a
postmortem. Repro: enqueue, kill the driver mid-step, let the lease lapse, watch the second attempt.

## Stages

Each ends with the suite green and the tree safe to commit.

### Stage A — capture, and the two-curl verdict

- The capture record above, taken at the provider-response boundary, including failed passes.
- `evals/debate/` with a runner that calls `generateDebate` directly — **never the queue**, so no
  artefact is clobbered and no product-spend row is written — under `withLedger("eval", …)`.
- **Cost identity per run** (Sol's F43). `generateDebate` returns searches and elapsed, not money,
  and `withLedger` prints an aggregate it does not return. So the runner derives each run's cost from
  the spend collector's `SpendRecord`s through `totalSpend`, records the contributing call ids and
  the `unpriced` count, and **asserts a completed run contains exactly its two search calls**. Never
  dollars from token `Usage`. A run with any unpriced call reports `not measured`, with the count.
- One fresh pass A on Cargo Cult with capture on, then fetch each reported URL and look for the
  model's quotations in the full page.
- The write-failure repro.

**Done looks like:** a numbered answer to *"would full-page fetching rescue rows?"*, written into the
spike-results doc, and one captured run on disk that Layer 1 can replay. ~$0.15.

### Stage B — the free instrument

- `evals/debate/score.ts`: loss-reason table, the cross-field screen, kept-per-returned, gold-URL
  hits. Deterministic, no IO, **unit-tested in `tests/debate-eval-score.test.ts`**.
- Layer 1 replay over captured records, starting from the raw annotations.
- Layer 0's five packets, as tests, each watched red before its fix.
- The corpus manifest, pinned by `inputFingerprint`.

**Done looks like:** free, repeatable numbers over Stage A's capture. No money.

### Stage C — the arms, generated and scored, landing nothing

- Arms as data: `incumbent`, `incumbent-repeat` (the floor), `targeted` (the group-specific question
  above, plus the passage-scoped `relation`).
- The frozen packet manifest, built from Stage A's capture plus the stored Cargo Cult rows.
- Layer 2: every arm returns exactly one reading for every packet; coverage printed first.
- **Every arm is scored on its raw output.** No production repair is applied before scoring, and
  there is no coercion to apply — F35 removed it.

**Done looks like:** a table of arms against the screen and the free measures, and **no prompt
landed**. Sol's F37: the metric that can identify the winner does not exist until Stage D.

### Stage D — the judge, and only then the landing

- GPT Sol through `codexJudge`, blinded, empty sandbox — the house pattern.
- **The judge never sees the arm's `relation`, `valence` or `applies`** (Sol's F38). Ordering
  questions inside one request is not blinding: the model reads the whole prompt before answering,
  and the summaries eval records that limitation in as many words. From the target, the quotation and
  the extract it independently returns engagement, the passage's stance toward the target, and —
  where mis-targeted — **the subject it appears to describe instead**. Deterministic code compares
  that with the arm's output afterwards.
- Per packet the judge sees: article title and byline; the row's target; the source's title and host;
  the `sourceQuote`; **and the full stored extract**. Without the extract it is guessing at the page's
  subject with exactly the information the model had, and the Geller row is invisible.
- **The anchor gate.** The seven Cargo Cult rows hand-labelled (three wrong-target, four right) plus
  the synthetic packets. **Every anchor must be classified correctly** — Sol's F39: six of seven
  permits a miss on one of only three known wrong-target cases, a 33% false-negative rate on the
  defect the judge exists to find, and the summaries precedent is `MAX_ANCHOR_INVERSIONS = 0`. The
  report prints the anchor confusion matrix including wrong-target recall, not a fraction. It is a
  sanity gate, not evidence that the judge's population error is below anything.
- Then, and only then, the winning prompt lands and `PROMPT_VERSION` bumps. **If no arm passes,
  production is unchanged.**

### Stage E — the live sweep, and the docs

Five articles × two repeats. `returnedSources`, kept, losses, gold hits, searches, cost, elapsed, on
the same cost identity as Stage A. Re-measure `STEP_BUDGET_MS` (120 s is a guess; a real run took
146.7 s). Write `evals/results/debate/` and the section in `evals/README.md`; update the parent plan
and [the spike results](260905f-debate-mode-stage-0-spike-results.md). ~$3.

### Stage F — full-page verification fetch, **only if Stage A says yes**

Our own fetch of the URLs the model reported rows for, fed to `findQuote` and **never to a model**.
The parent plan's "second injection surface" objection applies to a fetch a model reads and not to
one only a string matcher reads.

**But injection was not the only risk** (Sol's F44, the one P0). The URL is still untrusted network
input: a public result can redirect to loopback or private space, return an unbounded body, or hold
the connection open. And "≤12 URLs" was wrong — the caps are 12 **per pass**, so up to 24 per run.

So: through [`fetchDocument`](../../src/fetch.ts), never bare `fetch`, keeping its HTTP(S)-only rule,
its private-address and DNS-pinning checks on every redirect, its redirect cap, byte cap, type sniff
and deadline — plus an explicit whole-run concurrency, byte and elapsed budget. Fetched text is a
verification haystack and enters no prompt. The capture records the final URL, the content hash, the
fetch outcome and the exact bounded haystack, so Layer 1 stays network-free.

## Stopping rule, declared before the runs

1. **Wrong-target valence ≤ 1 in 20**, over **at least 20 structurally valid judged packets**. Every
   rate prints numerator over denominator; an undersized denominator is `not measured` and cannot
   satisfy a gate.
2. **Group-two engagement ≥ 80%** over its printed denominator. The obscure article requires **at
   least one kept and judged row and zero `no` judgments**; if it returns no rows the report says
   **`not exercised`**, never *"zero no"* (Sol's F42 — empty output is valid here, so the round-one
   wording could have passed over nothing).
3. Carr and `writes` keep ≥ 1 direct row in both repeats — and if that is unreachable even after
   fetching, **that is a product answer, not a tuning target**.
4. Median run ≤ $0.40, worst ≤ $0.60 — a disclosure figure, not a gate, and `not measured` if any
   contributing call is unpriced.
5. Greg reads two rendered panels and is happy.

*Good enough to ship as experimental* is 1, 2 and 5. Do not chase `applies` wording or a sixth
article.

## The one product question, held for Greg

> the reliable product is *what the web says about what this piece claims*, and direct responses are
> a bonus that fires on famous pieces. But the bonus is not optional, because a reader trying the
> mode for the first time will try it on something famous, and an empty "About this piece" on *Cargo
> Cult Science* — a piece with a Wikipedia article named after it — reads as broken, not honest. So:
> lead the panel with group two, show group one as a short line above it.
>
> — Fable, 2026-09-06

Held rather than built, and brought back **with the live sweep's numbers under it**.

## Deliberately not in this job

- **Pairwise arm-vs-arm comparison on live runs.** n=2 at 2.4× variance supports a large-effect call
  and nothing finer.
- **Scoring `applies`.** See the table.
- **Coercing an inconsistent valence.** Proposed in round one and removed by F35: the premise was
  that the pair was impossible, and it is not.
- **Renaming `valence` to `agreement`.** A product change, and Greg's.
- **An admin page that runs evals.** None exists for any of the eleven evals in the tree.
- **Stage 4 of the parent plan** — the shared link. Still unbuilt, still worth building for a mode
  that produces something worth sharing, and that proposition is what this job settles.

## The simpler option passed over

**Just fix the valence prompt and re-run twice.** Genuinely less work, and it would probably improve
the bug. Refused because the same two runs would tell us nothing about *engagement* — whether a
source passage really answers the claim it is filed under — which is the one relationship no code in
this mode can check, and the one a reader's trust actually rests on. A mode that files a plausible
stranger under a claim it does not address fails quietly, forever, and no amount of re-running spots
it.

## Review ledger — GPT Sol, round 1, 2026-09-06

[The review](260906b-plan-review-sol.md). Verdict: **refuse as written**, on F35, F37, F38, F40, F41
and F42. All thirteen were checked against the tree before acting; all thirteen accepted.

| ID | Finding | Disposition |
|---|---|---|
| F34 | P1 — coercion could manufacture the stopping-rule result | **moot, and the rule kept.** Coercion removed by F35; "score raw output, never a repaired projection" kept as a standing rule |
| F35 | P1 — the "impossible" pairs are not impossible under the shipped contract | **accepted, and it is the reversal.** The metric is a screen, not a gate; coercion cut; Fable's agreement rewording refused for changing a field's meaning under unchanged chips |
| F36 | P1 — Layer 2 could compare different rows and reward omission | **accepted.** Frozen row packets; every arm answers every packet; coverage printed before any quality figure |
| F37 | P1 — landing a winner before the metric that identifies it, and a contradiction at the `qualifies` exclusion | **accepted.** Only the screen is stratified by relation; Stage C lands nothing; Stage D judges and decides |
| F38 | P1 — ordering questions inside one request is not blinding | **accepted.** The judge never sees the arm's labels; deterministic comparison afterwards |
| F39 | P1 — six of seven cannot calibrate a 1-in-20 claim | **accepted.** Every anchor must be right; confusion matrix printed |
| F40 | P1 — capture sat downstream of the failures it claimed to preserve | **accepted.** Capture moved to the provider-response boundary, raw annotations, failed passes included |
| F41 | P1 — the corpus pin omitted a production input | **accepted.** Pinned on `inputFingerprint(blocks, tree, meta)` |
| F42 | P1 — two stopping clauses could pass over nothing | **accepted.** Denominators printed; `not measured` and `not exercised` are outcomes |
| F43 | P1 — no specified source for per-run cost | **accepted.** Cost from `SpendRecord`s via `totalSpend`, call ids recorded, two-call assertion, never from `Usage` |
| F44 | **P0** — Stage F removed injection but specified no safe network path; and the cap is 12 per pass, not per run | **accepted.** `fetchDocument` with every check kept, plus a whole-run budget; 24 per run |
| F45 | P2 — one "no-model" packet needed semantic judgment | **accepted.** Moved to the judged corpus; Layer 0 is deterministic only |
| F46 | P3 — the candidate inventory was incomplete | **accepted.** `.tmp-debate-fixture.mts` named in the round-two prompt |
