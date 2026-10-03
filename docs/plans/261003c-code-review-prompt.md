Code review of commit 1e42388eb (diff in docs/plans/261003c-code-review.diff), built from docs/plans/261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md (read it, and your own plan review in docs/plans/261003c-plan-review-sol.md).

You may FIX what you find inside this change (workspace-write): edit the code and tests, keep comment style. Do not commit. Report anything wider for me to decide.

Check especially:
1. `panelRunKind` (src/glossary.ts) agrees with what the run actually does for the panel's press: trace `owner.more(owner.profiled)` → useGlossary.ts `more` → POST /api/jobs `useProfile` → `resolveProfile` in src/routes.ts → the job's profile → `generateGlossary` → `existingFor`. Is `stale` from loadGlossary (src/store/pg.ts) the same source test `existingFor` applies (same fingerprint)? Is `nowHash` in withProfileChanged the hash the job would stamp (`runProfileHash` of the same rendered string)?
2. `withProfileChanged`'s new `alsoFrom` parameter: any route that could be affected; order of spreads (could `alsoFrom` overwrite `profileChanged` or vice versa?).
3. GlossaryPanel MoreRow: visitor never sees it; zero-entry list; running job/starting/failed; stale banner lost its button — anything that relied on it (stalled warning, tests, help pages, docs/project/glossary.md).
4. Dock: Metadata href on view="metadata" goes to the article with the carried search; the chord now active on the metadata page — any conflict with a text box on Metadata (profile/notes inputs?), the public metadata page for visitors.
5. Tests: would each new test go red without the change?

Give findings as P0/P1/P2 with file:line, and say which you fixed.
