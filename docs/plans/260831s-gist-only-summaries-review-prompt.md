# Plan review: delete the summary length ladder, keep the gists

Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Nothing built yet beyond one small
badge fix; this is a **plan-stage** review.

**The plan:** `docs/plans/260831s-gist-only-summaries.md`. Read it first.

Greg has decided that Summary mode keeps its one-sentence gists (written by stage 4 onto every tree
node, free) and loses the generated length ladder (`short` and `long`, stage 5e, `summary.json`). He
chose "full removal" over "reader-facing removal only" when both were put to him. That decision is
not under review. **What is under review is whether the plan has found everything, and whether
anything it proposes to delete is load-bearing for something else.**

## What I want from you

1. **What did I miss?** Walk the actual code, not the plan's list. Start at `src/summarise.ts`,
   `src/types.ts` (`Summaries`, `SummaryEntry`, `SummariesResponse`, `SummariesFound`),
   `src/store/artifacts.ts` (the artefact-kind union), `src/store/pg.ts`, `src/public/dto.ts`,
   `src/web/tree.ts`, `src/web/params.ts` and `src/web/App.tsx`. Name files and line numbers the
   plan does not mention.

2. **What breaks that the plan treats as incidental?** In particular: does anything read
   `summary.json` or the `article_revisions.summary` column for a purpose other than the Summary
   panel — a shelf badge, a staleness computation, a revision carry-forward policy, an admin view,
   the offline store, `db:export`/`db:import` round-trip fixtures? A step disappearing from
   `STEP_ORDER` may change job ordering, cost estimates or a progress UI in ways a grep for
   "summary" will not show.

3. **The database column.** The plan proposes leaving `article_revisions.summary` in place with
   nothing reading or writing it, because dropping a column destroys real readers' data and needs
   Greg's sign-off separately. Is a column that nothing reads a hazard here — does any code path
   (revision carry-forward, `beginDraftIn`, an artefact-presence query, a `select *`) still touch it
   in a way that would break or silently mislead once the type is gone?

4. **The tests.** Six test files import from `src/summarise.ts` only because it was a handy example
   of "a pipeline step": `block-policy-prompts`, `job-failure`, `profile-prompts`,
   `store-carry-forward`, `pipeline-artifact-store`, `supplement`. The plan re-points them at
   `glossary` or `ideas`. Read each and say whether re-pointing preserves what it was testing, or
   whether one of them is actually testing something specific to this stage that would be lost.

5. **Anything in the plan that is simply wrong.** I would rather be told now.

Be concrete, cite file:line, and say NO-SHIP if the plan would leave the tree broken or would delete
something that is still load-bearing.
