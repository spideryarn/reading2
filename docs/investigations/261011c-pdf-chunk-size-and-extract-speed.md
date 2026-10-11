# Smaller PDF chunks, and how long a PDF takes to transcribe

Up: [investigations.md](../project/investigations.md). Measured 2026-10-11 on the box, for report
`spya-z3uz86`. The plan is [261011u](../plans/261011u-more-pdf-shards-faster.md); the raw results
and the scripts that produced them are in
[`evals/results/pdf-chunk-size-2026-10-11/`](../../evals/results/pdf-chunk-size-2026-10-11/).

> Do you think it would be faster to upload PDFs (especially larger ones) if we sharded even more?
> […] Would it be faster if we broke them up into even more, so a higher concurrency?
>
> — Greg, 2026-10-11

## The short answer

**No — not by sharding more, and not by more concurrency.** Measured end to end on two long PDFs,
ten paid runs, $3.17:

- **More concurrency changes nothing** for the documents we see: up to 100 chunks are already sent
  at once, and a 250-page book plans about 43.
- **Smaller chunks were not reliably faster, and cost about 15% more.** Half-size chunks (3 pages,
  1,600 words) were **slower** on a dense 142-page paper (median 205 s against 149 s) and faster on
  a 250-page book in one of two runs (median 173 s against 209 s, inside the spread). The bar for
  changing the default was every half-size run beating today's median and the median 25% shorter;
  neither document met it.
- **Why the prediction was wrong.** Each smaller call is shorter, as predicted. But a smaller chunk
  fails its check and is asked again far more often (on the book, 70 of 88 chunks against 33 of
  43), and on a dense paper half-size planned 138 chunks, past the 100 that go at once, so a second
  wave waits behind the first.
- **What would make a big PDF faster** is the tail after the first wave, which is 40–70% of the
  step: chunks failing their check and being asked again one after another, then page-by-page
  recovery chains of 7–10 calls in a row. That is queue items `qi-astc8qqs` and `qi-az8tvrn4`, with
  the evidence below added to them. Nothing was changed in production.

## Higher concurrency is not the lever; smaller chunks might be

A PDF is cut into chunks of at most 6 pages and about 3,200 words, and up to 100 chunks are
transcribed at once (`CHUNK_CONCURRENCY`). The long documents we have measured plan 36 to 69 chunks,
so they already go out in one wave, and raising 100 would change nothing for them. (A dense
250-page PDF could plan more than 100, and would then go out in two waves.)

What "more shards" can change is the **size** of a chunk: half the pages per call, twice the calls.
Whether that helps depends on what a call's time is made of, and on what the step does after the
first wave.

## Stage 1: what the ledger already says (free)

Read-only, from `spideryarn.ai_calls`: production and the local stack, `purpose = 'pdf'`, calls made
since the width went to 100 (2026-09-04). **1,115 answered calls in 60 extracts.** No 429 and no
error row in any of them.

**A call's time is mostly its answer's length.** Duration ≈ 5.3 s + 6.5 s per thousand output
tokens (R² 0.65 overall, 0.77 on production alone). Input size explains little (R² 0.18). The
median call writes 4,339 tokens in 32 s. Half of that, 2,170 tokens, predicts 19 s: **0.58× the
time for half the chunk**, not 0.5×, because of the fixed ~5 s. The worst outlier does not fit the
model at all: Kuhn's image-heavy chunk took 171 s against ~40 s predicted, and a smaller word bound
does not shrink a call like that.

**About 40% of an extract happens after the first wave.** The ledger has no chunk id, but a re-ask
sends the same request, so its input token count matches the first call exactly. By that match,
**41% of first-wave chunks were asked again**, and the tail after the first wave is **43% of all
extract wall clock**. Its shape:

| extract | chunks | wall | first wave done | tail | what the tail was |
|---|---|---|---|---|---|
| Kuhn 142 pp, local, 09-04 | 69 | 246 s | 171 s | 75 s | one image-heavy chunk, then its re-ask |
| Kuhn 142 pp, local, 09-04 | 69 | 140 s | 84 s | 56 s | a re-ask |
| a production paper | 36 | 128 s | 64 s | 63 s | re-asks, 3 single-page recoveries |
| a production paper | 36 | 119 s | 48 s | 71 s | a chain of 8 single-page recoveries |
| Doctorow 250 pp, local, 10-04 | 43 | 149 s | 45 s | 105 s | a chain of 10 |
| Geometric Deep Learning 160 pp, local | 36 | 171 s | 62 s | 108 s | a chain of 9 |

The two Kuhn rows reproduce the 248 s and 142 s in the `CHUNK_CONCURRENCY` docblock, which checks
the method. A small paper (2–7 chunks) is almost always one call of 40–60 s and then one re-ask.

**The prediction.** Halving every chunk, with the same chance of a re-ask per chunk: rescaling each
extract's actual critical path gives **0.54×** today's wall clock (median; p10 0.48, p90 0.74); a
simulation that also gives twice the chunks twice the chances to be re-asked gives **0.63×**. So
on paper, **about 0.55–0.65 of today's time**: 30–40 s off a typical 80 s extract and 50–75 s off a
big one.

**What the prediction cannot know**, and stage 2 measures: whether a smaller chunk fails its check
more often or less (fewer pages to drift into summarising, but more seams and less context for the
check), and whether a recovery chain really halves with the chunk's pages.

The scripts are `stage1/dump.ts` (the read-only snapshot, reusing `scripts/cost-analysis.ts`'s
`readSnapshot`), `stage1/analyse.py` (the fit, the waves, the critical path, the prediction) and
`stage1/reask.py`. The dumped rows are not committed: they are production rows.

## Stage 2: measured end to end (paid)

[`scripts/eval-pdf-chunk-size.ts`](../../scripts/eval-pdf-chunk-size.ts) runs the real
`runPdfExtract` once per process (so the 429 gate starts at width 100 every run), with no
checkpoints, the real readers wrapped only to time each call, and its own slug so the local ledger
gives each run's spend. The chunk bounds come in through `PdfExtractOptions.chunking`, which
production never passes. Arms alternated: today (6 pages / 3,200 words) and half (3 / 1,600).

```
npx tsx scripts/eval-pdf-chunk-size.ts <file.pdf> <label> [--max-pages 3 --words 1600] --out <results.jsonl>
npx tsx scripts/eval-pdf-chunk-size.ts --ledger 'cs-%'
```

Documents: Kuhn, *A landscape of consciousness* (142 pages, dense two-column), and the 250-page cut
of Doctorow's *With a Little Help* used on 2026-10-04 (prose, dialogue).

| document | arm | runs | wall clock (each) | median | chunks | asked again (median) | pages recovered (median) | spend (median) | recall |
|---|---|---|---|---|---|---|---|---|---|
| Kuhn | today | 3 | 143, 161, 149 s | **149 s** | 69 | 5 | 4 | $0.27 | 0.994 |
| Kuhn | half | 3 | 230, 205, 132 s | **205 s** | 138 | 21 | 0 | $0.33 | 0.993–0.994 |
| Doctorow | today | 2 | 205, 212 s | **209 s** | 43 | 33 | 44 | $0.29 | 0.996–0.999 |
| Doctorow | half | 2 | 205, 142 s | **173 s** | 88 | 71 | 12 | $0.32 | 0.998–0.999 |

No 429 and no failed call in any run; the width stayed at 100. Peak memory 530–790 MiB, about 65
MiB more at half size on Kuhn. The front-matter and authors passes took 2–5 s a run and do not
matter here.

What the runs show:

1. **Half size trades recovery chains for re-asks, and ends up writing more.** On the book,
   page-by-page recovery fell from about 44 pages to 12, but whole-chunk re-asks doubled; total
   output tokens rose 10–25%. That, plus one system prompt per chunk, is the 15% on spend.
2. **A dense paper at half size goes past the width.** Kuhn's pages hold about 1,600 words, so the
   word bound gives roughly one page a chunk: 138 chunks, and those past the 100th wait for a slot.
   This is the case where higher concurrency would matter, and it only arises because the chunks
   were made smaller.
3. **Runs of one arm vary by up to 1.7×** (Kuhn half: 132 to 230 s), as the `CHUNK_CONCURRENCY`
   docblock found at 142 and 248 s. Three runs do not pin a small effect down; they do rule out a
   large one in the direction asked about.
4. **The book fails its check on most chunks at either size** — 33 of 43 today. Its tail after the
   first wave is 130–150 s of a 205–212 s step. That is the biggest single thing standing between a
   long PDF and a faster import, and it has nothing to do with chunk size.
5. **Recall did not move** (0.993–0.999) and record counts agree within 1%, so neither size is
   transcribing worse by that measure. Upstream cache reads varied a lot between runs of the same
   arm (39k tokens on the first Kuhn run, about 550k after), which moves spend, not time.

The raw rows, with every call's start and finish, are `stage2.jsonl` (one line per run; line 1's
`spendUsd` predates a fix in the script, and the ledger's $0.344 is the right figure) and
`stage2-ledger.json`.

## What was decided

Nothing changes in production. The chunk bounds stay at 6 pages and 3,200 words and the width at
100. The `chunking` option and the eval script stay, because they are how this gets re-measured
when the transcription model or the check changes: a model that fails the check less often could
change the answer, and the check's failure rate is the thing to fix first.
