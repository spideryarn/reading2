# Figures arrive after a paper opens, and an open article re-reads itself

Status: **not built, and stopped on purpose** after GPT Sol's plan review, 2026-10-04: nine P1s, and
what is left after simplifying is too much machinery for 49 s off a 300 s import. See § Review
record, which says what a later attempt would have to carry. The text below is the plan as it was
reviewed. Parent: [plans.md](../project/plans.md). Answers [Q-open-early] of
[261004h](261004h-post-import-modes-decided-on-the-server-for-every-import-path.md) § Stage 2. The
measurements and the two options not built are in
[the investigation](../investigations/261004e-open-the-article-before-structure-and-assets-where-the-import-s-time-goes-and-what-deferring-costs.md).

> see if you can find a way to get to the article loading faster by deferring stuff, as long as the
> article will update automatically (without requiring a page refresh), and as long as it's not
> going to introduce too much complexity. use your judgment
>
> — Greg, 2026-10-04

## What this is, in one paragraph

An imported PDF waits for its figures to be recovered before it opens: 49 s of 300 measured locally,
92 s of 250 on production's paper. Nothing the reader needs to start reading is in that step. So the
import publishes with the figures marked *still to come*, a second job recovers them, and the open
reading view re-reads the article when that job ends, with no reload and without blanking the page.
A web page is unchanged: its images are fetched before it opens, as now.

## What was passed over

- **Opening after `blocks`** (no tree yet). Saves 25 of 31 s on a web page, which is most of the
  value, and has been planned and stopped twice. Priced in the investigation. Too much for *"not
  too much complexity"*.
- **Moving the whole `assets` step.** Saves under a second more and lets every new web article
  hot-link the publisher until the swap.
- **Making `assets` a sharing step**, so the modes run beside the figure recovery rather than after
  it. It qualifies (one whole column, reads only the blocks), but it touches the overlap policy and
  its tests. Not needed for the article to open sooner; the modes wait no longer than they do today.

## Stage 1: the server

**The step defers.** `assets` (`src/pipeline.ts` § `STEPS.assets`) fetches the web images as now.
Then, when the blocks carry PDF figure markers **and** this job is an import rather than a request
for `assets` itself, it does not call `recoverPdfFigures`; it writes the manifest with
`pdfFiguresPending: true` and no `pdfFigures`. A job whose step list is exactly `["assets"]` (the
successor, and the Metadata page's re-run) recovers in full and writes no such field.

- *An import rather than a request for `assets` itself* is decided from the job's own step list,
  which the builder must trace to the step (`StepContext` does not carry it today): a job that also
  runs an earlier step defers. That covers add, upload, Retry, Refresh, Rebuild, Start again and
  *Read this*, and the CLI's `ingest`, which is this queue.
- **A pending manifest is not current.** The step's `stamp` and the store's *is it current* arm
  (`src/store/pg.ts`, `case "assets"`) both answer no while `pdfFiguresPending` is set, so the
  successor runs rather than skips. This is the trap to prove with a test: a successor that skips
  reports success and the figures never arrive.

**The publication queues the successor**, in `publishRevisionIn` (`src/store/pg-revisions.ts`),
beside the `labels` one and for its reason: `enqueueSuccessorIn(tx, { steps: ["assets"] })` when the
published draft's manifest is pending **and the publishing job itself ran `assets` among other
steps**. The second clause is what stops an article whose successor died from buying another on
every later mode publication; the way back from that is the Metadata page's re-run of `assets`,
which exists.

**Order**: figures, then labels, then the main modes. All are stamped in the one transaction:
`assets` at `now()`, `labels` after it, the modes after whichever of the two exist (`notBefore`, as
261004h stage 1 does for labels). `assets` is exclusive, so labels and the modes start when it ends,
which is no later than today, when they start after the whole import.

**Cost**: unchanged. The locator calls are written to `ai_calls` against the successor's job. A
successor reserves nothing.

**What a failure looks like.** `recoverPdfFigures` records a reason per figure rather than throwing,
so a successor that finds nothing still clears the pending mark. Only a job that dies or is stopped
leaves it, and then the figure note says the pictures have not been fetched, with the re-run on the
Metadata page.

## Stage 2: the open page

**A re-read that does not blank the page.** `useArticleAccess` (`src/web/article/access.ts`) gains a
second way to ask again beside `attempt`: a refresh that starts a new load, waits for the *finished*
answer (prose and images, the second draw), swaps it in with one `setAnswer`, and only then releases
the previous load's blob URLs. It never sets `LOADING`, never shows the blanked-images first draw,
and on any failure keeps what is on screen. A slug or reader change during it discards it, by the
`live` guard already there.

**The signal is the existing one.** In the owner's reading view,
`useStepFinished(slug, "assets", refresh)`: the jobs poll already announces a job that newly ends
`done` (`src/web/jobEngine.ts`), and Glossary, Quotes and Citations hang their narrow re-reads on
it. No new channel, no revision check, no timer.

**And `labels` gets it too**, one more line: `useStepFinished(slug, "labels", refresh)`. Paragraph
labels then arrive in an open Structure without the reload 260906a shipped with. The tree's shape
does not change when labels land, so node ids hold. If the browser check shows this disturbing an
open band, it comes out and stays reload-only.

**While it is pending**, a figure shows its caption and a short line that the picture is still
being fetched (`PdfFigureNote.tsx`), never the *couldn't recover* wording.

**Known limits, stated rather than fixed:**

- A visitor to a shared paper runs no jobs and hears none. They see captions until the owner's
  browser has run the successor, and the pictures on their next load.
- With every tab closed the successor waits, as `labels` does.
- Pictures arriving above the reader's place move the page. Chrome and Firefox anchor the scroll;
  Safari does not. Their size is not known before recovery, so no box can be reserved.
- A job finished in another tab while this one's engine is idle is not heard
  (`useStepFinished`'s documented limit).

## Tests, red first

- **Step** (`tests/`, no model): with markers and a multi-step job the step calls no recovery and
  writes `pdfFiguresPending`; with `["assets"]` it recovers and the field is gone; without markers
  nothing changes.
- **Freshness**: a pending manifest answers not current from both the stamp and the store's arm, so
  the successor's step runs. Mutation: make pending read current, see the test go red.
- **Publication**, real Postgres, beside `publication-enqueues-the-labels-successor.test.ts`: a
  pending import queues one `["assets"]` job, stamped before `labels` and before every mode; a web
  import queues none; a mode job publishing a still-pending manifest queues none; the successor's
  own publication queues none.
- **The open page** (`tests/*.test.tsx`): a mounted owner's reading view whose article has a pending
  figure; an `assets` job for the slug is announced done; the article is fetched again and the
  figure is drawn; **the hook never returned `LOADING` in between** and the prose element is the
  same DOM node before and after. A failed re-read leaves the first article up. An `assets` job for
  another slug does nothing.
- Mutations at the end: drop the *publishing job ran assets* clause; make the refresh call
  `setAnswer(null)`.

## Browser check (Sonnet subagent, Playwright, local stack)

At 1280px and 390px: import a PDF with figures; the reading view opens with captions and the
*still being fetched* line; without touching the page, the pictures appear; the scroll position
set before they arrive is on the same paragraph after; Structure's paragraph labels fill in the same
way. Import a web page with images: it opens with its images, as before. Time both from paste to
open.

## Docs in the same stages

`article-images.md` (the step defers; what pending means), `ingest-queue.md` (the successor and the
order), `web-client.md` or `reading-view-overview.md` (the re-read, as the shared way an open
article takes later work), `structure-step.md` (labels no longer reload-only, if it stays),
the comment in `src/sharing-steps.ts` that says `assets` changes what every mode reads (it does not),
`help-page.md` if the help says anything about figures or waiting, and 261004h § Stage 2's status.

## Review record

**GPT Sol on the plan** (commit 473941e1d, read-only, exit 0, answer file fresh):
[plan-review-sol](261004l-figures-arrive-after-a-paper-opens-and-an-open-article-re-reads-itself-plan-review-sol.md).
Verdict *build with changes*, nine P1s. The server half held: passing the job's declared step list
survives a handed-back claim, a pending manifest failing both freshness checks makes the successor
run, and the trigger does not loop. The rest did not:

| | What was wrong with the plan |
|---|---|
| F1 | A figure job that ends while the article is still loading is never announced, so the page stays on captions for good. The listener has to exist before the read starts, and reconcile. |
| F2 | *On any failure keep what is on screen* does not follow: a failed image delivery resolves successfully with fewer pictures, so a re-read can remove a figure the reader is looking at. |
| F3 | An open image lightbox holds a copy of the old blob URL, which the re-read revokes. |
| F4 | Two re-reads close together have no order, and releasing the old load after `setAnswer` is before the swap has been drawn. |
| F5 | A Rebuild forces `assets`, so recovered figures would be replaced by *pending* and vanish until the second job ends. |
| F6 | Start again queues its regenerations on a separate path, which the order has to cover too, by the holder's job id. |
| F7 | *The publishing job ran assets* cannot be read as a finished step off the job row: the row still says running at publication. |
| F8 | A CLI import drives only its own job, so figures would wait undriven, and the `labels` command it prints would stall behind them. |
| F9 | An open Illustrated band would go on saying it is current after the figures land. |

Each was checked against the code it names. None was wrong.

**Why stop rather than fix.** Dropping the `labels` re-read and deferring only when the draft
carries no earlier manifest removes F2, F3 and F5 and most of F4. What is left is still a step with
three or four conditions on when it defers, a new publication trigger, two freshness arms, an
ordering rule across three kinds of successor, a re-read with its own ordering and a reconciliation
for the loading window, a pending note, and an Illustrated revalidation: about a dozen files and
several states that are each silent when wrong. That buys 49 s of a 300 s import locally (92 of 250
on production's one paper), nothing on a web page, a visitor who never sees the update, and pictures
that push the page about when they land. Greg's second limit was *"not … too much complexity"*, and
he said stopping with the numbers is a fine outcome.

**The cheaper thing that was measured instead**: making figure recovery itself faster, with no
deferral. It saves 9 to 21 s. The numbers and what it would take are in the investigation, § *Making
figure recovery faster*. Not built either; it is 3 to 7% of the wait.

**If this is picked up again**, the order of work is: the no-blank re-read first and by itself, as
its own plan with F1 to F4 as its requirements, because Rebuild's *"Reload the page"* and the
reload-only `labels` want it whatever happens here. Deferral is small once that exists.
