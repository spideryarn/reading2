You are reviewing a small plan before it is built. Read-only: do not edit files. Repo: Spideryarn (TypeScript, Postgres via drizzle, React client in src/web/).

Plan: docs/plans/261003b-earlier-tab-counts-on-the-pills.md
Prior work: docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md, docs/plans/261001c-earlier-tab-marks-not-shipped-too.md
Code: src/web/FeedbackEarlier.tsx (useEarlierFeedback, EarlierFilter, EarlierList, isEarlierFeedbackPage), src/web/FeedbackDialog.tsx (where they are used), src/routes.ts (GET FEEDBACK_PATH, around line 7990), src/store/pg-feedback.ts (listMine, idFilter), src/store/contracts.ts (FeedbackStore), src/types.ts (EarlierFeedbackPage, EARLIER_FEEDBACK_LIMIT), src/feedback-ending.ts, src/web/styles/feedback.css.
Tests: tests/feedback-store.test.ts, tests/feedback-route.test.ts, tests/feedback-dialog.test.tsx.

The request (Greg, admin, 2026-10-01): "In Feedback / Earlier / Not shipped, it says at the bottom 'Showing your 50 most recent.' Is that true? Are there >50 not shipped? Perhaps include a number/badge in the tab-pills for Shipped and Not shipped?"

The plan's conclusion to check: the line was true (production, read-only: 345 rows all Greg's; under build 43be719's shipped map 115 not shipped; under main's map 40). Is the reasoning that the line can only appear with >50 after the filter correct given the code? Then: is the counts design right (separate countMine store method returning {all, in} with the same id predicate; unshipped = all - in; counts on every page; client keeps the first counts per opening)? Could counts and list disagree in a way a reader would notice (e.g. a race, or the store and the map differing)? Does unshipped = all - in really equal what the 'out' filter returns? Is showing a count on All right? Copy of the cap line. Accessibility of a number inside an aria-pressed button. Anything simpler that is still correct. Tests that would break.

Give findings as P0/P1/P2 with file:line, then a one-line verdict (GO / REVISE).
