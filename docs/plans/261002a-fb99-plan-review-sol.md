## Verdict: build with changes

The historical diagnosis is correct. The requested ancestry command exits `1`; the reverse check exits `0`, so `6bdf24dc` predates `374ea318a`. The reported voucher could not have queued an email because that build had no voucher-email code.

1. **High — an existing reader can make an initial delivery failure unrecoverable.**

   Evidence: claiming alone does not race out the automatic send: automatic reservation checks only `status = 'queued'` ([pg-voucher-emails.ts:300](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-voucher-emails.ts:300)), deliberately ignoring current voucher state. But if reservation fails, the delivery remains queued ([pg-voucher-emails.ts:392](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-voucher-emails.ts:392)); if sending is skipped or fails, it becomes `skipped`/`failed`. Once `/api/billing/usage` claims the voucher ([pg-vouchers.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-vouchers.ts:170)), Retry refuses every gift because `claimed_by` must be null ([pg-voucher-emails.ts:290](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-voucher-emails.ts:290)). Missing `RESEND_API_KEY` is one concrete route into this state ([email.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/email.ts:165)).

   Change: allow a gift delivery to be retried after claim while the voucher is unrevoked and its frozen recipient still equals the voucher address. That matches the existing event-time eligibility rule. Add a test where claim lands before an automatic reservation failure or skipped send, then Retry succeeds.

2. **High — make “confirmed, unambiguous match” an explicit disclosure defence.**

   Evidence: the plan alternates between “exactly one confirmed match” ([plan:48](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:48)) and “two accounts for one address means invitation” ([plan:106](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:106)). Those differ when two accounts share the address but only one is confirmed. Filtering confirmed accounts first would select one and disclose its allowance despite the address being account-ambiguous.

   Change: normalize with the same trim-and-lowercase rule as claims; first collect all live accounts at that address, require exactly one, and only then require that account’s `emailConfirmedAt`. Two matching accounts must fall back to the invitation even if only one is confirmed. Test that exact case.

3. **Medium — the plan does touch defences; preserve them structurally.**

   Evidence: this is a new cross-owner read whose safety rests on the admin namespace gate ([routes.ts:10229](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/routes.ts:10229)), which the security map identifies as a defence ([security-map.md:90](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/project/security-map.md:90)). It also rests on `authAdminEndpoint` refusing an Auth/database project mismatch ([admin-accounts.ts:390](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/admin-accounts.ts:390)); the existing `accountSource` includes that check ([pg-admin.ts:649](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-admin.ts:649)). The plan’s “Not a defence” section is therefore wrong.

   Change: extract one reusable account-list source/helper that always passes through `authAdminEndpoint`; do not assemble `gotruePages` independently in the voucher path. State these defences in the plan and test that project mismatch produces the invitation without reading billing data.

4. **Medium — the email disclosure is reasonable, but `/privacy` must say what Resend receives.**

   Evidence: a unique, confirmed address is a reasonable basis for emailing that reader their own allowance. “The admin could already see it” ([plan:69](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:69)) is not the relevant privacy argument: the new copy puts usage-derived data in Resend and the recipient’s mailbox. The current notice says only that the address receives an email “saying” a gift was made ([PrivacyPage.tsx:284](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/web/PrivacyPage.tsx:284)).

   Change: add to the plan’s docs stage an update to `/privacy`, its `LAST_UPDATED`, the privacy reasoning doc, and its test, stating that an existing reader’s gift email may include their remaining article allowance.

5. **Medium — the advertised “after” number is not always the number after the next claim.**

   Evidence: `claimVouchersFor` claims every waiting voucher for the address in one update ([pg-vouchers.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-vouchers.ts:170)), while the plan knowingly calculates each email using only its own gift ([plan:104](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:104)). With two waiting gifts, an email can say “you have 23” although opening Spideryarn claims both and produces 33.

   Change: either include all currently waiting vouchers for that address in the post-claim number, or use the simpler precise wording: “Based on your account now, this gift by itself would take you from R to R′ available articles.” The proposed arithmetic itself is otherwise correct: `wallUsed` includes public pricing, minimal papers, in-flight work, and high-power use ([pg-billing.ts:314](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-billing.ts:314)); `ingestHeadroom` matches the wall’s overdraft rule ([points.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/billing/points.ts:238)); existing claimed gifts are already in the Free limit ([pg-billing.ts:388](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-billing.ts:388)).

6. **Medium — the deadline and tests are underspecified.**

   Evidence: the plan promises a deadline ([plan:82](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:82)), but `gotruePages` currently has neither an injected fetch nor an abort signal ([admin-accounts.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/admin-accounts.ts:316)). Merely racing the promise would leave the HTTP request running. The proposed tests inject the completed lookup, which can bypass the new matching, pagination, and timeout logic ([plan:110](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:110)).

   Change: pass one shared `AbortSignal.timeout(...)` through every page fetch and inject the page fetcher in tests. Add tests for:

   - timeout/abort and malformed or short account listings → invitation;
   - two address matches with only one confirmed → invitation;
   - billing read failure after identity is established → existing-reader wording without numbers;
   - lapsed Free, existing claimed gifts, public/minimal/in-flight/high-power usage;
   - a PATCH changing address and article count together uses the new count;
   - the post-claim Retry recovery in finding 1.

7. **Low — correct the diagnosis’s status wording.**

   Evidence: an attempted delivery need not leave only a `failed` or `queued` row as claimed ([plan:29](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/docs/plans/261002a-fb99-voucher-email-for-existing-user.md:29)); it may be `sent`, `skipped`, or stranded `sending` as well ([pg-voucher-emails.ts:369](/home/greg/code/spideryarn2/.claude/worktrees/fb99-voucher-email-existing-user/src/store/pg-voucher-emails.ts:369)).

   Change: say that any queued attempt would have left a row in some status. The empty table still conclusively supports the historical diagnosis.

The simplest implementation remains schema-free: one store helper performs the defended account lookup and returns `invitation | existing-free | existing-paid | existing-unknown`; `createVoucher`/`updateVoucher` render that once before their transaction and freeze it through the existing outbox. The routes should not duplicate account matching or allowance arithmetic.