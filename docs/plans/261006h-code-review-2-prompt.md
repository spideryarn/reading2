# Code review, round two: the fix for C1 in plan 261006h

You are a read-only reviewer. Change no file. This is the second and last round; discovery closes
after it.

## The candidate

Commit `eab2f83dd`, and only it: `git show eab2f83dd`. It is **unreviewed code written by the
round-one reviewer**, not by the stage's author: the fix for C1
(`docs/plans/261006h-code-review-sol.md`), which moved `useLastView` out of `ArticlePage` and into
`App`, above its auth branches. Paths: `src/web/App.tsx`, `src/web/article/ArticlePage.tsx`,
`src/web/last-view.ts`, `tests/last-view-app-reader-change.test.tsx`,
`docs/postmortems/261006l-reader-switch-guards-must-outlive-the-auth-branches-they-guard.md`,
`docs/project/auth.md`, `docs/project/url-state.md`, and the plan. Stage 1 underneath it is
`a626d45e7`.

## What to do

Attack the move itself, independently first. A hook that ran once per `ArticlePage` now runs in
`App` on every route. What does that change for a one-reader browser, on every path into and out
of an article: a cold load, a click from the shelf, a jump from one article to another, the
metadata view, the public (signed-out) routes, the auth callback, a session that is still loading?
And does the reader-change fence now hold on every path between two readers?

Run `npx vitest run tests/last-view-app-reader-change.test.tsx tests/last-view-change-of-reader.test.tsx tests/first-open-default-wiring.test.tsx tests/debate-navigation.test.tsx tests/last-view.test.ts`.

Severity: **P0** cross-reader exposure or data loss; **P1** does not do what it says, or breaks
existing behaviour; **P2** real but minor; **P3** wording. Id every finding (D1, D2, …), say
reproduced or reasoned, and for each give the smallest fix. End with one line:
`VERDICT: approve` / `approve with changes` / `rework`.

## My own suspicions (already mine, worth less)

- Effect order. In `ArticlePage` the restore's layout effect ran before any descendant of the
  access gate mounted. In `App` it is a parent's layout effect, so it runs after every child's in
  the same commit. Is there a commit in which a child (nuqs state, `useReadingPosition`, a mode
  that acts on arrival and could buy a model call) reads the un-restored or un-stripped address
  first?
- `useLastView` calls `useExperimental()`, so `App` now subscribes to the settings store on every
  route and re-renders when it answers. Does that wake the store for nobody, or re-render the
  article? The comment block above the call in `App.tsx` was edited to match; is it now true?
- A session that expires on an article: the sign-in screen keeps a return address
  (`src/web/auth-return.ts`). If B signs in there, is B returned to A's query string, and saved
  there? Is that inside this fix's claim or outside it?
- The `loading` gate: `slug` is null until the session is known. Can the first non-null arrival be
  mistaken for a change of reader and strip a shared link's parameters on a cold load?
