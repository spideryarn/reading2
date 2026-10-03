Review this plan before it is built. Read-only: change nothing.

Plan: docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md

Read it, then the code it names: src/web/FeedbackButton.tsx (FeedbackHost), src/web/FeedbackEarlier.tsx,
src/types.ts (EarlierFeedback), src/store/contracts.ts (MyFeedback, listMine), src/store/pg-feedback.ts
(listMine), src/routes.ts (GET /api/feedback), src/feedback-notice.ts (pageLine), docs/project/feedback.md.

Check, and say plainly where I am wrong:
1. The table of surfaces under "What is already true": is any row false, and is there a surface I missed
   where the page address does not arrive (or arrives stale, e.g. location.href read at render in
   FeedbackHost versus the address at send time)?
2. The page label rule: does a path-only label with /add/ collapsed actually keep credentials and search
   terms out of the response? Any other route whose PATH (not query) can carry a secret or third-party
   text? Check src/web's router for path shapes.
3. Is deriving the label in the store the right seam, versus the route? Which is simpler and safer here?
4. Is the conclusion right: that the request was already met by 7a590fe58 and this is the only gap worth
   building? If ending Shipped with no code is the better call, say so.
5. Anything in the tests list that would pass without the feature (a test that cannot go red).

Findings as P0/P1/P2 with file:line. Be brief.
