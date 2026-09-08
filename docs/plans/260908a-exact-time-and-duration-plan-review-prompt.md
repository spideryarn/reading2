You are reviewing a PLAN, before any code is written, in the repo at
/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings (branch
`worktree-fb2k-metadata-step-timings`, based on origin/dev @ 8e78a20e).

The plan is `docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md`. Read it in
full first. It is untracked; read it from the working tree.

## Context you will want

- `src/web/Metadata.tsx` — the page. `StageRow`, `Wrote`, `exactly`, `weight`, `ago` are the
  functions the plan touches, near the bottom of the file.
- `src/types.ts` — `StageState` (search for `export interface StageState`) and `ArticleMetadata`.
- `src/store/pg.ts` — `articleMetadata`, around line 2522; the `stages` map is around line 2808 and
  carries the comment explaining why `ranAt` is `finished_at` only.
- `src/db/schema.ts` — `revisionStepRuns`, around line 2251.
- `src/store/pg-revisions.ts` — `beginStepRun` (~1396), `finishStepRun`, `recordStepRun` (~1546),
  and `beginDraftIn`'s carry-forward of step runs (~1050).
- `src/web/Tooltip.tsx` — `mouseOnly: controlled`, around line 191.
- `docs/project/tooltips.md`, `docs/project/touch.md`, `docs/project/copy.md`.

## What I want from you

Judge the plan, not my prose. In particular:

1. **Is the claim that the exact-time tooltip already exists correct?** I read it off `Wrote` in
   `Metadata.tsx`. Is there a state in which a step row shows a relative time with no card, or shows
   no time at all where it should show one?
2. **Is `startedAt` on the wire safe and correct?** Specifically: can `started_at` and `finished_at`
   on one `revision_step_runs` row ever come from *different* runs, which would make the subtraction
   a lie? I claim they cannot, from `beginStepRun` overwriting both and `finishStepRun` only
   updating a row it holds. Check that, including the carry-forward path and the `recordStepRun`
   path.
3. **Is the touch ruling defensible?** I argue this tooltip needs no reveal-then-commit because its
   trigger has no click behaviour, so `useHover`'s default touch handling already opens it on a tap.
   Is that right about `@floating-ui/react`'s `useHover` and about the synthesised event sequence?
   If it is wrong, say what the fix is, and say whether it is worth doing here at all.
4. **Anything the plan should have said and did not** — a null case, a store contract, a doc that
   owns a fact I am about to restate somewhere else.

## Severity scale — put one on every finding, and an ID (`P0-1`, `P1-1`, …)

- **P0** — the plan will ship something wrong or unsafe.
- **P1** — a real problem worth fixing before building.
- **P2** — worth considering; I may decline it.
- **P3** — taste.

If the plan is right, say so plainly rather than manufacturing findings. State a verdict at the end:
build as written / build with these changes / reshape.

## My own suspicions, last, so they do not steer you

- The duration of a step whose row was **carried forward** by `beginDraftIn` describes the run in
  the *previous* revision, not this one. The card will say "took 8.4s" about a run this revision
  never did. Is that a lie worth a different sentence, or is it the same thing `ranAt` already does?
- `exactly()` in `Metadata.tsx` is a different function from `exactly()` in `relative-time.ts`, and
  both exist. I am not touching that, but say if it bears on this.
