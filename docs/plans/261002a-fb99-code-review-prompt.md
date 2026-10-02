You are reviewing code in the Spideryarn repo (this worktree), and you may fix what you find.

The plan, with your earlier plan review folded in: docs/plans/261002a-fb99-voucher-email-for-existing-user.md
Your plan review: docs/plans/261002a-fb99-plan-review-sol.md

The change is one commit: `git show 43add6408` (diff against its parent; ignore anything else on the
branch). Files: src/store/admin-accounts.ts (confirmedAccountByEmail, gotruePages signal),
src/store/pg-vouchers.ts (standingOf, giftAudienceFor, createVoucher/updateVoucher wiring),
src/store/pg-voucher-emails.ts (GiftAudience, giftMessage's two letters, RETRYABLE), src/routes.ts
(one message), src/web/PrivacyPage.tsx, the docs, and tests in tests/billing-voucher-emails.test.ts,
tests/admin-accounts.test.ts, tests/billing-vouchers.test.ts, tests/privacy-page.test.ts.

Check, hard:
1. Correctness: the before/after arithmetic and the waiting-gift sum; the ambiguity-then-confirmation
   rule; the deadline actually aborting the fetch; nothing about the audience lookup able to fail a
   create or a PATCH (it must fall back, never throw); replayed creates still queue nothing.
2. The RETRYABLE change (claimed gifts now retryable): can it ever send a gift email twice, or to the
   wrong person? Think about readdress, revoke/restore, and the claim.
3. Privacy/security: no address, note, creator or voucher id in a log line or the email; no billing
   read for a non-matching or ambiguous address; the admin gate and authAdminEndpoint still in the path.
4. Whether each test could go red against the bug it is for (tests that pass whatever the code does).
5. Types: wrong states the compiler should refuse.

Rules: fix only what is inside this change; report anything wider instead of fixing it. Keep the
house style (comment density, naming). Do not touch .env*, infra/, or the database outside tests.
Do not commit. Run `npx vitest run tests/billing-voucher-emails.test.ts tests/admin-accounts.test.ts
tests/billing-vouchers.test.ts tests/privacy-page.test.ts` and `npm run typecheck` after any fix, and
say what they printed.

Answer: a verdict, then numbered findings (severity, file:line, what you changed or why you left it),
then the gate results.
