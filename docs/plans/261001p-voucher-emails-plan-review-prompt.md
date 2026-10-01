Review this plan before it is built: docs/plans/261001p-voucher-emails-to-recipient-and-creator.md
(repo root is the current directory). Read-only: do not edit any file.

Context to read: docs/plans/261001m-gift-vouchers-for-free-articles.md (the vouchers as shipped),
src/store/pg-vouchers.ts, src/email.ts, src/after-response.ts, src/arrivals.ts, src/billing/sync.ts
(the upgrade notice and its address lookup), src/store/admin-accounts.ts (accountEmail),
the voucher routes in src/routes.ts (search ADMIN_VOUCHERS_PATH and /api/billing/usage),
src/admin-vouchers.ts, src/web/AdminVouchersPage.tsx, docs/project/email.md,
docs/project/security-map.md, docs/project/billing.md section on gift vouchers.

Greg's brief: email the recipient on creation (never the admin's private note); email the admin who
created the voucher when it is claimed (resolve the address from the creator); no expiry; a failed
send must not fail or roll back create/claim, is logged via src/log.ts and is surfaced on the
vouchers page; each email is sent at most once per voucher event so a retry or double-click cannot
send two; only admins create vouchers; never log addresses or the note; no real email in tests.

Look hardest for: a way to send twice (concurrency, retries, the Send again path, the stuck
'sending' recovery), a way a send failure or a DB error in the mail bookkeeping fails the
create/claim, an address or the note reaching a log or the recipient, anything the
at-most-once guard does not actually guard, and whether awaiting the send inside the admin
create request (an exception to email.md's rule) is the right call. Also whether the fallback
to adminAddress() when the creator lookup fails is right, and whether the creator's private note
belongs in the claim notice to the creator.

Answer with a verdict (build / build with changes / rethink) and numbered findings, each with a
severity (P0-P3), the evidence (file:line), and the concrete change.
