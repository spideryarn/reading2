Found and fixed five issues; one wider pre-existing issue remains.

- F1 — High — [CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/src/web/CommandBar.tsx:641): an open or still-loading gift dialog could adopt a newly navigated article’s slug. It now captures the pressed slug, closes on article changes, never retargets state, and caches the loaded component without remounting on a second press.

- F2 — Medium — [AuthorGiftDialog.tsx](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/src/web/AuthorGiftDialog.tsx:60): two same-render submissions sent two POSTs because React’s `busy` state was not a synchronous lock. Added a ref latch with `finally` release. Server idempotency already prevented duplicate durable gifts.

- F3 — Medium — [eager-client-graph.test.ts](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/tests/eager-client-graph.test.ts:963): the lazy-boundary guard did not require every derived private root to appear in its calibration list. A future eager import of `AuthorGiftDialog` could therefore leave the guard green. Added the missing converse assertion and calibration entry.

- F4 — Low — [admin-command-bar.test.tsx](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/tests/admin-command-bar.test.tsx:226): the Feedback-precedence test did not mount `FeedbackHost`, so it could pass without the reader-facing Feedback row. Fixed the harness and added meaningful coverage for modal overlap, preserved dialog state, route changes, returned gift IDs, refusal, failed read-back, and double submit.

- F5 — Low — [admin.md](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/docs/project/admin.md:1273), [article-commands.ts](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/src/web/article-commands.ts:58): corrected claims that every destination used `/api/admin` and that the bar lacked an admin check. `/design` is explicitly documented as the data-free exception.

- F6 — Low, wider; not changed — [AdminVouchersPage.tsx](/var/tmp/spideryarn-worktrees/fbv88mga-admin-command-bar/src/web/AdminVouchersPage.tsx:483): the existing voucher form has the same same-tick duplicate-request gap. Its author-gift path checks render-lagged `busy`; the ordinary path does not check it at all. Existing server/idempotency-key protections prevent duplicate durable records, so I left this pre-existing code outside the reviewed change.

I found no non-admin/view-as trigger path, nor a regression in suggested rows, “Did you mean”, guide offers, or sentence-picker keys.

Verification:

- Requested Vitest suite: 161 passed, 2 skipped.
- Additional doc-link check passed.
- `git diff --check` passed.
- `npm run typecheck` could not start because this sandbox forbids the `tsx` launcher’s Unix socket (`EPERM`). Running the same script as `node --import tsx scripts/typecheck.ts` passed all 3,948 covered files across all four projects.