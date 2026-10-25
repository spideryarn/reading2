You are reviewing code before it is pushed, in the worktree you are running in. Repo: Spideryarn (TypeScript, ESM).

The work: plan docs/plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md — read it in full, including "The plan review, and what building changed". Your own earlier plan review is docs/plans/261025f-...-plan-review-sol.md.

The diff: `git diff 381c2cdba -- src tests docs` (the base commit). Files: src/matter.ts (the `summary` kind, `MODEL_MATTER_KINDS`, `summaryAt`, `ownProseBefore`, `summaryPart`, `endsSummary`, `summaryExplained`, combineMatter changes), src/matter-summary.ts (new leaf), src/matter-labels.ts, src/matter-current.ts (matter/4, m3 hash with the list-item bit, matter/3 readable under m2), src/matter-shape.ts, src/types.ts, src/web/matter-view.ts, src/web/TableView.tsx, tests/matter-summary.test.ts (new), tests/matter.test.ts, tests/matter-step.test.ts.

Evidence already gathered (do not re-run the paid eval; it is cached anyway but needs a local corpus you do not have):
- The 261018b eval on all three sets: 0 prose folded with the updated gold; every classifier call a cache hit (request byte-identical); see the addendum in docs/investigations/261018b-front-and-back-matter-eval.md.
- Each guard in summaryAt/combineMatter/view was removed in turn and at least one test went red.

What to look for, ranked by severity, each with a concrete failure scenario:
1. Any way a block of the article's own body prose gets folded as `summary` (placement, extent, union precedence, the list-item cut, the inline-label stop, the question sub-heading rule).
2. Any way stored values become wrong or unreadable: the hash change (`matterInputHash` m3 vs `matter3InputHash` m2), `MATTER_READABLE_VERSIONS`, the visitor read path (src/store/public-reader.ts uses matterForReader), anything that persists or compares kinds (src/matter-shape.ts, src/store/*, PublicArticle). Check that nothing else in src/ switches exhaustively over the matter kinds or needs to hear about `summary` (grep for MatterKindName, MATTER_KIND_ORDER, KIND_LABEL, "abstract" near matter).
3. Whether the model's request is truly unchanged (MODEL_MATTER_KINDS order equals the old MATTER_KINDS order; matterInput/shownHeadings untouched).
4. The stub label on the client: TableView passes blocks[s.start]?.text — is s.start an index into the same `blocks` array, including when the masthead echo trims a stretch (src/web/matter-view.ts § matterStretches)? Structure's faint rows/ⓘ: do they show a label anywhere that now needs the first block text too?
5. Performance: summaryAt is called for every opening block in the labels rule and again inside stretchEvidence and ownProseBefore (which recurses into summaryAt for earlier labels, and calls matterWindows and sectionRanges each time). Is anything quadratic on a 3,000-block article? Fix if cheap.
6. Comments that are now stale or wrong.

You may FIX what you find inside these files (this is the house workflow): keep fixes small and in the style of the surrounding code, add or adjust a test for each behavioural fix, and run `npx vitest run tests/matter-summary.test.ts tests/matter.test.ts tests/matter-step.test.ts tests/matter-view.test.ts tests/public-dto-matter.test.ts` and `npm run typecheck` after. Do not commit, do not touch git state, do not run anything against a remote database. Report anything wider than these files for me to decide.

Write your answer as: findings (severity, file:line, scenario, what you changed or why you did not), then the list of files you edited.
