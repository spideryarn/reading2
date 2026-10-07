Review the code built from a plan you reviewed, and fix what you find inside its scope.

You are in the worktree .claude/worktrees/open-before-structure, on HEAD 8a937ea37. You may edit
files (workspace-write). Fix defects in this change yourself, with a failing test first where one
can be written; report anything wider for me to decide. Do not commit. Do not run the full
`npm test` or `npm run check` (the box is loaded): run single test files with
`npx vitest run tests/<file>`, and `npm run typecheck` at the end. If Postgres or vitest is
unavailable in your sandbox, say so plainly and review by reading.

The change: docs/plans/261005j-open-before-structure-code-review.diff (this branch against its
merge base with dev; 36 files). The plan: docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
(§ Review record lists your ten plan findings and what the build was told to do about each). Your
plan review: docs/plans/261005j-open-before-structure-plan-review-sol.md.

Do an independent pass over the diff first. Then check these, which are the places I trust least:

1. Each of your plan findings F1-F10: is it actually closed in the code, or only in the plan's table?
2. `publishRevisionIn` (src/store/pg-revisions.ts): the one predicate for the main modes. Can they
   fire twice or never? Is the previous revision's tree read under the article lock? `boundToOlderBase`
   on the structure successor is written and has no test.
3. `enqueue` / `retryJob` (src/jobs.ts): the builder added a condition the plan did not have (no
   mark when the job itself holds a step that reads the structure). Right? Anything else that
   rebuilds a job's steps from names and drops `headingsFirst` (a requeue, a hand-back, the reset
   path, "Read this")?
4. The builder's own caveat: after a claim is handed back, `structure` re-runs (its `isDone` says no
   while awaiting) and then `assets` needs its window; a claim too short for `assets` would loop on
   `structure`. Is that reachable in production (LEASE_MS, STEP_BUDGET_MS, the deadline logic)? If
   it is, fix it: the builder's suggested fix is an `isDone` that counts the stand-in as done for
   the marked step of a never-published article.
5. The gate in `runStep`: one tree read per step after `structure` on every job. Acceptable, or
   should it read only when cheap? It sends a refusal to Sentry as an error: should an expected
   refusal be quieter (see how other `blocked` refusals are logged)?
6. `useLateStructure` (src/web/article/useLateStructure.ts): the F2 stale-list case was only ever
   red against a stub, never against the real hook with the freshness barrier removed. Mutate it
   and see. Also: a failed article fetch leaves the band saying "being built" with no retry until
   another structure job comes and goes; is there a cheap honest fix? Races: slug change mid-fetch,
   StrictMode double effects, sign-out, the images' second draw.
7. `OwnedReader` in ArticlePage.tsx mounts `useStepJob(slug, "structure", …, "quiet")` on every
   owned article, awaiting or not. Cost or side effect?
8. Diagram and Outline reset held node state on `root` identity, which also changes at the images'
   second draw. Harmless, or does it drop a real hover a second after open on every article with
   images? The keynav reset is unconditional on a plan change: same question.
9. After the merge with dev there are two notices in the Structure band: dev's `StructureNotice`
   (final headings tree; its "Try again" ends with "Reload the page") and this branch's
   `StructureArriving`. `StructureBand` draws one or the other. Is the split clean, and should
   `StructureNotice`'s finished state use the live swap now that it exists (only if small)?
10. Copy in src/messages.ts and the step detail: plain, true in every case (headingless articles
    get windows, not headings), and following docs/project/copy.md.
11. Tests that could pass for the wrong reason. The builders reported these weak spots: the
    Expanded notice case was never seen red; three assertions in structure-mode-faces were rewritten
    after the fix; the under-minimum step case and the two publication clauses were not mutated
    separately; adoption from a live job's queue slot is untested.

Do not write or alter any quotation attributed to Greg in any doc. Do not edit docs/project/*.md.

Answer with findings F1..Fn, each P0/P1/P2 and ESTABLISHED or REASONED, saying for each whether you
FIXED it (files touched, test added, red-then-green seen or not) or LEFT it and why. List every file
you changed. End with a verdict: ready to commit, ready after the listed items, or not ready.
