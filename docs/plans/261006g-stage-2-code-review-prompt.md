# Review request: 261006g stage 2, the sideways-scroll cue on /admin/costs

You are the code reviewer **and fixer** for one small stage. Fix what is wrong *inside this stage*,
narrowly and red-first (a failing test before each fix); report, do not fix, anything wider.

**Candidate (committed):** commit `9a7898a9d`. `git show 9a7898a9d --stat`. Its paths:

- `src/web/lib/SidewaysScrollBox.tsx` (new) — start here
- `src/web/lib/DataTable.tsx`, `src/web/AdminCostsPage.tsx`
- `tests/sideways-scroll-box.test.tsx` (new), `tests/admin-costs-page.test.tsx`,
  `tests/eager-client-graph.test.ts`
- `docs/project/admin-costs.md`
- the plan, `docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md` § Stage 2

That list does not limit what you read. **It does limit what you write:** another agent is editing
`src/routes.ts`, `src/store/*`, `src/types.ts`, `src/web/useQuiz.ts`, `src/web/useCitations.ts`,
`src/web/useCrossrefs.ts`, `src/web/lib/api.ts`, `src/web/QuizPanel.tsx` and their tests in this
same tree right now (stage 1, uncommitted). Do not touch those, and do not review them here. Do not
run any git command that changes state (no commit, add, stash, reset, checkout, restore).

## What to do

1. Independent pass: correctness of the measurement and its lifecycle, anything that changes the
   shelf or `/admin/users` (which share `DataTable`), accessibility, whether the tests would notice
   the code being wrong (mutate it and see), and whether this is the simplest thing that works.
2. Run `npx vitest run tests/sideways-scroll-box.test.tsx tests/admin-costs-page.test.tsx
   tests/eager-client-graph.test.ts` yourself; they need nothing outside the tree. The linter is
   Biome (`npx biome lint <files>`), typecheck is `npm run typecheck`.
3. Check the doc sentence in `docs/project/admin-costs.md` against the code. Do not write any quote
   attributed to a person.

Known and not yours to find: nothing here has been seen in a real browser yet (jsdom has no layout,
so `scrollWidth`/`clientWidth`/`scrollLeft` and `ResizeObserver` are stubbed); a browser check at
390px, iPad and desktop widths in both themes is running separately. Two tests ("says nothing when
the content fits", "keeps the scrolling on the inner box…") were never seen red.

## Severity and output

P0 breaks production for readers; P1 the stage does the wrong thing; P2 worth changing; P3 nit.
Every finding gets an ID (`F1`…), severity, file and line, and whether you **fixed** it (with the
red-then-green output) or are **reporting** it. End with one line:
`VERDICT: land it` / `VERDICT: land it with my fixes` / `VERDICT: do not land`.

## My own suspicions — already mine, worth less

- `DataTable` now holds the scroll box's class string twice (once in `SidewaysScrollBox`), with a
  comment saying "change one and change the other". Is there a smaller shape with one copy that
  still leaves the shelf's DOM untouched?
- Children are observed once at mount; a caller that swaps the child element would go unwatched.
- The shade is a 15% tint of the text colour rather than a fade to the page colour, because the
  pinned label column is opaque. Is `z-20` + `isolate` right against the pinned cells' `z-10`?
- `SidewaysScrollBox.tsx` joined `SHARED_WITH_READER` in `tests/eager-client-graph.test.ts`, so the
  reader's shelf bundle downloads ~100 lines it never runs. Accepted as cheaper than passing the box
  in as a component prop; say if you disagree.
