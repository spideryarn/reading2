# Code review: Chat's list shows more on a phone, and no lone quick-search icon in a narrow bottom bar

You are reviewing code that is committed in this worktree and not yet pushed. The stage is one
commit: `git show e57116c7e` (or `git diff HEAD~1 HEAD` — at the time of writing HEAD is that
commit). The plan is
`docs/plans/261005h-narrow-window-chat-thread-list-gets-more-lines-and-no-lone-quick-search-icon-in-the-bottom-bar.md`;
your own plan review is `docs/plans/261005h-narrow-chat-and-no-lone-bolt-plan-review-sol.md`, and its
one finding (a rename that is a prefix of the question) was taken by moving `titleFrom` into
`src/chat-title.ts` and comparing exactly.

**You may fix what you find, inside this stage only**: the files that commit touches. Keep each fix
narrow, and for a behavioural fix write the test that reproduces it first and see it fail. **Report,
do not fix, anything wider you notice.** Do not commit (a linked worktree cannot from the sandbox
anyway); leave your changes in the working tree and I will read `git diff`.

You can run one test file at a time, `npx vitest run tests/<one>.test.ts`, and `node --import tsx
<script>`. Not `npm test` or `npm run typecheck`, and nothing that needs Postgres, the network or a
browser — those are mine to run. A test that goes red only inside your sandbox (spawning a child,
writing a temp file) is not yet a finding; say so and I will re-run it.

## The evidence I already have

A Playwright pass against this worktree's dev server, article with fifteen conversations.

Chat's list, 390×844 touch — before → after:

| row | title before | title after | preview before | preview after |
|---|---|---|---|---|
| 58-char question | 2 lines, whole | 2 lines, whole | 1 line, ~35 of 121 chars, cut | 2 lines, clamped |
| two rows stored as `Explain the opening argument of this article in detail, in…` | identical 59 chars | `…in detail, in at least six paragraphs.` (83 chars, 2 lines, whole) | 1 line, cut | 2 lines, whole (71 and 83 chars) |

At 1440 the stylesheet values read back unchanged (`nowrap`, no clamp on the preview; title clamp
2); the two long rows show their 83 characters.

The bottom bar — `display` of `.dock-qs` / field / ⚡, and the width of `.dock-qs`:

| case | before | after |
|---|---|---|
| 390 touch (rung 4) | flex / none / flex, 44px | none / none / none, 0 |
| 390 touch, `?mode=search` (`.dock-qs--bolt`) | flex / none / flex, 44px | none / none / none, 0 |
| 600 mouse (rung 4) | flex / none / flex, 33px | none / none / none, 0 |
| 1100 mouse (first width on rung 4) | flex / none / flex, 33px | none / none / none, 0 |
| 1440 mouse (rung 3) | flex / flex / none, 147px | the same |
| 1440 mouse, `?mode=search` (rung 2, `.dock-qs--bolt`) | flex / none / flex, 34px | the same |

The gap between `.dock-modes` and the next button at rung 4 went from 44–56px to 7–9px, so the
hidden wrapper leaves no double gap. The ladder still first reaches rung 4 at 1100px.

Not checked in a browser: pressing `/` at 1100px with a mouse, and a focused bar box being hidden
by a resize. Both go through `getComputedStyle(field).display` in `DockQuickSearch.tsx`; please
trace them.

Gates so far: `npm run typecheck` clean; `tests/chat-list-row.test.ts`, `tests/chat.test.ts`,
`tests/dock-quick-search.test.tsx`, `tests/dock-fit.test.ts`, `tests/help-page.test.tsx`,
`tests/doc-links.test.ts`, `tests/spine-width.test.ts` green. The full suite is running separately.

## What to look for, in order of weight

1. **A wrong result a reader would see.** `rowTitle` (`src/web/chat-list-row.ts`) against every way
   a thread gets or changes its title (`src/chat.ts`: the three `titleFrom` call sites, rename, the
   edited first question, a spoken first turn, Remember's single thread which does not use this
   list); a first message whose `text` is not what the reader would call their question (command
   lines, a quoted passage, a hint — see `withoutCommandLines` in `src/citable.ts` and how
   `ChatPanel.tsx` draws a reader turn). Does the row ever show text the open conversation would not
   show for that turn?
2. **The stylesheet.** Specificity and source order of the new rules in
   `src/web/styles/dock-quick-search.css` and `src/web/styles/mode-band.css` against everything
   else that names those classes (`voices.css`, `narrow-window.css` § a coarse pointer, `dock.css`).
   `display: -webkit-box` with `white-space: normal` on `.chat-thread-last` inside a column flex
   button: any browser where the clamp does not take, or the ellipsis is lost?
3. **`DockQuickSearch.tsx` with nothing drawn**: `/`, the hidden-while-focused effect, focus left on
   an invisible element, the `aria-keyshortcuts="/"` that is now on two undrawn elements, and the
   fit ladder's string key in `Dock.tsx` (`qs`/`no-qs`).
4. **The tests.** Is each new assertion able to fail? Is there a regex in
   `tests/chat-list-row.test.ts` or the new cases in `tests/dock-quick-search.test.tsx` that would
   pass on a stylesheet that is wrong (a media block matched too loosely, a `hides` that is true
   because of a different rule)? Mutate and see.
5. **The words.** `docs/project/search.md`, `keyboard.md`, `mode.md`, `phone-and-touch.md`, the help
   text in `src/web/help/help-modes.tsx`, and the comments: anything that still says a phone, a
   narrow window or rung 4 draws the ⚡, or that is now false. Any sentence attributed to Greg must
   be one of the two quotations in the plan, verbatim; do not write new ones.
6. Check the conclusions in the plan, not only the code: the claim that the ⚡ opened *quick* while
   the Search button opens *thorough* by default; the claim that rename is reachable on a phone
   only through the hidden icons' strip (which is why their 46px was left alone).

Answer with a verdict first (ship / ship with the fixes made / do not ship), then findings numbered
and ranked P0 to P2, each with file, line and evidence, and for each whether you fixed it. Then a
list of anything wider you noticed and did not touch. Say plainly if you found nothing.
