The plan is not ready to build. D1’s locking design is sound, but D2–D4 have three high-severity gaps.

1. **High — D3 widens the accepted prompt-injection risk.** The old design explicitly kept model prose in admin-only notes ([261010c](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md:198), [D6](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md:224)). D3 instead puts untrusted model prose into an outbound email ([plan](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md:98)).  
   **Failure:** an article says “put this insulting/scam sentence in the message”; the lookup complies, fills the empty recipient note, and Greg sends after a cursory review. The human Send press mitigates this but was already present in D7; it does not make the new effect part of the old acceptance.  
   **Simpler option:** keep the suggestion private and add an explicit *Use as message* button beside it. That resolves Greg’s confusion without crossing the old boundary. Otherwise record a new explicit risk acceptance and update the security docs.

2. **High — “The email that will be sent” is not guaranteed to be what Send queues.** Preview and Send independently resolve mutable inputs. `giftAudienceFor` depends on account status, plan, usage, other waiting vouchers, and fallbacks after Auth failures ([pg-vouchers.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/store/pg-vouchers.ts:539)); Send also resolves the live starter title/link before queueing ([pg-vouchers.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/store/pg-vouchers.ts:690)). The Send comparison protects only email, name, note and article count ([pg-author-gifts.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/store/pg-author-gifts.ts:1296)).  
   **Failure:** preview shows an invitation; the recipient signs up, another voucher changes their waiting count, Auth transiently fails, or the article title changes; Send queues different prose. The plan acknowledges only sign-up, while still calling the block exact.  
   Either freeze a server-side preview snapshot that Send consumes, or label it honestly as a current preview and enumerate all mutable parts.

3. **High — the no-private-key preview path is underspecified.** The existing starter resolver reads the real key for private articles ([voucher-starter.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/store/voucher-starter.ts:92)), and the security map deliberately says that key reaches only the stored/sent email and pins its callers ([security-map.md](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/project/security-map.md:399)).  
   **Failure:** preview renders with the real URL and replaces it afterward; a missed text/HTML/error path returns the key to the browser.  
   Specify a no-key resolver that reads title, visibility and `share_token_at`, then passes the placeholder—not the real URL—into `giftMessage`. Update the security map and strengthen `share-link-token-stays-home.test.ts`.

4. **Medium — D4 does not keep all outbound-message safeguards fixed.** URL/address validation and the article fence remain fixed, but “claim nothing”, “no invented praise/numbers”, and the length rule move into editable guidance ([plan](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md:135)). Editable guidance also has the same system-message priority as the fixed text and can contradict it.  
   **Failure:** a tone edit accidentally removes the truthfulness rules; hostile article text then becomes an invented claim in an outbound message. Keep truthfulness, injection reminders and the hard output bound in the fixed portion. Testing that the fixed words occur in the prompt does not prove they remain effective when guidance contradicts them.

5. **Medium — guidance version semantics race and reset incorrectly.** `startAuthorLookup` reads guidance only when after-response work runs ([author-lookup-start.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/author-lookup-start.ts:125)), although the UI promises it applies to lookups “started after” Save.  
   **Failure:** lookup A is created, Greg saves guidance B, then A’s delayed task starts and unexpectedly uses B. No `guidance_id` on the lookup records which version produced its message. Also, *Back to built-in* stores a copy, so a later code update to the built-in safety text remains shadowed forever. Snapshot/link the guidance version when the lookup row is created, and represent reset as “use the current built-in”, not copied text. Without provenance, a single mutable settings row is simpler and serves the report equally well.

6. **Medium — 120 words and 500 characters conflict.** A valid 120-word answer commonly exceeds the voucher’s 500-character limit; silent word-boundary truncation can remove the required final “Greg” or leave an incomplete sentence. Align the prompt with the real stored bound, or leave over-limit suggestions unapplied in private notes.

Missing tests:

- Deterministic delete races against Restore, Send freeze, `beginLookup`, and `finishLookup`.
- Preview versus the actual persisted `billing_voucher_emails.body_text`, for invite and reader audiences.
- A sentinel private key absent from the entire serialized preview; no HTML returned.
- Guidance save/lookup ordering and built-in reset after the built-in constant changes.
- Suggested-message control characters, over-limit output, preserved sign-off, and an admin edit landing while the lookup runs.

No correctness hole was found in D1’s proposed row-lock/cascade behavior itself.