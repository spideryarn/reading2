# A document too long for one structure answer still becomes an article

Up: [plans.md](../project/plans.md)

Status as of 2026-10-05: **plan, nothing built.** Queue item `qi-kbkbw4rp`.

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

## The design

### Stage D: a bounded tree with no model

In `generateStructure` (`src/structure.ts`), where `wholeDocumentRequest(body)` throws
`TooLongForOnePass`, catch it and return a tree built without a model, instead of failing the step.
Everything after it (the pending labels manifest, the hash seam, `assertTreeSound`) runs as it does
for a model's tree.

The tree is `buildHeadingTree`'s, with one addition that makes it safe for the steps after it:

- **No run of sibling leaves is longer than a fixed bound.** A run over the bound is cut into
  consecutive, near-equal sections ("windows"), and the leaves hang under those. The bound is the
  labels step's own batch size (`MAX_BATCH`, 60), so labels are asked for in the sizes its checks
  were tuned at. A document with no usable headings becomes root, then about fifty windows, then
  leaves, rather than root and 3,100 leaves.
- **A window is titled by the opening words of its first paragraph**, cut at a word boundary with
  an ellipsis. It is honest (the words are the author's), free, and never empty when the block has
  words; a window whose first block has none (a figure) takes the first block that does, else a
  stock title.
- **No title is ever empty.** An empty or whitespace article title falls through to the first
  heading, then to the slug; a heading with empty text does not title a section.
- The tree keeps `provisional: "headings"`, `version: "headings/1"` and
  `generator: "deterministic-headings"` (today `generateStructure` would stamp the model's name on
  it, and the Metadata page would say a model wrote it).
- `StructureRun` says which path ran, in a field of its own, logged at every value. A fallback that
  silently became the common case must show in the logs
  ([silent-success.md](../reusable/silent-success.md)).

The windowing is an option on the builder, off by default, so the structure eval's arm zero
(`buildHeadingTree` as it stands) measures exactly what it measured before.

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
  which no sibling leaf run passes the bound. `wholeDocumentRequest` still refusing at 2,890 stays
  pinned, since that is now the line where the path changes.
- The labels planner over those trees: every structural block in a batch, no batch over the bound
  plus headings. With a supplement appended, and without. This is finding 1 as a test.
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

**Recommended: the ordinary structure call, once per part, stitched.** Not the cascade.

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

- [ ] Plan review by GPT Sol (read-only).
- [ ] **D**: tests red; build; gates; Sol code review (write-capable); the real 250-page book;
  browser check; docs; push to `dev`.
- [ ] **E plan**: a spike on the local book first (one group through the ordinary call, does it
  parse and build on a slice), then the detailed plan and its Sol review.
- [ ] **E**: build, gates, Sol code review, the real book end to end, browser check, docs, push.
- [ ] Debrief to the Overseer; remove the worktree after `worktree:check`.

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
