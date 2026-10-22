You are reviewing a plan in the Spideryarn repo (cwd). Read-only: do not edit any file.

Plan: docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md

Context: docs/user-feedback/questions/q-xcc7xq.md (Greg's answer: "B yes. e.g. store which days (and times?) they've opened an article"), docs/plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md, src/store/pg-shelf.ts (recordOpen), src/routes.ts (POST /api/library/:slug/open), src/web/article/ArticlePage.tsx (the open POST), src/store/pg-admin.ts (activitySources), src/store/pg-article-transfer.ts, src/admin-articles.ts, src/store/article-rows.ts, src/store/export.ts, src/store/export-bundle.ts, src/web/PrivacyPage.tsx, docs/project/privacy.md, docs/project/admin.md.

Look for: correctness of the recordOpen transaction and the 30-minute throttle (races, lock order against other transactions that lock articles rows, e.g. transfer, destroy, billing), privacy-page wording that would be false of the code, anything missed that must hear about a new article-scoped table (registries, tests, exports, transfers, deletion, owner isolation, RLS/grants), whether the admin count could leak what anybody read, and whether a simpler design does the job.

Rank findings P0/P1/P2 with file:line evidence. Say plainly if you find nothing serious.
