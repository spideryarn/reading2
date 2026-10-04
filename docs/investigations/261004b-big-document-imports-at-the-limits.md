# Big document imports, at the limits we state

Up: [investigations.md](../project/investigations.md)

Measured 2026-10-04 on the box, for report `spya-bac46a`. The plan is
[261004f](../plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md);
the raw results are in
[`evals/results/big-imports-2026-10-04/`](../../evals/results/big-imports-2026-10-04/).

> We've had issues loading big PDFs and documents. Can you run some evals or tests to make sure
> that things are working robustly for big ones up to our limits, basically.
>
> — Greg, 2026-10-04

## What was asked

The upload dialog promises: *"PDF or web page, up to 50 MB. PDFs up to 250 pages."* Does an import
at those numbers work?

## The short answer

**Not yet. 50 MB works; 250 pages does not, for most real documents.**

- A real **45 MB**, 160-page, figure-heavy paper imported end to end in under six minutes for
  $0.87, with no retries. Its article loads.
- A real **250-page** book was transcribed (three minutes, $0.65) and then **refused at the
  structure step**, with a sentence saying a retry will not help. The reader gets nothing.
- The cause is one ceiling: the structure step asks a model for the whole table of contents in one
  answer, and refuses before asking when the answer would not fit. That happens at about **2,890
  blocks** (a block is a paragraph, heading, quote or figure). The book came to 3,112.
- Two plain bugs found on the way are fixed, and one limit that was stated wrongly in the code is
  corrected. They are listed under § What was fixed.

## How it was measured

Two instruments.

**A free harness**, [`scripts/eval-big-imports.ts`](../../scripts/eval-big-imports.ts), which
builds made-up documents around the limits and runs every part of an import that needs no model:
the budget arithmetic (calling the real request builders), the Postgres store, the blocks step,
the PDF front half, the fetch cap. It can show a deterministic failure. It cannot show a bad
transcription or a bad model answer.

```
npx tsx scripts/eval-big-imports.ts --only m1,m3,fetch
npx tsx scripts/eval-big-imports.ts --only m2,m5
npx tsx scripts/eval-big-imports.ts --only m4
```

**Two real PDFs, paid**, through `npm run ingest` on the local stack, at commit `e8fa927c4`:

- Cory Doctorow, *With a Little Help* (CC BY-NC-SA), cut to exactly 250 pages: 0.8 MB, 113,059
  words.
- Bronstein et al., *Geometric Deep Learning* (arXiv 2104.13478): 160 pages, 45.09 MB, heaviest
  page 16.7 MiB.

**Spend: $2.15 in all** (270 calls, read from the local `ai_calls` ledger): $1.53 for the two
imports and $0.62 for the labels step on the one that published. The cap was $10.

## Where a long document stops

Each row is a ceiling, in the order a growing document meets it.

| What stops | At | What the reader sees | Now |
|---|---|---|---|
| Structure, one answer for the whole tree | 2,890 blocks of prose with no headings; or about 322 headings | "This article is longer than this step can handle in one go… [ai-too-long]". No Retry. Transcription already paid for. | **Open. Greg's decision**, below. |
| Relations (a reading mode, after import) | about 2,930 paragraphs | the same sentence, on that mode | Open, same cause |
| The article response, against Vercel's 4.5 MB | about 3,200 blocks of plain prose; lower with gists and labels | not measured on Vercel | Open, queued |
| The block insert | 3,856 blocks exactly | "blocks did not finish… trying again is worth a go" (it was not) | **Fixed** |
| A document fetched by address | 32 MiB, not the 50 MB stated | "That page is over the 32 MB limit." | **Fixed** later the same day: one 50 MiB limit for both, [261004k](../plans/261004k-one-size-limit-for-an-upload-and-an-address.md) |
| One PDF page too heavy for one request | 30 MiB encoded (about 22 MB raw), for a page plus the page before it | "[pdf-chunk-big]", no Retry | **Fixed** to 40 MiB, and the page before is dropped when it is the cause |
| The page cap | 251 pages | refused in under two seconds, with both numbers | Works |
| The byte cap on an upload | 50 MiB + 1 byte | refused in the browser | Works |

### What 2,890 blocks is, in pages

It depends on the document, which is why "250 pages" cannot be promised today:

| Kind of document | Blocks a page | Pages before structure refuses | Source |
|---|---|---|---|
| A book of fiction, with dialogue | 12.4 | about 230 | measured: the Doctorow cut, 3,112 blocks in 250 pages |
| A dense journal paper | 14.4, and 1.8 headings | about 178 (the headings get there first) | Kuhn, 142 pages, 2026-09-04; boundary by bisection |
| A paper heavy with figures and maths | 6.4 | about 450 | measured: Geometric Deep Learning, 1,025 blocks in 160 pages |
| A book of long paragraphs | about 5 | about 580 | a guess: *The Order of Time* was 1,041 blocks, pages unknown |

So the documents that reach 250 pages safely are the sparse ones. A novel and a long journal paper
do not.

## The real PDFs

| | 250-page book | 45 MB paper |
|---|---|---|
| fetch | 2.3 s | 4.1 s |
| extract | 166 s, $0.65, 43 chunks | 189 s, $0.48, 36 chunks |
| blocks | 12.5 s, 3,112 blocks | 5.7 s, 1,025 blocks |
| structure | **refused before the call**, $0 | 88 s, $0.37, 52 sections |
| assets | never ran | 57 s, $0.02; 28 of 58 figures stored |
| labels (its own job, after) | never ran | 86 s, $0.62, 910 paragraphs labelled |
| result | no article | published; response 0.96 MB (21% of 4.5 MB) |

Three things in those runs that nobody was looking for. Each is an observation, with its cause not
traced:

- **Almost every chunk is asked more than once.** 43 of 43 chunks on the book and 31 of 36 on the
  paper were asked again, so about two thirds of the transcription calls are second and third
  attempts.
- **Under half the chunks are checkpointed** (18 of 43, and 19 of 36). A checkpoint is what lets a
  retry skip a chunk already paid for. So a long PDF that fails late re-buys more than half of its
  transcription on a retry.
- **Half the paper's figures were not stored** (30 of 58).

Transcription was also far cheaper than the code's comments say: about $0.26 per 100 pages for the
book, against "roughly a dollar per hundred pages" in `src/uploads.ts`. Neither import came near
the 740-second window.

The largest request either document made was 22.8 MiB. So the new 40 MiB allowance has still not
been tried against the provider above 32 MB.

## What was fixed

All on `dev`, plan stage 2, each seen failing first.

1. **A long article's blocks are written in batches.** One SQL statement can carry 65,535 values
   and a block uses 17, so the 3,856th block failed with an error that read like a network blip.
   4,000 and 6,000 blocks now store and load in order. `src/db/insert-batches.ts`.
2. **The request allowance for a PDF chunk is 40 MiB, and belongs to the model.** It was 30 MiB,
   a number written for a model we no longer use; a real 9-page paper was refused over it on
   2026-09-28. Changing the reader model now fails the typecheck until its allowance is written
   down.
3. **A chunk that is too big only because of the page sent before it as context goes without that
   page.** What it costs: a paragraph that runs across that one page break comes out as two. A page
   too big on its own is still refused.
4. **A test that holds the stated limits against the code**, `tests/stated-limits.test.ts`. It pins
   the structure ceiling and says in its title that 250 pages is a known gap, so whoever moves a
   cap or a budget meets the other one.

## What was decided, and what is Greg's

**Nothing was built for the structure ceiling.** Every way out changes what a reader is promised or
is real engineering, so the options are in the plan,
[§ The decision this will probably end on](../plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md#the-decision-this-will-probably-end-on),
and on `awaiting-approval.md`. The recommendation, with GPT Sol's agreement: **D first** (when one
answer will not fit, build the tree from the document's own headings with no model, so the reader
can at least read what they paid to transcribe), **then E** (fill that tree in, a section at a
time, with the cascade that is already built and switched off).

**The 32 MB cap on an address** is a defence listed in `security-map.md`, so it was measured and
left. Either the cap goes to 50 MB or the dialog says two numbers.

## Ruled out, and not measured

- **The store as a ceiling.** After the fix it takes 6,000 blocks; nothing else on the import path
  has the same shape (GPT Sol and a second read agree).
- **More chunks than the concurrency limit.** 250 pages plan 42 or 43 chunks against a limit of
  100.
- **The blocks step.** Slightly worse than linear, 11 s at 4,200 blocks and 30 s at 6,300; not a
  failure at any size structure accepts.
- **Memory.** Peak 894 MB on the box for a 48.5 MB PDF. Vercel's ceiling for our functions is not
  set in `vercel.json` and was not measured.
- **Not measured:** whether Vercel really refuses a 4.5 MB article response (the size was measured,
  the refusal was not); the labels budget, which is private to the live call; a model call that
  hangs (no call has its own time limit, so one uses a whole 740 s window); production's own record
  of failed imports, which this session could not read.

## Follow-ups

In the Overseer's queue, each naming this report:

- `qi-kbkbw4rp`: the structure ceiling. Waiting on Greg.
- `qi-bv9nbj5z`: the 32 MB cap on an address against the stated 50 MB. Greg answered the same
  day, and it is built: [261004k](../plans/261004k-one-size-limit-for-an-upload-and-an-address.md).
- `qi-sbytr395`: the article response against Vercel's 4.5 MB.
- `qi-astc8qqs`: the transcription observations (chunks asked twice, checkpoints on under half,
  figures not stored, the untried 40 MiB allowance, the stale cost comment).
