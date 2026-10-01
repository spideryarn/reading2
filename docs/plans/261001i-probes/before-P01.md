# P01 (before) — shelf "added" as relative time, exact date on hover

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed to reading-view-overview.md and library.md (the shelf); helped.
- `docs/project/library.md` — very helped (I skipped the third page; 1204 lines, read to line 837): § "Sorting the shelf" says dates are already relative with exact timestamp in the details tooltip; names `relative-time.ts`, `useNow.ts`. Long, though, and the answer is in the middle of a sort section.
- `docs/project/tooltips.md` (first 60 lines only) — Floating UI history; not useful for this task.
- `docs/project/reading-view-overview.md` (grep only) — confirmed copy.md exists.

## 2. Code files you would edit
- `src/web/library-columns.tsx` (table "Added" cell, ~line 188, is plain text with no hover)
- possibly `tests/relative-time.test.ts` / a new shelf table test if I add the hover
- Nothing else: the cards view is already done (see below).

## 3. Existing helpers to reuse
- `src/web/relative-time.ts` § `timeAgo` (relative up to ~30 days, then a date) and § `exactly` (full timestamp)
- `src/web/useNow.ts` § `useNow` (clock re-read once a minute; already called in `Library.tsx`)
- `src/web/library-columns.tsx` § `ADDED_NOTE` / `CARD_NOTES` (card says "added 3 days ago")
- `src/web/ShelfEntry.tsx` § `Details` (tooltip on the card's date line already shows "Added" via `exactly`)
- `src/web/admin-columns.tsx` § date cell (timeAgo plus `title={exactly(...)}`) — pattern for a hover on a table cell
- No new helper needed.

## 4. Rules/policies I would follow
- Reproduce with a failing test first (AGENTS.md). Run `npm test` and `npm run typecheck`; `npm run lint` on touched files.
- Worktree + push to `dev`; plan doc under `docs/plans/` and GPT Sol review before commit (AGENTS.md).
- Table cell had its tooltip removed on purpose (comment cites tooltips.md § Structure's card, plan 260928a Decision 2): the title's row card already carries exact date via `rowCardFacts`. So adding a second card would contradict a decision; at most a native `title`, or nothing.
- Simplest first / ask Greg: the feature appears to exist already, so I would report that rather than build it.
- Docs: update library.md if behaviour changes; quote Greg.

## 5. Where you got lost
- The task as phrased is already implemented (cards: "added 3 days ago" + `Details` tooltip with exact date; table: relative text, exact date on the title's row card). Only found it by reading library.md § Sorting and grepping `timeAgo`. No doc says "the Added date is done; here is what remains".
- library.md is 1204 lines and the Read cap hid the end; no table of contents at the top.
- Ambiguity: whether the table cell itself should show a hover. The code comment says no, deliberately.
- I did not open copy.md or url-state.md; not needed.

## 6. Confidence
8/10 that I found everything; the main uncertainty is what Greg actually wants beyond what exists.
