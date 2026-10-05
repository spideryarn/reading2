# Long-document structure arrives top level first, then sections, then summaries

Up: [plans.md](../project/plans.md)

Status as of 2026-10-05, evening: **stage 0 (the line in Structure) is on `dev`; the eval
(stage 2) has run and is written up; nothing else is built.** Evidence: `src/web/StructureNotice.tsx`
exists and `StructureBand` mounts it; `evals/results/long-structure-2026-10-05/matrix/` holds the
cells and judgements. Stages 1a, 1b, 3, 4 and 5 are not started. Not deployed by this work.

Another plan shares this name's prefix,
`261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md`, by the
open-before-structure session. The two are related on purpose: see § What this builds on.

## What this is for

A document too long for one structure answer (past about 2,890 blocks; a 250-page book is about
3,100) has its table of contents asked for in "slices" since 2026-10-05
([261005a](261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md),
[structure-step.md § When one answer will not fit](../project/structure-step.md#when-one-answer-will-not-fit)).
If anything in that goes wrong, the reader gets a table of contents made of the author's own
headings: no summary sentence per section, some sections named by their opening words.

Greg, 2026-10-05, answering [Q-plain-tree-notice] (A was "say nothing", B "one line in Structure
saying so"):

> B yes add an indication. Although I'm not delighted by falling back to the original headings. I
> feel like it should be possible to do this robustly, progressively and fairly low-latency, e.g.
> just the top-level headings first, then the lower-level headings within each of those? then do
> the summaries later in parallel? or something like that. Run evals etc.

So three words to earn: **robust** (the plain tree becomes rare, and when part of it fails only
that part is plain), **progressive** (the reader sees something useful early and it fills in), and
**low-latency**.

## What was measured before designing (2026-10-05)

`evals/long-structure/measure-today.ts`, read-only (one `BEGIN READ ONLY` transaction), against
the local database and production.

| | local | production |
|---|---|---|
| structure calls recorded, last 45 days | 45, all `ok` | 6, all `ok` |
| structure steps that ended "from its headings" | 3 (all before the slices existed) | 0 |
| structure steps that ended "read in N parts" (slices) | 1, succeeded | 0 |
| revisions holding a tree marked `provisional: "headings"` (drafts and superseded ones included) | 7, none of them an article's current revision | 0 |
| one call's wall time, by input size | under 20k tokens: 24 s median, 47 s p90; 20k to 60k: 47 s, 105 s; 60k to 120k: 111 s, 120 s | the same shape on six calls |

A call the ledger records as `ok` came back; whether its answer was accepted is a different fact,
recorded on the step, and the two rows above are kept apart for that reason.

**There is no recorded slices failure to count.** The slices path reached production on
2026-10-05 at 14:04 (`618ab1509` is an ancestor of `origin/main`), a few hours before this
measurement, and no long document has gone through it there yet. Locally it has run on one real
book, once, and worked (4 slices, 5 calls, 131 seconds, $1.00). (This said "not deployed" as
first written, taken from 261005a's status line and not checked; the counts were right and the
reason was wrong.) So "why do
the slices fail today" has no answer in the data, and the fallback rate is unknown. What can be
said is read from the code (`runSlices`, `src/structure-slices.ts`, and its caller in
`src/structure.ts`):

1. **It is all or nothing.** The first failed call sets `stopped`, the calls in flight are waited
   for, and the whole document gets the headings tree. Four good slices and one bad one give the
   reader none of the four. If one call fails with probability *p*, a book of *n* slices plus the
   root call falls back with probability 1 − (1 − *p*)^(n+1): at *p* = 3% that is 14% for the
   250-page book and about 75% at the 45-slice ceiling.
2. **A refused or cut-short answer is never asked again**, on the reasoning that the same request
   would get the same answer. A smaller request would not.
3. **Optional calls can sink the whole tree.** A failed refill (one chapter asked for again to
   divide it), a failed root call (one sentence for the whole book), or one section the labels
   step could not ask about each discard every slice. 261005a named the refill rule as "the first
   thing to revisit if the fallback rate is not near zero".
4. **Nothing tries again.** The step ends `done` with the plain tree. Since stage 0 the owner has
   a Try again; before it there was only a full reset.
5. **Nothing is shown until everything is done.** The book's 131 seconds of structure sit after
   its transcription and before the article opens at all.
6. **Past about 45 slices there is not time in one attempt.** The number is not a hard line (it
   depends on how long the calls take), and it is not a wall either: a good answer is saved even
   when it arrives too late to use, and a saved answer is read before the deadline is consulted,
   so a second attempt starts from where the first stopped. (This paragraph said "a certain
   fallback" until the plan review, F5.)

One more number matters and is not about slices: **one ordinary call on a 142-page paper took 508
seconds** (2026-09-04, `effort: "medium"`; the effort is `low` now, and Moby-Dick at 2,569 blocks
took 94 to 129 seconds). A document well under the slices line can still be the slowest import a
reader has. Whether a staged shape should take those too is a question the eval can answer.

## What exists already, and what does not

From a read-only survey of the code and the earlier plans (file and line in the survey's report,
kept in this session; the load-bearing ones were re-read by me).

**Built, and reusable:**

- `buildBoundedHeadingTree`: free, instant, sound. It is the plain tree, and the slices are cut
  along it.
- The slices machinery: planning on the author's headings, a checkpoint per request (so a second
  run buys only what is missing), a deadline and a time cap per call, eight calls at a time.
- A root call that writes the whole-book sentence from the top-level titles and gists.
- The breadth-first cascade Greg's idea resembles
  ([260904c](260904c-hierarchy-structure-in-waves.md), `src/structure-cascade.ts`,
  `src/structure-expand.ts`, `src/structure-deepen.ts`): a prompt that divides **one section**
  into one level of children with gists, a strict parser, a width gate. **It is switched off for
  every reader** (`SPIDERYARN_DEEPEN_STRUCTURE`). It starts from the ordinary whole-document call,
  runs one wave only, never writes a gist for the node it starts from, and on Moby-Dick cost 2.5
  to 3.5 times as much, ran longer, and divided the same parent differently on 15 of 22 repeats.
  Its quality was never judged. So Greg's idea is **partly built as parts, and not as a path**:
  there is no "top level only" first call and no gists-later pass.
- The labels pattern: a revision is published with labels `pending`, a free successor job is
  queued in the same transaction, the browser drives it.
- A blind-judge harness (`evals/structure-whole-document/blind.ts`) and long local documents.

**Not built:**

- A tree of which **some** nodes are the model's and some are plain. `Tree.provisional` is
  tree-level and `checkTree`'s gist rule is all or nothing. `src/types.ts` says a node-level state
  "only earns its place if partially-streamed nodes ever have to coexist with finished ones".
  That is now.
- A first call that returns only the top level, and any measurement of one.
- A call that returns titles and ranges without gists, a call that writes gists for nodes that
  already exist, and any measurement of what either saves.
- An open reading view picking up a new tree without a reload.

## What this builds on

The open-before-structure session is planning exactly the last item: a first import publishes
with the bounded headings tree, a successor `["structure"]` job builds the real one, and the open
page swaps it in. **That is this plan's delivery mechanism, and this plan does not build a second
one.** It gives "progressive" its first step for free (the author's headings at once), and it
gives "robust" an automatic second attempt (the successor job can be asked again). This plan is
about what the structure step does inside that job. If their work is stopped, stage 4 below is
what has to be re-thought; stages 1 to 3 stand alone.

Three facts constrain how many times a tree can be replaced, whoever does it: node ids are
positional and renumber on a swap; any tree write resets the paragraph labels (the slowest pass,
221 seconds and $1.53 on the book); and the hash other modes are keyed on includes the gists, and
the labels prompt carries each section's gist. **So every extra publish of a fuller tree costs a
labels pass, and gists must land before labels are asked for.** That argues for few swaps, and
against gists as a late, separate publish.

## The plan review, and what changed

GPT Sol, read-only, 2026-10-05:
[the review](261005j-long-document-structure-plan-review-sol.md), verdict **build with changes**.
It confirmed from the code that the slices are all or nothing, that a refused or cut-short answer
is not asked again, and that a failed refill, root call or unaskable section each give the whole
document the headings tree. I checked each finding against the code before taking it.

- **F5 (P2, established): the simpler route was turned down on a false premise. Taken, and it
  reorders the plan.** I had written that a document past the time ceiling "fails identically
  every time". It does not: saved answers are read before the deadline is consulted
  (`src/structure-slices.ts`, the checkpoint read at the top of `ask`), and a late good answer is
  still saved. So trying again makes progress. **Stage 1 is now two stages: 1a, a capped
  automatic second attempt and optional calls that cannot sink the tree, which needs no new kind
  of tree; and 1b, the mixed tree, which does.**
- **F1 (P1, established): a mark on the node does not fix section navigation.** The client takes
  one "section level" for the whole article. A plain stretch puts its paragraphs at depth 3; a
  model part with no sections puts them at depth 2, and its paragraphs would then be listed as
  sections. Taken: 1b does not start until it has a written rule for what a section is in a tree
  of mixed depth (the review's: the deepest internal ancestor of a paragraph), and that rule is a
  client change with its own tests. This is the same fault 261005a reported in today's model
  trees, so the fix is worth having whether or not 1b is built.
- **F2 (P1, established): "whole nodes of the headings tree" was too loose.** A slice can be cut
  inside a part of that tree, and the planner's step back to a heading can move a cut off the
  tree's own boundary. Taken: 1b builds the plain stretch as an exact cover of the failed
  interval, with the ancestors it needs made for it, and checks the real cut points against it.
- **F3 (P1, reasoned): halving can lose a half silently, and buys the refused request again.**
  Taken: each half is accepted only if it tiles its own blocks, the seam check includes the new
  midpoint, and the decision to split is saved so a later run does not ask for the whole slice
  first. With no heading to cut at, the cut is at a window boundary; below a minimum size a slice
  is not halved; one good half is kept and the other is plain (1b) or fails the attempt (1a).
- **F4 (P1, reasoned): keep the admission and settlement rules.** Taken as a constraint on both
  stages: every call (halves, re-asks, refills, the root) goes through the same pool, the same
  "does its cap fit before the deadline" check and the same expired-peer check; usage is read
  before an answer is judged; every started call is waited for; a reader's Stop is a
  cancellation. Tests for a timeout during a halving and for a good answer arriving after a
  peer's failure.
- **F6 (P2, established): carry the mark everywhere a tree is built or crosses.** Taken: the mark
  says why (a plain node, or a root whose sentence could not be written, which does not make its
  children plain); `buildTree` and the public DTO carry it; the publish guard keeps using
  `checkTree` and gets no second exemption; the structure hash includes it without changing the
  hash of a tree that has none.
- **F7 (P1, established): the judge as it stands cannot decide this.** It shows a part's opening
  sentence and three deeper gists. Taken: § Stage 2 below.
- **F8 (P2, reasoned): six documents and two runs are a pilot.** Taken: said so, a second
  document past the line added, the bars restated with a cost ceiling, and the simulation
  described as arithmetic about assumptions.
- **F9 (P2, established): the script counted every revision with a tree, not published ones.**
  Fixed in the script and in the table above (none of the seven local ones is current).

## The design

Four changes, in the order they should be built. Only the first is certain; the eval decides the
last, and 1b is built only if 1a leaves a fallback rate worth the new kind of tree.

### Stage 1a: try again by itself, and optional calls cannot sink the tree (robust, the simple half)

No new prompt and no new kind of tree. Every tree it publishes is one of the two that exist
today: finished, or wholly plain.

- **A failed refill keeps the section it was meant to divide** (reversing review finding F28 of
  261005a, which that plan flagged as the first thing to revisit).
- **A section too long for one labels call is cut into windows on its own**, the way the plain
  tree already cuts one, where today it sinks everything.
- **A refused or cut-short slice is cut in two and each half asked once** (rules in F3 above). In
  1a, a half that fails is a failed attempt.
- **The step tries a second time by itself when the first attempt fell back for a reason a second
  could fix**: a failed call, a failed root call, out of time. Capped at one automatic retry, in
  the same job where the time is there and as a successor job where it is not (on the
  open-before-structure mechanism, when that is on `dev`; until then, in the same job only). It
  buys only what is missing. Not retried: could not plan, and a joined tree that will not build,
  which would fail the same way.
- **`StructureRun.source` says how many attempts it took and why the first fell back**, logged at
  every value ([silent-success.md](../reusable/silent-success.md)).

Tests, red first, with the injected model seam and so free: a failing refill, an unaskable
section and a truncated slice each still give a finished tree; one failing slice gives a finished
tree on the automatic second attempt, with only that slice asked for again; a slice that fails
twice gives the plain tree and says so; the F4 cases. And one piece of arithmetic, written up as
arithmetic: at assumed per-call failure rates of 1%, 3% and 10%, the share of documents left
wholly plain, today against 1a.

### Result: stage 1a (the slices half)

Built 2026-10-05, in `runSlices` only. Not committed or reviewed as this is written.

**What landed.**

- **A failed refill keeps its section.** A refill is now an optional call: a transport failure, a
  refusal, a cut-short answer, an answer that does not pass, or its own time cap leaves the
  original section in place, and the root is still asked. Its spend is counted, and a good
  answer that arrives late is still saved and still not used.
- **A refused or cut-short slice is read in two halves** (`halvingCut`): at the heading nearest
  the middle when one lies within a quarter of the slice of it, else at the middle block, and
  never one block after a heading. Not under `HALVE_MIN_BLOCKS` (120), or when snapping past
  consecutive headings leaves no safe cut within that middle band. The halves are asked one
  after the other inside the slice's own place in the pool, each once, each accepted only if it
  tiles its own blocks, and the cut is added to the outcome's `seams`. The first half is started
  only if the second and the root would still fit after it. The decision is saved as a marker
  under the refused request's own key, in the existing namespace (no migration), and is read
  before asking.
- **One second pass.** A slice that fails in the first pass no longer stops the others. What is
  missing after it is asked for once more, one call each, and a failure there ends the run.
  `secondPass` counts slices whose second-pass call actually started, excluding retries denied
  admission; it is on the outcome, on `StructureSource`, in the step's log line and in its
  `detail` ("read in 3 parts (1 asked for twice)").
- **The one `stopped` flag is now two.** Out of time (a needed call passed its cap, or would not
  fit) stops everything in both passes, as before. A final failure stops everything too. A
  first-pass failure that another ask might mend stops nothing.

**What did not, and why.** Cutting an unaskable section into windows is in `src/structure.ts`,
and the retry as a successor job is in the job queue. Both are held until the
open-before-structure work has landed in those files. A failed root call is still a required
call asked in one pass (with its one re-ask): `source` does not yet say why a first attempt fell
back, because inside one run there is no first attempt to report, only `secondPass`.

**Decisions made while building, each a judgement.**

- The second pass asks **once**, with no re-ask of an answer that does not pass. So a slice gets
  at most three calls, or one whole and its two halves twice.
- A refused or cut-short answer that cannot be halved (too small, or already a half) is **not**
  asked for again in the second pass: the same request would get the same answer. It ends the
  run where it happens, as it did.
- No marker is kept for those, so a later run does ask again. A marker there would make one
  refusal permanent for that document.
- A second pass that cannot start for want of time reports `out-of-time`, not `slice-failed`.

**The arithmetic** (`npx tsx evals/long-structure/fallback-arithmetic.ts`). The share of long
documents left wholly plain, today then after 1a. **It is arithmetic about assumptions, not a
measurement**: every pass is taken to fail independently with the same probability, the second
pass included. Real failures cluster, so these figures are neither estimates nor bounds on the
real rates. Halving, refills and running out of time are not in it.

| assumed per-pass failure | 4 slices | 8 slices | 20 slices | 45 slices |
|---|---|---|---|---|
| 1% | 4.9% → 1.0% | 8.6% → 1.1% | 19.0% → 1.2% | 37.0% → 1.4% |
| 3% | 14.1% → 3.3% | 24.0% → 3.7% | 47.3% → 4.7% | 75.4% → 6.9% |
| 10% | 41.0% → 13.5% | 61.3% → 17.0% | 89.1% → 26.4% | 99.2% → 42.7% |

Within these assumptions the root failure rate is the floor on the second figure, because the
root call is still one required question. That is the next thing this arithmetic points at.

**Tests.** `tests/structure-slices-second-pass.test.ts` started with 27 tests: 23 were red before the change;
the three on `halvingCut` were written after it, and one (a reader's Stop in the first pass) is
a guard that passed before and after. Sixteen existing expectations changed, because they
encoded the behaviour this stage reverses: seven gained `secondPass: 0`, and the rest are named
in the two older test files where they sit.

The code review added two regressions and strengthened the second-pass cap check, each seen red:
the retry count now excludes denied admission and queued peers stopped by a final failure, and
halving cannot snap across consecutive headings beyond the allowed middle band.

**Dry scenario.** `evals/long-structure/dry.ts` now expects the refused slice to succeed by
halving, matching the new behaviour.

### Stage 1b: a failed part is plain, and the rest is kept (robust, the larger half)

Built only if 1a's numbers, and what the eval sees fail, say the plain tree is still common
enough to matter. It needs the contract in F1, F2 and F6 written first.

```
 today                                   stage 1
 ─────                                   ───────
 slice 1 ok ─┐                           slice 1 ok ──► the model's sections
 slice 2 ok ─┤                           slice 2 ok ──► the model's sections
 slice 3 ✗  ─┼─► all thrown away,        slice 3 ✗  ──► the author's headings for that
 slice 4 ok ─┘   whole tree plain                       stretch only, marked as such
                                         slice 4 ok ──► the model's sections
                                         root call  ──► one sentence for the whole
```

- **A slice that still fails after 1a's second attempt gets a plain stretch for exactly its own
  blocks**, built from the author's headings as the plain tree is (F2), and every other slice
  keeps the model's answer.
- **Each plain node says so on itself, and why** (F6), and `checkTree` excuses exactly those
  nodes from the gist rule and no others. A failed root call keeps the tree and leaves the root's
  sentence unwritten, marked as that. A tree with no model node at all is still
  `provisional: "headings"`, as today. The reader's line in Structure (stage 0) gains a second
  wording: some parts are the author's headings only. Try again buys only the failed slices.
- **Out of time keeps what arrived**, under the admission rules of F4.
- **`StructureRun.source` counts the plain slices**, logged at every value.

What it gives up: a tree can be finished in some parts and plain in others. Every consumer of a
gist already reads it conditionally, which the review confirmed for the ones it checked; what
they do not all tolerate is paragraphs at different depths (F1), and that is the real cost.

Tests, red first, free: one failing slice of four gives a sound tree with three slices' gists and
one marked plain stretch that tiles its blocks; a cut inside a part of the headings tree, and
repeated or consecutive headings at a cut; a failing root keeps the rest; a second run asks only
for what was plain; `checkTree`, through publication, still refuses an unmarked node with no
gist; the client's section list over a mixed tree has no paragraph listed as a section and no
empty title.

### Stage 2: the eval that decides the shape (progressive, low-latency)

Greg's shape, and the two decisions inside it that nothing has measured:

```
 A. slices (today, with stage 1)        B. top level first             C. B, with gists later
 ───────────────────────────────        ──────────────────             ─────────────────────
 cut at ~1,000 blocks, blind            one call reads the whole       as B, but the per-part
 to each other; each call               document and returns only      calls return titles and
 returns parts, sections and            the top-level parts (title,    ranges only, and a third
 gists for its stretch; then            start, one sentence);          round of calls writes the
 one root call                          then one call per part, in     gists for nodes that
                                        parallel, for its sections     already exist
                                        and their gists
```

- **B against A** asks whether a first call that sees the whole document makes better top-level
  parts. A's known weakness is that a slice does not know it is a slice: on the book it cut
  stories into scenes at the top level (25 parts for about 13 stories), and a chapter across a
  seam becomes two. B's first call is small to answer (a few dozen parts) however long the
  document, so the "answer will not fit" refusal does not apply to it; its input does have to fit,
  and that bound is checked before the call (review F3 of 261005a, still open). B also has a
  natural early result: the top level, after one call.
- **C against B** asks whether leaving the gists out of the second round makes it enough faster to
  pay for a third round that reads the text again. It is what Greg sketched ("then do the
  summaries later in parallel"). The hypothesis here is that it does **not** pay: output is the
  small part of these calls' time, every block is read twice, and because gists must exist before
  labels and before most modes, the reader could not use the earlier tree for much. That is a
  guess: how much of a call's time is the gists has never been measured, and a tree with titles
  and no gists is already something a reader can use, as the plain tree shows. The eval is there
  to settle it either way.
- **B's second round is the cascade's expansion prompt** (`expand/8`,
  `src/structure-expand.ts`), reused unchanged. As first written this said the opposite: the
  ordinary structure call on one part, to avoid evaluating a prompt as well as a shape. That
  does not work. The ordinary call answers with three levels, and under a part that puts
  paragraphs a level too deep; the expansion prompt was built for exactly "divide this one
  section into one level of children". So the eval does test a prompt along with a shape, and its
  write-up says which failures are the prompt's (it has no strict schema, and asks for a verdict
  per child that nothing here uses).
- **The three new prompts are the eval's own** (`evals/long-structure/prompts.ts`: `long-top/1`,
  `long-sections/1`, `long-section-gists/1`). Their rules for titles, gists, questions and
  boundaries are cut out of the production prompts by section name, not rewritten, so a
  difference between arms is not a difference in what a gist is asked to be.

**Corpus** (seven documents; block counts from the earlier work, to be re-checked by the harness
before any paid call): the 250-page book (3,053 blocks, past the line) and a second document past
the line, to be found or made by joining two of the Gutenberg books; Moby-Dick (2,569) and the
second Gutenberg book (1,326), long but inside the line; the 160-page paper (1,025); the long web
page `gwern-scaling-long`; and the book with its heading blocks turned into paragraphs, the
headingless case. For the ones that fit one call, the ordinary single call is a fourth arm, which
is what says whether a staged shape should also take documents under the line. **This is a
pilot** (review F8): two documents past the line and two runs each can show a large difference in
quality or time and cannot show a failure rate. One giant section, one enormous paragraph and a
deadline that runs out are exercised with made-up documents and the fake model, for nothing.

**Measured, per document and arm, over two runs each, cold (no checkpoint), the arms interleaved
so that a slow hour is not one arm's:**

- wall time to the top level, and to the finished tree, at eight calls at a time;
- calls, failures and re-asks, by reason;
- cost, from the ledger;
- the mechanical checks (`checkTree` clean, every authored heading starts a node, parts per
  document, sections with no children over 60 blocks; seams on headings, reported as not
  applicable for the headingless document and not as a pass);
- a blind judge, each arm against today's output for the same document and C directly against B,
  two judges from different families;
- repeat stability: the top-level starts of run 1 against run 2.

**The judge is extended first, and shown to be able to fail** (review F7). `blind.ts` today shows
a part's opening sentence and three deeper gists against 400 characters each, which cannot say
where a part ends or whether two sets of gists are as good. It gains: the document's authored
headings; the same sampled passages for every arm (chosen from the document, not from a tree);
the text either side of each top-level boundary; and section gists compared on the same passages.
Before any arm is judged, three spoiled trees are: one with two parts welded together, one with
invented gists, one with gists removed. A judge that does not mark those down is not used.

**Budget.** About 24 document-arm pairs, two runs, at roughly $0.7 a run on average, is about
$34, plus about $5 of judging: **cap $40**, reported to the dollar. Unpaid first: the harness, the
planner for B over every document, the judge's materials, and a dry run with the fake model.

**What would decide it**, reported as paired results per document and not as an average. B is
taken over A if the judges prefer its top level on most documents, it is no slower to the
finished tree by more than a quarter, and it costs no more than half as much again. C is taken
over B only if the finished tree arrives at least a third sooner, the judges do not prefer B's
gists on the aligned passages, and the cost is within the same ceiling. If neither clears its
bar, stages 1a and 1b are the fix and stage 3 is not built.

Written up under `docs/investigations/` before anything is built from it.

### Result: stage 2, run 2026-10-05

[The investigation](../investigations/261005c-long-document-structure-top-level-first-against-slices-and-one-call.md).
$32.31 in the ledgers, about $32.4 in all, of the $40 cap. One run per cell on six documents (the
joined seventh was cut off by the cap partway through its first cell, and there was no room for
a second run), so a pilot. GPT Sol checked the write-up against the raw files:
[stands with corrections](261005j-long-structure-eval-check-sol.md), all made, and they narrowed
three of the conclusions below from my first draft.

- **B against A, past the line: B, on the one book tried.** Both judges, on both variants of one
  story collection, top level and summaries. Same time to finish, top level in half the time,
  about half as much again in cost.
- **B against one call, under the line: mixed.** Better and nearly twice as fast on the 160-page
  paper at nearly twice the price; the judges split on Moby-Dick; worse on a short page.
- **C against B: not shown to pay, and not cleanly tested.** No faster to the finished tree and
  dearer; it lost two of three direct comparisons, one of them on its outline and not on its
  summaries. It goes to the back of the queue, not in the bin.
- **Neither bar in § What would decide it was met cleanly, because of two things the plan did
  not expect.** The staged arms lost 4 of 14 runs outright to one call's answer failing
  validation twice. And the first call is not steady: the same request on the same book gave 15
  parts in one arm and 8 welded ones in the other.

So stage 3 is **not** "build B". It is, in order: stage 1a; B's per-part round without its
`verdict` and with a strict schema (which addresses seven of sixteen refused answers, not most);
then a measurement of the first call alone (three draws on four documents, the present prompt
against one revision: 24 calls, about $17 before re-asks); and only then B, for documents past
the line. Stage 1b is not shown to be needed by this eval. Whether B should also take long
documents under the line is a question for Greg, put with these numbers.

### Stage 3: build the shape the eval picks

Planned in detail after stage 2, and reviewed again. In outline, if B wins: a top-level call with
its own small schema and prompt version; the per-part round reusing the slices machinery with
parts as the units (a part too big for one call is sliced, as now); stage 1's rule for a failed
part; the root sentence from the first call, so the separate root call goes. Prompt changes
follow [prompting-guide.md](../project/prompting-guide.md).

### Stage 4: what the reader sees while it happens

On the open-before-structure mechanism, once it is on `dev`: the author's headings at once, then
the finished tree swapped in. Whether the top level (B's first call) is worth a publish of its
own in between is **a question for Greg, asked with the eval's numbers and not before**: it would
show model-written part titles perhaps a minute earlier, and it costs a third tree swap and the
care that goes with one. If the gap between the first call and the finished tree is short, the
answer is no.

### Stage 5: an enormous document gets labels on a spread of its paragraphs, not on the first stretch

Added 2026-10-05 at the Overseer's request. It is about the labels step, which runs after
structure, and it is here because it is the same reader and the same document. Not reviewed by
GPT Sol yet; it gets its own review before it is built.

The problem is
[261005c § (a)](261005c-long-document-follow-ups-stale-sentence-run-codex-overwrite-guard-breadcrumb-paragraph-source-guess-page-cap.md):
a page of 120,000 short paragraphs plans about 2,000 label calls, the labels job gets three
740-second windows, and so the labels stop partway down and end `failed`. Greg's answer to
[Q-label-ceiling], as the Overseer relayed it to this session (his words, not seen by me at
first hand):

> for very large articles, we tweak/add to the prompt to say to only add labels for some of the
> paragraphs (so that it's not just truncated partway down the articles)

**What it would be.** Above a ceiling on planned label calls, the step labels a spread of
paragraphs across the whole document and leaves the rest alone, so the end is covered as well as
the start and the number of calls is bounded whatever the length.

**Priced for the 120,000-paragraph case**, from the 250-page book's labels run (65 calls, four at
a time, 221 seconds, $1.53: about $0.024 and 14 seconds a call, so about 200 calls fit one
740-second window):

| which paragraphs get a label | labels | calls | time, four at a time | cost |
|---|---|---|---|---|
| all of them (today's plan; does not finish) | 120,000 | about 2,000 | about 1.9 hours, 10 job windows | about $47 |
| every 10th, a call per section as now | 12,000 | about 2,000 if each section is still its own call | no saving | no saving |
| every 10th, ten sections to a call | 12,000 | about 200 | about 12 minutes, one window | about $5 to $10 (each call reads ten times the text) |
| the first paragraph of each lowest section | about 2,000 | about 35 | about 2 minutes | about $1 to $2 |

The second row is why the choice of which paragraphs matters less than **how many sections one
call covers**: a call per section is 2,000 calls however few labels each writes. So the ceiling is
on calls, and the spread is whatever fits under it. Proposed: a ceiling of 200 calls (one job
window, about 12,000 paragraphs at full labelling, four times the 250-page book); below it,
nothing changes; above it, the step labels one paragraph in *k*, the first of each lowest section
always among them, with *k* chosen so the calls fit, and each call covers several neighbouring
sections. The prompt gains what Greg describes: these marked paragraphs get a label, the others
are context. That is a prompt change, measured before it is kept
([prompting-guide.md](../project/prompting-guide.md)).

**What changes in the rule.** [granularity-zoom.md](../project/granularity-zoom.md) says an
absent `navLabel` on a paragraph means deliberately unlabelled and only that, and a revision has
its paragraph labels everywhere or the whole layer is withheld (`Article.navLabelStatus`,
`src/web/nav-labels.ts`). A spread breaks both, so:

- `navLabelStatus` gains a value for "labelled in part, on purpose" (say `sampled`), stored on
  the revision, so that state is never read off which labels happen to be there.
- Under it the paragraph layer is drawn, not withheld. A paragraph with a label shows it; one
  without shows **its own opening words, in the author's face**, as a headings-only section title
  already does (`titleFrom: "opening-words"`, [fonts.md](../project/fonts.md)). That keeps the
  rule that generated text never stands in for prose: the stand-in is the prose.
- An absent label keeps its one meaning under every other status.
- The reader is told once, where they ask for the paragraph layer: this document is long, so
  only some paragraphs have a label.

What it gives up: most paragraphs of such a document are never labelled, and the labels that
exist were written with less of their neighbours in view. The alternative passed over is the
progress rule in 261005c (keep going as long as a window made progress): it finishes the job
honestly and costs about $47 and two hours of an open tab for one article, with a migration.

## Stages

- [x] **0.** The line in Structure when the tree is the author's headings, with Try again for the
  owner. On `dev` as `8000e95dd`; [structure.md § When it is only the headings](../project/structure.md).
  Browser-checked at 1440, 820 and 390 (`261005j-shot-*.png`) with the page's article response
  patched to a headings tree; the light theme and a signed-out visitor were not looked at. The
  full suite was not run (the box was overloaded and the Overseer asked sessions not to).
- [x] Plan review by GPT Sol (read-only).
- [ ] **1a.** A second attempt by itself, and optional calls that cannot sink the tree. Unpaid.
  Tests red first, gates, Sol code review, the arithmetic.
  - [x] The slices half, in `src/structure-slices.ts`: a failed refill keeps its section, a
    refused or cut-short slice is read in halves, one second pass over what failed, the
    arithmetic. § Result: stage 1a (the slices half). Not yet through the Sol code review.
  - [ ] A section too long for one labels call cut into windows on its own.
  - [ ] The retry as a successor job, and a second attempt after a failed root call.
- [ ] **1b.** The mixed tree, if 1a leaves a need. Its contract (F1, F2, F6) first.
- [x] **2.** The eval. About $32.4. § Result: stage 2.
- [ ] **3.** A strict schema for the per-part round, the first call measured alone, then B past
  the line, with its own plan section and review.
- [ ] **4.** Delivery, on the open-before-structure work.
- [ ] **5.** Labels on a spread of paragraphs past a ceiling of calls. Its own review first.

## The simpler options passed over

- **Stop at the line and Try again (stage 0).** It makes the plain tree visible and recoverable;
  it does not make it rarer, and Greg asked for that.
- **Just retry the whole step automatically.** I passed this over at first, on a premise the
  review showed was false (F5). It is now stage 1a, ahead of the mixed tree.
- **Turn the cascade on.** It is the nearest existing thing to Greg's sketch. It cannot write a
  gist for the node it starts from, only divides downwards, and its one measurement ended
  undecided at several times the cost.
- **Build B without the eval.** It is the more appealing shape, and its first call reads the
  whole document, which is new: no call here has been measured on reading 250 pages to write
  thirty lines. A shape chosen for looking right is how the cascade got built and left off.

## The questions put to the review

All five are answered in § The plan review: a per-node mark, yes, with a reason on it (F6);
mixing does break the section level, and needs a rule first (F1); halving is sound only with the
rules in F3; the bars were biased and two runs say nothing about failure rates (F7, F8); and the
simple half of stage 1 need not wait for the eval (F5).
