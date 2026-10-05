# Review: Timeline dates on an article with no publication date (plan 261005d)

You are reviewing a small, already-built change in this worktree. It is the plan review and the
code review in one pass, because the change is small and was built while the cause was being
found; say so if you think the design itself is wrong, not only the code.

Read first:

- `docs/plans/261005d-timeline-dates-without-a-publication-date.md` — the plan, the cause, the
  measurement and what was passed over.
- `docs/project/timeline.md` — the mode, and the rule it lives by: nothing is dated unless the
  article dates it.
- The diff: `git diff origin/dev -- src tests docs/project/timeline.md` (uncommitted work is in
  the tree; `git status` shows the files).

The files changed: `src/timeline-time.ts` (`pieceYear`, `assumedYear` on `WhenInput`,
`resolveAtom`), `src/timeline.ts` (`dateEvent`, `toEvents`, `buildTimeline`), `src/types.ts`
(`When.yearFrom`), `src/web/TimelinePanel.tsx` (`datingWords`, `yearNotes`, the head of the
list, the open row), `src/web/marginalia/MarginaliaColumn.tsx`, and three test files
(`tests/timeline-time.test.ts`, `tests/timeline.test.ts`, `tests/timeline-resolve.test.ts`).

What I most want checked, in this order:

1. **The conclusion.** The plan says the cause is a missing publication date and that the
   prompt and the model's answer were right. Is anything in the code inconsistent with that?
2. **Can a date now reach a reader that the article does not support, beyond the one assumption
   the plan names?** In particular: `pieceYear` scans with `scanDates`; `resolveAtom` uses the
   assumed year with no direction logic; a range ("from July 13 through July 19") with one end
   carrying a year; 29 February in a non-leap assumed year; `labelStatesAnUncitedDate` is not
   passed the assumed year (is that right?).
3. **Every place `yearFilled` or `dating.kind === "rejected"` is read** — the panel, the
   marginalia, Skim, the visitor payload (`src/public/dto.ts`, which I deliberately did not
   edit because it is a defence), chat tools, export. Does any of them now say something false
   about a row with `yearFrom: "piece"` or a `noYearFrame` row drawn as words? Grep rather than
   trust my list.
4. **`evidenceKey` and id inheritance.** A re-run on an article with no publication date turns
   `rejected` rows into `dated` ones, so their evidence key changes and their ids are re-minted.
   Is that a real loss of `?event=` links, and is there a cheap fix?
5. **The tests.** Is any new test unable to fail? Is a case missing?
6. **The reader-facing sentences** in the head of the list and on the open row: plain, true in
   every combination of `fromPublished` / `fromPiece` / `yearless`?

House rules for this review: fix what you find inside these files and say what you changed;
report anything wider for me to decide. Do not edit `src/public/dto.ts` or anything listed as a
defence in `docs/project/security-map.md`. Do not run any git command that changes the tree's
history or discards work, and do not commit. Do not write to any database. Do not attribute any
sentence to Greg that is not already quoted from him in the plan. Run
`npx vitest run tests/timeline-time.test.ts tests/timeline.test.ts tests/timeline-resolve.test.ts`
and `npm run typecheck` after any edit.

End with a verdict line: `VERDICT: ship` or `VERDICT: do not ship`, then the findings as P0 / P1 /
P2 with file and line.
