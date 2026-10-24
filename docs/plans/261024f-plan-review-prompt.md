Review this plan, read-only, before it is built: docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md

Context: Spideryarn repo. Read the plan, then check it against the code it touches:
src/store/pg-author-gifts.ts (finishLookup, patchAuthorGift, sendAuthorGift, listAuthorGifts),
src/author-lookup.ts (AUTHOR_LOOKUP_SYSTEM, runAuthorLookup, authorLookupNotes),
src/author-lookup-start.ts, src/store/pg-voucher-emails.ts (giftMessage), src/store/pg-vouchers.ts
(giftAudienceFor, createVoucher, starter resolution), src/store/voucher-starter.ts, src/db/schema.ts
(author_gifts, author_lookups), src/routes.ts (the /api/admin/author-gifts routes), src/web/AdminAuthorGifts.tsx,
src/web/useAdminAuthorGifts.ts, src/mcp/tools.ts (author-gift tools), docs/project/admin.md § Author gifts,
docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md (D4, D6, D7), docs/project/security-map.md.

Look for: correctness holes (races between delete and send/lookup/restore; the preview diverging from what Send
actually sends; anything the preview route could leak, e.g. the private link key); whether D3 (model's suggested
message filling the empty note-to-them field) genuinely stays within 261010c's D7 risk acceptance or widens it;
whether D4's split of the prompt into a fixed part and an admin-editable part keeps the defences intact; anything
simpler that would serve Greg's three reports equally well; missing tests. Rank findings by severity, each with
a concrete failure scenario. Be concise.
