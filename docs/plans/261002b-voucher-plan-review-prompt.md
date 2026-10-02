You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only.

Plan: docs/plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md

Relevant code: src/store/pg-vouchers.ts, src/store/pg-voucher-emails.ts, src/admin-vouchers.ts,
src/web/AdminVouchersPage.tsx, src/db/schema.ts (billingVouchers), src/billing-plan.ts (ReaderPlan,
describePlan), src/billing/summary.ts, src/web/BillingSection.tsx, src/web/FreeAllowance.tsx,
src/web/Tooltip.tsx, src/web/admin-columns.tsx (Spend), src/admin.ts (formatSpendNanos),
src/web/PricingPage.tsx (FAQ), docs/project/security-map.md, docs/project/billing.md.

Check especially:

1. Security: the recipient note is admin-written text rendered into an email to a stranger. Is the
   escaping plan sufficient? Anything else (header injection, link spoofing, length, control chars)?
2. Outbox semantics: emails are rendered and frozen at queue time. Does adding the note break
   replay/idempotency, re-address, retry, or revoke? Any path that would send a stale or missing note?
3. Are the reader-facing claims the plan wants to make (free allowance is lifetime, paid resets on
   period end to the tier allowance, no rollover, ending plan returns to free, gifts count only on
   Free) actually true in the code? Is `periodAllowance` from the tier row right, including trials,
   prorated switches, and an ending plan?
4. Adding `gifts` to the paid arm of ReaderPlan: anything that assumes gifts only on free arms?
5. Simpler alternatives I missed, or over-engineering.
6. Whole-dollar rounding: any bad edge case?

Answer with numbered findings, each with severity (P0-P3), the file/line evidence, and a concrete
fix. Also state whether the plan's overall conclusion holds.
