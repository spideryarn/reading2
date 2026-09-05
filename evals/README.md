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

## `summaries/` — is a Socratic summary line better than the gist we ship?

```
npm run db:export -- --out output/summaries-corpus     # the corpus, once — read the Target: line
npx tsx evals/summaries/run.ts plan                    # free: what a run would buy, and from where
npx tsx evals/summaries/run.ts generate --stub         # free: no model, no network, every seam
npx tsx evals/summaries/run.ts generate                # 7 arms x 7 documents = 49 calls
npx tsx evals/summaries/run.ts judge --run <dir> --repeats 3
npx tsx evals/summaries/run.ts report --run <dir>
```

**A run lands under `output/summaries-runs/`, which is gitignored**, because a judging prompt carries
thousands of words of a reader's article. What gets copied into `evals/results/summaries/` by hand is
`results.md`, which has arm names, counts and ranks in it and no article prose.

Stage C of
[260905f](../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md), and
the one thing to carry away before anything else: **it is a screen that rejects bad variants, not a
verdict that ships one.** Both advisers reached that from opposite directions — Fable from what the
reader is doing in the Summary panel, GPT Sol from what a model judge cannot settle — and the final
instrument is Greg reading three or four variants *rendered*. This exists so what he reads is the
best of seven rather than the first of one.

The seven arms are the incumbent, the incumbent again (the generation noise floor), a
GISTS-block-only arm, and Fable's four question variants
([`summaries/variants.md`](summaries/variants.md), which is the **source** of the prompt text rather
than a description of it — `variants-file.ts` parses the fenced blocks and the arms send them
verbatim). Adding a fifth variant is a `## V5` section in that file plus one entry in `ARMS`.

### Every arm is a `bakeoff`, the control included

Production asks for structure, titles, gists and questions in **one** long-context response. This
runs the variants over a **fixed existing tree** and asks only for wording, which is why it costs a
few dollars instead of $8–20 and two hours. By `hierarchy-structure/arms.ts`'s own discipline that
makes every arm here a `bakeoff` and none of them `isolated` — the control arm is production's
*rules* under a different request, not production's call — and what it cannot catch is an
interaction between the new wording and the structure the model proposes in the same breath. It also
touches nothing in `EXPAND_SYSTEM`, which has no question field at all, so no result from it covers
the deepening cascade. Every results file repeats all of that.

`isolatedAgainst` is the one thing the template did not have: an arm names the *other arm* it
differs from in a single block, so `v1` is one block away from `gists-only` and `v2`–`v4` are one
block away from `v1`, even though all five are two blocks away from production.

### The calibration gate, which is the reason it is worth building

Three things have to hold before a ranking is read at all, and the first was missing until GPT Sol
found it: **the ranking must be a permutation of the lineup**. Without that check, a judgement naming
the five anchors and none of the seven real lines passed — no inversions to find, no anchors
unranked, a green gate over an ordering of nothing. The judge is also shown **windows sampled across
each section** rather than its first 1,800 characters: the calibration node is 30,187 characters
long, and the material anchors 3 and 5 quote is nowhere in its opening, so head-only truncation let
the judge reject the two anchors that matter for being unsupported by the *excerpt*.

Blinding cannot blind this intervention — **a question visibly identifies itself**, so a judge primed
to value "a door" prefers the arms that look like doors however the labels are shuffled (GPT Sol's
P1-3 on the plan). So five known-bad lines go into one lineup: a fabricated count, a neutral lookup
question, an answer-leaking question, a title-only line, and the gist with a question mark on it.
**All five must rank below every real line, or the run reports no ranking at all** — not a ranking
with a warning on it. `MAX_ANCHOR_INVERSIONS` is 0, declared before the run rather than argued after
one, and the gate has been watched doing both things (`--stub-judge good` / `--stub-judge bad`).

Anchors 3 and 5 are the two that matter, because they are the most *informative* lines on the page.
A judge measuring information rather than the door-or-wall criterion rates them highly, which is
exactly the failure being detected. Anchor 1's fabricated count is a real trap, not a synthetic one:
its node has six children while its gist and its prose both say four.

`anchors.ts` asserts all four facts about that node — id, title, depth, child count, and that anchor
5 really is its gist — and refuses to run if the tree has been re-carved. Without that, a re-ingest
would leave the gate passing over nothing.

### Two resolutions, and three things a leader has to survive

The **incumbent run twice** measures how much the model wobbles; **the same frozen output judged
again under a fresh seeded shuffle** (`--repeats`) measures how much the judge does. The shuffle is
seeded (mulberry32 over an FNV-1a of the run id, slug and repeat) precisely so a repeat differs in
labels alone.

**The threshold is judge instability alone, in mean-rank units**, and taking the larger of the two
was wrong twice over — GPT Sol's P0-4 on the code. The generation floor was
`|mean(incumbent) − mean(incumbent-repeat)|`, and those two recipes are *exchangeable*, so opposite
movements cancel and that number trends to **zero as the corpus grows** however far apart the runs
landed on any row; it is a **paired** per-lineup figure now. And the two quantities were on different
sampling scales, so `max()` of them was arithmetic between statistics that share the word "ranks"
and nothing else. The paired generation floor is printed beside the judge's *per-lineup churn*,
which is the only thing on its scale.

A leader is named only when **all three** hold: it beats the threshold, it led in **every repeat's
own table** (an ordering that does not reproduce under a fresh shuffle is not an ordering), and the
run was a clean bill — otherwise an arm that answered only its easy sections leads by having
answered less. When any fails, the report prints the table and says which, rather than reaching for
a winner.

### The arm sees the whole tree and writes for part of it

The outline in the prompt goes down to depth 2 even when only the root and depth-1 rows are asked
for, with the rest marked *"context only"*. Both GISTS blocks say *"write a parent's gist from its
children"*, and a depth-1 node's children are at depth 2 — showing only the requested rows told the
model to do something the prompt had made impossible, and it would have worked from the raw prose
instead, quietly and differently from production, which has the whole tree in front of it because it
just wrote it.

### The axes are reported, and the ordering is a request

Seven axes per candidate — fidelity, distinctiveness, triage, orientation, simplicity, leakage,
factuality of the shape hint — asked before any preference, and **aggregated into the report**.
Collecting them and printing only the ranking, which is what the first version did, meant the
harness could not support one of the independent claims it exists to make.

"Before" is an instruction in the prompt and in the schema, **not something a text model can be
forced into**: one response carries both, so preference can still colour the earlier fields. Two
calls would fix it and are not built. Until then, an axis that agrees with the ranking is weak
evidence and one that *disagrees* is the interesting one. The anchors appear in the axes table
(where their scores are the diagnostic — anchor 1 should score 1 on fidelity) and not in the ranking
table (where they are a gate, not a competitor).

### What is deliberately not scored

`shapeFacts` counts yes/no openers, bracketed hints, counted hints and meta-narration phrases, and
**none of them is a defect**. V3 relaxes production's "not yes/no" rule on purpose — that relaxation
*is* its axis, and it is the arm that can falsify the plan's central bet — so a scorer docking a
point for yes/no would decide against it before the judge read a word. `tests/summaries-eval.test.ts`
pins that.

`v4` is the only arm that would need a change to `src/hierarchy.ts` if it won: Greg's literal reading
order puts the hint after the question mark, and `questionFor` appends a second one, so the stored
value becomes *"…consciousness? (4 arguments)?"*. The harness applies V4's rule to V4's lines only,
the report names the arm, and the test asserts **production's own `questionFor` doing the mangling**
— so the cost of that variant is a red test rather than a sentence.

### The corpus is real articles, pinned by two hashes

`summaries/corpus.ts` is a committed manifest of ten documents out of local Postgres — 19 to 2,046
blocks (72 to 357 among the seven a default run scores), one to 252 headings, two of them carrying
the current generic questions. `npm run db:export`
is byte-deterministic (checked by exporting twice and comparing twelve hashes), so **both**
`blocks.json` and `tree.json` are pinned: the tree is an *input* to this eval, not an output, so a
re-carve is a different measurement wearing the same slug. Drift is reported in the run file and in
every results file, never thrown and never swallowed.

The plan measured the root-gist inversion on the fixture cut and flagged the caveat. It holds on real
articles: the root gist is the longest median row in nine of the ten, the exception being
`openai-huggingface` where root and depth-1 tie at 27 words.

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

## `deepen/` — is the deepening verdict worth obeying, and what does it cost?

```
npm run eval:deepen -- --book output/2701-h.html --article output/noema-mythology-of-conscious-ai.html
npm run eval:deepen -- --book … --article … --dry-run           # the same shape, no model call
npm run eval:deepen -- --book … --article … --repeats 3 --spend # the paid draw, ~$41
```

**No numbers yet — the harness is built and the paid draw is Greg's to run.** It exists to answer
the five questions
[260904d § What the live run must answer](../docs/plans/260904d-deepen-fat-sections.md#stage-5-questions)
wrote down *before* the money moved, so that a paid run cannot quietly succeed at nothing: is the
verdict stable across repeats, does the model always say yes, how often does a mechanical bound
overrule it, what does it cost against the incumbent's $1.00 a book, and does the hierarchy step
still fit its budget under load.

**Preflight is the default posture**: with no flag it runs every gate, proves the seam for free and
prints the bill, and buys nothing. `--spend` is the only way to spend.

Four phases: the book ingested with deepening on (repeat 1); the repeats, **serial**, as
`{steps: ["hierarchy"], force: ["hierarchy"]}` against the same slug; an ordinary article run with
the flag off and then on, which must come out byte-identical; and three jobs at once at
`DEFAULT_JOB_CONCURRENCY` for the wall clocks, with a start rendezvous so that "at once" is true of
the measured *step* and not merely of the three promises.

**A pre-spend review refused the first version of it**, and the thirteen findings are worth
reading before touching any of this — GPT Sol, 2026-09-05. Two of them decide whether the run is
worth making at all:

- **The structure-rebought guard was applied to phase A, where buying the structure call is the
  whole point.** Moby-Dick's measured structure call is 453,832 input tokens
  ([the artefact](results/hierarchy-waves-2026-09-04/2701-h.tree.json) § `usage`) against a computed
  floor of 256,900, so a **successful** $40.90 run would have spent the money and then reported
  `structure-rebought` fatally. `checkRepeatBoughtItsWave` now takes `structure: "bought" |
  "resumed"`, and a test pins the real token count so the guard can never again fire on the phase
  that is supposed to buy.
- **$40.90 was never a bound, and it still is not one.** A re-asking pass that hands its claim back
  at its own 740 s deadline is requeued, and the driver re-claimed it immediately — with the slug
  still named in the re-ask lever, so the next claim ignored the checkpoint rows just written and
  bought the wave again; `REQUEUE_BUDGET = 2` permits three windows. The run **stops** a re-asking
  pass on its first requeue, reports it fatally (`requeueVerdict`), goes no further, and **retains**
  that article and job rather than cleaning them up — deleting the article cascades to the
  checkpoint rows, which is the paid work the refusal exists to keep. The estimate prints $40.90 as
  the **nominal estimate** and $85.30 as the **three-window requeue exposure**, and says plainly
  that neither is a bound: nothing here enforces a spend cap, an ordinary pass can re-buy work whose
  best-effort checkpoint write failed, and a redraw buys a second answer.

The rest were the same disease in five more places: **an answer computed over evidence that is
absent, partial or failed, printed as though it were a result.** Every one of Q1–Q5 now has an
explicit answerability gate, and "not measured" is visibly different from "measured zero" —
[silent-success.md](../docs/reusable/silent-success.md).

Four things in it are worth copying:

- **The repeat has to buy something, and this is the one that would look fine.** The scoped calls
  are content-addressed, so a second wave over one article reads its own rows back, makes no call,
  and reports verdicts identical to the first **by construction** — a perfect stability figure worth
  nothing. `SPIDERYARN_DEEPEN_REASK` names the slugs to re-buy, the run refuses to start unless it
  names the book and neither article, and afterwards `checkRepeatBoughtItsWave` asks the ledger
  whether the wave was really bought *and* whether the structure call was wrongly re-bought with it.
- **The load phase is started together before it is measured, and concurrency is measured over the
  STEPS' windows, never the jobs'.** The arithmetic demanding three overlapping `hierarchy` windows
  was right and the phase did not arrange them: the book's job is a forced `hierarchy` and starts its
  measured step at once, while the two load articles start at `fetch` and get there only after
  stages 1-3. The two load jobs are driven first and are **held at the entry** to their measured
  step; a **readiness wait** ends when both are there, with the gate still shut and nothing of the
  book driven or bought; then the book is driven, reaches the same entry through the same hook, and
  **all three are released together** (`startRendezvous`). Two earlier versions of this were wrong in
  instructive ways. Merely *announcing* an arrival held nobody, so load1 could announce, run its
  whole step and finish before load2 announced. Holding only the loads and releasing them before
  driving the book moved the same hole one party over: with the third queue slot taken, both released
  loads could finish before the book reached `hierarchy` — and the outcome still said "all". The book
  therefore *does* wait inside its own claim, and it costs nothing, because by then everybody else is
  waiting for it; the two load steps are the ones that really hold, bounded, and what it cost them is
  reported. **A phase that cannot line up buys nothing trying to.** A readiness wait that does not end
  `"all"` stops the run rather than driving the book at all; and if the *gate* gives up with all three
  already driven, every step it releases is released "abandoned" and throws before it runs. Those jobs
  end `error` by this eval's doing and each carries a finding saying so. **And the three share one
  fate**: once any of them has failed its measured step, fallen back to wave 1, or handed its claim
  back, the other two stop before their next claim **and cancel the calls their running step has not
  yet made**. Stopping before the next claim was not enough on its own, because one claim runs the
  whole `hierarchy` step — structure call, expansion wave *and* a whole pass of labels, which
  `generateHierarchy` starts even after the wave failed. So the fate carries an `AbortSignal` that
  `announcing` combines into the measured step's own `ctx.signal`; label batches are queued with that
  signal, and `tests/labels-batching.test.ts` already pins the property that matters — *"the callback
  must never run either, or the 'stop paying' half of fail-fast buys nothing"*. The remaining bound is
  the single request already in flight, which may still be billed. A measured job also stops on its
  first requeue rather than being re-driven, because a re-drive takes the gate's latched verdict, runs
  outside it, and lets the queue overwrite the first attempt's clock. In one line: **it no longer
  starts paid measured work when the rendezvous already knows question 5 is impossible.**
  **What a successful gate guarantees is a shared start, not a shared window.** Another job **cannot**
  serialise the three afterwards — by then all three hold claims, which is all three of the cap's
  slots — so `peakConcurrency` reaching 3 is *arranged* and confirms the wiring rather than measuring
  anything. The load measurement is **`fullConcurrencyMs`**, the longest interval with all three
  genuinely in flight, held to a floor **declared in preflight before anything is bought**. It is
  bounded by the shortest of the three, and the load articles' `hierarchy` is far shorter than a
  book's 658-778 s — so below the floor, question 5 reports latency after a synchronised start rather
  than sustained three-job load, and says so. All three phase-D promises
  stay alive while two of them are being told `busy`, so a whole-job overlap check passes over a
  phase that ran one job at a time — which is exactly what `SPIDERYARN_JOB_CONCURRENCY=1` or another
  agent's dev server holding a claim slot looks like. `peakConcurrency` has to reach three over the
  hierarchy steps' own windows, three of them have to have finished `done` with a wave's stats
  behind them, and the runtime `jobConcurrency()` is asserted before anything is enqueued.
- **Repeats are paired on parent-plus-range, never on `where`.** `where` is an ordinal path derived
  from the answer's own fan-out, so two repeats that split a parent in different places both emit
  `root > child 1` and a boundary that moved reads as a verdict that held — wrong in the direction
  that makes the signal look *better* than it is. A record with no range is refused outright rather
  than paired approximately. Verdict flips, changed fan-out and moved boundaries at equal fan-out
  are three separate rows that must not be added together — and only **one** of the three pairs is
  disjoint. A changed fan-out is counted alone; a moved boundary and a surviving child's verdict flip
  overlap deliberately, because one parent can do both and making them disjoint would discard valid
  same-range verdict evidence. The overlap is counted and printed.
- **The dry run found a real bug on its first pass, and the check written for it was wrong twice
  over.** `enqueue` ends with `pump()`, which drives the job with the *production* registry; the
  silencer of the day was `withoutTheInProcessPump`, one global variable, so two overlapping
  `enqueue`s raced on it and one job went to the real network with no eval overlay. **That silencer
  is gone** — `enqueue` takes `pump: false` on the request now (`src/jobs.ts` § `pump`, 2026-09-05),
  so the hazard is per-request and there is no global left to race on; the queueing here is
  sequential because it reads better, not because anything depends on it. What the episode left
  behind is the check, and it is kept because it outlived its bug: it reads the fixture step's own
  `detail` — `"1382 KB (fixture book)"` — because the first version matched the DNS error text, and
  the queue replaces a failed step's message with a reader-facing sentence, so that version was
  watched printing "none" over a run where **every fetch had gone to the network**.

`report.ts` is the arithmetic and has no IO; `harness.ts` owns the ingress, the levers and the free
seam probe; `run.ts` only drives and prints. Everything the cost eval already proved — the eval
spend overlay, the fixture stage-1 step, the local-database gate — is imported from `cost/harness.ts`
rather than copied. The book and the article are named on the command line
and hashed at run time, because `output/` is gitignored and a checked-in manifest pointing at a file
nobody else has would break the cost eval for everybody.

**What `--dry-run` cannot prove**: that anything published. Publishing needs a tree and a tree needs
a model call, so every dry-run job stops at its last free step and fails — and because a failed job's
draft revision is rolled back, every job *after* the first on the same slug fails at once too. It
proves the driving — the fixture ingress, the force, the serial repeats, the start rendezvous, the
concurrent load phase, the cleanup — and says so rather than printing a table of zeroes.

**Run it before you run anything that spends**, and read the last line as well as the first. On
2026-09-05 it died at its very first `enqueue` — `dev` had merged in a rule refusing `blocks`
without `hierarchy`, which is exactly what the free step list asked for — created nothing, and
printed its entire closing report on the way down: an empty driving table, `Findings: none`, a
written `run.json`. Three things came out of that and are the reason to trust it now: the step lists
are checked against the queue's own rule before anything is enqueued, the summaries can say *there
was nothing here*, and a run that died says so at the top rather than in its last line.
[260905b](../docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md).

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
