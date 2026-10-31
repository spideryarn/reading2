You are reviewing a plan before it is built, in the Spideryarn repo (current directory). Read-only.

Plan: docs/plans/261031c-archiving-leaves-a-public-article-on-the-public-list.md
Context: Greg's decision quoted in the plan; docs/user-feedback/questions/q-d4586t.md; docs/project/library.md (search "archiv"); docs/project/public-shelf.md; docs/project/security-map.md.
Code: src/store/public-library.ts, src/store/pg-cited-in-spideryarn.ts, src/public-copy.ts, src/routes.ts (sendThenRefreshPublicTopics, the PATCH /api/library/:slug and POST /api/library/:slug/open handlers), src/store/pg-shelf.ts recordOpen, src/public-shelf-topics.ts, src/public-library-topics.ts, src/web/Masthead.tsx, src/web/PaperCard.tsx, src/web/ShelfEntry.tsx, src/web/useArchive.ts, src/web/PrivacyPage.tsx, src/messages.ts (SHARING_MARK_ON_ARCHIVED etc).

Please find:
1. Any place the plan misses that encodes "archived => not publicly listed / not publicly discoverable" (grep widely: src, tests, docs, evals, MCP tools, chat tools prompt text, the public topic tree withholding logic, the shelf's Include public section which excludes your own shared articles).
2. Whether the security reasoning holds: does dropping the archived clause from the listing or the cited-in candidates weaken any defence or leak any owner-only fact (e.g. archived state, opens) to strangers?
3. Whether dropping the topic refresh on archive/put back/open is safe — e.g. on the first request after deploy, when previously hidden archived articles reappear in the listing, what do the public topic pills do (withheld? stale? who rebuilds them, and when)? Does the plan need a one-off refresh or does the existing mechanism cover it?
4. Anything else wrong, or a simpler route.

Write a numbered list of findings, each with file:line evidence and a severity, then a one-line verdict: "VERDICT: proceed", "VERDICT: proceed with changes", or "VERDICT: rethink".
