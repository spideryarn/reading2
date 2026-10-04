# Plan review: bottom bar order, and Help leaves the bar

You are reviewing a plan before it is built. Read-only: do not edit anything.

Read, in this order:

1. `docs/plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md` — the plan.
2. `src/web/Dock.tsx` — `MODES_UI`, `ModeGroup`, the Help `DockLink` near *"Help, beside Feedback,
   for everybody"*, `NOT_A_MODE`, `helpHrefFor`, `useCommandBarChord`, `DockCommands`,
   `DockCommandBar`, and how `isVisitor` is computed.
3. `src/web/CommandBar.tsx` § `helpRow` and `CommandBarArticle.help`.
4. `src/web/ModeSurface.tsx` and `src/web/BandAbout.tsx` — the (i) and its *More in Help →*.
5. `src/web/PublicChrome.tsx` — what a visitor's band is when a mode is not shared.
6. `tests/dock-mode-order.test.ts`, `tests/dock-help-link.test.tsx`,
   `tests/dock-mode-tooltips.test.tsx` § `NOT_MODES`, `tests/dock-fit.test.ts`.
7. `docs/project/help-page.md` § The ways in; `src/web/help/help-topics.tsx` near *"The bottom bar
   holds"*.

The product decisions are Greg's and are not up for review: Citations and Glossary each move one
place left, and the Help icon leaves the reading view's bottom bar while Help stays reachable.
What **is** up for review is my reading of them, in particular the decision to keep the link for a
visitor.

What I want from you:

- **Each finding as (a) the concrete reader, page and state under which the planned behaviour is
  wrong, and (b) the smallest change to the plan that closes it.** Severity P0–P3. A finding with
  no (a) goes last.
- Specifically try to break:
  - **The reachability table.** For each of: owner in a mode, owner in Plain, owner on the Metadata
    page, a signed-in reader on somebody else's shared article, a signed-out visitor, a phone (no
    hover, no keyboard), a band that failed and drew its fallback — is there a route to `/help`
    after the change? Is my claim that every mode's band has the (i) with the Help link true, or
    are there bands without one? Is `isVisitor` the same condition under which the command bar
    stands down, exactly, on both the reading view and the Metadata page?
  - **The order.** Is there any other place that states or derives the bar's order and would now
    disagree: the command bar's rows, the Help page's tables, `/design`, a keyboard shortcut by
    position, a fit-ladder rule that counts buttons, a screenshot script, a doc?
  - **What else names the Dock's Help link** and would be left false: comments, docs, the Help
    page's own text, tests whose names say "everybody".
  - Is "keep it for a visitor" the right smallest reading, or is there a simpler one that still
    leaves nobody without a route?
- Say plainly at the end: **ready to build / ready with changes / not ready**.

You may run a single test file with `npx vitest run tests/<one>.test.tsx`; not `npm test`, and
nothing that writes.
