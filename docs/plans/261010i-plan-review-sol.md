**APPROVE WITH CHANGES.** Reusing `author_gifts` is reasonable for the stated author campaign. Article-less drafts can wait for v1, provided the tool clearly states that limitation. A preview would leave nothing to review and send on `/admin/vouchers`; changing `billing_vouchers` would disturb more billing paths.

1. **High — Send does not bind approval to the reviewed gift.**  
   [AdminAuthorGifts.tsx](/var/tmp/spideryarn-worktrees/agent-a9611895ca950261c/src/web/AdminAuthorGifts.tsx) shows the recipient, but posts only the gift ID. An MCP edit can change the address after Greg reads the confirmation and before `sendAuthorGift` freezes the row. The private link then goes to an address he did not approve. This is pre-existing, but matters especially when Send becomes the confirmation boundary.  
   **Fix:** Send the reviewed voucher fields as an expected snapshot; compare them atomically when freezing, returning 409 if they changed. Test an address change between confirmation and Send, asserting no voucher or email is created.

2. **Medium — The tool would record human rights confirmation before it happens.**  
   D1 proposes sending `rightsConfirmed: true` automatically. [pg-share-link.ts](/var/tmp/spideryarn-worktrees/agent-a9611895ca950261c/src/store/pg-share-link.ts:149) records that value in the sharing audit when the link is created. Adding a sentence to the later Send dialog does not make that earlier record accurate. Keeping the key out of MCP results is good, but does not resolve this distinction.  
   **Fix:** Let MCP save the draft without enabling a missing private link. Require actual rights confirmation on Send, then create the link through the existing sharing machinery before creating the voucher. The browser’s already-confirmed ensure path can retain its present behavior. Test that MCP drafting creates no confirmed-sharing audit event.

3. **Medium — A concurrent ensure loser can still mutate an existing gift’s link.**  
   `ensureAuthorGift` checks for an existing gift before resolving or creating the link, outside the insert transaction. Both calls can see no gift; A inserts it; Greg turns its link off; delayed B creates another link, loses the insert, and answers “existing, nothing touched.” `keepExisting` preserves an enabled key but does not prevent this re-enabling.  
   **Fix:** Serialize ensures per article and recheck for the existing gift after acquiring that lock, before any link mutation. Add a controlled concurrent test covering the interleaving above, plus differing initial fields and lookup preferences.

4. **Medium — The test plan needs positive controls and actual lookup completion.**  
   The remote design is sound: without `email`, `update_gift_voucher` cannot reach the store’s readdress-and-email branch. But listing and rejection tests alone would also pass if every remote update refused. Likewise, starting a lookup does not prove it preserves supplied fields.  
   **Fix:** Add successful remote edits with no queued email; direct calls to omitted tools with no route reached; a future asking tool filtered by default; and a completed lookup that preserves supplied email/name, retains their null provenance, fills empty fields, and appends notes. Keep explicit browser checks for unchanged default `202`, existing `200`, and MCP no-lookup `201`.

5. **Low — Make the remaining contract details explicit.**  
   Initial fields should reuse PATCH’s **validation rules**, not its complete request contract: PATCH requires `notesBase`, rejects an empty object, and accepts operations such as discard and append. The new ensure answer also needs `lookupId: string | null`.  
   **Fix:** Specify a strict create-fields subset, allow omitted/empty initial fields, initialize the notes timestamp, and preserve PATCH’s concurrency requirements. Apply remote filtering only through `remote.ts`’s injected tool list, leaving stdio’s default `TOOLS` intact. Update the author-gift enumeration, all-tool argument fixtures, and old remote tests expecting approval-refusal wording. Describe `draft_author_gift` as an article-bound alternative to immediate gifting.

No files edited.