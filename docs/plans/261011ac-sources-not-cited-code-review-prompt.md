You are the code reviewer AND fixer for one feature in the Spideryarn repo, in this git worktree.
Read CLAUDE.md for the house rules. The feature: Sources › Not cited, plan
docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md (its "GPT Sol's plan review,
and what changed" section is your own earlier plan review, and overrides the body). The scoped diff
against origin/dev is docs/plans/261011ac-sources-not-cited-code-review.diff (generated snapshots,
the help corpus and fixtures left out; read them in the tree if needed). Main files:
src/related-work.ts, src/store/pg-related-work.ts, the related-work routes in src/routes.ts,
src/types.ts RelatedWorkResult, src/messages.ts RELATED_WORK_*, drizzle/20261011175129_related_work_searches.sql,
src/web/NotCitedPanel.tsx, src/web/useRelatedWork.ts, src/web/modes/sources/SourcesMode.tsx,
src/web/params.ts, src/web/PrivacyPage.tsx, docs/project/sources.md, tests/related-work*.test.ts,
tests/not-cited-panel.test.tsx.

Things the author worries about (look at these last, after your own pass):
- The exclusion matcher: any path where a work the article DOES cite is shown as not in its
  bibliography (the worst error), or a generic title excludes a genuinely uncited work.
- OpenAlex's answer as untrusted text: bounds, shape checks, links built only by citerUrl, nothing
  logged that carries the query (which holds the article's words).
- Owner-only: GET and POST under the owner filter; a visitor makes no request and never sees the chip;
  ?sources=not-cited on a visitor's page.
- The new rate-limit bucket `related-work-search` (src/related-work.ts RELATED_WORK_RATE_POLICY) and
  the CHECK constraint word: does it follow how other buckets are wired, and is it actually enforced
  before the OpenAlex call?
- The press: no GET ever calls OpenAlex; the button is held; a failed Search again keeps the list.
- The stored row re-checked on read; queryChanged; the abstract-first query recipe
  (related-work/2) and email stripping.

You may run vitest on single files that need no database or network (e.g.
`npx vitest run tests/related-work.test.ts tests/not-cited-panel.test.tsx`); the pg tests need
Postgres, which your sandbox lacks — the author ran them: tests/related-work-pg.test.ts passes.

Fix what is inside this feature, narrowly, red-first where it is a behaviour bug (add a failing test,
then fix). Do not commit. Do not edit security defences listed in docs/project/security-map.md §
Where the defences physically live — report instead. Report, do not fix, anything wider.

Output: findings with IDs F1.., each with severity P0 (wrong/harmful), P1 (fix before landing),
P2 (worth doing), P3 (nit), evidence (file:line), and whether you FIXED it (and which files) or
only REPORTED it. End with one line: verdict LAND, LAND AFTER FIXES (all fixed), or HOLD.
