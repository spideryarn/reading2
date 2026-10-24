Code review of plan 261024f, built — you may fix what you find inside this change (workspace-write), and report
anything wider for the author to decide.

The plan, with its Revision 1 (which wins), is
docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md; your own
plan review is docs/plans/261024f-plan-review-sol.md. The change is the last commit on this branch:
`git show HEAD --stat` and `git show HEAD`.

What it does, in short:
1. DELETE /api/admin/author-gifts/:id deletes a discarded gift (deleteAuthorGift in src/store/pg-author-gifts.ts,
   under the gift's row lock; refused unless statusOf says "discarded"). Page: Delete + inline confirmation on a
   discarded gift's line (src/web/AdminAuthorGifts.tsx).
2. GET /api/admin/author-gifts/:id/email renders the email via giftMessage with giftAudienceFor and the starter's
   revision title, the private link replaced by STARTER_LINK_PLACEHOLDER (previewAuthorGiftEmail). Page: EmailPreview
   on draft/sending cards; relabelled editor; "Private notes".
3. The lookup's suggestedMessage is stored on author_lookups.suggested_message and offered on the card with "Use as
   your message", which opens the editor prefilled; never written into recipient_note by the server.
4. author_gift_guidance (insert-only, null = built-in), GET/PUT /api/admin/author-gift-guidance, authorLookupSystem
   (src/author-lookup.ts) with fixed rules + Greg's guidance; startAuthorLookup reads currentGuidance and records
   guidance_id when claiming. Page: src/web/AuthorGiftGuidance.tsx.
Migration: drizzle/20261024004506_author_gift_guidance_and_suggested_message.sql.

Check especially:
- the preview diverging from what Send queues for the same inputs (tests/author-gifts.test.ts compares them);
  whether any path can return the private key (the preview must never call pgShareLinkStore.read or resolveStarter);
- delete racing Send's freeze, Restore, beginLookup and finishLookup; the cascade and FK set-null behaviour;
- the guidance: parse rules, the built-in stored as null, the prompt's fixed rules surviving any guidance, the
  guidance being an admin's text placed in the system prompt (is any non-admin path able to write it?);
- the admin namespace gate covering the three new routes (tests/author-gifts.test.ts § the namespace gate);
- React: EmailPreview's refetch on updatedAt, stale responses, the delete confirmation's state, DraftEditor's
  noteToUse; anything that breaks the existing Send confirmation's snapshot semantics;
- docs (docs/project/admin.md § Author gifts, marketing-author-gifts.md) matching the code.

Gates to run after any fix: `npm run typecheck`, and
`npx vitest run tests/author-gifts.test.ts tests/admin-author-gifts.test.tsx tests/author-lookup.test.ts tests/author-lookup-start.test.ts tests/authenticated-api-route-contract.test.ts`.
Report findings ranked by severity, each with a concrete failure scenario, and list every file you changed.
