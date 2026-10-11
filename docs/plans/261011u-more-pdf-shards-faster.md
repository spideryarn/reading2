# Would more shards make a big PDF transcribe faster?

Up: [plans.md](../project/plans.md). Report `spya-z3uz86` (SPIDERYARN-READING2-HB), queue item
`qi-sm55ckw9`. The measurement is written up in
[261011c-pdf-chunk-size-and-extract-speed.md](../investigations/261011c-pdf-chunk-size-and-extract-speed.md).

> Do you think it would be faster to upload PDFs (especially larger ones) if we sharded even more?
> My understanding is that we break PDFs up amongst up to some number of calls to the LLM that
> transcribes them, so it's a few pages at a time. Would it be faster if we broke them up into even
> more, so a higher concurrency?
>
> — Greg, 2026-10-11 (`spya-z3uz86`)

## What is true today, before measuring anything

The extract step (`src/pdf-read.ts`) cuts a PDF into **chunks** of at most 6 pages and about 3,200
words (`MAX_CHUNK_PAGES`, `CHUNK_WORDS`, plus a 3 MB byte bound), and sends up to
`CHUNK_CONCURRENCY` = **100** chunks at once. A 250-page book plans 42–43 chunks, a 142-page paper
69 ([261004b](../investigations/261004b-big-document-imports-at-the-limits.md)). So:

- **Higher concurrency, on its own, cannot help a typical document today.** The long ones measured
  so far plan 36–69 chunks, one wave at a width of 100. Raising 100 changes nothing below 100
  chunks. (Not *every* document: a dense 250-page PDF can plan more than 100 — GPT Sol F1.)
- **The only lever in the question is smaller chunks.** Smaller chunks means each call writes fewer
  output tokens, and a call's time is mostly the time to write its answer, so each call should be
  shorter. The open question is whether the *step* gets shorter, because the comment over
  `CHUNK_CONCURRENCY` measured that at width 100 the step is **tail-bound**: the slowest chunk,
  often one asked a second time after failing its check, decides the wall clock.
- What smaller chunks cost: a copy of the system prompt per chunk (no prompt caching on this path),
  one context page per chunk (the page before, sent as evidence), more seams where a paragraph can
  break, and more calls against the provider's rate limit.

## Stages

### Stage 1 — free: what the ledger already says

Read `ai_calls` for PDF transcription calls, production read-only and the local ledger. **Narrowed
after review (F2):** the ledger has no page range or chunk key, and `attempt` is the transport
retry, null on this path, so it cannot tell a first ask from a re-ask or a recovery. What it can
give is a call's duration against its output tokens, and each extract's spread of call durations.
That says whether a call half the size takes half as long.

Done when: the fit and the spread, in the investigation doc.

### Stage 2 — paid, capped at $12: measure it end to end

A small option on `planChunks` / `runPdfExtract` (`chunking`) so an eval can set the two chunk
bounds without editing constants; omitted, the plan is unchanged, and production never passes it.
An eval script, `scripts/eval-pdf-chunk-size.ts`, runs the real `runPdfExtract` with
`nullCheckpointStore()` and **one fresh process per run**, so the shared `WidthGate` starts at 100
every time (F4), and arms interleaved A B A B rather than A A B B (F7). It records, per run: the
step's wall clock; each chunk's finish time (from `onProgress`) so the first wave can be told from
the tail; chunks asked again and pages recovered; the front-matter and authors passes' time
separately (F3); spend and cache tokens from the ledger by slug; recall and quality notes; peak RSS.

Arms, in order of cost:

1. **Today (6 pp / 3,200 words) against half (3 / 1,600)** on Kuhn (142 pp, dense, 69 chunks
   today), three runs each; and on the 250-page Doctorow cut (prose, 43 chunks today), two each.
2. Only if half is faster: a third (2 / 1,100), which takes a 250-page book past 100 chunks and
   into two waves (F1), and the winner against today on a figure-heavy PDF, Geometric Deep Learning
   (arXiv 2104.13478, 45 MB), two each (F6). Otherwise the conclusion is stated for text-layer
   PDFs only.

Done when: the table, with spend, and a verdict in the investigation doc.

### Stage 3 — only if stage 2 says yes

"Yes" means all of: on both text documents, every run of the smaller size beats the median of
today's runs and the median is at least 25% shorter; spend no more than 25% higher; recall per page
no lower, and no more chunks refused or recovered (F5 — note counts alone are not comparable across
plans). Then change the constants and the comments that cite the old numbers, with a test over a
plan of more than 100 chunks and peak RSS measured on the largest (F9). Deploying it re-buys any
in-progress import's checkpoints, since their page ranges change. If the answer is no, nothing is
built and the write-up says what the real lever is (the re-asks: `qi-astc8qqs`, `qi-az8tvrn4`).

## The simpler option passed over

Answering from the arithmetic alone ("concurrency is already above any chunk count, so no"). It is
right about concurrency and silent about chunk size, which is what the question is really about,
and the `CHUNK_CONCURRENCY` comment's own history shows a confident sentence here being wrong twice.

## Risks

- **Rate limits.** At a third of today's size a 250-page book plans ~130 chunks, past the width of
  100, so it becomes two waves. `WidthGate` halves on a 429; the eval records any.
- **Cost.** Each run is about $0.25–0.65; the first arm is 10 runs, about $6; the cap is $12. Spend is read from the ledger.
- **Variance.** Re-asks are model variance; two runs a cell may still not separate a small effect.
  If they do not, the verdict says "not distinguishable", not "no".

## Log

- 2026-10-11: plan written. GPT Sol plan review
  ([261011u-…-plan-review-sol.md](261011u-more-pdf-shards-faster-plan-review-sol.md)): proceed with
  changes. F1–F9 all taken: the one-wave claim narrowed, stage 1 narrowed to what the ledger can
  say, fresh process per run and interleaved arms, a stricter quality gate, a figure-heavy PDF
  before any default changes, a >100-chunk test and RSS before stage 3. F8's cheaper isolated-call
  pilot is skipped: the end-to-end first arm is ~$6 and answers the real question directly.
- 2026-10-11: stage 1 done (free): a call is ~5 s + 6.5 s per thousand output tokens; ~43% of an
  extract is the tail after the first wave; predicted 0.55–0.65× at half size.
- 2026-10-11: stage 2 done ($3.17, ten runs): half size **not** reliably faster — slower on Kuhn
  (median 205 s against 149 s; 138 chunks, two waves), mixed on Doctorow (173 s against 209 s,
  inside the spread) — and ~15% dearer, because smaller chunks are re-asked far more often. The
  stage-3 bar was not met, so **stage 3 is not built**; the arm-2 runs (a third, and the
  figure-heavy PDF) were not needed to reach that and were not run. The write-up is
  [261011c](../investigations/261011c-pdf-chunk-size-and-extract-speed.md). What lands: the
  `chunking` option (production never passes it), `scripts/eval-pdf-chunk-size.ts`, and the
  evidence added to `qi-astc8qqs` and `qi-az8tvrn4`, which hold the lever that would work.
