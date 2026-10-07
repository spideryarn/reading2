**Land with the fixes made.**

- **F6 — P1, fixed: concurrent replay could be refused.** If another create committed during starter resolution, a non-ready result returned `starter-refused` without checking the committed voucher. Four regression assertions failed with that wrong answer. [createVoucher now rechecks replay identity](/var/tmp/spideryarn-worktrees/voucher-starter-article/src/store/pg-vouchers.ts:510) before refusing.

- **F7 — P1, fixed: readdress could email a replacement article.** After deletion nulled `starter_article_id`, resolving the retained slug could find a newly imported article at that address. Existing delete/import paths permit this. Two regression assertions returned `kept` instead of `dropped`. [Readdress now checks article identity](/var/tmp/spideryarn-worktrees/voucher-starter-article/src/store/pg-vouchers.ts:899) under the voucher lock and drops deleted or mismatched starters.

- **F8 — P3, fixed: the key-owner comment excluded the new email destination.** [Updated the comment](/var/tmp/spideryarn-worktrees/voucher-starter-article/src/store/pg-share-link.ts:12) to name voucher resolution, the kept email and Resend.

[Regression tests](/var/tmp/spideryarn-worktrees/voucher-starter-article/tests/voucher-starter-races.test.ts) now pass; **117 targeted unit tests passed** overall. Independently compared **72 no-starter messages** against the parent commit: subject, text and HTML were byte-for-byte unchanged. Title escaping and control-character checks passed. Lint reported one complexity advisory.

The retry loop is bounded and handles concurrent readdress/restore correctly. The CHECK permits `ON DELETE SET NULL` while retaining the slug. The title-versus-slug fallback is the documented stage 1 choice. No P0 or additional key-leak path found.

Whole-tree typechecking passed initially; subsequent runs encountered errors only in concurrently edited stage 2 UI files. Those remain untouched. Your supplied 236 DB-test results cover the candidate; DB suites need rerunning after these fixes outside this sandbox.

All reviewer changes are **uncommitted**. The [postmortem](/var/tmp/spideryarn-worktrees/voucher-starter-article/docs/postmortems/261007n-persisted-identity-must-outlive-live-lookup-state.md) records both root causes.