Code review of plan docs/plans/261001p-voucher-emails-to-recipient-and-creator.md (read it, with its
Log: your two plan reviews, 261001p-voucher-emails-plan-review-sol.md and
261001p-voucher-emails-plan-review-2-sol.md, are what the design answers to).

The change is exactly `git diff origin/dev HEAD` in this worktree (origin/dev is already merged, so
that diff is only this work). Commits: 6eacf764a (plan), 374ea318a (server), b743dd3b9 (client),
1cb319d61 (merge; the migration regenerated as 20261001191310_billing_voucher_emails, identical SQL).

You may edit: fix what you find inside this stage (server, client, tests, the migration only if it
is wrong and has not been applied anywhere but local), and report anything wider for the lead to
decide. Do not commit, push, deploy, or run anything against a remote database. Never send a real
email: tests use the fake fetch seam, and tests/setup/provider-guard.ts refuses api.resend.com.

Look hardest at:
1. At most once: can any path call Resend twice for one delivery (reserve predicates, the stale
   lease, retry vs automatic racing, completion from an old attempt, the claim notice's recipient
   freeze)? Is the frozen request truly immutable once a provider call was attempted?
2. Can a send failure, or a failure in any bookkeeping after the event, fail or roll back a voucher
   create, a claim, a PATCH, or the GET /api/billing/usage plan read?
3. Does any address, the note, or a provider body reach a log line, a stored `detail`, or the
   recipient's email? Is the note absent from both emails?
4. Is every new route behind the admin namespace gate, with no reader-reachable write?
5. The browser-minted id: strict parsing, exact replay comparison, and nothing queued on a replay.
6. Tests: does each guarantee have a test that would go red if it broke? Name any that would not.
7. The client: Retry double-submit, the delayed re-read and its cleanup, and copy that is true.

Run, at least: `npm run typecheck`, and individually with `npx vitest run`:
tests/billing-voucher-emails.test.ts tests/billing-vouchers.test.ts tests/email.test.ts
tests/admin-vouchers-page.test.tsx tests/authenticated-api-route-contract.test.ts
tests/db-schema-drift.test.ts.

Answer: a verdict, numbered findings (P0-P3, file:line, what you changed or what the lead must
decide), and the exact gate results you saw.
