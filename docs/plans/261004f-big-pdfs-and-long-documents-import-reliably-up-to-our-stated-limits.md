# Big PDFs and long documents import reliably, up to the limits we state

Up: [plans.md](../project/plans.md)

Report `spya-bac46a` (Sentry `SPIDERYARN-READING2-C6`), a problem, from Greg (admin, production row
proven by `feedback-reporter.ts`), 2026-10-04 10:33 UTC, filed from the home page. Queue item
`qi-p8jh7k2h`.

> We've had issues loading big PDFs and documents. Can you run some evals or tests to make sure
> that things are working robustly for big ones up to our limits, basically.

## What "our limits" are

The upload dialog says one sentence, from `uploadLimits()` in `src/uploads.ts`:

> PDF or web page, up to 50 MB. PDFs up to 250 pages.

So the promise is **50 MB** and **250 pages**. There is no stated limit on words or blocks, and a
web page has no page count, so a very long web page is promised only "up to 50 MB".

## What we already know, before measuring

A read-only survey of the code (2026-10-04, this session, by a subagent; every line below is a
**hypothesis until stage 1 runs it**, because nothing was executed):

1. **No test or fixture runs a large document through the pipeline.** The biggest committed PDF is
   17 pages; the biggest `blocks.json` is 141 blocks. The tests that mention 2,000+ blocks are
   arithmetic on the token budget. So "does a 250-page PDF import" has never been asked of the code
   since the cap went to 250 on 2026-09-04; the one long paper that has been run end to end is 142
   pages (Kuhn, 2,025 blocks, plan 260904b).
2. **A dense 250-page paper is refused at `structure`, after transcription is paid for.** The
   structure step asks for the whole tree in one answer, and refuses up front
   (`TooLongForOnePass`, shown as `[ai-too-long]`, no Retry) when its estimate of the answer plus
   64,000 tokens of thinking room passes the model's 128,000 output ceiling. That boundary is about
   2,890 blocks of headingless prose, or about 320 headings. Kuhn's density (14 blocks and 1.8
   headings a page) reaches it near 180 pages.
3. **The block insert is one SQL statement with 17 parameters a row.** Postgres' wire protocol
   allows 65,535 parameters, so about 3,856 blocks or more should fail at the `blocks` step with a
   driver error. Below the structure boundary for prose, but a long web page with no model step
   before `blocks` reaches it first.
4. **A PDF fetched by address is capped at 32 MB**, where an upload is capped at 50 MB, and the
   dialog's sentence covers both.
5. **One PDF page too heavy for one request** (about 22 MB raw, or a heavy page plus the previous
   page it carries as context) fails as `[pdf-chunk-big]`. Plan
   [260928b](260928b-pdf-chunk-too-big-for-one-request.md) wrote the fix and built nothing. (Built
   in stage 2 of this plan; see § Result.)
6. **No AI call has its own time limit.** A hung call uses a whole 740 s window, and a job gets
   three.
7. Smaller suspicions: the `blocks` step took 36 s on 2,046 blocks against a 5 s "worth starting"
   budget; `GET /api/article/:slug` returns the whole article as one JSON body with no size check
   against Vercel's 4.5 MB response limit; labels on 3,600 blocks is about 60 batches inside 700 s;
   250 pages may plan more chunks than `CHUNK_CONCURRENCY` (100); memory on a 50 MB scan.

Production's own record of which big imports failed was **not** read: an unattended session is
refused production reads (the classifier, three times on 2026-10-03). The past reports are the
evidence instead: `260903_1557` (142 pages against a 100-page cap), `260928b` (26.6 MB, 9 pages),
`261001_1829` (*The Order of Time*, 1,041 blocks, structure answer thrown away), `261003_1903`
(a transport blip).

## The plan review, and what changed

GPT Sol, read-only, 2026-10-04: [the review](261004f-big-pdfs-plan-review-sol.md), verdict
**build with changes**. It confirmed items 2, 3, 4, 5 and 6 above against the code, with exact
numbers: the structure call refuses at **2,890 headingless blocks** or **321 to 322 headings**, and
the block insert at **3,856 rows**. It found no second statement on the import path with the same
shape. Taken, finding by finding:

- **F1, the 32 MB fetch cap. Taken as a measurement, not as a fix.** The size cap in `src/fetch.ts`
  is a defence listed in [security-map.md](../project/security-map.md), and this run may not edit
  one. Stage 1 measures it through the `fetchImpl` seam; the mismatch with the dialog's sentence
  goes to Greg (see § Decisions). **Answered and built the same day**:
  [261004k](261004k-one-size-limit-for-an-upload-and-an-address.md).
- **F2, M4 cannot reach the 30 MiB request check**, because that check is inside the real reader
  and M4 swaps the reader out. Taken: M4 says so rather than copying the arithmetic. Stage 2 makes
  the check reachable by a free test and builds A and B of
  [260928b](260928b-pdf-chunk-too-big-for-one-request.md): raise the allowance to what the reader
  model takes, and send a chunk without its context page when the context page is what makes it
  too big. That plan asked Greg whether to build them; this report ("fix what fails" for big PDFs)
  is taken as the yes, and its trade-off is written again under § Decisions so he can undo it.
- **F3, "every confirmed failure gets a test that stage 2 turns green" cannot be met.** Taken.
  Three kinds of outcome now: a **regression test** stage 2 turns green; a **characterisation
  test** that pins a deliberate ceiling at its measured number, so moving it means facing the
  stated limit; and a **decision** that blocks the claim "works up to the limits" until Greg makes
  it.
- **F4, the labels budget is private to the live call.** Taken: marked not measurable in stage 1.
  Extracting it is stage 2 only if it is a pure move.
- **F5, M5 needs a published revision and cannot use sizes the store refuses.** Taken: M5 runs the
  whole write-and-publish lifecycle, and its large sizes are re-run after the batching fix.
- **F6, the figure step on an image-heavy PDF.** Taken if the seam is as simple as the review
  says; otherwise named as not measured.
- **F7, an option the plan missed.** Taken: option E below. And D is smaller than the plan said,
  because `src/heading-tree.ts` already builds a tree from a document's own headings.
- **F8, the paid run.** Taken: staged, with a stop rule, and it ends with the article being loaded
  through the real route, not at the last model step.

## The shape of the work

Greg asked for evidence first. So: **measure, fix what the measurement shows is broken and is
cheap to fix, and write up the rest as a decision** rather than build the hard version unasked.

### Stage 1: measure, with no paid model

One harness, `scripts/eval-big-imports.ts`, that builds synthetic documents at and around the
stated limits and runs every part of an import that does not need a model. It writes a results
JSON under `evals/results/` and prints a table. The measurements, each answering one question:

| | Question | How |
|---|---|---|
| M1 | At what size does each model step refuse before calling? | Synthetic block arrays on a grid of pages × density (blocks and headings a page: Kuhn's measured 14.4 and 1.8; a book's, from *The Order of Time*; a headingless one). Call the real request builders (`wholeDocumentRequest`, the labels, relations and per-mode budget functions) and record refuse or accept, and the estimated input tokens against the model's context window. |
| M2 | Does the store take a long document? | `writeArtefacts` and then `loadArticle` on the local Postgres at 1,000, 2,000, 3,000, 4,000, 6,000 blocks. Time, and whether it throws. |
| M3 | Does the `blocks` step scale? | Synthetic HTML of N paragraphs, headings, quotes and figures through the real `blocks` step. Time at 500 to 6,000 blocks; look for worse-than-linear growth. |
| M4 | Does the PDF front half cope at the caps? | Synthetic PDFs made with pdf-lib: 250 text pages; 251 pages (must be refused in seconds); a 250-page image-heavy one near 50 MB; one with a single 25 MB page. Run `refuseAnOverlongPdf`, `pass0`, `planChunks` and `runPdfExtract` with a reader that answers from the text layer (the seam the tests already use). Record chunk count, wall time, peak memory, and any refusal. |
| M5 | Does the reader get the article back? | The JSON body size of `GET /api/article/:slug` at each M2 size, against 4.5 MB. |

A synthetic document is not a real one: it cannot show a transcription fault or a bad structure
answer. It can show every deterministic failure, which is what items 2, 3, 5 and 7 are.

Done when: the table exists, every hypothesis above is marked confirmed, refuted or not measured,
and the confirmed ones each have a failing test under `tests/` (stage 2 turns them green).

### Stage 2: fix the deterministic failures

Expected, to be corrected by stage 1:

- **Batch the block insert** (and the identities insert) so no statement passes the parameter
  limit. Red test first: write 4,000 blocks.
- **Anything else stage 1 finds that is a plain bug**: a wrong budget number, a stale comment that
  states a size, a quadratic loop with a one-line fix.
- **A test that ties the stated limit to what the code can do.** One test file that reads
  `MAX_PAGES` and `MAX_UPLOAD_BYTES` and fails if a document at those numbers cannot pass a
  deterministic step, so the next change to a cap or a budget has to face the other.

Not in this stage: anything that changes a prompt, a model, or what a reader is promised.

### Stage 3: one real long PDF, end to end, paid

Synthetic documents cannot prove the model steps. So one real, public-domain or openly licensed
PDF near the limits, imported on the local stack with the ingest steps only (fetch, extract,
blocks, structure, assets; then labels), not the ten modes.

- **Which document is chosen after stage 1**, so the money buys information: a document stage 1
  predicts will pass (to check the prediction), sized as near 250 pages as that allows.
- **Spend cap: $10 in total for this plan**, stated in the write-up with the ledger's own figures.
  Kuhn's 142 pages cost about $3.50 end to end on 2026-09-04.
- **Staged, with a stop rule.** Extract first, and stop if it fails. Then blocks and structure, and
  stop if they fail. A second document of a different shape (heavy with images) only if the first
  left money and a question. The run ends by loading the article through the real route.
- If stage 1 predicts every 250-page document of ordinary density is refused, the run uses the
  largest size predicted to pass, and the write-up says the stated limit was not reached and why.

### Stage 4: write-up and bookkeeping

`docs/investigations/261004b-big-document-imports-at-the-limits.md` (what was asked, measured,
decided, ruled out; numbers with their date and command), the docs that own each changed fact, the
note in `docs/user-feedback/`, `feedback-endings.ts`, the queue.

## The decision this will probably end on

If stage 1 confirms item 2, the dialog promises 250 pages and a dense paper stops near 180. There
are four ways out, and **choosing between them is Greg's**, because each changes what a reader is
promised or costs real engineering:

- **A. Say the true number.** Lower the page cap, or add a second sentence, so nobody pays for a
  transcription that cannot finish. Cheapest; gives up long papers.
- **B. Refuse early.** Estimate the block count from the PDF's text layer before transcribing, and
  refuse in seconds with a plain sentence. Keeps 250 for sparse documents (books), still refuses
  dense ones, but for free. An estimate, so it will sometimes be wrong in both directions.
- **C. Build the tree in sections.** The top level from the document's own headings or from a
  first cheap pass, then each part in its own call. Removes the ceiling. The largest piece of work,
  and it changes the structure prompt path every article uses or adds a second path beside it.
- **D. A plainer tree for a too-long document.** When one pass will not fit, build the tree from
  the document's own headings with no model, and let the reader read. No gists at the top levels.
  Small, because `src/heading-tree.ts` already builds that tree, but a new, lesser kind of article.
- **E. D, then fill it in.** Start from the same headings-only tree and hand it to the cascade
  that is already built and switched off (`SPIDERYARN_DEEPEN_STRUCTURE`), which asks for each
  section in its own bounded call. More reuse than C. Turning the switch on alone does nothing for
  this case, because today the cascade only starts after the one big call has succeeded.

This plan builds none of A to E unless stage 1 shows one of them is a few lines and plainly right
(B's refusal sentence, for instance, if the estimate turns out to be exact). Otherwise the options
go to `docs/user-feedback/awaiting-approval.md` with the measured numbers, and a queue entry.

## Decisions

Filled in as they are made. Each is Greg's to overturn.

- **The 32 MB cap on a document fetched by address stays, and is not ours to move here.** It is a
  listed defence. The dialog's "PDF or web page, up to 50 MB" is true of a file you choose and
  false of an address you paste. For Greg, in `awaiting-approval.md`.

  **Greg overturned it, 2026-10-04**, answering [Q-url-size-cap]:

  > make them consistent (and perhaps reuse the same protection-machinery)

  So there is one limit, 50 MiB, from the one constant (`MAX_UPLOAD_BYTES`), and one streaming
  size guard shared by the fetch and the store's read. Built in
  [261004k](261004k-one-size-limit-for-an-upload-and-an-address.md).
- **A chunk whose context page makes it too big is sent without that page** (260928b's B). What it
  costs: a paragraph that runs across that one page break comes out as two. What it buys: the
  article imports instead of failing whole.
- **The structure ceiling: D first, then E.** Greg, 2026-10-04, answering [Q-long-documents] (the
  options A to E under § The decision this will probably end on, where the recommendation was D
  first, then E):

  > go with your recommendation

  So a document too long for one structure answer gets its tree from its own headings with no
  model (D), and that tree is then filled in a section at a time (E). The work is
  [261005a](261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md).

## The simpler option passed over

**Only write tests for the caps, no harness and no paid run.** Passed over because the report asks
whether big imports *work*, and the existing tests already check that an over-cap document is
refused. What nobody has checked is the document just *under* the cap.

**A full paid sweep of real PDFs at several sizes.** Passed over on cost and time (each is 10 to
20 minutes and dollars), and because the failures the survey found are deterministic and free to
find.

## Open questions

- Whether an estimate of block count from a text layer is good enough for option B. Stage 1's M4
  gives one data point per synthetic density; Kuhn's real numbers are the only real one.
- Vercel's memory ceiling for a 50 MB PDF is unconfirmed and cannot be measured from the box. M4's
  peak memory is recorded and compared with the function's configured memory, if it can be read
  from `vercel.json`; otherwise it is named as not measured.

## Result

All four stages ran on 2026-10-04. The write-up, with the tables, is
[the investigation](../investigations/261004b-big-document-imports-at-the-limits.md).

**The answer to the report: 50 MB works, 250 pages mostly does not.** A real 45 MB paper imported
end to end. A real 250-page book was transcribed and then refused at the structure step, which is
hypothesis 2 above, confirmed on a real document and wider than first thought: it catches an
ordinary book of fiction, not only a dense paper.

### Stage 1, measured (`e6c49cea9`)

`scripts/eval-big-imports.ts`. Hypotheses 2, 3 and 4 confirmed with exact numbers; the response
size (in 7) confirmed as a size, not as a Vercel refusal; "more chunks than concurrency" (in 7)
refuted; 5 not reachable through the test seam; 6 not measured. One accident: the harness's first
run published articles with labels pending, which queued four jobs on the shared local database;
two were claimed by another agent's worker and failed without spending. Cleaned up, and the
harness now writes a finished labels manifest so nothing is queued.

### Stage 2, fixed (`e8fa927c4`), reviewed (`27c21b8f0`)

- The block insert is batched (`src/db/insert-batches.ts`). 6,000 blocks store and load.
- 260928b's A and B: 40 MiB for the current reader model, tied to it by type; a chunk too big only
  because of its context page goes without it. `openRouterReader` takes an injectable wire, which
  is what makes the refusal and the send testable for free.
- `tests/stated-limits.test.ts` pins the stated limits against the code, the known gap included.
- [GPT Sol's code review](261004f-big-pdfs-stage-2-code-review-sol.md): **ship**, no P0 or P1, no
  changes made. Its three P2s are not fixed: F9 and F11 (which predates this work) are in
  `qi-astc8qqs` with the transcription observations; F10 (the harness can forget an unfinished
  cleanup on an interrupt) is accepted for a hand-run script whose normal path left zero rows.

### Stage 3, two real PDFs, $2.15 of the $10

A 250-page book: refused at structure, 3,112 blocks, nothing published, $0.65 spent. A 45 MB,
160-page paper: published, labelled, loads at 0.96 MB, $1.50. Both ran at `e8fa927c4`. Raw records
in `evals/results/big-imports-2026-10-04/stage3-*.json`. The two articles are left in the local
database as `s3-doctorow-250p-spya-sw2jbz` (a failed draft) and `s3-gdl-45mb-spya-cc9kr8`.

### Not built, and where each went

- **The structure ceiling**, options A to E above. Greg's. `qi-kbkbw4rp`, and a line in
  `awaiting-approval.md`. Recommended: D, then E. Greg chose that (§ Decisions), and D is built
  in [261005a](261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md).
- **The 32 MB fetch cap.** Greg's; a listed defence. `qi-bv9nbj5z`. Since built, on his answer
  (§ Decisions): [261004k](261004k-one-size-limit-for-an-upload-and-an-address.md).
- **The article response against 4.5 MB.** `qi-sbytr395`.
- **Chunks asked twice, checkpoints on under half, figures not stored, the untried 40 MiB.**
  `qi-astc8qqs`.
- **The labels budget as a pure function** (F4) and **a time limit on each model call**
  (hypothesis 6): not measured and not queued on their own; both are named in the investigation's
  "not measured" list.
- **Production's record of failed big imports** was not read.
