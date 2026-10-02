You are reviewing a plan before it is built, in the Spideryarn repo (current directory). Read-only.

Plan: docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md

Read it, then read the code it touches: src/web/AddArticle.tsx (JobCard, JobList), src/web/AddPage.tsx (PurposeBox, completion/openArticle, saveAndOpen, openWithoutIt), src/web/FeedbackButton.tsx (FeedbackHost, useFeedbackOpen), src/web/FeedbackDialog.tsx, src/web/ProfileBox.tsx, src/web/useAutosavedText.ts, src/web/purpose.ts, src/web/reader/Reader.tsx (capability/owner), src/web/relative-time.ts, src/urls.ts isWebUrl, src/types.ts Job. Also docs/project/security-map.md for anything rendered from reader input.

Find: correctness bugs the plan would introduce; states it forgets (StrictMode double effects, re-adds of an existing article, the alreadyArticle path, retries, uploads, a FeedbackHost absent); security issues (href from user input, anything in a feedback body that breaks the "ids not prose" rule); simpler designs that meet Greg's words; any claim in the plan that the code contradicts. Be concrete: file:line, the failing scenario, and the fix. Rank P0/P1/P2. Do not edit files. Also say plainly whether the overall design is sound.
