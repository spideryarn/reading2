You are reviewing code in this worktree, and you may fix what you find (workspace-write). Do not commit, do not run git commands that change history or the index, do not touch .env.local, the production database, or anything under infra/.

The plan, with your own earlier plan review folded in at the bottom: docs/plans/261009x-metadata-ai-processing-named-as-the-modes-are.md.
The scoped diff: docs/plans/261009x-metadata-ai-processing-named-as-the-modes-are-code-review.diff (plus the regenerated src/command-pick-catalogue.generated.json).

Look for:
1. Correctness: any place a step name or label is now wrong, blank, or looked up unsafely (unknown steps from a newer server, prototype keys); any place that still has its own copy of these names (grep src/web for hard-coded "Thread", "Reception", "Bibliography", "Simple summary", "Relation words" used as a step's name).
2. Command bar: does `rerunNames` still find every re-run row by what a reader types, and does `rerun peer review` / `rerun summary` / `rerun diagram` still pick no wrong paid run? Run the tests in tests/command-match-rerun-and-find.test.ts and tests/command-match-mode-aliases.test.ts.
3. Reader-facing copy: the one-line descriptions in src/web/step-names.ts for steps that are not modes. Are they accurate against the code (where each artefact is actually shown)? Plain words, no jargon?
4. Layout risk in src/web/Metadata.tsx: the new description line in RerunRow (order-last, basis-full) and in StageRow.
5. Stale comments the change left behind (in Metadata.tsx, rerun-commands.ts, ResetArticle.tsx, reset-role.ts, rerun-steps.ts).

Fix what is clearly wrong inside these files and run `npm run typecheck` and the affected vitest files (at most one vitest run at a time; the box is shared). Then write your answer: numbered findings, each with severity (P1/P2/P3), file:line evidence, and whether you fixed it; and a list of every file you changed.
