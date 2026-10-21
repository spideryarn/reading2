# Four-hundred-page imports, measured

Up: [investigations.md](../project/investigations.md)

Measured 2026-10-20 on the box, as stage 1 of
[261020b](../plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md), before
anybody raises the page cap. The method is
[261004b](261004b-big-document-imports-at-the-limits.md)'s. Raw results are in
[`evals/results/four-hundred-pages-2026-10-20/`](../../evals/results/four-hundred-pages-2026-10-20/).

## What was asked

If `MAX_PAGES` went from 250 to 400, would a 400-page PDF import, and would its article load? The
plan's worry was the article response passing Vercel's 4.5 MB limit on a dense document.

## The short answer

**Not yet. `MAX_PAGES = 400` is not safe today, and the article response is not the reason.**

- **An ordinary book loads at 400 pages.** Lessig's *Code v2* imported in about 10 minutes for
  $2.46 with labels. Its article response is 3.1 MB, 69% of 4.5 MB.
- **A dense document loads at 400 pages, but only just, and not on the first try.** Real
  conference proceedings, at about 580 words a page: the response is 3.7 MB without paragraph
  labels and about 4.0 MB with them (88%). But transcription needed two of its three time windows
  and finished with 5 seconds to spare. And the first cut never imported at all: one page failed
  transcription twice in the same way.
- **A maths-heavy book does not load at 400 pages.** All three transcription windows ran out, and
  each one bought almost every chunk again. At 250 pages the same book loaded on its third and last
  window with 24 seconds left. **So today's 250-page cap is already marginal for this kind of
  document.**
- **What actually limits length is the transcription step**, not the response size. Every 740-second
  window has to finish, or save enough work for the next window to carry on from. On these documents
  it does neither reliably (see § Why transcription is the limit).

Largest page count seen to load: **400** for the book and for the dense proceedings (the latter
only after one page was cut out); **250, with 24 s to spare**, for the maths book.

## How it was measured

At commit `e97877409`, with `MAX_PAGES` set to 400 in the worktree for the run and then set back. It
was never committed. Each PDF was cut to its pages with pdf-lib, as 261004b did, and imported with
`npm run ingest -- <file>` against the local Supabase (`127.0.0.1:54362`, from every script's
`Target:` line). Labels were run afterwards, as their own job. Time per step comes from the job log.
Cost comes from the local `ai_calls` ledger, using the query in `results.json`.

**The response size** is `JSON.stringify(loadArticle(slug))` run as the owner, which is exactly the
body `GET /api/article/:slug` sends (`src/routes.ts` § `send`). It is uncompressed: gzip is about a
fifth of it. Whether Vercel really refuses a larger body was not measured, as before.

| Document | Licence | Pages | Words | Source |
|---|---|---|---|---|
| Lessig, *Code: Version 2.0* | CC BY-SA 2.5 | 424, cut to 400 | 176,150 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/Special:FilePath/Code_v2.pdf) |
| Roberts, Yaida & Hanin, *The Principles of Deep Learning Theory* | arXiv | 471, cut to 400 and 250 | 174,761 / 107,594 | [arXiv 2106.10165](https://arxiv.org/pdf/2106.10165) |
| WASSA 2023 workshop proceedings | CC BY 4.0 | 638, cut to pp. 1–400, then pp. 29–428 | 233,551 | [ACL Anthology](https://aclanthology.org/2023.wassa-1.pdf) |

**No Doctorow novel reaches 400 pages.** His CC PDFs are 134–299 pages, so the ordinary book is a
CC non-fiction book.

**Spend: $12.38 in all** (1,677 calls), against the $10–15 approved.

## The numbers

| | Code v2, 400 pp | Proceedings, 400 pp | Maths book, 400 pp | Maths book, 250 pp |
|---|---|---|---|---|
| extract | 502 s, $0.41, 68 chunks, 1 window | 740 s + 735 s, $1.00, 88 chunks, 2 windows | 3 × 740 s, $1.94, 68 chunks: **failed** | 740 + 740 + 716 s, $1.23, 43 chunks |
| chunks saved for the next window | 50 of 68 | 44 of 88 after window 1 | 1, then 1 | 1, then 2 |
| longest single model call | 465 s | 595 s | 727 s | — |
| blocks | 17 s, 2,702 | 43 s, 3,911 | — | 16 s, 2,680 |
| structure | 38 s, $0.65, one call (no slices) | 68 s, $1.24, **4 slices** | — | 93 s, $1.57, one call |
| assets | 31 s, $0.01 | 98 s, $0.01 | — | 35 s, $0.01 |
| labels | 153 s, $1.38, 2,200 paragraphs, inside 700 s | **failed** at 183 s, $1.88 (not time: see below) | — | not run |
| import wall time | 10 min | 28 min | 37 min, then error | 39 min |
| import total | $2.46 with labels | $4.18 with the failed labels | $1.94 for nothing | $2.81 without labels |
| article response | **3.11 MB** with labels (69%) | **3.71 MB** without labels (82%); about **3.96 MB** with (88%) | — | 2.26 MB without labels |

In the response, the prose is carried twice, once as `text` and once as `html`. In *Code v2* that
is 1.08 MB and 1.22 MB of its 3.1 MB. A paragraph label adds about 104 bytes. So the response grows
with the number of words, about 14 bytes a word, plus about 300 bytes a block for the tree. Labels
add a little more. **By extrapolation, not measurement:** proceedings this dense would reach 4.5 MB
at about 450 pages. A two-column document with no figures, at about 800 words a page, would reach
it at about 320 pages.

## Why transcription is the limit

The chunks run side by side (68–88 of them, under a concurrency limit of 100). So a window's length
is set by its slowest chunk, not by the number of pages. And the slowest chunks are slow: a single
transcription call took up to 727 seconds, and 4–29 calls per document took over 300 seconds. No
single call has a time limit of its own. Three things then go wrong at once:

1. **A window that runs out keeps only part of its work.** A chunk is saved for the next window
   only if it passed its check without being re-read page by page (`src/pdf-read.ts` §
   `keepChunk`, the two calls in `runPdfExtract`). A chunk that was re-read, or that never passed,
   is kept only after the final pass over all the chunks. A window that runs out never reaches
   that pass. On the maths book about 1 chunk in 68 was kept per window, so every window paid for
   the whole book again. This is 261004b's *"under half the chunks are checkpointed"*
   (`qi-astc8qqs`), which turns out to be what makes a long maths document fail.
2. **Three windows is the limit** (the first window plus `REQUEUE_BUDGET = 2`, `src/jobs.ts`). The maths book at 250 pages
   finished on its third window only because that window happened to be quick.
3. **The reader is then told something untrue.** The maths book's job ended `[jb-gone]`:
   *"whatever was running it did not come back … trying again picks up where it left off"*. In
   fact it ran out of windows, and trying again would buy 67 of 68 chunks again.

## Other failures, each recorded rather than fixed

- **One page can sink a 400-page import.** Page 28 of the proceedings failed its source-page check
  twice (`[ai-pdf-incomplete]`). The reader's *Try again* (`retryJob`) failed on the same page
  after 201 s and $0.36 more. The sentence says *"Trying again may produce a usable reading"*. Here
  it did not. This has nothing to do with length, except that a longer document has more pages
  that can fail.
- **Labels on the proceedings failed in the same way twice.** One batch asked for 38 labels and got
  39, then did so again. The whole step fails on that one section, and the published article says
  labels failed. A retry made the same mistake (20 s, $0.05), although the sentence says *"trying
  again is worth a go"*. It finished well inside its budget, so 400 pages is not a time problem for
  labels.
- **`npm run labels` after an ingest waited "busy" for ten minutes and gave up.** The ingest queues a
  `matter` job and a `labels` job after itself. The command was handed the already-queued labels
  job, and that job waits behind the `matter` job, which nothing drives. Driving the `matter` job
  by its id cleared it. 261004b got round the same thing by cancelling the queued jobs. The hint
  that `scripts/stage.ts` prints (*"`npm run labels -- <slug>` generates them now"*) therefore
  does not work straight after an ingest.

## What this means for 261020b

- **Keep `MAX_PAGES` at 250 for now.** At 400, an ordinary book works, a dense one works only
  narrowly, and a maths-heavy one fails after charging for three windows.
- **What would make 400 safe, in order of how much it would help:** save every chunk the moment it
  is usable, recovered ones included, so that a second window carries on instead of starting
  again; give one transcription call a time limit well under the window; then measure again with
  these same three documents. The article response at 400 dense pages (~4.0 MB) is close enough to
  4.5 MB that `qi-sbytr395` should be measured on Vercel before the cap moves too.
- **The plan's estimates, against what happened:** extract cost was lower than estimated ($0.41,
  not ~$1.05) and took longer (502 s, not ~270 s). The book did not need slices (2,702 blocks fits
  in one call). Labels took 153 s, not ~375 s. The response for the book was 3.1 MB, against the
  ~3.7 MB estimated.

## Left behind on the local stack

The five articles (`l400-codev2-…`, `l400-pdlt-…`, `l250-pdlt-…`, `l400-wassa-…`,
`l400b-wassa-p29-…`) are still in the local database, under the dev owner. The `matter` and `labels`
jobs queued after `l250-pdlt` were cancelled, so that a dev server's pump will not buy them later.
