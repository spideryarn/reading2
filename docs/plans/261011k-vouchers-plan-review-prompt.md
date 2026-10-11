Review the plan docs/plans/261011k-vouchers-paste-name-and-address-several-to-one-person-add-up.md, read-only.

Check its claims against the code: src/store/pg-vouchers.ts (claimVouchersFor, the readdress and the reader-plan read), src/store/pg-billing.ts (freeEntitlement, lockBillingAccount), src/db/schema.ts (billing_vouchers indexes), src/billing-plan.ts (giftMakeup), src/web/AdminVouchersPage.tsx, src/web/AdminAuthorGifts.tsx, src/email-address.ts, docs/project/billing.md § Gift vouchers.

Specifically:
1. Is it true that several vouchers to one address already add up end to end (create, claim, entitlement, revoke, the email to an existing reader, /profile and shelf copy, the admin list)? Anything that assumes one voucher per address?
2. Is "additive" correctly stated in slots?
3. Any trap in parsing "Name <email>" in an onChange of a type="email" input (browser sanitising, React controlled input, caret), and edge cases the parser should accept or refuse.
4. Anything simpler or anything missing.

Write findings as a numbered list, each with severity (high/medium/low) and file:line evidence, then a one-line VERDICT: approve / approve with changes / rework.
