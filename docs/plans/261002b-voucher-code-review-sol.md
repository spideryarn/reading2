1. **P1 — Billing copy made false promises about trials and delayed cancellation.**  
   Evidence: [src/billing-plan.ts:729](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/billing-plan.ts:729), [src/billing-plan.ts:834](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/billing-plan.ts:834), [src/billing-plan.ts:929](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/billing-plan.ts:929). Trial copy claimed the allowance would restart and referred to “what you have paid for”; cancellation copy claimed the current allowance lasted until `endsAt`, even when another billing period begins first. I changed the copy to distinguish trial conversion, renewal, and ending, and added regressions for earlier/later scheduled endings.

2. **P1 — The recipient-note limit disagreed with Postgres and could be bypassed by cleaning.**  
   Evidence: [src/store/pg-vouchers.ts:584](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/store/pg-vouchers.ts:584), [src/web/AdminVouchersPage.tsx:87](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/web/AdminVouchersPage.tsx:87). The server previously checked only the cleaned note; the browser’s `maxLength` counted UTF-16 units, while Postgres `char_length` counts Unicode code points. I now check both raw and cleaned input in code points, pass raw input to the server, and removed the incompatible browser limit. Tests cover 500/501 emoji and over-limit input shortened by cleaning.

3. **P1 — The existing paid-plan route test would fail on the new wire shape.**  
   Evidence: [tests/billing-usage-route.test.ts:338](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/tests/billing-usage-route.test.ts:338). Its exact equality omitted `periodAllowance` and `trial`. I updated it and added assertions for trial state. I also added a paid-reader voucher integration test proving gifts remain visible while not changing the paid allowance at [tests/billing-vouchers.test.ts:504](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/tests/billing-vouchers.test.ts:504).

4. **P2 — The tooltip link had an excessively long accessible name and a small touch target.**  
   Evidence: [src/web/PlanHelp.tsx:56](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/src/web/PlanHelp.tsx:56). I gave it a concise action-oriented label, retained the full explanation as its accessible tooltip description, and increased the coarse-pointer target to 40px. Keyboard focus and touch sizing are now tested.

5. **P2 — Important normalization and outbox behavior lacked effective regressions.**  
   Evidence: [tests/billing-voucher-emails.test.ts:1016](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/tests/billing-voucher-emails.test.ts:1016), [tests/billing-voucher-emails.test.ts:1125](/home/greg/code/spideryarn2/.claude/worktrees/fb-voucher-note-and-profile/tests/billing-voucher-emails.test.ts:1125). I expanded coverage to CRLF, lone CR, U+2028/U+2029, DEL and C1 controls, and added a failed-send/edit/retry test proving the outbox retries its frozen original body.

The HTML path is safe: recipient text is cleaned, escaped at the HTML boundary, and never interpolated into the subject, header, or authored link. Create replay, re-addressing, and note-only edits have the intended semantics. The prorated sentence is supported by the quota-adjustment implementation: a current-period mismatch comes from a same-subscription, same-period price change. Spend formatting and `.gifts` consumers showed no further defects.

Verification:

- Requested unit tests: **124/124 passed**.
- All four underlying TypeScript compiler invocations passed.
- `git diff --check` passed.
- Exact `npm run typecheck` could not start because the sandbox denied `tsx`’s local IPC socket.
- The voucher email, voucher, and additional billing usage database tests could not initialize because the sandbox denied access to local Postgres/Docker.

**Overall:** no unresolved code findings, but I would not call it ready to land until the three database-backed tests pass in an environment that can reach local Postgres. I made no commit and left unrelated feedback/generated-file changes untouched.