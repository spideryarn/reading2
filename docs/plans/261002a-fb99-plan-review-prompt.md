You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only.

The plan: docs/plans/261002a-fb99-voucher-email-for-existing-user.md

Read it, then the code it changes: src/store/pg-voucher-emails.ts (giftMessage, queueGiftEmail),
src/store/pg-vouchers.ts (createVoucher, updateVoucher/updateOnce, claimantUsage, claimVouchersFor),
src/store/admin-accounts.ts (listAccounts, gotruePages, accountFrom), src/store/pg-admin.ts (accountSource),
src/billing/points.ts (ingestHeadroom, budgetFor), and the routes in src/routes.ts around line 7500.
Also docs/project/billing.md § Gift vouchers, docs/project/security-map.md, and the previous plan
docs/plans/261001p-voucher-emails-to-recipient-and-creator.md (its Log has the earlier reviews).

Questions:
1. Is the diagnosis (the voucher predates the email feature, so nothing was ever queued) right? Check
   the ancestry claim yourself: `git merge-base --is-ancestor 374ea318a 6bdf24dcd261d25f51627d739f461b4747055cce`.
   Is there any OTHER reason an email to an existing user would not arrive with today's code (e.g. the
   claim racing the automatic send, a Retry predicate, the production send gate in src/email.ts)?
   Look hard here.
2. Is the design right and the simplest that meets Greg's ask? Is there a simpler correct one?
3. Correctness of the before/after numbers, privacy of putting a reader's own allowance in an email,
   the confirmed-match rule, and fallback on any doubt.
4. Does anything here touch a defence (security-map.md)? If so, say which.
5. Anything missing from the tests.

Answer with a verdict (build / build with changes / rethink) and numbered findings, each with
severity, evidence (file:line), and the change you would make. Be concrete; skip praise.
