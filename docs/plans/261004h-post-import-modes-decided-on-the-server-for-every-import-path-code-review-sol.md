Fixed six findings within Stage 1. Changes are uncommitted.

1. **F6 — P1, ESTABLISHED, FIXED:** Checkbox writes were not bound to the reader’s session. A pending PATCH could retry after account switching, and a queued second write could acquire the next reader’s token. Fixed in `src/web/auto-modes-setting.ts`: every save carries the session signal, and obsolete queued writes are skipped. The regression was red first.

2. **F7 — P1, ESTABLISHED, FIXED:** Failed writes restored `!next`, rather than the server’s confirmed value. Starting on, pressing off then on, and failing both PATCHes left the box off while the server remained on. Fixed in `src/web/auto-modes-setting.ts` by retaining confirmed state and re-reading after failure. The regression was red first.

3. **F8 — P1, ESTABLISHED, FIXED:** Checkbox writes could race the legacy hand-over or writes from a previous AddPage mount. An earlier off could finish after a later on and overwrite it. Fixed with one session-owned queue and shared snapshot in `src/web/auto-modes-setting.ts`. Failed hand-over now reports failure and displays the server’s actual choice while retaining the legacy key. Both ordering regressions were red first.

4. **F9 — P1, ESTABLISHED, FIXED:** A mode queued during the initial import could run before labels. The unpublished article row permits an owner’s mode request; publication then deduplicates onto that earlier holder without changing its timestamp. Once the import ends, the mode precedes labels. Fixed in `src/store/pg-successor.ts` by assigning an unclaimed, draft-free holder the successor’s queue position. Added a regression in `tests/publication-queues-the-main-modes.test.ts`; **it remains unrun here because Postgres is unavailable**.

5. **F10 — P3, ESTABLISHED, FIXED:** Timing explanations confused a response arriving with a write committing. An unanswered High-powered request may already have committed; a late tick also need not hang throughout Structure and labels to miss a step. Checkbox changes likewise affect publication only after committing. Corrected the plan, `high-powered-ai.md`, `ingest-queue.md`, and the relevant client comments; AddPage now shows pending saves.

6. **F11 — P3, ESTABLISHED, FIXED:** Completion copy used the current checkbox value to infer which jobs publication had queued. Unticking after completion produced a false promise that saving the purpose would steer everything generated afterwards. Fixed in `src/web/AddPage.tsx`; the regression in `tests/add-page-purpose.test.tsx` was red first.

7. **F12 — P2, ESTABLISHED, REPORTED:** Three supplied tests establish narrower evidence than their surrounding descriptions suggest. Rollback uses a manually shared transaction rather than `settleIn`; the administrator case models a reservation-free ordinary owner; the power case calls the store and `readStepPower` directly rather than advancing the real runner. These support the primitives but leave their integration wiring unverified.

By code inspection, I found no further defect in import eligibility, owner selection, profile rendering, charging, or transaction boundaries. The reader lookup and successor inserts intentionally add publication failure points: exceptions roll back publication. Missing `Job.url` is handled by job cards; the batch panel uses job IDs and slugs. The `/help` copy does not promise client-side queueing.

Validation: **140 tests passed across six pure suites**, all four TypeScript projects passed, and `git diff --check` passed. Targeted lint reported only AddPage’s existing complexity advisory. The standard typecheck launcher hit the sandbox’s socket restriction; the same checker passed via `node --import tsx scripts/typecheck.ts`.

**Verdict: candidate required changes; fixes are ready for your diff review, conditional on the updated Postgres suite passing.**

Every file changed:

- `src/store/pg-successor.ts`
- `src/web/auto-modes-setting.ts`
- `src/web/AddPage.tsx`
- `src/web/add-high-power.ts`
- `tests/auto-modes.test.tsx`
- `tests/add-page-purpose.test.tsx`
- `tests/publication-queues-the-main-modes.test.ts`
- `docs/project/high-powered-ai.md`
- `docs/project/ingest-queue.md`
- `docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md`
- `docs/postmortems/261004j-a-page-mount-cannot-own-writes-to-a-reader-setting.md`