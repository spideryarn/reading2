# P01 (after2): shelf "added" date as relative time, exact date on hover

## 1. Docs opened, in order
- `AGENTS.md` (as CLAUDE.md, in context) - pointed to reading-view-overview and library.md; the "where to look" for the shelf is the library line.
- `docs/project/library.md` (first 836 of 1218 lines) - very helpful: its "Where to look" block names `src/web/relative-time.ts` (`timeAgo`, `relativeAgo`, `exactly`), `useNow`, and says "added 3 days ago", real date past a month, exact time on hover. Also § The tooltip and § Sorting the shelf.
- I did not open `docs/project/tooltips.md`, `web-client.md` or `reading-view-overview.md` (library.md answered it).

## 2. Code files you would edit
- Probably none: the feature already exists. Cards show `added ${timeAgo(...)}` via `ADDED_NOTE` in `src/web/library-columns.tsx`; the table's Added cell uses `timeAgo`; the hover card in `src/web/ShelfEntry.tsx` (line ~331) shows `["Added", exactly(entry.addedAt)]`.
- Only if checking the hover is on the date line itself: `src/web/ShelfEntry.tsx` (the card's date line / Details tooltip) and, for the table, the row card `rowCardFacts` in `src/web/library-columns.tsx`.

## 3. Existing helpers/components/functions you would reuse
- `src/web/relative-time.ts` § `timeAgo`, `relativeAgo`, `exactly`
- `src/web/useNow.ts` § `useNow` (the one clock; `Library.tsx` already calls it)
- `src/web/library-columns.tsx` § `ADDED_NOTE`, `CARD_NOTES`, `rowCardFacts`
- `src/web/ShelfEntry.tsx` Details tooltip (`ControlTip`, per `docs/project/tooltips.md` as named in library.md)
- No new helper needed.

## 4. Rules/policies you would follow
- Report back that it already exists rather than rebuild it (AGENTS.md "reuse the machinery"; library.md).
- Pass `now` into `timeAgo` rather than reading the clock (header of `relative-time.ts`).
- If anything changed: test first, `tests/relative-time.test.ts` and `tests/library-sorting.test.ts`; `npm test`, `npm run typecheck`; GPT Sol review before commit; worktree + push to `dev` (AGENTS.md).
- Tooltip copy describes the artefact, not the gesture (tooltips.md, from AGENTS memory index; not opened).

## 5. Where you got lost
- Nowhere much. The task premise (add it) is already true; library.md's "Where to look" bullet made that obvious in two tool calls. The only gap: library.md is 1218 lines and I read 836, so I did not confirm every statement about the table's hover.
- Mild inconsistency to check: library.md says the exact date is on hover of "the date line" on cards, but the code I saw puts it in the Details card; I did not open the card's date-line markup to confirm the hover target.

## 6. Confidence
8/10 that the feature already exists and where; 6/10 that no residual change (e.g. a `title` attribute on the date text itself) is wanted.
