# Code review: bottom bar order, and Help leaves the bar except a visitor's

You are reviewing code built from a plan, and you may **fix what you find** inside the scope of
this change. Anything wider, report and leave. Do not commit, push, or run any git command that
changes the tree other than your edits.

The change is one commit: `git show 8c4701b3e` (or `git diff origin/dev...HEAD`).

Read:

1. `docs/plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md` — the
   plan, with Greg's words and the plan review's four findings.
2. The diff, whole.
3. `src/web/Dock.tsx` § `MODES_UI`, `DockHelp`, `NOT_A_MODE`, `helpHrefFor`, and how `isVisitor` is
   computed and where `DockCommands` / `DockCommandBar` / `useCommandBarChord` read it.
4. `tests/dock-help-link.test.tsx`, `tests/dock-mode-tooltips.test.tsx`,
   `tests/dock-mode-order.test.ts`.
5. `src/web/help/help-topics.tsx` near *"The bottom bar holds"*; `docs/project/help-page.md` § The
   ways in.

Greg's product decisions are not up for review. What is:

- **Each finding as (a) the concrete reader, page and state under which the code is wrong, and
  (b) what you changed or would change.** Severity P0–P3.
- Try to break:
  - **Nobody without a route.** Is there any reader, page or state for whom the bar draws neither
    the Help link nor the Commands button? Is the gate in `DockHelp` exactly the gate on the
    command bar, in both arms of the bar (reading view and Metadata page)?
  - **The tests.** Would each new assertion have failed before the change, and would it fail if
    the gate were inverted, dropped, or keyed on `signedIn` instead of `isVisitor`? Is anything
    asserted only through a helper that would pass vacuously (zero matches)? Does the Commands
    button really carry `aria-label="Commands"` in the rendered bar, on both pages?
  - **The order.** Any comment in `MODES_UI` that now says something false about a neighbour; any
    other file that states the old order as current (not history).
  - **The Help page's sentence.** Is it true for an owner, a signed-in visitor and a signed-out
    visitor? Is the (i) called what the rest of that page calls it?
  - Anything that still says the Dock's Help link is for everybody, as a present-tense claim.
- Run `npx vitest run` on the test files you touch or that cover what you touch, and
  `npm run typecheck`. `typecheck` was already red on `origin/dev` in
  `src/backfill-registry-facts.ts`, which this change does not touch; say if you see anything else.
  Do not run `npm test` or `npm run check`.
- End with a plain verdict: **ready to push / ready after my fixes / not ready**, and list every
  file you edited.
