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
back intact. `assets` was admitted on **185 s**, which is `collectAssets`'s 180 s cap plus
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

## The upper bounds

- The claimant's deadline: `LEASE_MS − DEADLINE_MARGIN_MS` = 740 s, under Vercel's
  `maxDuration` of 800 s. A budget at or over 740 s is never satisfied.
- `assets`: `ASSETS_BUDGET_MS` 180 s + `PDF_FIGURES_BUDGET_MS` 180 s; unbounded by any clock are
  `readRawBytes` before the second and the storage puts neither can abort.
- `fetch`: `DEFAULTS` in `src/fetch.ts`, 3 attempts × 30 s with at most 10 s between them = 110 s
  per `fetchDocument`; `fetchByAddress` makes at most 1 + 2 of those (the pasted address, then a
  paper source's candidates, of which arXiv and PMLR give two) = 330 s; then the page count
  (≤ 2 s) and an unbounded storage put.

## What changes

- `assets` 185 s → **400 s**: 360 s of caps, 5 s of unwinding each (the allowance 185 s already
  gave the first), the storage read, rounded up. 340 s under the deadline.
- `fetch` 150 s → **360 s**: 330 s of requests, the page count and the storage put, rounded up.
  **This row decides nothing today**: `fetch` is first in `STEP_ORDER`, so it is always a claim's
  first step, which the walk runs ungated. Raised so the table states the truth.

Both are sized to the clocks rather than to the data, which is the table's own rule: too large
costs one request, too small is the overrun this fixes. What the `assets` raise costs: a claim
that finishes `structure` with under 400 s left hands back before `assets` instead of starting
it. Production's `structure` median is 86.8 s, so most still run in the same claim.

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
- `fetch` ≥ (1 + the most candidates any source gives) × (`attempts × timeoutMs` + the longest
  wait `retryDelayMs` returns between attempts), and < the deadline. Its weak point: the paper
  source registry is not exported, so it counts candidates over one sample address per source,
  and a new source has to be added there ([fetching.md](../project/fetching.md) says so).

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
