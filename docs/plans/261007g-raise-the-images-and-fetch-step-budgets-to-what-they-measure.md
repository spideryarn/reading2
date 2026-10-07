# Raise the images and fetch step budgets to what they measure

2026-10-07. Builder: Claude (Opus), for the Overseer. Follows
[261007b § What is left](261007b-seventh-sweep-job-queue-tier-0.md#what-is-left), which reported
both numbers and changed neither.

> an import that fails because its images step outran 185 s against ~360 s real is a bug, not a
> choice — raise images and fetch to what the measurements say (with headroom, and the reasoning in
> the comment and the owning doc), red-first if a test can pin it; no need to ask Greg.
>
> — the Overseer, 2026-10-07

## The bug

`STEP_BUDGET_MS` (`src/jobs.ts`) is what the walk checks between steps: the next step starts only
if at least that much of the claim's 740 s deadline is left, and otherwise the claim is handed
back intact. The first runnable step starts ungated. `assets` was admitted on **185 s**, which
is `collectAssets`'s 180 s cap plus
unwinding. For a PDF the step then runs `recoverPdfFigures`, which has a second 180 s cap
(`PDF_FIGURES_BUDGET_MS`) whose clock starts only after the PDF has been read from storage. So the
walk could start `assets` after `structure` on a remnant the step was entitled to outlive; it then
met our deadline, the job paused and re-ran the step, and each pause spent one of
`REQUEUE_BUDGET`'s windows. Three, and the import ended interrupted.

`fetch` was 150 s against a step that can make three `fetchDocument`s of 110 s each.

## Where "about 360 s" came from

Arithmetic, not a measurement: 180 + 180, the two caps
([261007b](261007b-seventh-sweep-job-queue-tier-0.md) and its
[Sol review](261007b-seventh-sweep-job-queue-tier-0-code-review-sol.md)). It is right as the
step's *clock* ceiling, and the code comments themselves say the two halves are alternatives in
practice (a PDF's blocks carry no `<img>`, a web article has no figure markers). Nothing enforces
that, so the clock ceiling is the honest floor.

## Measured

`revision_step_runs`, only rows the step actually ran in that revision (`attempt_id is not null`,
so rows carried forward to a later draft are not counted twice), deduplicated, split by
`article_revisions.raw_source_kind`. Production inside `BEGIN READ ONLY … ROLLBACK` as
`spideryarn_app`, counts and durations only.

| | n | min | median | p90 | p99 | max |
|---|---|---|---|---|---|---|
| prod `assets`, PDF | 27 | 0.0 | 2.2 | 40.0 | 83.2 | **92.8** |
| prod `assets`, HTML | 20 | 0.0 | 0.2 | 2.7 | 3.9 | 4.2 |
| prod `fetch`, PDF | 25 | 0.0 | 1.2 | 2.3 | 3.9 | 4.3 |
| prod `fetch`, HTML | 20 | 0.0 | 0.8 | 1.7 | 2.5 | 2.6 |
| local `assets`, PDF | 32 | 0.0 | 1.1 | 47.0 | 150.3 | **184.3** |
| local `assets`, HTML | 98 | 0.0 | 0.3 | 2.9 | 55.5 | 73.7 |
| local `fetch`, PDF | 38 | 0.0 | 0.9 | 2.8 | 3.9 | 4.1 |
| local `fetch`, HTML | 122 | 0.0 | 0.5 | 1.0 | 2.2 | 10.7 |

Seconds. The local 184.3 s is a PDF whose figures clock ran out. The figure locator's model calls
(`ai_calls`, `step_name = 'assets'`): production 32 calls, max 21.2 s, worst run 74.4 s of wall
time. **What the table cannot show**: a run that overran and was paused leaves no `done` row, so
the overruns this plan is about are invisible in it. The committed fixture corpus has no timings
for either step.

## The clocks and their limits

- The claimant's deadline: `LEASE_MS − DEADLINE_MARGIN_MS` = 740 s, under Vercel's
  `maxDuration` of 800 s. A budget at or over 740 s is never satisfied.
- `assets`: `ASSETS_BUDGET_MS` 180 s + `PDF_FIGURES_BUDGET_MS` 180 s. Its reads of structure
  blocks, the raw manifest and PDF bytes are outside these races. Image/figure puts take no
  signal, but the collectors race their whole workload, so these puts do not hold their return.
- `fetch`: `DEFAULTS` in `src/fetch.ts`, 3 attempts × 30 s with at most 10 s between them = 110 s
  per `fetchDocument`; `fetchByAddress` makes at most 1 + 2 of those (the pasted address, then a
  paper source's candidates, of which arXiv and PMLR give two) = 330 s of nominal clocks. This
  is not a hard return-time ceiling: response-body cancellation and dispatcher shutdown are
  awaited without races. PDF page counting has the claimant's signal but no separate step
  timeout (1.5–1.8 s measured cold); storage can await head, put and up to four verification
  gets with 50/200/800 ms waits, without a timer. The upload path also awaits its record read,
  staging head/get, promotion and record settlement. See `acquireUpload` in `src/pipeline.ts`
  and `storeRawSource` in `src/store/blobs.ts`.

## What changes

- `assets` 185 s → **400 s**: 360 s of caps, an estimated 5 s of unwinding each (the allowance
  185 s already gave the first), plus estimated storage-read slack. 340 s under the deadline.
- `fetch` 150 s → **360 s**: 330 s of requests, the page count and the storage put, rounded up.
  **This row decides nothing today**: `fetch` is first in `STEP_ORDER`, so it is always a claim's
  first step, which the walk runs ungated. Raised so the table states the truth.

Both are admission estimates sized to the clocks rather than to the data; neither bounds all
elapsed time. Too large costs a request, too small risks discarding and repeating a late run.
The `assets` raise adds a hand-back when `structure` leaves at least 185 s but less than 400 s;
below 185 s it already deferred. For example, a fresh claim spending 365 s in `structure` has
375 s left: a 92.8 s assets run would fit, but is now deferred. That is the deliberate cost of
reserving for the possible combined clocks. The reported structure median (86.8 s) alone does
not establish how often this happens; that also depends on time spent before structure.

**The simpler option passed over**: raising `assets` to 370 s, the caps plus unwinding and
nothing for the storage read. It would hand back slightly less often, at the price of a number
knowingly under one of the step's own costs.

**Out of scope, unchanged**: the lease, `REQUEUE_BUDGET`, Stop, every other budget, and the
`LEASE_MS` arithmetic and the "whole default ingest" test, which are about an ordinary web page
where neither raise applies.

## The test

`tests/jobs-lease-budget.test.ts`, two cases, both derived from the constants that enforce the
clocks rather than from the new numbers:

- `assets` ≥ `ASSETS_BUDGET_MS + PDF_FIGURES_BUDGET_MS`, and < the deadline.
- `fetch` ≥ (1 + the most candidates a sampled address gives) × (`attempts × timeoutMs` + the
  longest total wait `retryDelayMs` permits between attempts), and < the deadline. Originally
  the source registry was not exported, so a new source could be missing from the samples
  without a failure. The code-review fix below closes that gap.

**Code-review fix:** `SOURCES` is now exported and the test checks its names against the samples,
then resolves each sample with its own source. Adding a source without a sample now fails.
Address shapes remain sampled; a source whose candidate count varies needs its longest list
covered. The assertions cover configured clocks, not untimed work or the estimated slack.
Reproduced with a temporary eighth source giving three candidates: the original test stayed
green; the registry check failed with `review-extra` missing from the samples. Mutation removed.

**Red first**: both failed against the old numbers (185 000 < 360 000; 150 000 < 330 000).
**Mutations**, each run separately and put back: `assets` at 359 999, red;
`PDF_FIGURES_BUDGET_MS` at 230 s, red (410 000); `DEFAULTS.attempts` at 4, red (450 000); a
third arXiv candidate, red (440 000).

## Other budgets the same table measures under

Production and local maxima from the same `revision_step_runs` query, against the current row.
Reported, not changed. Most are mode steps that usually run as the only step of a job, which the
walk starts ungated, so the row matters only when a job names them after another step.

| step | budget | prod max (n) | local max (n) |
|---|---|---|---|
| `ideas` | 120 s | 357.8 s (36) | 149.9 s (53) |
| `sketch` | 240 s | 335.6 s (24) | 182.4 s (8) |
| `illustrated` | 600 s | 739.3 s (15) | 376.0 s (3) |
| `debate` | 120 s | 161.6 s (17) | 146.7 s (5) |
| `tweets` | 90 s | 114.7 s (27) | 128.5 s (57) |
| `arc` | 60 s | 50.8 s (49) | 199.5 s (185) |
| `blocks` | 25 s | 7.2 s (47) | 35.7 s (158) |

`structure` (700 s) reached 727.2 s locally; it is a ceiling by design, with its own slices and
pause.

## Review status

GPT Sol reviewed the code
([prompt](261007g-raise-the-images-and-fetch-step-budgets-to-what-they-measure-code-review-prompt.md),
[answer](261007g-raise-the-images-and-fetch-step-budgets-to-what-they-measure-code-review-sol.md)).
**Verdict: ship with these fixes applied.**

**Fixed:**

- **C2** — the `fetch` test counted candidates over a hand-kept sample list, so an eighth source
  went uncounted. `SOURCES` is now exported from `src/paper-sources.ts` and the test requires a
  sample for every registered name. Checked by hand: a fake eighth source with three candidates
  turned the test red (`review-extra` missing from the samples); removed again.
- **C3** — comment and doc sentences that called the budgets hard bounds, said hung image/figure
  puts delay a collector's return, or overstated what the measurements show, rewritten; the local
  `assets` count corrected 131 → 130 (32 PDF + 98 web).

**Left:**

- **C1** — neither budget bounds the whole step. `assets` reads blocks, the raw manifest and the
  PDF bytes outside its collector races; `fetch` has untimed storage head/put/read-back and awaited
  response cleanup and dispatcher shutdown; and storage (`src/store/blobs.ts`) makes bare fetches
  with no timeout. The budgets cover the configured clocks plus estimated slack, and say so.
- **C4** — accepted trade-off. `assets` now hands back when 185 s ≤ remaining < 400 s, although a
  measured 92.8 s run would fit. Reserving for the configured clocks is deliberate: under-reserving
  risks discarding and repeating a late run.
- **C5** — informational, no defect: `fetch` is always a claim's first step today.
- **C6 — P1 risk, and the next item.** Five other step budgets are below their measured
  **production** maximum, and they can matter today because those steps do follow earlier ones in
  one job: `ideas` 120 s vs 357.8 s (it follows Quotes in Skim jobs), `sketch` 240 s vs 335.6 s,
  `illustrated` 600 s vs 739.3 s (it follows Sketch), `debate` 120 s vs 161.6 s, `tweets` 90 s vs
  114.7 s. The table above understates this when it says they usually run alone. `arc` and
  `blocks` exceed only their local maxima.
  **Done 2026-10-07** in
  [261007h](261007h-five-more-step-budgets-to-what-they-measure.md): each row set to its calls'
  token time with headroom (`ideas` and `tweets` 600 s, `sketch` 700 s, `debate` 360 s);
  `illustrated` 700 s as a reservation, since its brief alone outlasts a claim, which is left as a
  design question. Of the five, only `ideas` (in Skim) and `illustrated` (after Sketch) follow
  another step in anything the app queues; the other three do so only in a hand-written job.
