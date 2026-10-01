# Key — P01: shelf "added" date as relative time, exact date on hover

**The headline: this is already built.** An ideal agent discovers that before writing anything, and
reports it (or narrows the task to a real gap) rather than re-implementing it. The shelf has said
"added 3 days ago" since 2026-08-26; the exact time is one hover away in both views.

## Docs it must read
- MUST `docs/project/library.md` § "One sort state, two renderers" (the paragraph "Dates are
  **relative** …" says it is done, names `relative-time.ts` and `useNow.ts`), § "The tooltip" (cards
  view: hovering the date line gives the exact added time), § "The table's row card, whole titles,
  and columns you can hide" (table view: exact date on the title's card).
- MUST `docs/plans/260930i-changelog-release-dates-as-relative-time.md` — the nearest job: "no
  library, because the repo already wraps it"; `relativeAgo` vs `timeAgo`; narrow style pinned to `en`.
- USEFUL `docs/project/tooltips.md` § "`ControlTip`, which is what most of them are now" and
  § "Structure's card, which is defined by subtraction" (a card must not repeat the row).
- USEFUL `docs/reusable/third-party-library-selection.md` — the legitimate "no library" outcome.

## Existing code it must reuse (a second copy is the mistake)
- `src/web/relative-time.ts` § `timeAgo` (relative, then an absolute date past 30 days),
  § `relativeAgo`, § `exactly` (the hover text). Trap: a new `formatDistance`/`dayjs`/hand-rolled
  "N days ago", or a new `Intl.RelativeTimeFormat` in the shelf.
- `src/web/useNow.ts` § `useNow` — one minute-ticking clock read once per render and passed down.
  Trap: `Date.now()` per cell (two cells can straddle a minute and disagree).
- `src/web/library-columns.tsx` § `ADDED_NOTE` / `CARD_NOTES` (cards' meta line), the `added`
  column's `cell` (table), § `rowCardFacts` (exact "Added" on the row card).
- `src/web/Tooltip.tsx` § `ControlTip` / `Tooltip`, if any new hover is added.

## Code files it would edit (only if a gap is confirmed)
- `src/web/library-columns.tsx`; tests in `tests/relative-time.test.ts`,
  `tests/shelf-table-row-card.test.tsx`, `tests/library.test.ts`.

## Project rules that apply
- Check it is not already built — `docs/project/feedback-reports.md`, and CLAUDE.md "Before
  rebuilding something…". Failing test first (CLAUDE.md § Before you call it finished).
- No new dependency without the library-selection process (`vision.md` § Prefer boring).
- A `title` alone is not a hover for touch or keyboard; use `ControlTip` or an `sr-only` copy
  (`tooltips.md`; 260930i § Plan review item 2).
- Browser check in a Sonnet subagent (`browser-control.md`, `browser-testing.md`).

## Traps
- 260928a (`docs/plans/260928a-shelf-table-view-row-card-full-titles-hide-columns.md`, Decision 2)
  deliberately *removed* a card from the table's Added cell: two cards per row, each repeating the
  row, is the failure tooltips.md describes. Putting a hover back on that cell undoes a decision.
- Past 30 days `timeAgo` shows a date on purpose; "43 days ago" is worse (`relative-time.ts` header).
- `style: "narrow"` is `3 days ago` in `en-GB`; it is pinned to `en` (260930i, Plan review item 1).
