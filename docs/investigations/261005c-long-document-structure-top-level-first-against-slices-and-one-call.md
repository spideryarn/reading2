# Long-document structure: top level first, against slices and against one call

Up: [investigations.md](../project/investigations.md)

Run 2026-10-05 for stage 2 of
[261005j](../plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md).
Greg asked whether a long document's table of contents could be made "robustly, progressively and
fairly low-latency, e.g. just the top-level headings first, then the lower-level headings within
each of those? then do the summaries later in parallel?" (his words in full are in the plan).
This is the measurement of that shape.

**Spend: $32.31 recorded, about $32.4 in all**, against a cap of $40. The harness's ledgers (one
line per network attempt) hold $2.18 for the smoke run and $30.13 for the matrix and its judging.
The smoke run's GPT Sol judgements were recorded at $0 (that judge is on our own key with the
provider, and the ledger did not yet read its upstream cost); from the judgement records that is
about another $0.10, which the ledger cannot confirm.

GPT Sol checked this write-up against the raw result files, read-only, before it was committed:
[the check](../plans/261005j-long-structure-eval-check-sol.md), **stands with corrections**, eight
of them, all made. Where a sentence below is narrower than the first draft, that is why.

## The short answer

- **It is progressive, and where it finished, faster under the one-answer line.** In the
  top-level-first runs that completed, a top level arrived in 18 to 62 seconds, and a document
  that fits one call today was finished in 32 to 108 seconds against 68 to 142.
- **Past the line it is no faster to finish than today's slices** (136 and 151 seconds against
  127 and 169), and it costs about half as much again.
- **Past the line it made the better table of contents, on the one book tried.** Both judges
  preferred it to the slices on both variants of one story collection (with its headings, and
  with them removed), on the top level and on the summaries. Two variants of one book are not two
  books.
- **It was less robust in these runs, not more.** 4 of 14 completed staged runs produced no
  table of contents at all, and 9 of 14 had at least one answer refused by the parser. The
  slices: 0 of 2, and no answer refused. These are counts, not rates, and the harness changed
  one rule between the smoke run and the matrix (below).
- **Its first call is not steady.** The same request on the same book gave 15 parts once (the
  twelve stories, the front matter, the introduction and the closing essay) and 8 parts the next
  time, with stories welded together. On Moby-Dick it gave 8 parts, one running from chapter 32
  to chapter 86.
- **Summaries in a later round: not shown to pay, and not cleanly tested.** No faster to the
  finished tree and a quarter dearer in the runs that completed, and it lost two of three direct
  comparisons. But one of those losses comes from a different first-call outline and not from
  the summaries, it won the paper outright, and it finished the Origin where B did not.

So Greg's shape is worth having for the top level it gives early and for what it did to a long
book's parts. **This pilot supports fixing recovery and measuring the first call's variability
before it is adopted**: the shape makes three to seven times as many calls, and today one failed
call loses everything. That puts the plan's stage 1a first. It does not by itself show that 1b
(a tree plain in parts) is needed.

This is a pilot: six documents, one run each. It can show a large difference and cannot show a
rate. The times are generation only: they leave out loading the document and getting the result
to a reader.

## What was compared

`evals/long-structure/` (`run.ts` is the entry; `dry.ts` is the free check of the harness itself,
with a fake model and injected failures). Nothing under `src/` was changed and nothing was
written to the database.

| arm | what it does |
|---|---|
| **one** | the ordinary single structure call. Today's path under the line. |
| **A** | today's slices (`runSlices`), as production runs them past the line. |
| **B** | call 1 reads the whole document and returns only the parts (`long-top/1`); then one call per part, eight at a time, divides it into sections with their summaries, using the switched-off cascade's prompt unchanged (`expand/8`). |
| **C** | as B, but the per-part calls return starts and titles only (`long-sections/1`), and a third round writes the summaries (`long-section-gists/1`). |

The three new prompts are in `evals/long-structure/prompts.ts`. Their rules for titles, summaries,
questions and boundaries are cut out of the production prompts by section name, so the arms do
not differ in what a summary is asked to be. Model and effort are the structure step's own
(`claude-sonnet-5`, `low`).

| document | blocks | words | fits one answer |
|---|---|---|---|
| a 250-page book of short stories (`s3-doctorow-250p-spya-jg872v`) | 3,053 | 110,745 | no |
| the same book with every heading turned into a paragraph | 3,053 | 110,745 | no |
| Moby-Dick | 2,569 | 209,227 | yes |
| On the Origin of Species | 1,324 | 155,479 | yes |
| a 160-page paper (`s3-gdl-45mb-spya-cc9kr8`) | 970 | 47,957 | yes |
| a long web page (`gwern-scaling-long`) | 143 | 12,637 | yes |

A seventh, Moby-Dick joined to the Origin (3,893 blocks), was built and has no finished cell: the cap
stopped the run partway through its first one.

## Time, cost and failures

"Top" is when the top level existed; "done" is when the whole tree had passed the same final
build and `checkTree` every arm goes through. Failures are calls whose answer was not accepted.

| document | arm | top | done | calls | not accepted | cost | parts / sections |
|---|---|---|---|---|---|---|---|
| paper | one | 142 s | 142 s | 1 | 0 | $0.45 | 9 / 45 |
| | B | 18 s | 78 s | 9 | 1, re-asked | $0.87 | 11 / 75 |
| | C | 18 s | 86 s | 15 | 0 | $1.07 | 11 / 98 |
| web page | one | 68 s | 68 s | 1 | 0 | $0.13 | 12 / 49 |
| | B | 21 s | 32 s | 4 | 0 | $0.18 | 12 / 20 |
| | C | 24 s | 44 s | 7 | 0 | $0.24 | 15 / 29 |
| Moby-Dick | one | 140 s | 140 s | 1 | 0 | $1.04 | 19 / 74 |
| | B | 24 s | 108 s | 9 | 0 | $2.31 | 8 / 143 |
| | C | 36 s | **no tree** | 27 | 3 | $3.48 | |
| Origin | one | 119 s | 119 s | 1 | 0 | $0.71 | 18 / 83 |
| | B | 35 s | **no tree** | 19 | 2 | $1.69 | |
| | C | 29 s | 124 s | 37 | 2, re-asked | $2.58 | 18 / 256 |
| book | A | 126 s | 127 s | 5 | 0 | $1.04 | 22 / 124 |
| | B | 62 s | 136 s | 16 | 2, re-asked | $1.57 | 15 / 117 |
| | C | 69 s | 134 s | 17 | 0 | $1.93 | 8 / 97 |
| book, no headings | A | 169 s | 169 s | 5 | 0 | $1.04 | 28 / 121 |
| | B | 54 s | 151 s | 15 | 1, re-asked | $1.60 | 14 / 107 |
| | C | none | **no tree** | 2 | 2 | $1.13 | |

The smoke run before the matrix bought B and C on the paper once more: B finished (42 seconds,
$0.73) and C produced no tree. Those two make the fourteen completed staged runs counted above,
twelve in the table and two in the smoke run. **The harness changed one rule between them**: in
the smoke run a part that came back as a single section was a failure (that is what sank C
there); from the matrix on, such a part simply keeps its paragraphs. So the smoke failure would
not recur, and "4 of 14" mixes two versions of the harness.

**A fifteenth run was started and cut off.** The joined document's C cell made 21 paid attempts,
$3.73, before the cap stopped it; no cell was saved, and it is in none of the counts.

**Where the money goes.** The first call reads the whole document, and that is the dear part.
For the twelve staged cells in the table, $6.80 of $18.64 was first calls. (Across everything the
staged arms spent in the matrix, the cut-off cell and one first-call retry included, it is $8.34
of $22.37.) The per-part rounds read the document a second time, and C a third. B's per-part
calls did use prompt caching, which the expansion prompt sets up (24 calls read 112,712 cached
tokens); caching was not made equal across the arms.

**Why the staged runs failed.** All four were answers that did not pass validation twice running;
none was a transport failure or a refusal. Three were in a per-part call, and one was C's first
call on the headingless book, whose parts did not tile. Of the sixteen answers the staged arms
had refused in all, seven were B's expansion answers missing the `verdict` that prompt asks for
on each child and nothing here uses; they caused one of the four lost runs. C's prompts already
have strict schemas, so its failures are something else and are not diagnosed here.

**What was and was not the same across arms.** The blocks, the model, the effort, the final
build and `checkTree` were. Eight calls at a time is production's own number for the slices. The
slices arm also runs production's seam check and its check that the labels step could ask about
every section; the staged arms do not run those, though every finished tree here would have
passed the second.

**One whole arm's result rests on one call.** In B and C a failed first call is no tree, and a
failed per-part call was, in this harness as in production today, no tree. That is the plan's
stage 1 point made by measurement: more calls, each one fatal.

## What the judges said

Two blind judges from different families (Opus and GPT Sol), shown the document's own headings,
both top levels, the text either side of every top-level boundary, and the same eight sampled
passages with each tree's title and summary for the section containing them. Before any arm was
judged, each judge had to prefer a good tree to three spoiled ones (two parts welded; summaries
taken from elsewhere in the document; section summaries removed). Both passed, 3 of 3, on two
documents. Which tree sat in which seat was shuffled by a hash; the first-named arm happened to
sit first in 9 of the 12 pairs, which the check recomputed and found to be the draw and not a
bias. No arm's name is in what a judge sees.

| pair | document | top level | summaries | overall |
|---|---|---|---|---|
| **B against A** (today, past the line) | book | B, B | B, B | **B, B** |
| | book, no headings | B, B | B, B | **B, B** |
| **B against one** (today, under the line) | paper | B, B | B, B | **B, B** |
| | web page | one, one | one, one | **one, one** |
| | Moby-Dick | one, one | B, B | one, B |
| **C against B** | book | B, B | B, C | **B, B** |
| | web page | C, C | B, B | **B, B** |
| | paper | C, B | C, C | **C, C** |
| **C against today** | book (A) | A, A | C, A | **A, A** |
| | paper (one) | C, C | C, C | **C, C** |
| | web page (one) | one, C | one, one | one, C |
| | Origin (one) | C, C | one, one | C, one |

(Each cell is Opus's verdict, then Sol's.)

**Why B beat the slices on the book**, in the judges' words: B "gives each story one whole part
with its afterword attached", where the slices tree "cuts Human Readable into three top-level
parts", splits another story into a stub and a part, and makes every afterword a part of its own. That is
the weakness 261005a named (a slice does not know it is a slice), seen by a reader who was not
told about it. With no headings to cut on, the gap was the same: 14 parts against 28.

**Why B lost on Moby-Dick's top level**: 8 parts, one running "from Chapter 2 to mid-Chapter 29",
one that "swallows Chapters 32–86, cetology and narrative alike". The single call gave 19 parts
that "follow the novel's real movements". B's summaries were still preferred there, because each
per-part call reads its own part closely.

**The first call is not steady.** B and C send the same first request (the check confirmed both
read 265,091 input tokens for the book). B's draw gave 15 parts and was preferred to the slices
by both judges; C's draw gave 8, welded "several stories into themed bundles", and lost to the
slices by both. The difference between those two results is one call's luck, which is the most
important thing this run found. It also means **C's loss on the book is not evidence about
summaries written later**: it lost on its outline.

**On the short web page the single call was better and cost less.** 143 blocks is not a long
document, and the staged shape has nothing to offer it but a faster finish (32 against 68
seconds).

## What it means for the plan

1. **Stage 1a comes first**, as the plan review already had it, and this run is the evidence:
   4 of 14 staged runs lost everything to one call's bad answer. Whether 1b (a tree plain in
   parts) is also needed, this eval does not say.
2. **B's per-part round should lose its `verdict` and gain a strict schema.** That addresses
   seven of the sixteen refused answers and one of the four lost runs: worth doing, and not most
   of the problem. It is a prompt change, so it is measured.
3. **The first call needs work before the shape is adopted**: it under-divides long books. Its
   prompt says to make each part one whole chapter or division; the model gave 8 parts for 135
   chapters, and 8 or 15 for a collection of twelve stories. The next measurement is that call
   alone: three draws on each of four documents, for the present prompt and one revision, is 24
   calls, about $17 at $0.70 each before re-asks, scored on whether the parts are the author's
   divisions.
4. **Summaries later (C) goes to the back of the queue; it is not ruled out.** The titles do
   arrive sooner (58 against 78 seconds on the paper, 100 against 136 on the book) and the
   finished tree does not. But the comparison was confounded by the outline each arm happened to
   draw. Testing it properly means giving B and C the same frozen outline.
5. **Whether the staged shape should also take documents under the line** is a product
   trade-off for Greg, not settled here: on the 160-page paper it was better, nearly twice as
   fast and nearly twice the price ($0.87 against $0.45); on Moby-Dick the judges split; on a
   short page it was worse.

## What this does not show

- Any rate. One run per cell; the instability finding comes from two draws that happened to
  share a prompt.
- Anything past 3,053 blocks. The joined document has no finished cell.
- Anything about a second long book. Both past-the-line documents are one story collection.
- Stability of the slices themselves across runs (A was run once per book).
- Cost with caching made equal across arms.
- What a reader waits: loading and delivery are not in the times.
- The judges' agreement with a human reader. They agree with each other on 9 of 12 overall
  verdicts.

## To run it again

```
npx tsx evals/long-structure/dry.ts                                   # free: the harness checks itself
npx tsx evals/long-structure/run.ts all --cap-usd 40 --runs 1         # the matrix and its judging
npx tsx evals/long-structure/run.ts report --name matrix              # the table, from stored cells
```

Results are under `evals/results/long-structure-2026-10-05/` (`smoke/`, `matrix/`, `dry/`): one
file per document, arm and run, one per judgement, and the ledger. A run resumes; a finished cell
is never bought twice. Delete a cell's file to buy it again.
