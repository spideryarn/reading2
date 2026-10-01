## Verdict

Conditional pass after fixes. I found and fixed one high-severity fallback bug plus test/privacy weaknesses. No remaining in-scope correctness issue found, but the database-backed gate could not run in this sandbox.

1. **High — [pg-vouchers.ts:347](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-vouchers.ts:347)**  
   The account lookup was outside the `try`, so an unexpected rejection could fail voucher creation or PATCH. Added fail-open boundaries around both the lookup and the POST/PATCH audience resolver; they now queue the invitation instead.

2. **Medium — [pg-vouchers.ts:359](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-vouchers.ts:359)**  
   An unavailable lookup’s arbitrary `reason` was logged, potentially exposing an address or provider response. The log now contains only a fixed label/error class.

3. **Medium — [billing-voucher-emails.test.ts:485](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/tests/billing-voucher-emails.test.ts:485)**  
   The claimed-retry test sent successfully, manually changed the row to `failed`, then sent again—manufacturing the duplicate it claimed to exclude. Replaced it with a genuine provider refusal followed by claim and Retry, plus a delivered-then-claimed case proving `sent` remains ineligible.

4. **Medium — test coverage strengthened**  
   Added non-vacuous coverage for the fetch abort signal, Auth/database mismatch before fetch, no billing read for none/several/unavailable, audience exceptions on create/PATCH, wall usage including public/minimal/in-flight/high-power costs, and claimed gifts on lapsed Free. See [admin-accounts.test.ts:591](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/tests/admin-accounts.test.ts:591) and [billing-voucher-emails.test.ts:857](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/tests/billing-voucher-emails.test.ts:857).

5. **Medium, wider design risk — left unchanged — [pg-voucher-emails.ts:414](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-voucher-emails.ts:414)**  
   Readdress, revoke/restore, and claim do not redirect a retry: `sent` is excluded, revoke blocks, readdress breaks the recipient equality, and claim preserves the voucher address. However, the existing outbox can duplicate after an ambiguous attempt once Resend’s 24-hour idempotency window expires, and any frozen recipient can become stale if inbox ownership later changes. Fixing that requires a broader outbox/revalidation policy. I corrected the new plan’s absolute claim at [261002a plan:90](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:90).

## Gate results

- Required Vitest command: **failed before tests ran**. Sandbox reported `connect EPERM 127.0.0.1:54362`, then `No database`.
- Database-independent fallback: **2 files passed, 45 tests passed** (`admin-accounts`, `privacy-page`).
- `npm run typecheck`: **failed to launch** because `tsx` could not create `/tmp/tsx-1000/14.pipe` (`listen EPERM`).
- Equivalent `node scripts/typecheck.ts`: **passed** all four TypeScript projects; all **2626** source files covered.
- `git diff --check`: passed.
- No commit made.