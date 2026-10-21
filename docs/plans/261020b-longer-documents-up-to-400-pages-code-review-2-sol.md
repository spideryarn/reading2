# Code review 2: narrow check of C1-F1 (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol
(gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, on `4b07261d7`; prompt in
[the prompt file](261020b-longer-documents-up-to-400-pages-code-review-2-prompt.md). Verbatim.

## Review

1. **Lock order: pass. No cycle found.**

`switchOnHighPower` takes billing → article → job → reservation ([pg-billing.ts:1632](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1632), [pg-billing.ts:1532](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1532)).

Every audited path is a prefix or subsequence of that order:

- Session endings take article before job, then settle the reservation ([pg-session.ts:759](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:759), [pg-session.ts:475](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:475), [pg-session.ts:491](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:491), [pg-session.ts:605](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:605), [pg-session.ts:623](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:623)).
- The public `finish`/terminal `releaseStep` paths take job before reservation ([pg-jobs.ts:1092](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:1092)).
- `settleExpired` takes any required article locks, then jobs, then reservations ([pg-jobs.ts:1705](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:1705), [pg-jobs.ts:1823](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:1823), [pg-jobs.ts:1884](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:1884)).
- `requestCancel` takes job then reservation ([pg-jobs.ts:2063](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:2063), [pg-jobs.ts:2119](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:2119)).
- `priceFetchedPdf` takes billing → job → reservation ([pg-billing.ts:1823](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1823), [pg-billing.ts:1849](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1849)).
- Visibility and `reserveUpgrade` take billing → article ([pg-visibility.ts:169](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-visibility.ts:169), [pg-billing.ts:1345](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1345)).
- Voucher changes take billing before voucher ([pg-vouchers.ts:1030](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-vouchers.ts:1030)).
- Delete takes billing → article → active jobs ([pg-shelf.ts:575](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-shelf.ts:575)).

No path introduces article → billing, job → article, or reservation → job.

2. **C2-F1 — P0: queued imports still permit a permanent one-slot High-powered charge.**

`activeImportPrice` matches only `status = 'running'`; no match is explicitly treated as ready with no slot count ([pg-billing.ts:1532](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1532), [pg-billing.ts:1545](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1545)). The eventual fallback is one slot because `articleSlots` ignores unsettled reservations ([pg-billing.ts:1954](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1954), [pg-billing.ts:1699](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1699)).

That misses real charged work:

- A deadline hand-back changes the job to `queued` while preserving its reservation and draft ([pg-jobs.ts:2363](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:2363)).
- The UI itself regards both `queued` and `running` as alive ([AddPage.tsx:1203](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/AddPage.tsx:1203)).
- A retry’s fresh job is queued against an already-existing article, so the PUT can immediately take this path.
- There is no separate `claimed` status: claiming atomically changes `queued` to `running` ([pg-jobs.ts:901](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-jobs.ts:901)). Before that transaction commits, another transaction can still observe the queued version and miss it.

Therefore a timed PUT during a queued window can write the once-for-ever High-powered row at one slot before the PDF’s multi-slot reservation settles. The new database tests cover only running jobs ([billing-long-documents-db.test.ts:392](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/tests/billing-long-documents-db.test.ts:392)).

3. **C2-F2 — P1: observing a failed/stopped job does not cancel an already-scheduled 409 retry.**

A 409 schedules a timer ([add-high-power.ts:188](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:188)). `observe(..., false, ...)` changes `jobAlive` but neither clears that timer nor leaves `waiting` ([add-high-power.ts:93](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:93)). When the timer fires, `kick()` does not check `jobAlive` and sends another PUT ([add-high-power.ts:163](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:163)).

It will not retry indefinitely after another 409, but it performs one request after the terminal observation. Combined with C2-F1, that request normally sees no running job and may successfully charge one slot for a failed or cancelled long import. The added test exercises an endlessly alive job, not death with a pending timer ([add-high-power.test.ts:83](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/tests/add-high-power.test.ts:83)).

No files changed.

**Verdict: do not approve.**