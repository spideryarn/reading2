# One size limit for an upload and an address

Queue item `qi-bv9nbj5z`. Parent: [plans.md](../project/plans.md). It follows from
[261004f](261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md), items F1
and "Not built".

## What is wrong

The upload dialog says "PDF or web page, up to 50 MB". That is true of a file you choose
(`MAX_UPLOAD_BYTES` in `src/uploads.ts`, 50 MiB). A document fetched by address stops at 32 MiB
(`DEFAULTS.maxBytes` in `src/fetch.ts`), a second number typed in a second place. Measured
2026-10-04: 32 MiB + 1 byte and 50 MiB are both refused with "That page is over the 32 MB limit".

## Greg's decision

> make them consistent (and perhaps reuse the same protection-machinery)
>
> — Greg, 2026-10-04, answering [Q-url-size-cap]

## What exists today (read 2026-10-04)

There are two size guards and they are not the same strength.

| path | guard | how it counts |
| --- | --- | --- |
| address | `readCapped` in `src/fetch.ts` | counts bytes as they arrive, cancels the socket at the first byte over |
| upload | `get` in `src/store/blobs-supabase.ts` | refuses on `Content-Length`, then `res.arrayBuffer()` reads the **whole** body and checks the length afterwards |

The upload guard has a second line in front of it (`store.head` in `acquireUpload`, and Supabase's
own `file_size_limit`), so it is not known to be exploitable. But a body with no `Content-Length`
is buffered in full before the check, which is the weaker shape.

The job card: `FetchFailure` carries no `readerFailure`, so `readerFailureOf` in
`src/job-failure.ts` gives the fetch step's over-limit failure the generic "retry" sentence and
the card offers Retry. A retry fetches the same bytes and fails the same way. **To be shown by a
red test before it is believed.**

## The plan

One stage, three commits where practical.

1. **One number.** `DEFAULTS.maxBytes` in `src/fetch.ts` becomes `MAX_UPLOAD_BYTES`, imported from
   `src/uploads.ts` (which `fetch.ts` already imports from). No second literal. Red first: a test
   through `fetchDocument`'s `fetchImpl` seam with a body of exactly 50 MiB (accepted) and
   50 MiB + 1 byte (refused `too-large`, the sentence says 50 MB), with and without a declared
   `Content-Length`. Also a line in `tests/stated-limits.test.ts` that the two are the same value.
2. **One guard.** A leaf module `src/read-capped.ts` holds the streaming counter (the body of
   today's `readCapped`), taking the error to throw as an argument. `readCapped` in `src/fetch.ts`
   becomes a thin wrapper that throws `FetchFailure("too-large")`. `get` in
   `src/store/blobs-supabase.ts` reads through it instead of `arrayBuffer()`, so an oversized
   object is stopped at the cap rather than after buffering. Its `Content-Length` pre-check stays:
   that server is our own Storage, not a stranger's, and refusing before the transfer is free. Red
   first: a Storage response with no `Content-Length` and a body over the cap must be cancelled
   before it is fully read.
3. **The job card.** The pipeline's fetch step catches `FetchFailure` with code `too-large` and
   rethrows `stageFailure(FETCH_TOO_BIG, …)`, a new `blocked` sentence in `src/messages.ts`
   written beside `UPLOAD_TOO_BIG` and built from the same constant. No Retry is offered. Red
   first: a job whose fetch is over the cap is `blocked`, not `retry`.
4. **Docs.** `fetching.md` (the cap paragraph), `security-map.md` and `security.md` where they
   name the cap, `library.md` and the source comments that say "32 MB", `scripts/eval-big-imports.ts`
   sizes, and 261004f items F1, Decisions and "Not built" (Greg's answer quoted). The
   `awaiting-approval.md` line and the queue entry are the Overseer's to close.

## Is it still a defence

Yes. The cap stays a hard streaming cap on bytes that actually arrived. What changes is the number,
32 MiB to 50 MiB.

Memory: `readCapped` holds the chunks and then one joined copy, so the peak for a body at the cap
goes from about 64 MiB to about 100 MiB. An upload at 50 MiB already puts the same bytes through
the same pipeline after that point. This is a bounded increase and not a measured capacity:
Vercel's memory ceiling for a 50 MiB import is unconfirmed by either route (the plan review's F1
corrected an earlier sentence here that cited a measurement of a different paper as proof). Only the pipeline's
own document fetch uses the default; link previews (1 MiB), paper text (15 MiB), assets and the
bibliographic lookups each pass their own tighter cap and are untouched.

## The simpler option passed over

**Change the one literal and nothing else.** Passed over because Greg asked for the machinery to be
shared where it can be, and because the store's guard buffers before it checks. It is the fallback
if the reviewer finds the shared guard risky: commit 1 and 3 stand alone without 2.

## Not in this plan

Every other `FetchFailure` code (not found, forbidden, and so on) also reaches the job card as the
generic retry sentence. That is wider than this item and goes to the Overseer in the debrief.

## The plan review

GPT Sol, read-only, 2026-10-04: [the review](261004k-one-size-limit-plan-review-sol.md), verdict
**build with changes**, no P0 or P1. It confirmed that only the pipeline's document fetch relies on
the default cap, that the over-limit failure did reach the job card as a generic retry, and that
nothing depends on `arrayBuffer()` or on the store's error text. Three P2s, all taken:

- **F1**: the memory paragraph claimed a measurement proved safety. Reworded above and in
  `fetching.md`.
- **F2**: adapter-level tests for a broken stream (its own error, never "too large"), ordered
  chunks, exactly the cap, and no cap named. In `tests/one-size-limit.test.ts`.
- **F3**: two more places that stated the old number as current
  (`original-version/extraction.md`, `src/paper-text.ts`).

## Result

Built 2026-10-04 as planned, in one stage.

- `DEFAULTS.maxBytes` in `src/fetch.ts` is `MAX_UPLOAD_BYTES`. An address is accepted at exactly
  50 MiB and refused at 50 MiB + 1 byte, with and without a declared length.
- `src/read-capped.ts` is the one streaming counter. `readCapped` in `src/fetch.ts` and `get` in
  `src/store/blobs-supabase.ts` both read through it.
- `FETCH_TOO_BIG` (`[fetch-big]`, `blocked`) is what the job card shows. It was confirmed red
  first that the card offered Retry.
- `tests/one-size-limit.test.ts`: seven of its first eight tests were red before the change.

Not done here: every other `FetchFailure` code still reaches the job card as the generic retry
sentence (see § Not in this plan).
