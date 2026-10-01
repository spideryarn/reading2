Verdict: **conditional approve after fixes**. No remaining in-scope code finding, but the three Postgres suites could not start in this sandbox, so the review is not fully green yet.

1. **P1 — Superseded attempts could still call Resend. Fixed.**  
   [pg-voucher-emails.ts:421](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-voucher-emails.ts:421) now verifies lease ownership before sending and again after a potentially slow creator lookup. A concurrent-idempotency 409 remains `sending`/ambiguous instead of falsely becoming `failed`.

2. **P1 — Email/provider data could reach logs through thrown errors and successful provider IDs. Fixed.**  
   [email.ts:116](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/email.ts:116) now retains only allowlisted error-class names, never error messages, and no longer logs Resend’s response ID. Tests cover addresses, notes, arbitrary provider bodies, thrown messages, and stored `detail`.

3. **P2 — Timeout/network-failure copy claimed more certainty than existed. Fixed.**  
   [AdminVouchersPage.tsx:173](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/web/AdminVouchersPage.tsx:173) now says an ambiguous request “may or may not have gone”; definite HTTP refusals remain ordinary failures.

4. **P2 — Retry allowed a same-tick client double-submit. Fixed.**  
   [AdminVouchersPage.tsx:219](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/web/AdminVouchersPage.tsx:219) adds a synchronous ref guard. The server’s atomic reservation remains the authoritative protection.

5. **P3 — An unresolved write could schedule reads after unmount. Fixed.**  
   [useAdminVouchers.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/web/useAdminVouchers.ts:114) now suppresses immediate and delayed rereads after teardown and clears existing timers.

6. **P3 — Missing regression coverage. Fixed.**  
   Added tests for automatic-send versus Retry racing, creator lookup outliving its lease, PATCH surviving send failure, same-tick Retry, post-unmount completion, ambiguous copy, and provider-body/log leakage in [billing-voucher-emails.test.ts:405](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/tests/billing-voucher-emails.test.ts:405) and [admin-vouchers-page.test.tsx:345](/home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/tests/admin-vouchers-page.test.tsx:345).

The migration matches the schema; browser UUID parsing is anchored and strict, replay comparison covers every stored field, replay queues nothing, and every new email-writing route is under `/api/admin/`. The only wider limitation is the plan’s acknowledged one: Resend retains idempotency keys for 24 hours, so a manual retry after that window cannot promise lifetime at-most-once.

Gate results:

- `npm run typecheck`: command itself exited 1 because `tsx` could not create `/tmp/tsx-1000/14.pipe` (`EPERM`). Running the identical script through `node --import tsx scripts/typecheck.ts` passed: 420 web files, 2,476 test files, 104 fleet-web files, 787 root files; all 2,590 sources covered.
- `tests/email.test.ts`: **12 passed**.
- `tests/admin-vouchers-page.test.tsx`: **21 passed**.
- `tests/authenticated-api-route-contract.test.ts`: **387 passed**.
- `tests/billing-voucher-emails.test.ts`: could not start; local Postgres connection refused by sandbox with `connect EPERM 127.0.0.1:54362`.
- `tests/billing-vouchers.test.ts`: same database refusal.
- `tests/db-schema-drift.test.ts`: same database refusal.
- Scoped Biome lint: passed.
- `git diff --check`: passed.

No email, remote database operation, commit, push, or deployment was performed. The concurrent project-doc edits and untracked review prompt were left untouched.