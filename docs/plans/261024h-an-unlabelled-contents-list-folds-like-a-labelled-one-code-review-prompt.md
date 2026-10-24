You are reviewing code built from a plan you already reviewed, in the Spideryarn repo (this working
tree). You may fix what you find, inside this change's scope; report anything wider for the author
to decide. Do not commit. Do not touch .env.local, infra/ or anything outside the repo.

The plan (updated after your plan review, including what was taken and not):
docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md
Your plan review: docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one-plan-review-sol.md
The diff under review: docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one-code-review.diff
(the working tree holds the same changes: src/matter-labels.ts, src/matter-current.ts,
tests/matter.test.ts, tests/matter-step.test.ts, docs/project/front-and-back-matter.md).

Evidence already gathered: `npx vitest run tests/matter.test.ts tests/matter-step.test.ts
tests/public-dto-matter.test.ts tests/freshness-deciders-agree.test.ts` passes; the two guards in
`linkedContentsRuns`/`matterByLabels` were each removed and a test went red; the three-set matter
eval shows 0 prose folded before and after with all numbers unchanged; on the real page the rule
yields one contents stretch over the 13 entries.

Look especially at:
1. `linkedContentsRuns`: the href regex against what src/blocks.ts actually stores in `Block.html`
   after sanitising (attribute quoting, entity-encoded ids, other attributes before href, a link
   wrapping more than the entry). Could an entry link to its *own* section heading in a way that
   matters? Anything a hostile page could do with links to fold prose — remember the
   half-showing floor and evidence checks in `holdStretches`.
2. The version split (`MATTER_PROMPT_VERSION` = matter/3, `MATTER_READABLE_VERSIONS` keeps
   matter/2): is it true that every reader of the version uses the right one? grep every use of
   `MATTER_PROMPT_VERSION` and `.version` on a matter document (src/store/pg.ts,
   src/store/public-reader.ts, src/pipeline.ts stamp, matterSettled, the public DTO, the export, the
   fleet/admin views if any). Is it sound that a matter/2 value is still safe to fold?
3. Does `matterInputHash` not covering `html` matter now that the rule reads `html`?
4. Tests: do they prove what their names say?

Write findings first, most severe first, each with file:line and a concrete failure scenario, then
what you changed (if anything) and why.
