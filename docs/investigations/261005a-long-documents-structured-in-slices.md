# A long document's table of contents, asked for in slices

Up: [investigations.md](../project/investigations.md)

Measured 2026-10-05 on the box, for queue item `qi-kbkbw4rp`. The plan is
[261005a](../plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md);
raw results are in
[`evals/results/long-documents-2026-10-05/`](../../evals/results/long-documents-2026-10-05/); the
scripts are in [`evals/long-documents/`](../../evals/long-documents/).

## What was asked

A document over about 2,890 blocks is too long for the one model answer that normally writes the
table of contents. Since stage D of the plan it gets a tree from its own headings, with no
summary sentences. Can it get a finished tree instead, by asking the ordinary structure call for
one stretch of the document at a time and joining the answers?

## The short answer

**Yes, on the one real book tried.** Four slices of a 250-page book, each through the call every
article already uses, joined under one root: a sound, finished tree with a gist on every section,
for $0.81 and about 100 seconds. It needed three things the first idea did not have, each found
by the run: a note telling the model it is reading one stretch of something longer, a second ask
for a chapter that comes back with no sections, and seams placed on the author's headings.

One book, one paper slice and one headingless slice. Not a corpus.

## How it was measured

The document: Cory Doctorow, *With a Little Help* (CC BY-NC-SA), cut to 250 pages, as imported
locally (`s3-doctorow-250p-spya-jg872v`, 3,053 blocks). The model and effort are the ones the
structure step uses at standard power. Nothing was written to the database; spend was collected
to a file.

```
npx tsx evals/long-documents/spike-parts.ts        # plan, four slices, stitch, root call
npx tsx evals/long-documents/spike-followups.ts    # one refill, the first note
npx tsx evals/long-documents/note-comparison.ts    # the generic note, with and without
```

Spend: **$2.73** in all ($1.26 for the spike and its follow-ups, $1.47 for the note comparison).

## The four slices

| Slice | Blocks | Seconds | Tokens in / out | Cost | Top-level sections | Repairs |
|---|---|---|---|---|---|---|
| 0 | 805 | 42 | 72,006 / 3,920 | $0.18 | 6 | 5 |
| 1 | 716 | 38 | 69,068 / 3,187 | $0.17 | 6 | 0 |
| 2 | 628 | 96 | 48,891 / 9,176 | $0.19 | 7 | 1 |
| 3 | 904 | 94 | 86,227 / 8,807 | $0.26 | 8 | 0 |

Every answer parsed and built first time. The root's gist took one more call: 3 seconds, $0.01.
Joined: 27 top-level sections, 118 below them, no problem from the tree checker as a finished
tree, and nothing the labels step could not ask about. Side by side the wall time is the slowest
slice plus the root call, about 100 seconds, against a step budget of 700.

**And as built, through the queue** (`npm run structure -- <slug> --force`, the same day, after
the code review): 4 slices, no refill, no re-ask, 5 calls, 131 seconds, **$1.00**, 25 top-level
sections that are mostly the book's stories by name. The labels step then ran on that tree as on
any other.

## What went wrong, and what fixed it

- **Three of four slices cut their stories into scenes at the top level.** *Visit the Sins* came
  back as five top-level sections. The model was not told it was reading part of a book.
- **One chapter came back with no sections and 183 blocks in it**, holding two whole stories. The
  tree checks pass that shape. Asking again for that range alone (18 seconds, $0.05) returned
  three chapters with both stories among them.
- **A first planner cut inside a story.** Preferring the author's sub-headings to arbitrary
  boundaries put all three seams on story starts.

## The note

Two short paragraphs ahead of the blocks, in the user message. The system prompt is not touched,
so an ordinary article's request is byte for byte what it was. The wording is `SLICE_NOTE` in
[`src/structure-slices.ts`](../../src/structure-slices.ts).

With and without, on three slices:

| Slice | Note | Top-level sections | With no sections of their own (over 60 blocks) | Seconds | Cost |
|---|---|---|---|---|---|
| The book, slice 2 (628 blocks) | no | 7 | 1 (1) | reused from the spike | |
| The book, slice 2 | yes | 4 | 0 | 72 | $0.18 |
| A paper, first 900 blocks | no | 10 | 4 (0) | 131 | $0.42 |
| A paper, first 900 blocks | yes | 11 | 5 (0) | 67 | $0.32 |
| The book, slice 3 with its headings made plain text (904) | no | 6 | 4 (0) | 79 | $0.25 |
| The book, slice 3, headingless | yes | 4 | 2 (0) | 110 | $0.30 |

- **The book:** better. *Visit the Sins* comes back whole, and the 183-block chapter with no
  sections is gone.
- **The paper** (*Geometric Deep Learning*): no real change. Chapters 1 to 7 are identical; the
  front matter is split in two.
- **Headingless:** short afterwords fold into their stories.

**Decision: keep the note, as worded, and do not tune it further on this evidence.** Each cell is
one run, and the model's answers vary between runs, so the paper row says "no harm seen", not
"no harm".

## The cascade, which was not run

The plan Greg chose named a different mechanism for this stage: the "cascade" built in September
and switched off ([260904d](../plans/260904d-deepen-fat-sections.md)), which divides fat sections
with one small call each. It was passed over without a paid run, on what the code does: it gives
gists to the sections it creates and never to the ones it started from, so the root and every
heading section would stay bare; it runs one wave, not a recursion; and it can only divide
downwards, while this book's headings hide three stories under one of them. Its earlier cost
figures cover its whole step with labels, so they are not comparable with the numbers above. **So
the cost of the cascade against slices is unmeasured**, and the choice rests on fit and on slices
being less new machinery.

## Ruled out, and not measured

- **Not measured: a second document end to end.** One book. A long paper was measured as one
  slice only.
- **Not measured: a document of several thousand blocks with no headings at all.** The seams
  there are arbitrary and a story that crosses one becomes two sections.
- **Not measured: more than four slices at once**, and so not the provider's rate limits at eight.
- **Not measured: the root gist's quality** beyond reading two of them.
- **Unchanged: slices are sized by block count.** A document of enormous paragraphs can still
  overflow one call's input.

## Follow-ups

In the plan's § Result for stage E and in the debrief to the Overseer.
