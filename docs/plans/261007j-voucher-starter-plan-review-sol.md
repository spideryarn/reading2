**Build with changes.** The existing chain is viable, but F1 and F2 need correction before building. No P0 found.

1. **F1 — P1: a failed email insert can log the key.**  
   The plan’s [“Not logged” claim](/var/tmp/spideryarn-worktrees/voucher-starter-article/docs/plans/261007j-gift-voucher-starter-article-by-private-link.md:108) misses the queueing failure path. `createVoucher` and `updateVoucher` call unguarded transactions; `queueGiftEmail` binds the complete email body. Drizzle includes those parameters in its error message, which `logRequest` preserves through `errorFields`.

   I reproduced the parameter exposure with a fake database client and sentinel key; no database was accessed. Delivery-time catches and Resend’s error allowlist protect the later send, not this insert.

   **Plan change:** use the existing `scrubDbError` boundary around the complete voucher write transactions. Add red-first tests that fail an email insert during both create and readdress, assert rollback, and verify that the sentinel reaches neither logs, HTTP errors nor captured monitoring events.

2. **F2 — P1: current starter validation breaks create replay.**  
   The [proposed ordering](/var/tmp/spideryarn-worktrees/voucher-starter-article/docs/plans/261007j-gift-voucher-starter-article-by-private-link.md:91) validates publication and the live link before entering `createVoucher`. Consider: create commits, its response is lost, the link is turned off, then the browser resubmits the identical request. The route returns 409 instead of acknowledging the voucher already created. This violates the existing replay contract.

   **Plan change:** distinguish an existing create from a new create before checking live starter readiness. Compare immutable request identity, including the starter, rather than its current key, title or visibility. Explicitly handle deletion: `ON DELETE SET NULL` loses the original starter identity. Retaining the original key-free `starterSlug` alongside the nullable foreign key is one straightforward solution.

   Red-first cases: lost response followed by link revocation, rotation and article deletion; identical replay queues nothing; a different starter under the same id conflicts.

3. **F3 — P2: the promised readdress warning needs more than a response field.**  
   After article deletion, the nullable foreign key cannot distinguish “never had a starter” from “starter was deleted.” Also, [useAdminVouchers.update()](/var/tmp/spideryarn-worktrees/voucher-starter-article/src/web/useAdminVouchers.ts:185) currently returns `null` on success and discards the PATCH response, so `starter: "dropped"` would not reach the page.

   **Plan change:** preserve enough key-free history to identify an omitted starter, carry the warning through a typed update result, and render it beside the saved-change confirmation. Resolve the starter only when an actual address change will queue an email. Drop it for established absence, revocation or ownership refusal; a database outage should fail the transaction rather than send an unintentionally incomplete email.

   Test deleted starter, revoked link, lookup failure, unchanged address, and the warning actually appearing in the page.

4. **F4 — P2: chaining the share-link POST must retain its existing uncertainty handling and confirmation.**  
   Every POST creates a new key and invalidates the previous one. The plan names the request and tick-box but leaves lost-response handling unspecified. The existing `PrivateLink` and `add-share-link` implementations treat an ambiguous write as unknown and recover by reading, rather than repeating POST.

   The existing confirmation also includes the shared-content inventory and personalised-artifact warning; shelf fields alone cannot supply these.

   **Plan change:** explicitly reuse those confirmation pieces and request semantics. Disable another create while pending; after an ambiguous result, read the existing link state before permitting another POST. Reset confirmation when the selected article changes, and fence late responses to their article and reader. Keep the key out of voucher input, preview and table state.

   Add red-first tests for lost/malformed POST responses, selection changes and confirmation reset.

5. **F5 — P2: make the browser-driven import lifecycle explicit.**  
   “No new background mechanism” is accurate. “The server never waits for an import” is accurate for the **voucher request**; the server still executes import work when the browser calls `/advance`.

   `App` starts the existing engine independently of the vouchers page, so navigation there does not stop imports. On Vercel, however, closing or suspending all driving tabs can pause progress. Hidden-tab polling stops; an already-started drive loop can continue while the browser permits it.

   **Plan change:** say this explicitly and reuse `KEEP_A_TAB_OPEN` in the form. Specify tracking the returned job id, refreshing the shelf after completion, and using `lastFailure()` for a refused add. Reuse existing progress/retry handling rather than implementing another job-state interpretation.

   Stage 2 needs red-first coverage for actual job advancement on this page, unrelated completions, completion after the user changes selection, failure/retry, and shelf refresh. Width checks alone cannot establish the chain works.

Your owner-context suspicion is cleared: `serveAuthenticatedApi` calls `setRequestOwner(user.id)` before the admin gate. The namespace does not substitute another owner. Resolving as the PATCHing administrator therefore behaves as described; omitting another administrator’s inaccessible starter is a reasonable fail-closed choice.

The normal email read path is also sound: `latestVoucherEmails` selects status columns, not bodies. Resend failures use allowlisted reasons. I found no ordinary body-to-admin-page path; F1 is the concrete additional key destination.

The two stages are sensible once these tests are added. Keep the existing no-starter goldens unchanged as compatibility checks.

A simpler version worth comparing is: paste the URL in the voucher form, open the existing `AddPage` in another tab, then refresh the picker and select the finished article. It preserves the voucher draft and reuses all import/sharing recovery UI, at the cost of a tab switch. The plan currently compares only against manually emailing the link, which gives up more of the requested outcome.

This was a read-only review; no files were edited.