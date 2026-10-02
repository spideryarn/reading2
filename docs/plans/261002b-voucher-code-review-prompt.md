You are the code reviewer for plan 261002b in the Spideryarn repo (this worktree). You may edit
files: fix what you find inside this change's scope, and report anything wider for me to decide.
Do not commit, do not run git commands that change history or the index, and do not touch the
database other than through the test suite.

The plan (with your own earlier plan review, every finding of which was taken):
docs/plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md and
docs/plans/261002b-voucher-plan-review-sol.md.

The change is one commit: `git show 950e1a33b` (read it with `git show`/`git diff 950e1a33b^ 950e1a33b`).

Three parts:

1. A note to a gift voucher's recipient: column `billing_vouchers.recipient_note`
   (drizzle/20261002012754_billing_voucher_recipient_note.sql), parsed in src/store/pg-vouchers.ts
   (`parseNote`, `createVoucher`, `updateOnce`), rendered in src/store/pg-voucher-emails.ts
   (`giftMessage`, `noteRow`, `escapeNoteHtml`) after `noteText` in src/email.ts, shown and edited on
   src/web/AdminVouchersPage.tsx with an `EmailSketch`. The subject/heading/label strings moved to
   src/admin-vouchers.ts so the sketch and the email share them.
2. `/profile` and the shelf share src/web/PlanHelp.tsx (`PlanInfo`, `GiftList`, `HowYourPlanWorks`),
   worded by `planTip` / `planExplainer` in src/billing-plan.ts. The paid arm of `ReaderPlan` gained
   `periodAllowance`, `trial` and `gifts` (src/billing/summary.ts).
3. `/admin/users` Spend: `formatWholeDollars` in src/admin.ts, used in src/web/admin-columns.tsx.

Look hardest at:

- Untrusted text: can anything in the note reach the HTML unescaped, the subject, a header, or a
  link? Is `noteText`'s regex right (it should map CR, CRLF, U+2028, U+2029 to LF; every other Cc
  to a space; 3+ LFs to 2)? Is the 500-character limit counted the way Postgres' `char_length`
  counts, both before and after cleaning?
- Outbox semantics: replay/idempotency of create (the replay comparison now includes the note);
  re-address carrying the stored or patched note; nothing re-sending on a note-only edit.
- Every sentence in `planTip`/`planExplainer`: is each true against the billing code
  (src/store/pg-billing.ts, src/billing/tiers.ts, src/billing/quota-adjustment.ts)? Especially the
  prorated sentence ("This month's is N, because the plan changed part-way through it") — is a
  mismatch between `limit` and `periodAllowance` only ever caused by a plan change? And the ending
  and trial wording.
- Anything that assumed `gifts` only on the free arms (grep for `.gifts`).
- The tooltip on a link: accessibility (aria-label length, keyboard), and touch.
- Tests that would stay green if the code were wrong.

Run `npm run typecheck` and the relevant test files (tests/billing-voucher-emails.test.ts,
tests/billing-vouchers.test.ts, tests/admin-vouchers-page.test.tsx, tests/plan-help-copy.test.ts,
tests/profile-plan-help.test.tsx, tests/free-allowance-box.test.tsx, tests/admin-spend-column.test.tsx,
tests/billing-plan.test.ts, tests/privacy-page.test.ts) after any fix.

Answer with numbered findings: severity (P0–P3), file:line evidence, what you changed (or why you
did not), and whether the overall change is ready to land.
