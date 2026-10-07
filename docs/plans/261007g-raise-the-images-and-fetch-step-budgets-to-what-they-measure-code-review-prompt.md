# Code review (write-capable): the images and fetch step budgets

You are reviewing, and may fix, one committed change: `1b867d81b` on branch
`worktree-sweep7-step-budgets`. The plan:
`docs/plans/261007g-raise-the-images-and-fetch-step-budgets-to-what-they-measure.md` (it has the
measured production and local durations). Context: `docs/plans/261007b-seventh-sweep-job-queue-tier-0.md`
§ What is left (you raised the budgets in its review), `docs/project/ingest-queue.md`.

**What it does.** `STEP_BUDGET_MS.assets` 185 s → 400 s (the two internal caps, `ASSETS_BUDGET_MS`
180 s + `PDF_FIGURES_BUDGET_MS` 180 s, plus unwinding and an untimed storage read); `fetch` 150 s →
360 s (one `fetchDocument` is 3 × 30 s + 10 s = 110 s; `fetchByAddress` makes at most three; plus a
page count and a storage put). Two new tests derive each budget's floor from the code's own
constants. The claim deadline is `LEASE_MS − DEADLINE_MARGIN_MS` = 740 s; a step starts after
another only if `deadlineAt − now ≥ STEP_BUDGET_MS[next]`; the first step of a claim always starts.

**Check:**
1. Is the arithmetic right, and is each budget an upper bound on what the step can take, including
   anything untimed (the storage read before the figures clock, puts, retries inside a helper)?
   Is anything inside either step NOT bounded by a timer (a fetch with no timeout, a loop over
   figures with no cap)? Name it.
2. Admission: does raising `assets` to 400 s leave any ordinary import worse off, e.g. `structure`
   leaving 340–400 s so `assets` is deferred to another request it did not need before (measured
   production `assets` max is 92.8 s)? Is a budget sized to the clock ceiling, not the measured
   tail, the right choice? (The builder's reason: the deadline rule now discards a late product,
   so under-estimating costs a whole repeated run.) Say plainly whether you agree.
3. `fetch`'s budget never decides admission today (fetch is always first in its claim). Is there a
   job shape where fetch is NOT first (a re-run with `preceded-by`, a successor, Refresh from
   source)? If so, is 360 s then right?
4. The fetch test counts candidates over one sample address per source because the source registry
   is not exported: is that a test that will silently stop covering a new source? Is exporting the
   registry (or its count) the smaller honest fix?
5. Every rewritten comment and doc sentence is a claim; check each.
6. The builder lists seven other step budgets below their measured production maximum (ideas 120 s
   vs 357.8 s, sketch 240 s vs 335.6 s, illustrated 600 s vs 739.3 s, debate, tweets, arc, blocks),
   unchanged. Do any of them matter today (is any of those steps ever NOT the first step of a
   claim)? Report; do not change them.

You may run `npx vitest run tests/jobs-lease-budget.test.ts tests/jobs-tier0-offline.test.ts`
(nothing outside the tree). No Postgres, no `npm test`.

**Fix what is inside this change**, narrowly, red-first. **Report, do not fix, anything wider.** Do
not change any other budget, the lease, `REQUEUE_BUDGET` or Stop. Do not commit.

**Reply format.** Findings C1, C2, …; P0–P3; the input; reproduced or reasoned; fixed or not. Then
files changed, what you ran, and a verdict (ship / ship with these fixes applied / do not ship).
