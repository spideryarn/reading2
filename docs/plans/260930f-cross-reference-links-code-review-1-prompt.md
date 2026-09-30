# Code review, stage 1: 260930f cross-reference links (the `crossrefs` step)

Repo: the current working directory, a git worktree of Spideryarn. You may edit files (see "Fixes").

**Candidate**: commit `97c5c3c0`. The diff is `git show 97c5c3c0` (the full list of changed paths is
`git show --stat 97c5c3c0`). Start with `src/crossrefs.ts`, `tests/crossrefs.test.ts`, the migration
under `drizzle/`, `src/pipeline.ts`, `src/store/pg.ts`, `src/store/pg-revisions.ts`, `src/routes.ts`,
`src/web/auto-modes.ts`, `src/rerun-steps.ts`. That is where to start, not a limit on scope.

**The plan** it implements (stage 1 only):
`docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md`, especially
§ 1, § 3, the validation table, and "Stage 1 real runs". Your own plan review is
`docs/plans/260930f-cross-reference-links-plan-review-sol.md`. Check that F1, F3, F4, F8 (the part
on the server), F9, F11, F12 and F13 are really done in code, not only in the plan's prose.

Stage 2 (prose marks, client hook, cards) is NOT in this candidate. Another agent is building it
in parallel in this same tree, in `src/web/annotate.ts`, `TableView.tsx`, `BlockLinkCard.tsx`,
`ProseHoverCard.tsx`, `ArticlePage.tsx`, `reader-capability.ts`, a new `useCrossrefs.ts` and CSS.
Do not edit those files, and ignore uncommitted changes in them.

## What to do

1. An independent attack. Look for:
   - correctness bugs in validation: every rule in the plan's table must be enforced and tested;
     the unique "spaced" rendered-text match; the stored slice; the cap; the root cases;
   - freshness and stamp mistakes, where a stale artefact is reported fresh or a fresh one stale;
   - carry across revisions, and reset;
   - spend accounting (`ai_calls` ledger, budget, `max_tokens` truncation);
   - route authorisation: owner-only, with no public leak;
   - the auto-run posting order;
   - any registry the step should be in and is not.

   Run `npx vitest run tests/crossrefs.test.ts` yourself, and any other test that needs no
   database or network. You have no network, not even loopback, so Postgres-backed suites are
   mine to run.
2. **Fixes**: fix what is inside this stage, narrowly and red-first (a failing test, then the fix).
   Report, but do not fix, anything wider. Do not commit. Do not edit
   `src/sanitize-policy.ts`, `src/sanitize.ts`, `src/web/sanitize.ts`, `src/public/dto.ts` or any
   other file in docs/project/security-map.md § Where the defences physically live. If a finding
   needs one of those, report it.

Severity, graded by consequence:
- **P0**: data loss, exploitable security, incorrect charging, or the service broadly unusable.
- **P1**: user-visible wrong behaviour, or an authoritative contract violated.
- **P2**: design or maintainability risk with no wrong behaviour today.
- **P3**: prose defect.

Give every finding an ID (C1, C2…), a severity, file:line evidence, and whether you fixed it (with
the test that went red) or only reported it. End with a verdict: **approve** / **approve with
these fixes** / **changes needed**.

## My own suspicions (already mine, and worth less: spend most of the run elsewhere)

- The server computes rendered text with jsdom (`innerHTML` → `textContent`) and not with
  annotate.ts' `renderedText`. Can the two disagree (`<br>`, block-level children, entities,
  `<math>`, soft hyphens), leaving a phrase unique on the server that the client cannot mark?
- `crossrefs` is last in `STEP_ORDER` but posted in the first parallel group.
- The "nearby" rule uses the full block order, while ids are checked against body blocks only.
