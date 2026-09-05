# Evals

Not tests. [`tests/`](../tests) holds the deterministic ones — same input, same answer, run on every
change ([testing.md](../docs/project/testing.md)). An eval calls a model, costs money, takes minutes,
and gives a slightly different answer each time. It is run by hand when a decision needs it, and its
results are committed so the next change can be compared against a number rather than against
somebody's memory of last week.

## `pdf/` — three PDFs, and what "read correctly" means

```
(no runner yet — see evals/pdf/README.md)
```

The odd one out on this page: **no script and no numbers yet**, just three source PDFs committed
with their licences and one committed result. It is here because the fixtures already did their job
— the first-hour bake-off for [PDF ingestion](../docs/plans/260826c-pdf-ingestion.md) ran on them, and
[`pdf/baselines/bakeoff-2026-08-26.json`](pdf/baselines/bakeoff-2026-08-26.json) is the number the
next change gets compared against.

Read [`pdf/README.md`](pdf/README.md) for what each fixture is for and the three ways choosing them
nearly went quietly wrong.

## `pdf/titles.mts` — whose title does a PDF get, and what does the fix eat?

```
npx tsx evals/pdf/titles.mts transcribe --samples=3     # buys the records, once
npx tsx evals/pdf/titles.mts score                      # four arms over those records
```

Written after a 142-page Elsevier paper reached a reader's shelf called *"Progress in Biophysics and
Molecular Biology"* — the journal, not the paper
([260905b](../docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md)). Ten fixtures under
[`pdf/titles/`](pdf/titles/README.md), each the **first three pages** of a real document (one is
synthetic), each with a gold title, the strings a naive extractor is likely to steal instead, and
short verbatim snippets that must survive.

Three things about it are worth copying elsewhere:

- **The transcription is bought once and the arms run over it.** Paying per arm would compare arms
  that read different records, and the fault being measured is model variance on a genuinely
  ambiguous line.
- **It scores in two directions.** *Right title, fewer publisher lines shown* is maximised by an arm
  that hides the whole first page — and `src/pdf-score.ts` would not notice, because recall counts
  every record whether it renders or not. So `mustKeep` sits beside `mustNotRender`, and there is an
  **`overdelete` arm that the report must fail, in every document**. It says so out loud rather than
  printing a bad number and hoping somebody looks.
- **A gold only counts where the transcription put it in reach.** Retention is scored against what
  each sample renders with *nothing* set aside, and anything already missing from that baseline is
  named as a corpus problem rather than blamed on an arm — because a gold that is already lost cannot
  be lost again, which would mask the next arm's damage. The first version of this report gave the
  incumbent 72% for removing furniture it had never touched.
- **Three pages is enough to reach `FURNITURE_PAGES` and not enough to be the document.** Of the
  eight real multi-page fixtures only two reproduce their own document's furniture from the cut, so
  every fixture keeps `pass0-full.json` — the whole document's `metaTitle` and furniture, measured
  before it was cut — and the arms reason with that while the model sees three pages.

## `extraction/` — what Mozilla Readability does to fifteen hard pages

```
npx tsx evals/extraction/corpus.mts                     # free: no model, no network
npx tsx evals/extraction/fixtures/verify.mts --refetch  # have the pages changed under us?
```

**The odd one out on this page in the other direction: it calls no model at all.** It is here rather
than in `tests/` because it is a fifteen-page corpus of other people's HTML, it takes tens of
seconds, and its output is a judgement to read rather than an assertion to pass. `compare()`, the
part that *is* deterministic and cheap, is tested properly in
[`tests/extraction-inventory.test.ts`](../tests/extraction-inventory.test.ts) — one case per bug the
instrument shipped with, and there were eight: five in the matcher, three in the part that compares
two arms, every one of them a number that rewarded *recovery* being read as a number that rewarded
*quality*.

[`extraction/rescue.mts`](extraction/rescue.mts) is the one that spends money: it asks a model which
of the blocks Readability dropped were the article and which were the furniture, and answers with
ids only.

Read [`extraction/fixtures/README.md`](extraction/fixtures/README.md) for what each of the fifteen
is meant to break, why the HTML is committed rather than fetched on the day, and why the fifteenth
had to be added before the corpus could judge its own arm.

## `prompt-caching.ts` — is the article actually being cached?

```
npm run eval:caching -- data/noema-mythology-of-conscious-ai
```

**This one calls a model**, unlike `hierarchy-labels.ts`, and that is the whole point of it. Everything
deterministic about prompt caching is already pinned in
[`tests/article-prompt.test.ts`](../tests/article-prompt.test.ts): that the cached prefix is
byte-identical across two questions, two selections, two reading positions, a growing conversation.
None of that proves a cache was *read*. Only the provider can say, and the only way to ask is to call
twice and look at the number.

It searches one article twice with two different criteria, back to back, and prints
`cacheReadTokens` / `cacheWriteTokens` and the cost against uncached. **The pass condition is a
non-zero read on the second call.** Results land in `results/` so the next change is compared against
a number.

Worth having as an eval rather than a test because the failure is invisible: a cache that has stopped
hitting returns the right answer, raises no error, and only costs more
([silent-success.md](../docs/reusable/silent-success.md)). There is also a public report of cache
reads sitting at zero through OpenRouter with Claude, so "no error" is specifically not evidence.
See [docs/project/prompt-caching.md](../docs/project/prompt-caching.md).

## `reorder-quality.ts` — did putting the article first change the writing?

```
npm run eval:reorder -- data/constitution data/noema-mythology-of-conscious-ai
```

Calls no model — it measures artefacts already on disk, like `hierarchy-labels.ts`. It exists because
prompt caching required the arc, thread and glossary prompts to put the article *ahead* of each
stage's instructions, and models weight recency. The direction of the move matches Anthropic's own
long-context guidance, which is a reason to expect it to be fine rather than evidence that it is.

Measures mean length, opening-bigram repetition, and **vocabulary retention** — the proxy for the
model still working from the author's own words. A fall of more than a couple of points means the
reorder cost something, and the right response is to put that stage's prompt back and leave it
uncached: bytes serve the prompts, not the other way round.

The incumbent numbers are committed at
[`results/reorder-quality-before.md`](results/reorder-quality-before.md), captured before anything
was regenerated. **They stop being obtainable once the artefacts are rebuilt**, which is why they are
in the repo rather than left to be re-derived.

## `hierarchy-labels.ts` — are batched nav labels as good as whole-pass ones?

Written for [260826h-toc-scaling.md](../docs/plans/260826h-toc-scaling.md), which splits stage 4 into one
whole-document structure call plus parallel label batches. The worry that split has to answer is
coherence: labels written in separate calls, each blind to the others, might not read as a series.

```
npm run eval:hierarchy -- data/constitution data/noema-mythology-of-conscious-ai
```

It reads `tree.json`, `blocks.json` and — when the labels were generated in batches —
`labels.json`, which records which blocks went in which call. It calls no model itself: it measures
artefacts that already exist, so it is cheap to re-run and can be pointed at an old tree as easily
as a new one.

### The texts

Two, and deliberately not more. Each costs a real ingest to regenerate.

| | blocks | why this one |
|---|---|---|
| `data/constitution` | 360, all gistable | the article that broke the stage; dense authored headings; long enough that batching actually happens |
| `data/noema-mythology-of-conscious-ai` | 141, 117 gistable | has non-gistable media blocks, so it exercises the "no label here" path; short enough to be a fast check |

`data/writes` (19 blocks) is too short to batch and is not part of the eval.

### What it measures

Everything here is mechanical. None of it is a proxy for "is this a good label" — they are proxies
for the specific ways this design could go wrong.

- **Coverage** — labelled over gistable. Has to be 100%. A gap here is not a quality question, it is
  [silent success](../docs/reusable/silent-success.md).
- **Length** — against the documented 6–20 words, **excluding headings**. A heading's label is
  required to be its heading copied exactly, which is usually two to six words, so counting them
  measures how many headings the article has. The first version did count them: 30 of the
  constitution's 39 "outside range" labels were compliant headings, and all 9 of the other article's
  were. What is left is the real signal — drifting short is the first sign the model has less context.
- **Template repetition** — the share of labels sharing an opening bigram, headings excluded for the
  same reason. "The author then turns to" is the failure the prompt is written against, and a model
  with fewer neighbours in front of it is likelier to fall back on a formula.
- **Vocabulary retention** — the share of a label's content words that appear in its own block,
  headings excluded for the same reason (a copied heading scores ~1.0 and is not evidence of
  anything). The cheap proxy for *"reuse the author's distinctive vocabulary"*, and for not
  inventing. It uses `contentWords` imported from [`src/labels.ts`](../src/labels.ts) — the same
  function the stage uses to *refuse* a batch whose labels match the neighbouring paragraphs better
  than their own, so the measure and the gate cannot drift apart.
- **The seam test** — the one aimed at the coherence question. See below.
- **Tree/labels agreement** — do `tree.json` and `labels.json` say the same thing? Nothing made them,
  so a re-run that wrote one and died before the other would leave a reading view and a provenance
  record describing different articles, with nothing red.
- **Label cost, and the slowest single call.** Named for what it is: it is *not* the stage's
  wall-clock, because the structure call, the queue's waves and any retried first attempt are all
  outside what `labels.json` records.

**A measure that excludes something is asserting a fact about it**, and this one got that wrong once
already: headings were excluded on the premise that their labels are the heading copied exactly, and
the model was not copying them exactly — on 9 of 36 labels for one article. The exclusion hid the
bug that justified it. A heading's label is now taken from the block rather than asked for
([`src/labels.ts`](../src/labels.ts)), so the premise is true because code makes it true.

### The seam test

Naively you would compare labels either side of a batch boundary against labels next to each other
inside a batch. That comparison is rigged: a batch boundary is also a *section* boundary, so the two
labels are about different things and would look less alike however they were generated.

So the control is matched. Both groups are pairs of adjacent labels that **cross a sibling-set
boundary**; the only difference is whether that boundary is also a call boundary.

- **seam pairs** — adjacent labels whose blocks were in different calls
- **matched interior pairs** — adjacent labels whose blocks were in different sibling sets but the
  *same* call

If the two groups score the same, batching left no trace. If seams are worse, that is the number to
fix.

**There is no verdict line, and removing it was the point.** The first version printed "seams look
worse" off a 15% ratio band. The second kept that and added a floor of twenty pairs, which looked
like rigour and was not: at similarities around 0.02, one extreme observation among twenty moves the
mean by ~0.05 — far outside the band the verdict was reading — and the pairs are not independent
anyway, coming from one article, one run, one model. A floor cannot rescue a statistic with no error
bar, and printing a threshold implies one.

So the numbers are printed and nothing is concluded from them. A directional claim about seams needs
a blinded comparison across several texts and several runs with its uncertainty stated, which this
harness does not do. Until then the coherence claim rests on the mechanism — labelling synthesises
nothing across chunks, and sibling batching keeps every compared pair inside one call — and
[260826h-toc-scaling.md](../docs/plans/260826h-toc-scaling.md) says so too.

### What it cannot do

The direct test of a label's job needs a person: show a label with its 5–9 sibling paragraphs
shuffled, and ask which paragraph it points to. Measure correct identification, time, and whether
distinctive terms survived. `--shuffle` prints those sets ready to hand to someone.

## `hierarchy-structure/` — is the structure pass worth what it costs?

Written for [260830a-opening-an-article-before-the-toc.md](../docs/research/260830a-opening-an-article-before-the-toc.md).
`hierarchy-labels.ts` above judges stage 4's *second* pass; this judges the first — the single model call
in [src/hierarchy.ts](../src/hierarchy.ts) that proposes the nested structure, which is 163–320 seconds and
88% of the ingest wait now that the labels run concurrently and the arc is deferred. The decisions queued against it (progressive waves, seeding the
author's headings, changing model or effort) need a number to decide against.

```
npm run eval:hierarchy-structure -- --arm headings --arm incumbent-disk   # free: no model, no network
npm run eval:hierarchy-structure -- --list                                # the declared arms
```

The deterministic scoring (`score.ts`) is unit-tested in
[`tests/hierarchy-structure-eval.test.ts`](../tests/hierarchy-structure-eval.test.ts) — the same split as
`extraction/`: the part that is cheap and repeatable is pinned as a test, the part that spends
money is not one. The arms are declared as data in `arms.ts`; the ones that call a model **refuse
to run** until their executor lands, loudly, so a results file cannot quietly mean "those arms were
skipped".

### The corpus is a committed manifest of seven documents

The corpus lives in `hierarchy-structure/corpus.ts` — one entry per document with its role, its
selection reason, and the sha256 of the `blocks.json` that was measured (data/ is gitignored and
regenerates, so a results file that only named a slug would name bytes nothing can recover; the
runner checks the hash and says so when it has drifted). `source`, `source-2` and
`revistes-ub-30977` are **three extractions of one document** — the manifest marks the first two
`duplicate` and no default run or aggregate ever counts them, or one document is triple-weighted
and every paid arm buys the same answer three times. `example/` is marked `fixture` and appears in
no claim about real documents. The seven `dev` entries are **frozen as the development set** — the
heading rule's thresholds were fitted on them — and the held-out set Greg is choosing arrives as
new `heldout` entries, a data change. (An earlier statement of the headline result said "6 of 9";
the honest denominator is below.)

### The denominator is free

**`headings` is arm zero**: the tree the author's own headings give for free, built
deterministically in `src/heading-tree.ts`. On this corpus it reproduces the incumbent's depth-one
carving *exactly* (L1 boundary agreement 100%) on **four of the seven distinct documents** — so an
eval that scored model arms against nothing would credit the model for work the headings did for
free. What the model demonstrably adds on those four is the level *below* (all-boundaries
agreement 28–48%: the model cuts long runs at topic shifts, headings can't), the gists, and the
titles where there is no heading to copy.

The scorer also reports **the longest headingless run of body blocks**, which is the article's own
fact rather than the tree's, and the number that predicts whether a heading tree can give usable
bands at all — heading *count* cannot: fowler has eight headings and a 61-block run, because all
eight are front-matter.

The two hard cases stay hard, which is what they are in the corpus for: `scaling-hypothesis`
over-segments on its own headings (11 parts against the model's 8, L1 agreement 42%), and
`fowler-phrenology`'s headings are all catalogue front-matter in the first ten blocks, so the
heading tree collapses to flat — no heading rule can carve that document, and it is precisely
where a model arm earns its money.

The section-level rule is two rules, not one — the shallowest level with ≥3 headings (else ≥2,
else flat), then **a segment with under 20 words of prose merges into the next one** (the last
merges backwards). The second rule is what the naive "shallowest repeated tag" was missing:
without it the constitution grows a 6-word title part, and scaling-hypothesis a 1-word "Appendix"
part and three trailing furniture parts. `src/heading-tree.ts` has the reasoning and the failure it
keeps (fowler).

**The 20 was fitted to this corpus — and `--sensitivity` shows it sits on a plateau.** Thresholds
of 10, 20 and 40 words produce *identical carvings on all seven dev documents*; only 0 (no merging
at all) differs. So the constant is not knife-edged: anywhere in a broad band gives the same
trees, which is the difference between a tuned number and a discovered one. Both sentences belong
together — "fitted" alone overstates the fragility, "plateau" alone hides where it came from.

(Operational note, 2026-08-30: nine test files once went red at load average 187 — several agents
running suites concurrently — because importing src/hierarchy.js took 22 seconds and 5s-default timeouts
fired en masse. If you see many unrelated suites time out at once, check `uptime` before
concluding your change broke something.)

**Running a paid panel on a laptop, learned the expensive way (2026-08-30, twice):** the lid can
kill a run mid-call (a sleep surfaced on wake as the SDK's `APIConnectionTimeoutError` — correctly
a bench fault, not an arm outcome), and a completed background run's completion notice can arrive
half an hour late, during which "waiting on the notice" is indistinguishable from "the thing died".
So: wrap paid panels in `caffeinate -i`, and judge progress from the run directory's `run.json` —
checkpointed after every cell — never from the orchestration around it. Wall-clock latency is not
trustworthy across a suspend (one interrupted call recorded 586s that was mostly nap); a cell
whose latency looks like an outlier should be checked against its neighbours' before it is quoted.
And a panel interrupted twice ends up spread over several run directories — anything computing a
floor must read across **all** of them (`floor-combined.mts`) or the floor is silently a subset,
which is the survivor selection effect in a new outfit.

### What it measures

Mechanical proxies, per (blocks, tree); none is "is this a good tree". Validity (`checkTree`,
with the free arm's structurally-inevitable missing gists counted apart from real damage);
part-size balance in **words** (cv); leaf-depth uniformity per **block**; fanout against the
prompt's 5–9; title and gist vocabulary retention via the same `contentWords` the label gate uses,
with copied headings excluded for the reason the label eval learned; gist template repetition; and
**heading agreement, which is deliberately two-sided and deliberately not a score** — boundaries
landing on headings ≈ deferring to the author, headings becoming boundaries ≈ not reorganising,
and either end can be right.

`compareTrees` reports how differently two trees carve one article — exact Jaccard over cut
points, **plus a tolerant nearest-cut distance**, because under Jaccard alone a boundary that
moved one block reads as total disagreement and run-to-run wobble would dominate any noise floor
built on it. Between an arm and the incumbent it is descriptive; between repeats of the incumbent
it is **the noise floor**, the resolution of the whole instrument, to be reported before any
comparison. The mechanical measures are diagnostics and guards, not the verdict — every one of
them can be won by a worse arm (GPT Sol's review has the table) — so close arms go to a **blinded
judging pass over the finalists' trees** (`hierarchy-structure/blind.ts`, fed by the per-run `trees/`
directory). **The judge is a model, not a person** — Greg's decision, 2026-08-30, with a budget of
about ten comparisons, spent on the documents where arms disagree. The weakness is stated here
rather than discovered later: a model judging model output tends to prefer writing that resembles
its own, which is why the free heading tree is always in the lineup as a non-model anchor.

**The decision rules, declared before any run rather than argued after one:**

- An **unusable flag disqualifies an arm regardless of its scores** — a model can raise it, and a
  tree nobody would navigate by does not win on retention numbers.
- Where the judge and the mechanical measures **disagree on a close call, neither wins**: the
  decision falls through to latency, cost and simplicity.
- A judge who cannot separate the arms by more than the noise floor does not rank them — the
  honest output is *"not separable on quality"*, and the results file says so plainly rather than
  reaching for a winner.

Never treat either tree as the reference: the third warning in the design was to never derive an
expectation from the thing under test.

**Reading the two agreement numbers together:** `l1Boundaries` is depth-one cut points only;
`boundaryDistance` is over **all** internal cut points — so `l1Boundaries: 1.0` beside a mean
distance of ~3 blocks is not a contradiction, it is the level below L1 disagreeing. And on this
corpus the means are `within1Block` 0.56 against exact `allBoundaries` 0.39 (0.65 vs 0.48 on the
constitution alone), so **roughly a quarter to a third of the deep "disagreement" is one-block
wobble** — which softens, without erasing, the claim that the model earns its money below L1.

Each run writes a **directory** under `results/hierarchy-structure/` — `run.json` (scores, arm specs,
the git commit, and the measured input hashes), rewritten incrementally after every article × arm
so a run that dies after six paid calls keeps six results, plus every produced tree under
`trees/`, the disk arm's included, because `data/` regenerates under old results.

### The arms that spend money (phase 2, not yet runnable)

Every arm is labelled with the **kind of claim its result can support** — `isolated` (one variable
differs from the incumbent) or `bakeoff` (several move together: it can pick a deployable recipe
and can never explain the win) — and the label travels into the results file. `incumbent` (what
ships: `anthropic/claude-sonnet-5`, one call, at whatever `src/hierarchy.ts` § `EFFORT` currently
says — this line named a value and was wrong about it for five days), `incumbent-repeat` (the noise
floor), `smart-medium` (isolated: effort, and it was `smart-low` until production moved to `low` on
2026-09-04 — the arm points the other way now), `headings-listed` (isolated: the author's headings as an explicit
list — production already shows them as blocks and calls them hard boundaries, so this isolates
salience), `headings-seeded` (isolated: the whole deterministic heading tree as a proposal),
`cheap-high` (bakeoff: gpt-5.6-luna does not exist on the Messages wire — src/models.ts — so
model, wire and thinking semantics move together), `waves` (bakeoff, and it must exercise **three**
levels — the book-length motivation is depth the single call cannot reach, so an L1→L2 pilot would
not test the process it argues for), `cheap-then-revise` (bakeoff).

Every paid arm sends **production's own prompt** through `structureRequest` (src/hierarchy.ts) — the one
assembly point, called by `generateHierarchy` itself, pinned byte-for-byte (and seen red under
perturbation) by [`tests/hierarchy-structure-request-parity.test.ts`](../tests/hierarchy-structure-request-parity.test.ts)
— and its transports are declared bypasses (`hierarchy-structure-messages` / `hierarchy-structure-chat` in
src/spend-declarations.ts) that refuse to run without an open ledger.

**Cost accounting is loud by construction, twice.** In-process, every paid call must return token
usage AND an in-band cost figure — the Messages wire streams so the raw events' `cost` is read
exactly as `meterStream` reads it (the fact tests/messages-stream.test.ts pins), the chat wire
asks with `usage: {include: true}` — and a call that cannot account for itself **fails the run**
rather than printing a zero (`assertCallAccounted`, model-arms.ts). Then, after the run,
`verify-costs.ts` asks OpenRouter's generation endpoint about every stored generation id — the
provider's own number, not our arithmetic — writes the answers into `run.json`, and exits non-zero
on any disagreement over 10% or any call the provider has no record of. **A run is not quotable
until it passes.** (The 10% band is a judgement call, not a discovered constant: the failures it
exists for — a zero, a dropped field, a different call's figure — miss by orders of magnitude,
while legitimate drift (rounding on sub-cent calls, billing lag) stays in single digits; 1% would
false-alarm on rounding, and a band wide enough to pass a halved cost would defeat the point. If
the verifier cannot find a record, fix the id, never the threshold.) Both once-flagged wire facts
were **verified on live calls, 2026-08-30**, not assumed: the in-band cost arrived on every
calibration call, and the raw-event ids are real `gen-…` OpenRouter generation ids.

**A thrown arm is an outcome; a harness fault is a fault.** Roughly one structure call in five
returns a tree whose children do not tile (measured on HEAD, 2026-08-30 — and reproduced by this
eval's own fourth calibration call).

> **Read the throw rate together with `repaired`, from 2026-08-30 on — and since 2026-08-31 the
> throw rate says almost nothing about tiling at all.** `buildTree` drops an unbacked
> `sourceHeading`, and it no longer *checks* whether an answer's children tile their parent: it
> derives a tiling from them ([hierarchy.md](../docs/project/hierarchy.md#derived-partition)).
> Those were the two families that produced every throw measured above, so an arm that makes either
> mistake now scores `outcome: "ok"` with a perfectly valid tree, and the throw rate understates how
> often an answer was wrong as written. Each result carries a `repaired` block saying what was
> mended — `ranges`, `blocks`, `largest`, `droppedChildren` — and the runner prints it.
>
> Two measures are casualties, for the same reason and in the same way. `sourceHeadingValid` is
> necessarily 1 for any tree built by today's code. `validity.otherProblems` can no longer report a
> tiling fault at all. **A repair inside the code under measurement redefines the measurement, and
> nothing fails when it does** — so neither number says on its own what it used to, and `repaired`
> is where the signal went. The runner records that as `outcome: "threw"` with the error
and the bill, and continues — never a retry, because a floor computed over the surviving runs
alone is the variance of the survivors, a selection effect that understates the floor; and the
wasted call stays on the arm's cost and latency. A harness fault (a config error, a dead network)
still crashes the run: those are different kinds of fact, and recording a bench fault as an arm
outcome would blame the recipe for our own bench. `floor.ts` reports attempts-and-throws first,
per document.

**Fragments do not contaminate arm zero's headline — checked, not assumed** (2026-08-30): with
every fragment block's words zeroed, `buildHeadingTree` produces an identical carving on all seven
affected documents, greatwork's 89 fragments included. The pollution inflates leaf counts and
advice, not structure. The reconciliation is its own GET-only file because the spend scan rightly
forbids a raw fetch inside a declared-bypass file. All of this exists because the observer seam
maps Messages-shaped usage into OpenRouter-shaped rows, and the failure mode of that mapping is a
cost landing as zero, silently — a free-looking arm someone quotes in three months.

(A possible future tidy, declined for now: typed issue codes on `checkTree`. The scorer's
gist/other split is made by construction instead — placeholder gists injected, then `checkTree`
re-asked — and src/tree-invariants.ts is load-bearing enough that it does not get opened for an
eval's convenience.)

Two facts recorded so nobody rediscovers them mid-run: Greg wants deeper-than-three trees
supported **eventually, not measured for yet** — and the reading view is not ready for them anyway
(`columnLabel`, src/web/tree.ts, falls through to depth-number naming past depth 3), which is a
known product gap, not this eval's to fix. And the heading rule's thresholds were **fitted to the
dev corpus** — `--sensitivity` prints the carving at 0/10/20/40 stub words, and held-out documents
judge the rule as it stands, never re-tuned.

**`elapsedMs` on each result is the wall clock; summed `calls[].ms` is not.** Since 2026-09-04,
`run.ts` times each cell end to end — every call plus parsing, `buildTree` and assembly — with
`performance.now()`. Summing the per-call `ms` figures instead misses that time entirely and, for
a `waves` arm's parallel calls, double-counts concurrent seconds on top of it; a results file
written before that date has no `elapsedMs` and should not have one reconstructed for it.

## `cost/` — what does one article actually cost us?

```
npm run eval:cost -- --preflight                          # free: every gate, no money
npm run eval:cost -- --fixture short-html --all-modes      # ingest, then one job per mode
npm run eval:cost:interactions -- --slug <slug> --list     # the twelve per-interaction tasks
```

**The answer, 2026-09-03: an ingest costs $0.03 on a 561-word essay and $0.33 on a 16,855-word one;
pressing every mode button takes those to $0.35 and $1.55.** The write-up is
[results/cost-per-article-2026-09-03.md](results/cost-per-article-2026-09-03.md) — per-article ×
per-step, the range, cost per 1,000 words, the per-interaction table, the observed variation in
long-article hierarchy, what is ranked most expensive and why, and the reproduction command for
every figure. The plan is
[260902g](../docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md).

It drives the **production** queue rather than a copy of it — `run.ts` replaces stage 1 with a
fixture read and overlays `withSpendAttribution({ scopeKind: "eval" })` on every step, so what is
priced is what ships. `interactions.ts` calls the request-path functions directly for the things
that are not pipeline steps. `report.ts` is the arithmetic and has no IO; `fixtures.ts` is the
committed three-article corpus, with its two gaps written down rather than left to be assumed.

Four things in it are worth copying into the next eval that measures money:

- **A cold assertion that can be falsified, not argued.** On a per-mode draw *any* cache read is
  fatal. The reason the modes can be priced cheaply — one ingest, then eight single-mode jobs
  against the adopted article — is that a single-mode job marks no breakpoint and Anthropic's cache
  is explicit-only. That is a claim about the provider, so it is checked on every draw rather than
  asserted in a comment. Null cache telemetry is fatal too: unknown is not evidence of coldness.
- **Calls made reconciled against rows kept.** Sink write failures are swallowed and a Postgres
  read cannot report a row that was never inserted, so `AdvanceParts.onStepSpend` hands the runner
  each step collector's count. The first paid run spent $0.0333 and the ledger kept neither row,
  with every gate green.
- **A paid failure is not a price.** A generation billed in full that wrote nothing is recorded,
  excluded from every per-article figure and listed separately. Two of them turned up.
- **A round labelled cold is checked against its calls.** One `chat` cold round read a cache an
  earlier run had written; the runner noticed and withheld the ratio rather than printing a 1.2×
  that would have read as a fact about caching.

Two earlier pieces are kept because they are worth reading before anybody re-derives them:

- **`baseline/`** — what the ledgers we already had could be made to say, with the scripts that
  say it. Every figure reproduces (`final-numbers.py`); the reproduction command is at the top of
  `stage1-baseline.md`. Headline: an ingest plus first open is **$0.099** on a 2,500-word article
  and **$0.61** on a 21,000-word one, and **a third of all the AI spend in our history was
  duplicate execution** from a bug since fixed.
- **`feasibility.md`** — how an eval drives the *production* queue and still keeps its spend out
  of the Product bucket, without changing the cost machinery. It also records the trap that
  `enqueue`'s `pump()` will run the job with the production registry and silently ignore your
  overlay.

The rule the rest of this file already follows applies double here: **eval rows are excluded from
`npm run cost` by design**, so a cost eval has to report its own spend rather than read it out of
the product report.

It has already paid for itself once. Pricing what a reader who presses two mode buttons pays found
that the article cache has **never** worked for a pair of stages — the writer pays the premium and
the reader sends no breakpoint, so it reads nothing —
[260903c](../docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md).
Nothing was red, every artefact was correct and the whole suite passed. It was found by measuring
money and by nothing else.

## `embedding-retrieval.ts` — which embedding model finds the right passage in *our* articles?

```
npm run eval:embeddings
SPIDERYARN_JUDGE_MODEL=claude-opus-5 npm run eval:embeddings   # a real second opinion
```

It reads the **committed fixture corpus** (`tests/fixtures/data-root/data/`, plus `example/`), not
the gitignored `data/` at the repository root — since 2026-09-01, so that two runs a week apart are
about the same passages. That also means the counts below, and the numbers in
[results/embedding-retrieval-2026-08-26.md](results/embedding-retrieval-2026-08-26.md), were taken
over a **larger** corpus than the one it reads now: arm-to-arm gaps within a run still compare, the
absolute precision does not.

**This one spends money twice**: it embeds the whole corpus with each candidate model (a twentieth of
a penny) and it calls a judge model once per query (a few cents). Both are the point. Everything
cheaper — MTEB tables, vendor benchmark pages — answers a question about somebody else's corpus, and
the research that recommended `openai/text-embedding-3-small` said as much out loud: it could not
find an apples-to-apples English-retrieval comparison and argued from overall MTEB means, which mix
multilingual scores into a number we would only ever use on English essays. A recommendation with a
citation attached is still a guess. This file is the measurement.

It embeds all 495 gistable blocks with each *arm*, runs 18 hand-written reader-style questions —
committed in the file, and phrased in the reader's words rather than the author's, so word matching
cannot answer them — takes each arm's top 5, and judges the **union** of every list once per query,
blind: 221 (query, passage) pairs. Every arm is then scored against identical judgements; judging
each list separately would let the same passage score 1 for one arm and 2 for another, and part of
the gap between arms would be the judge's own noise.

An **arm is a model plus how that model is asked**, not just a model id. Voyage takes an `input_type`
(`"query"` / `"document"`) and OpenRouter passes it through — the vectors differ from the untyped
ones at cosine 0.93 — so withholding it would be running Voyage wrong and calling the result a fact
about Voyage. Each contender is run the way its own vendor says to; `voyage-4-lite` is *also* run
untyped, as its own arm, so the size of that choice is in the output rather than asserted in a
comment.

Five things in it are worth copying into the next eval that compares options:

- **A verdict with an interval, and the ability to return "too close to call".** A paired bootstrap
  over the 18 queries against the leading arm, printed beside the point estimates, with each row
  labelled *behind* or *tied*. It matters: the top two arms here differ by 0.033 on mean score and
  **are** tied, while the bottom arm differs by 0.333 and is genuinely behind. Point estimates alone
  would have made those look like the same kind of fact — see the seam-test story below for the last
  time this folder got that wrong.
- **A second judge.** Judgements are cached in a file **named after the judge**, so re-running under
  a different one is a genuine re-derivation rather than a re-read of the first judge's cache. The
  two judges agreed on 84.6% of pairs and changed nothing directional.
- **A cache keyed by the text, not the id.** `judgementKey` hashes the passage and query text into
  the key, because a block id is stable across re-extraction *by design* — so keying a cached opinion
  on it would silently serve a verdict about prose that has since changed. The judge model and rubric
  version are checked at file level, so a mismatch says so instead of looking like a cold cache.
- **A baseline that isn't a straw man.** The shipped literal matcher ANDs every term, so it returns
  nothing at all for all eighteen sentence-shaped queries — true, and useless as a comparison. So a
  deliberately generous word matcher (OR over content words, ranked) is measured too. Semantic
  search beating the first proves little; beating the second is the number that matters.
- **An error message that names the cause.** OpenRouter answers "No endpoints available matching your
  guardrail restrictions and data policy" with a **404**, which reads like a bad model id and is
  actually the account's privacy settings. Since two different `OPENROUTER_API_KEY`s are in play here
  and `src/env.ts` lets the exported one beat the file, the eval now prints which key it used and how
  to switch, rather than the raw 404.

Result, 2026-08-26: **`voyageai/voyage-4`** — tied with `openai/text-embedding-3-small` on every
measure under both judges, and winning the tie-break on dimensions (1024 vs 1536) and billing
(OpenRouter credits vs BYOK). `baai/bge-m3`, the cheapest and originally preferred option, is the one
arm that is clearly behind. Numbers, the tie-break stated in full, and the OpenRouter account
prerequisite are in
[results/embedding-retrieval-2026-08-26.md](results/embedding-retrieval-2026-08-26.md);
the decision is recorded in [search.md](../docs/project/search.md).

## Results

`results/` holds one JSON per run, named by slug and timestamp to the minute, committed. The minute
matters: the point of writing these out is to compare a run against the one before it, and a name
that collided on the same day would overwrite the "before" you re-ran in order to have.

They are the record, not a formality — the numbers quoted in
[260826h-toc-scaling.md](../docs/plans/260826h-toc-scaling.md) come from these files, and a later change should be
argued against them rather than against a paragraph of prose.
[`results/README.md`](results/README.md) says which is which, and which one is no longer obtainable.

## `reorder-quality.ts` — did a prompt change make the writing worse?

Calls no model. It reads the arc, thread and glossary already on disk and measures three things:
mean sentence length, how often entries open the same way (`template`), and **`vocab`** — how much
of the wording is the author's rather than the model's, which is the one that matters.

It exists because two prompt changes in a row moved the article to the front of the prompt and
changed how hard the model thinks about it, and neither is a free edit: models weight recency, and
effort buys reasoning that may or may not reach the page.

```
npm run eval:reorder -- data/<slug>              # print the current numbers
npm run eval:reorder -- data/<slug> --against <copy>   # compare against a kept copy
```

Committed results: [reorder-quality-before.md](results/reorder-quality-before.md) (the incumbent, to
compare against) and [effort-vs-quality.md](results/effort-vs-quality.md) (`high` against `medium`
on two articles, which is what decided that the three stages do **not** align their effort).

Note the shape of a bug it had: it read glossary entries from a field called `gloss` that had been
renamed, mapped every entry to `""`, filtered them all out and printed *"no artefact on disk —
skipped"* about a glossary that was sitting right there. An eval that quietly measures nothing reads
exactly like an eval with nothing to measure. See
[silent-success.md](../docs/reusable/silent-success.md).
