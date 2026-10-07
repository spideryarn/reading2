Stage 1 is a sensible minimal product change: the separate name earns its column because it also makes the voucher list useful. Putting the greeting above the italic personal note is clearer. No P0 issue found.

### Findings

- **F1 — P1 — Manual workaround bypasses the defence pause**  
  [plan:52](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:52>)  
  Pasting the private URL into `recipient_note` puts the credential into the voucher row, the POST request, admin-list response/UI, frozen text and HTML email bodies, Resend, and the inbox. Those are precisely the new flows awaiting approval. Doing it manually avoids a code edit but does not avoid the security decision.  
  **Fix:** describe C as technically possible but not recommend it before Greg approves the additional credential copies.

- **F2 — P1 — The security background gives Greg a false inventory**  
  [plan:143](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:143>), [security-map.md:262](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/project/security-map.md:262>)  
  The question says the key currently appears only in the address bar and owner’s card. It also travels in two public requests and is accepted in browser history and Vercel’s access log.  
  **Fix:** copy the security map’s complete current inventory into the question and distinguish transient transport, platform logs, and durable application storage.

- **F3 — P1 — Options A and C cannot truthfully be said to put the key in “the same places” yet**  
  [plan:165](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:165>), [plan:184](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:184>)  
  C necessarily stores the full key in `billing_vouchers.recipient_note`. A first-class implementation could instead retain an article identity and freeze the URL only in the outbox—or it could store the full URL. Those have different security footprints. The promise that the voucher page detects an invalidated link also requires retained article identity and a current-key comparison, neither included in “one column”.  
  **Fix:** choose and document A’s persisted column, admin response, readdress behaviour, deletion behaviour, and stale-link check before presenting its risk or one-day estimate.

- **F4 — P1 — “Draft voucher” is much more than delaying its email**  
  [plan:209](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:209>), [pg-vouchers.ts:152](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/store/pg-vouchers.ts:152>), [pg-billing.ts:631](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/store/pg-billing.ts:631>)  
  Every unclaimed voucher row is immediately claimable; once claimed, every billing read counts it. A draft row would therefore grant the gift before Send. It would also enter the “waiting gifts” calculation used in other emails.  
  **Fix:** either use a separate prospect/draft table, or specify a draft state excluded from claim, waiting-sum, and entitlement queries plus an atomic draft→sent transition. Add the genuinely separate “prospect list, later converted to a voucher” option; it better fits people whose address or gift details are not known yet.

- **F5 — P1 — The browser’s hand-written replay fingerprint is missed**  
  [plan:104](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:104>), [useAdminVouchers.ts:158](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/useAdminVouchers.ts:158>)  
  `pendingCreate` manually fingerprints four fields. If `recipientName` is omitted, changing only the name after an uncertain request reuses the old UUID and receives a 409 instead of being treated as changed input.  
  **Fix:** explicitly add the name to this fingerprint and test the uncertain-request/name-only-change case.

- **F6 — P1 — Privacy work is required, not conditional, and the live page/test are absent from the file list**  
  [plan:118](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:118>), [PrivacyPage.tsx:296](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/PrivacyPage.tsx:296>), [privacy-page.test.ts:162](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/tests/privacy-page.test.ts:162>)  
  The page and its test deliberately enumerate recipient-authored gift-email content sent through Resend. A stored recipient name is another piece of personal data and another such value.  
  **Fix:** include `PrivacyPage.tsx`, its `LAST_UPDATED`, `tests/privacy-page.test.ts`, and the evergreen privacy explanation—not merely “privacy.md if”.

- **F7 — P1 — `oneLine` truncation conflicts with the promised 400**  
  [plan:100](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:100>), [email.ts:261](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/email.ts:261>)  
  `oneLine(text, 80)` truncates; it does not reject. The plan currently permits an implementation that silently shortens input while promising a 400.  
  **Fix:** reject the raw value above 80 Unicode code points first, then clean it; clean again at email rendering as defence in depth. Test 80/81 ASCII, emoji, and control-character cases.

- **F8 — P2 — No existing test pins the complete no-name email body**  
  [plan:129](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:129>), [billing-voucher-emails.test.ts:988](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/tests/billing-voucher-emails.test.ts:988>)  
  Current tests pin fragments, ordering, escaping, and equality between null/blank variants—not the whole previous text and HTML. A new test written after implementation cannot prove “byte for byte unchanged” unless the previous bytes are recorded.  
  **Fix:** capture exact pre-change invite and existing-reader outputs in fixtures or explicit golden assertions before changing the renderer.

- **F9 — P2 — Two adjacent nullable strings invite a silent argument-order mistake**  
  [pg-voucher-emails.ts:236](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/store/pg-voucher-emails.ts:236>), [pg-voucher-emails.ts:397](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/store/pg-voucher-emails.ts:397>)  
  `giftMessage` and `queueGiftEmail` already take `recipientNote` positionally. Inserting another `string | null` can swap name and note without a type error.  
  **Fix:** use a named `{ recipientName, recipientNote }` object, or at minimum append the new argument and add a test where both values are distinct.

- **F10 — P2 — Promised feedback bookkeeping has no corresponding action**  
  [plan:30](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:30>), [awaiting-approval.md:64](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/user-feedback/awaiting-approval.md:64>)  
  The plan says this job removes the stale private-link entry, but the file/action list omits it. It also does not name the eventual feedback ending note.  
  **Fix:** add both as explicit completion actions.

- **F11 — P3 — The subject does contain something Greg typed**  
  [plan:93](</var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md:93>)  
  The article count is administrator input and appears in the subject.  
  **Fix:** say “the subject carries neither the name nor any other free text.”

No export change is needed for Stage 1: the existing export is per article, not an account/voucher export. The proposed rendering boundary is otherwise sound—body-only placement prevents header injection, `oneLine` removes line breaks/control characters, and HTML escaping prevents markup injection.

The scoping decision to stop before building the private-link integration is correct; the plan is insufficiently cautious only in recommending the manual note workaround before that same decision.

`tests/share-link-token-stays-home.test.ts` passed: 6/6.

**Verdict: build with changes.**