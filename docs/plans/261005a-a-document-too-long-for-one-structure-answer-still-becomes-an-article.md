# A document too long for one structure answer still becomes an article

Up: [plans.md](../project/plans.md)

Status as of 2026-10-05: **both stages built and on `dev`** (§ Result: stage D, § Result: stage
E). Evidence: `src/structure-slices.ts` and `buildBoundedHeadingTree` exist and
`generateStructure` calls both; a real 250-page book went through each path on the local stack.
Not deployed by this work. Queue item `qi-kbkbw4rp`.

**Read this first if you read nothing else.** § The design was written before the code and two
of its claims were corrected later: § The plan review (uniform depth) and § The E spike (the
cascade, the note). What was built is § Stage E, as it will be built, with § The review of this
plan; what happened is the two Result sections.

## What this is for

The upload dialog says *"PDFs up to 250 pages"*. Measured on 2026-10-04
([the investigation](../investigations/261004b-big-document-imports-at-the-limits.md)): the
structure step asks a model for the whole table of contents in one answer, and refuses before
asking when that answer would not fit, at about 2,890 blocks. A real 250-page book (3,112 blocks)
was transcribed, paid for, and then refused. The reader got nothing.

Greg, 2026-10-04, answering [Q-long-documents] (options A to E in
[261004f § The decision this will probably end on](261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md#the-decision-this-will-probably-end-on),
where the recommendation was D first, then E):

> go with your recommendation

- **D.** When one answer will not fit, build the tree from the document's own headings with no
  model, and let the reader read.
- **E.** Then fill that tree in, a section at a time, so a long document ends up with the same kind
  of tree a short one has.

## What two surveys found, before any code (2026-10-05)

Two read-only subagents traced the code; one ran the real `buildHeadingTree`, `checkTree`,
`planBatches` and `budgetFor` over made-up 3,100-block documents. What matters:

1. **A flat headings tree does not survive the next step.** `buildHeadingTree`
   (`src/heading-tree.ts`) gives root plus one leaf per block when a document has too few headings.
   With endnotes appended, the labels step throws ("planBatches left 3100 of 3100 gistable
   block(s) out of every batch"). Without them it is one sibling set of 3,100, and the labels call
   refuses it as too long (above about 2,032 in one set). And every reading mode's outline
   (`partsOf`, `src/tree-parts.ts`) would list 3,100 untitled parts. **So D cannot be "call
   `buildHeadingTree`".** The ceiling would only move one step along.
2. **A long run under one heading is the same problem, smaller.** A sibling set is never cut by
   the labels step. Twelve chapters of 258 paragraphs is twelve label calls of 259, about 150
   seconds each, at a batch size four times what the label checks were tuned at (60).
3. **An empty title fails the tree.** `articleTitle ?? firstHeading ?? slug` lets `""` through, and
   a heading block with empty text titles a section `""`. `checkTree` refuses both.
4. **Nothing else breaks on a tree with no gists.** Every server prompt and every client view
   reads `gist` conditionally; the publish guard exempts a tree marked `provisional`; nothing
   polls or waits on that mark. The structure step has no version check that would call a
   `headings/1` tree stale and re-run it.
5. **The switched-off cascade is further from E than 261004f said.** It runs **one wave**, not a
   recursion (stage 6 was never built). It gives new children gists and **never writes one for the
   node it started from**, so the root and every heading section would stay bare and the finished
   tree would fail the gist rule. A target too big for one call is **skipped**, which is exactly a
   long headingless stretch. Its one real measurement (three passes of one book,
   [260904d](260904d-deepen-fat-sections.md)) ended at "turn it on, or stop", at 3.5 times the
   cost, with quality never compared.
6. **The ordinary structure call works on a slice.** `wholeDocumentRequest(body)` renders whatever
   blocks it is given, and the answer parser takes its root's range from the first and last block
   of that array. So a part of a document can be put through the prompt every article already
   uses, the one that has been evaluated.

## The plan review, and what changed

GPT Sol, read-only, 2026-10-05, on commit `d25298853`:
[the review](261005a-long-documents-plan-review-sol.md), verdict **do not build unchanged**. It
confirmed that nothing treats `provisional` as unfinished, that no invariant caps depth or needs
questions, and that the structure call parses and builds on a slice. Finding by finding:

- **F1 (P1), windows break section navigation. Taken, by a different fix.** The client picks "the
  section level" as one above the deepest leaf, for the whole article (`sectionDepth`,
  `src/web/position.ts`). I wrote here that every model tree has its paragraphs at depth 3, having
  checked the five fixture trees. **That was wrong, and the E spike found it:** a chapter with no
  sections is an answer the model gives often (184 of 882 chapters, the comment on `depth1Schema`
  in `src/structure.ts`), and its paragraphs sit at depth 2. So what the review described already
  happens in production for an article with one short chapter, and is reported to the Overseer as
  a finding of its own. The review proposed teaching the client to cope. Instead **D's tree has the same shape as a model's:
  root, parts, sections, paragraphs, every paragraph at depth 3.** No client change, and a test
  that says so. § Stage D below is rewritten to this.
- **F2 (P1), a model's tree can also hand labels a section too big to ask about. Taken.** Before a
  model-built tree is accepted, the step asks the labels step's own arithmetic whether every
  sibling set can be asked for in one call; if one cannot, it returns D's tree and logs why. The
  threshold is the labels refusal, not 60: a paid tree is not thrown away for a 70-paragraph
  section.
- **F3 (P1, reasoned), one enormous paragraph.** *Half taken:* structure takes the D path when its
  **input** will not fit as well as when its answer will not, if the estimate is already to hand.
  *Half not built:* a labels request bounded by characters, with excerpts for an oversized block.
  It is true of every article today, long or short, and is reported to the Overseer as a finding.
- **F4 (P1, reasoned), 120,000 short paragraphs need more label batches than three job claims
  allow. Not built.** New reach, since such a page was refused at structure until now. What the
  reader gets is a readable article whose paragraph labels failed, which is a worse article and
  not a lost one. Reported, with a recommendation.
- **F5 (P2), a single chapter too big for one call. Taken into E's plan.**
- **F6 (P2), the batch bound is 84, not 60, and supplements are exempt. Taken:** the tests check
  sibling sets (at most 60) and planned batches (the planner's own maximum) separately, and
  windowing happens before the supplement is appended.
- **F7 (P2), the comparison was unfair to the cascade. Taken:** the E spike compares both routes
  under the same deadline and fallback before choosing. § Stage E's recommendation is now a
  hypothesis for that spike.

## The design

### Stage D: a bounded tree with no model

In `generateStructure` (`src/structure.ts`), where `wholeDocumentRequest(body)` throws
`TooLongForOnePass`, catch it and return a tree built without a model, instead of failing the step.
Everything after it (the pending labels manifest, the hash seam, `assertTreeSound`) runs as it does
for a model's tree.

The tree has the shape every model tree has, so nothing after it meets a new case:

```
 root ─ parts (depth 1) ─ sections (depth 2) ─ one leaf per block (depth 3, all of them)
```

- **Parts** are the document's sections at its section heading level, chosen and stub-merged by
  the rule `buildHeadingTree` already has. A document with no usable headings gets parts made of
  consecutive runs of sections instead.
- **Sections** are the sub-headings inside a part, and **no section holds more than a fixed number
  of blocks**: a longer run is cut into consecutive, near-equal "windows". The bound is the labels
  step's own batch size (`MAX_BATCH`, 60), so labels are asked for in the sizes its checks were
  tuned at. Windowing is done on the body, before the endnotes are appended.
- **Every part has sections, and every paragraph is at depth 3.** The tree-invariant checker
  (`checkTree`) is the oracle for how a part too small to divide is handled (merged into its
  neighbour, or whatever shape passes clean).
- **A window is titled by the opening words of its first paragraph**, cut at a word boundary with
  an ellipsis, and carries no `sourceHeading`. It is honest (the words are the author's), free,
  and never empty when the block has words; a window whose first block has none (a figure) takes
  the first block that does, else a stock title.
- **No title is ever empty.** An empty or whitespace article title falls through to the first
  heading, then to the slug; a heading with empty text does not title a section.
- The tree keeps `provisional: "headings"`, `version: "headings/1"` and
  `generator: "deterministic-headings"` (today `generateStructure` would stamp the model's name on
  it, and the Metadata page would say a model wrote it).
- `StructureRun` says which path ran, in a field of its own, logged at every value. A fallback that
  silently became the common case must show in the logs
  ([silent-success.md](../reusable/silent-success.md)).

`buildHeadingTree` as it stands is the structure eval's arm zero and must go on measuring exactly
what it measured, so the bounded tree is a separate builder (or an option that is off by default)
sharing its section-level and stub rules rather than a change to its output.

Two more conditions send a document down this path (review F2, F3): its **input** will not fit one
call, where that estimate is already to hand; and a model-built tree that holds a sibling set the
labels step could not ask about in one call.

What the reader gets from D alone: the article opens and reads; Structure, the rail and the spine
show the author's headings and the windows, with no gists; paragraph labels arrive from the labels
step as for any article; Summary and the other modes work from titles only.

**Not in D:** any new sentence on screen saying the structure is plainer. E removes most of the
need, and where E fails the tree is still usable. Named in the debrief for Greg.

**What D does not fix, and says so:** Relations refuses at about 2,930 paragraphs with the same
sentence, on that mode only. The article response against Vercel's 4.5 MB is `qi-sbytr395`.

Tests, each red first:

- `tests/stated-limits.test.ts`: the KNOWN GAP test is replaced. A dense paper at the stated 250
  pages, and a headingless document past the one-answer ceiling, go through `generateStructure`
  with no model call (the test's model seam throws if touched) and come back with a sound tree in
  which no body sibling set passes the bound and every body leaf is at depth 3.
  `wholeDocumentRequest` still refusing at 2,890 stays pinned, since that is now the line where the
  path changes.
- The labels planner over those trees: every structural block in a batch, and no batch over the
  planner's own maximum. With a supplement appended, and without. This is finding 1 as a test.
- The client's own section list (`buildSections`) over those trees: no section with an empty
  title, none that is a paragraph. Review F1 as a test, on a document where one chapter is long
  and its neighbour is short.
- A model's answer, well-formed, with one 2,200-block section: the step returns the bounded tree
  and says why (review F2).
- Empty article title; empty heading text; a window starting on a wordless block.
- `buildHeadingTree` with the option off is byte-identical to before (the eval's arm).
- One Postgres round trip: write, publish guard, load.

Then, free and real: re-run `structure` on the failed local draft `s3-doctorow-250p-spya-sw2jbz`
(3,112 blocks, left by 261004f for this), run its labels (about $2 by the 45 MB paper's rate; cap
$4), and a Sonnet browser check at desktop, iPad and phone widths of the reading view, Structure
and the rail.

Docs in the same stage: `structure-step.md` (the ceiling section), `ingest-queue.md`, the
investigation's table and short answer, 261004f § Result, the comments in `src/uploads.ts` and the
stated-limits test. The dialog's sentence does not change: it becomes true.

### Stage E: fill the tree in, part by part

**The hypothesis the E spike tests: the ordinary structure call, once per part, stitched**, rather
than the cascade. Review F7: the two routes are compared under the same deadline and the same
fallback before one is chosen. Review F5: a single part too big for one call is cut at its own
sections' boundaries, the authored part is kept as the parent, and its gist is composed from its
children's, so gist composition is needed for such parts as well as for the root.

```
 too-long body (3,112 blocks)
   │  cut at D's top-level boundaries (chapters, or windows), packed into
   │  consecutive groups that each fit one ordinary call with room to spare
   ▼
 [ group 1 ]  [ group 2 ]  [ group 3 ]      each: the existing prompt, on its slice,
   │            │            │              its own checkpoint, run side by side
   ▼            ▼            ▼
 part trees (gists, titles, questions, as for any article)
   │  the groups' top-level sections become the book's top-level sections
   ▼
 one root over all of them  ──►  one small call writes the root's gist from the sections' gists
   ▼
 buildTree + assertTreeSound once, over the whole body: an ordinary, non-provisional tree
```

- If any group fails (after the one re-ask the step already allows), or the deadline would be
  passed, **the step returns D's tree**. A long document never fails at structure again; the
  worst case is the plainer tree. Each group's answer is checkpointed, so a retry buys only what
  is missing.
- A group boundary is always one of D's top-level boundaries, so no section the author named is
  split between two calls. A headingless document is cut at window boundaries, which is arbitrary;
  the model sees each group whole and cuts inside it properly, but cannot join across the seam.
- Cost: the same tokens as one call would have used, plus the prompt repeated per group. Roughly
  what a 2,000-block paper costs today, scaled.

**The cascade route, passed over, and why.** To get a finished tree from the cascade it needs a
recursion loop, publication per wave or a requeue, a way to cut an oversized target, and a new
bottom-up pass to write gists for every node it started from: four new mechanisms on machinery
whose only measurement ended undecided. The part-by-part route adds one small call and a stitch,
and reuses the prompt every article is already cut by. Greg's answer named E as "the cascade";
this is the same result for the reader by a shorter road, so it is taken as a technical fork and
reported in the debrief rather than asked. GPT Sol is asked to attack exactly this choice.

**What it gives up:** each group is cut without sight of the others, so top-level sections may be
uneven across a seam, and the root's gist is composed from section gists rather than written by a
model that read the book.

E is planned in detail, and reviewed again, after D lands. Stop rule (Greg's): if E grows past
several days, stop after a working stage and debrief.

## Stages

- [x] Plan review by GPT Sol (read-only).
- [x] **D**: tests red; build; gates; Sol code review (write-capable); the real 250-page book;
  browser check; docs; push to `dev`.
- [x] **E plan**: a spike on the local book first (one group through the ordinary call, does it
  parse and build on a slice), then the detailed plan and its Sol review.
- [x] **E**: build, gates, Sol code review, the real book end to end, browser check, docs, push.
- [ ] Debrief to the Overseer; remove the worktree after `worktree:check`.

## Result: stage D

Built 2026-10-05. `e9abf4aa6` is the stage as first built; the commit after it carries GPT Sol's
review fixes and three things the real book showed.

**What landed.** `buildBoundedHeadingTree` (`src/heading-tree.ts`); the catch and the labels check
in `generateStructure`; `StructureRun.source`, logged and in the step's `detail`;
`labelCallBudget` and `unaskableBatches` (`src/labels.ts`). The article title reaches the step
from the extract's meta. `buildHeadingTree`'s output is unchanged, pinned by digests taken before
the edit.

**The code review.** [GPT Sol](261005a-long-documents-stage-d-review-sol.md): ship with the fixes
it made.

- **F8 (P1), fixed by the reviewer.** A model answer with a root and no sections, on an article
  with endnotes, passed the tree checks and then made the new labels check throw, so a tiny
  article that used to publish would have failed. The labels planner now leaves supplement
  branches out. [The postmortem](../postmortems/261005a-a-supplement-append-invalidates-a-labels-planner-assumption.md).
- **F9 (P1, wider, not built).** A document with more than 1,096 top-level headings makes the Arc
  feature refuse (one sentence per part, in one answer). The article opens and reads. Reported.
- **F10 (P3), fixed.** Comments that described only the model path.

**Not done from the plan.** Review F3's structure half: nothing in the codebase estimates whether
the whole-document call's *input* fits, and none was invented. The Postgres round trip as a test:
the publish guard is private and the scaffolding was large; the real import below is that check.

**The real book** (Doctorow, *With a Little Help*, 250 pages), re-imported on the local stack as
`s3-doctorow-250p-spya-jg872v`: 3,053 blocks; structure 5 seconds, no model call, $0; labels 235
seconds, 60 batches, 3,052 paragraphs, none dropped, $1.62; article response 2.3 MB. It showed
three things no synthetic document had:

- **The PDF's running header was transcribed as a heading on most pages**, so 58 of 76 parts were
  titled *With a Little Help*. Now a heading repeated five or more times, or the article's own
  title met twice, or a heading with no letters in it, neither cuts nor titles. 13 parts, named
  for the stories.
- **Windows were titled "#", "36" and "Oh"** (scene breaks, page numbers). An opening-words title
  now comes from the first block with three real words, and dot leaders are dropped.
- **Opening-words titles were drawn in the model's typeface.** They are the author's words. A node
  now says where its title came from (`titleFrom: "opening-words"`), and `titleVoice` draws it in
  the author's face ([fonts.md](../project/fonts.md)).

Spend: $2.24 for the first import, and about $1.6 more to label the re-cut tree. The $4 cap was
for one pass; the second was a choice, to check the final tree in a browser with its labels.

**The browser check** (Sonnet, Playwright, 1440, 820 and 390 wide; screenshots
`261005a-shot-*.png`): usable at all three, nothing broken or empty, breadcrumbs always a part and
a section. What it shows that D cannot fix: the tree is only as good as the headings the
transcription marked (several stories sit under one chapter whose heading came out a level too
high). That is what E is for.

**Seen and not ours:** after a click in Structure the "current" row sits one section behind the
one clicked, and the fisheye's second column is slow to follow; a 500 from `/api/source-guess` on
an uploaded file. Reported, not investigated.

## The E spike, and the plan it leads to

Run 2026-10-05 on the real book, by an Opus subagent: `evals/long-documents/spike-*.ts`, results
in `evals/results/long-documents-2026-10-05/`. Spend $1.26 of a $6 cap, nothing written to the
database.

**The hypothesis held.** Four slices of 628 to 904 blocks, the ordinary structure call on each,
side by side: every answer parsed and built first time, 38 to 96 seconds each, $0.81 in all with
the root call. Stitched under one root and put through one `buildTree` over the whole body with
no change to it: **zero `checkTree` problems as a finished, non-provisional tree**, a gist on
every internal node, nothing the labels step could not ask about. About 100 seconds of wall time
against a step budget of 700.

**The cascade was not run.** It leaves every node it starts from without a gist, and it can only
divide downwards: D's parts for this book hide three stories under one heading, and nothing in
the cascade regroups upwards. Slices are chosen for that and for being simpler. Its earlier
measurements (260904d) cover its whole step with labels, so they cannot be set against this
structure-only spike; the cost comparison review F7 asked for is unmeasured (review F20 below).

**What the spike found that the hypothesis did not have:**

- **A slice does not know it is a slice.** Three of four slices cut their stories into scenes at
  the top level (*Visit the Sins* became five parts). A four-sentence note ahead of the blocks,
  written for this book, on two of the slices, brought the tree from 27 parts to 19 (not exactly
  one per story: *Human Readable* is still three). An ordinary article's request is unchanged,
  because the note exists only on this path. See review F19 below.
- **A chapter can come back with no sections and 183 blocks in it**, swallowing two stories. The
  tree checks pass it. Asking again for that range alone (18 seconds, $0.05) gave three chapters.
  So: a top-level section with no sections of its own and more blocks than the labels batch size
  is asked for once more as its own slice, and its children take its place.
- **Slice seams belong on authored headings.** A first planner cut inside a story at a window
  boundary; preferring sub-headings put all three seams on story starts.
- **The root's gist** is one call of a few seconds over the top-level titles and gists.

### Stage E, as it will be built

```
 generateStructure, when one answer will not fit:
   plan slices (pure) ──► each slice: the ordinary call + the two-sentence note,
        │                 its own checkpoint, one re-ask as today, 8 at a time
        │                         │
        │                 refill: a sectionless top-level section over 60 blocks
        │                 is asked again as its own slice, once
        ▼                         ▼
   stitch: every slice's top-level sections under one root ──► root gist call
        ▼
   buildTree + appendSupplement + assertTreeSound + the labels check
        ▼
   a finished tree (source: slices)        any failure, or the deadline ──► D's tree
```

- New `src/structure-slices.ts`: the planner, the stitch, the refill rule, the note, the root
  prompt with its schema. `generateStructure` tries it where it now returns D's tree.
- **D's tree is the fallback for everything**: a slice that fails twice, a refusal, a truncation,
  a stitched tree that will not build or that the labels step could not ask about, the deadline.
  A long document never fails at structure; the worst case is the plainer tree. What was bought
  is checkpointed per slice, so the reader's Retry (or a re-run) buys only what is missing.
- `StructureRun.source` gains the slices path, with the slice count and how many were refilled,
  logged at every value. The call and token counts add every slice up.
- The model seam is injected, so every test is free: the planner over the real shapes (the dense
  paper, a headingless 6,000 blocks, one giant part); a stitched tree is sound and finished; a
  failing slice, a failing root call and a passed deadline each return D's tree with the spend
  still reported; a second run re-reads the checkpoints and asks for nothing; the refill happens
  once and not twice; `tests/stated-limits.test.ts` says a document at the stated limits gets a
  finished tree when the model answers and D's when it does not.
- Then the real book end to end through the queue, its labels, and a browser check at three
  widths. Budget $5.

### The review of this plan, and what changed

GPT Sol, read-only, on `923013789`: [the review](261005a-long-documents-stage-e-plan-review-sol.md),
**build with changes**. It checked the spike's numbers against the raw files (correct) and that
the shared checkpoint namespace is safe. All seven findings are taken:

- **F15 (P1, established): a slice can vanish in the stitch.** An answer with a root and no
  sections is valid on its own, contributes nothing when its sections are promoted, and the final
  build quietly stretches a neighbour over its blocks, with a gist written for text that model
  never saw. So: a slice or refill is accepted only if its promoted sections are non-empty and
  exactly tile the blocks it was given. Anything else is a failed answer (one re-ask, then D).
  The final build must report zero repairs at slice seams.
- **F16 (P1): the deadline.** If the queue's own deadline fires, the job ends as interrupted even
  if E then returns D. So E keeps its own, earlier deadline (the step budget or the queue's
  deadline, whichever is sooner, less a reserve for finishing); every call has a time cap; a call
  is admitted only if its cap fits; E aborts its own calls with its own signal, waits for them,
  and finishes with D inside the reserve. A reader's Stop is still a cancellation. Refills are
  skipped first when time is short.
- **F17 (P1): spend.** On a failure E stops admitting calls and **waits for every call already
  started** before returning D, so their cost is inside the step's ledger scope; each good answer
  is checkpointed even when a peer failed; usage is read before the answer is judged.
- **F18 (P1): a second run buys nothing only if refills and the root are checkpointed too.** They
  are, each under its own canonical request.
- **F19 (P2): I overstated the note.** What the spike tried was four sentences written for this
  book, on two slices, and it gave 19 parts, not exactly one per story. The production note is
  generic, and is measured before it is kept: note against no note on a slice of the book, a slice
  of a paper and a headingless slice, written up under `docs/investigations/`.
- **F20 (P2): the cascade's numbers were for its whole step, labels included**, so the cost and
  time comparison above does not stand. Slices are chosen for fit (the cascade cannot regroup
  upwards or write gists for the nodes it starts from) and for being simpler. The comparison of
  cost is unmeasured.
- **F21 (P2): an import cycle.** `structure-slices.ts` imports no values from `structure.ts`; the
  request and parse helpers are passed in or moved.

Also from the review: one re-ask per slice, as today; a refilled chapter that is still sectionless
is kept if the tree and labels checks pass; D's windows are never mixed into a model tree.

**What it gives up, said plainly.** Each slice is cut without sight of the others, so a story
that runs across a seam would be two parts (seams are put on headings to make that rare, and a
headingless document has only arbitrary seams). The root's gist is composed from its sections'
gists by a new prompt with two runs behind it. Slices are bounded by block count, not by
characters, so a document of enormous paragraphs can still overflow a call's input (review F3,
unchanged). Past about 45 slices (roughly 40,000 blocks) the step runs out of time and returns
D's tree. A chapter with no sections still leaves its paragraphs at depth 2, as in any model
tree today.

## Result: stage E

Built 2026-10-05. `a079914e2` is the stage as first built; `618ab1509` carries GPT Sol's review
fixes.

**What landed.** `src/structure-slices.ts` (the planner, the acceptance rule, the join, the
refill rule, the note, the root call, the deadline, `runSlices`), and its call from
`generateStructure` where one answer will not fit. `StructureRun.source` has a slices value and
the headings reason says why slices failed. The step's own budget now reaches the step
(`stepBudgetMs`, from `src/jobs.ts`). No migration: slices, refills and the root share the
existing checkpoint namespace under their own request keys.

**The code review.** [GPT Sol](261005a-long-documents-stage-e-code-review-sol.md): ship with the
fixes it made, eight of them, each seen red first: F22 (the call count left out failed calls and
retries), F23 (a root "question" that was a statement), F24 (a call answering after its time cap
could still publish), F25, F26 (a failed slice stopped admission a moment late), F27, F28, F30.
Two new test files, one of which drives the real job walk through the queue.

- **F28 changes a decision of mine.** I had a failed refill keep the section it was meant to
  improve. The reviewer made it return the headings tree, as any failed call does. That throws
  away a finished tree for one optional call that failed after its retries. I have left it: it is
  the simpler rule, the slices are checkpointed so a re-run buys only the refill, and it should be
  rare. It is the first thing to revisit if the fallback rate is not near zero.
- **F29 (P2, wider, not built).** Checkpoint reads and writes have no time limit of their own, so
  the reserve at the end of the step is an allowance and not a bound. Reported.

**The gates.** Typecheck and the import-cycle check green. The full suite on `618ab1509`: 1,593
files passed and 6 failed. Five are the ones a fresh worktree always fails for want of a build
(`fleet-composed-access`, `cold-start-lazy-imports`, `fleet-decisions-route`,
`fleet-reports-route`, `pdf-bundle-trace`). The sixth was real: the reviewer's new queue test
reused an owner uuid another test file claims, which `tests/fixture-ids.test.ts` refuses. It has
its own id now, and both files pass.

**Not red-first.** The implementer wired the step before writing its integration tests, so those
passed on first run. Five mutations of the finished code each turned one red, and every review
fix was red first.

**The real book, through the queue.** `npm run structure -- s3-doctorow-250p-spya-jg872v --force`:
4 slices, no refill, no re-ask, 5 calls, 131 seconds, $1.00. 25 parts, mostly the book's stories
by name, each starting on its own heading with no gaps (checked block by block). Labels: 221
seconds, 65 calls, 3,052 paragraphs, $1.53.

**Spend on E:** $1.26 spike, $1.47 note comparison, $1.00 and $1.53 for the run above: $5.26
against a budget of $5 for the run plus $6 and $3 for the two measurements.

**The browser check** (Sonnet, Playwright, 1440, 820 and 390; `261005a-shot-e*.png`): the article
opens and reads at all three, Structure shows the 25 parts with their gists, no empty titles, no
overflow, author's titles in the serif and the model's in mono.

**One real problem it found, which is not this work's.** After a click on a part or section in
Structure the prose lands correctly, and about two seconds later the address's `?at=` is
rewritten to a block several hundred pixels *above* the view, and the highlighted row follows it
to the previous section. It does not correct itself. **It reproduces on an ordinary 1,025-block
article** (`s3-gdl-45mb-spya-cc9kr8`, a model-built tree, nothing of this plan in it), where `at=`
ended up between 22 and 1,419 pixels above the view after five clicks. The book's tree was
checked block by block and every part starts on its own heading, so it is the reading view and
not the tree. Not investigated; reported to the Overseer with the measurements
(`261005a-shot-e1x-1440-book-after-click.png`).

**Also seen, as in any model tree:** a part with no sections (a dedication, an afterword) shows
"This part is not divided into sections" on a wide screen, and in the breadcrumb its "section"
is a paragraph's label.

## The simpler options passed over

- **D as one line (`buildHeadingTree` in the catch).** Finding 1: it publishes an article whose
  labels step then throws, for every headingless long document.
- **Raise the ceiling instead** (less thinking room, or starts-only output). It moves 2,890 to some
  other number and the dialog's promise stays untrue for the next longer book.
- **Stop at D.** Greg chose D then E.

## Open questions for the review

- Is 60 the right bound, and is "opening words" the right title for a window?
- Is there any consumer that the surveys missed which treats `provisional` as "not finished"?
- E's route.
