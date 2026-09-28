# The shelf's Table view: a card per row, whole titles, and columns you can hide

Started 2026-09-28. Owner: the `shelf-table-view` session, started by the Overseer.

## The ask

> Oh, and while we're at it, can we improve the Table view on the home page (perhaps delegate to a
> separate agent):
> - Include a rich tooltip for each row that shows a bunch of extra stuff about the article. see
>   @docs/project/tooltips.md
> - Perhaps always show the full article title on each row? Or at least leave a bit more space - the
>   titles are too truncated
> - Maybe I can right-click a column to hide it? but then I'd need a way to reveal it again. Or maybe
>   they always all re-show on re-opening the table?
>
> — Greg, 2026-09-28

Greg asked for this directly, so the shape is approved. Calls his words do not settle are taken at the
simplest default and listed under [§ Assumptions waiting on Greg](#assumptions-waiting-on-greg).

## Where things are today

- The table is `DataTable` ([`src/web/lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx)), shared
  with `/admin`'s list of accounts. Everything shelf-specific is in
  [`src/web/library-columns.tsx`](../../src/web/library-columns.tsx).
- The Article column is the one `fluid` column: `w-full max-w-0 min-w-56`, and its title link is
  `truncate` — one line, ellipsis. That is the "too truncated".
- The only card in a row is the **Added** cell's `Details` (from `ShelfEntry.tsx`, shared with the
  cards view). It repeats the row: opens and comments are columns beside it.
- The row does **not** show the gist, which is the thing the cards view has and the table gave up
  ([library.md § Sorting the shelf](../project/library.md#sorting-the-shelf): "the table … gives the
  blurb up for six columns").
- `DataTable` has no column hiding. TanStack v8 has `columnVisibility` state built in.

## Decisions

### 1. Titles wrap, whole — not a wider column

Take the ellipsis off the title and let it wrap (`overflow-wrap: anywhere`, for a title with a long
unbroken word). **The byline line under it wraps too** (revised after Sol P-1): it carries the site
name, which the Added cell's `Details` card used to be the only way to read in full once a long byline
pushed it past the ellipsis. Wrapping both is simpler than teaching the card which half of a truncated
line the reader could not see.

Why wrap rather than widen: a wider column only moves the cut — at 1100px the fixed columns plus the
five action buttons already take most of the width, and at 390px the column is at its 224px floor
whatever we do. Wrapping is the only version where every title is readable at every width, and it
costs row height only on the rows whose title is long. It needs no change to `DataTable`, so `/admin`
is untouched. The simpler option passed over: a two-line clamp — still cuts the longest titles, which
is exactly the complaint.

### 2. A row card on the title, defined by subtraction

Hovering or focusing the **title link** opens a card. Its contents are **what the row is not already
showing** — the rule Structure's card set ([tooltips.md § Structure's card](../project/tooltips.md#structures-card-which-is-defined-by-subtraction)):

- the **gist** — the one-sentence summary the cards view shows as its blurb, and the main reason the
  card is worth a hover;
- **exact dates**: added, and last opened — the row shows them only as "3 days ago";
- **size beyond words**: parts, sections, blocks (the row has words);
- **what has been built**: arc, thread, glossary;
- **renamed by you**, when the title is an override;
- **the value of every hidden column** (after stage 2): a column you hid is not on the row, so its
  fact goes back into the card. That is subtraction applied to the reader's own choice, and it is what
  makes hiding safe — nothing becomes unreachable. (Actions are not a value and are not hideable —
  below.)

Nothing already printed on the row is repeated: not the title, byline, site, minutes, shared badge,
nor any visible column's value. No card at all if that leaves nothing (in practice there is always an
exact date).

**The Added cell's `Details` card goes** from the table (it stays on the cards view, which is its
other home). Two cards per row, one repeating the other and both repeating the row, is the failure
tooltips.md describes; the one thing it had that the row did not — the exact date — is now in the row
card. The Added cell becomes plain text.

Trigger on the title link rather than the whole `<tr>`: the row also holds five action buttons with
cards of their own, and a row-wide trigger would open two cards at once over them. The link is
focusable, so the keyboard gets the card that the mouse does. The table body is wrapped in one
`TooltipGroup`, so running the pointer down the titles opens each card instantly after the first.
**The action buttons join that one group in table rows** rather than keeping the private group
`Actions` makes for itself (it keeps it on the cards view): two nested groups each keep their own
current member, so a title card and an action card could be open together (Sol P-3). `Actions` takes a
prop saying "a group is already above you".
Placement below the title, `keepSide`, so it flips to above rather than over the date columns.

**Touch: none**, the same call Structure's rows and `OutlinePanel` made — a tap on a title opens the
article, and making that tap reveal-then-commit would slow the thing a tap on a shelf is for. On
Greg's iPad the whole title is now visible without a card, and the gist is one tap away in the cards
view. Assumption A1.

Every sentence in the card is checked against the code before it lands (tooltips.md lists how often
plausible card copy was false). No `title` attributes in the rows; the one there now — "Never opened"
on the em dash — becomes an `sr-only` span.

### 3. Hiding columns: a Columns menu, right-click as a shortcut, remembered per browser

- A **Columns** control beside the cards/table switch, drawn only in table view: a Radix
  `DropdownMenu` of checkboxes, one per hideable column, exported from `DataTable.tsx` and placed by
  `ShelfControls`. This is the route that works on iPad, on a
  keyboard and for anyone who never thinks to right-click. It shows how many are hidden
  (a small count badge on the button, not a long label, so the phone row does not overflow — Sol P-8;
the right-hand control group is allowed to wrap), which is also the answer to "where did my column
go?".
- **Right-click a column header** (long-press on touch, which Radix `ContextMenu` gives for free)
  opens a one-item menu: *Hide "Words"*. A menu rather than an instant hide, so a stray right-click
  costs nothing. **Focus after hiding goes to the neighbouring visible header's sort button** (next,
  else previous) — the header that opened the menu no longer exists, and Radix would otherwise return
  focus to a removed node (Sol P-4; `ShelfActionsMenu` hit the same thing). Both the menu and the
  Columns list live in `DataTable.tsx`, so that focus rule is local to the file that draws the headers.
- **Article and Actions cannot be hidden** — a row with no title is not a row, and the actions are
  five controls, not a value the card could carry back (Sol P-5). The five data columns can — Added, Last opened, Opens, Comments, Words.
- **Remembered in `localStorage`** under one key, wrapped in try/catch the way
  [`small-screen-hint.ts`](../../src/web/small-screen-hint.ts) does it; unreadable storage, junk, or
  an id we no longer have all land on "everything shown". Per browser, not per account and not in the
  URL: it is a preference about this screen, not a view of the shelf worth sending to someone.

Why remembered rather than "everything re-shows on reopening": somebody who hides Opens hides it
because they never want it, and making them do it again every visit is the annoyance. The trap that
"re-show" protects against — a column gone with no way back — is closed instead by the Columns
control being always visible and saying how many are hidden. Assumption A2.

**Opt-in in `DataTable`.** Hiding is switched on only when the caller passes visibility state, so
`/admin`'s table gains no menus it did not ask for.

A hidden column that is the current sort key stays the sort key — the chips still show it, and the
row card still carries its value.

**The Table control's own card changes too** (Sol P-2). `VIEW_TIPS.table` in `ShelfControls.tsx`
promises "every column at once" and "No blurb", and both stop being true: the blurb is in the row
card and columns can be hidden.

## Stages

Each ends green and committable.

1. **Whole titles and the row card.** `library-columns.tsx` (title cell, new `RowCard`, Added cell
   loses `Details`, "Never opened" loses `title`), a `TooltipGroup` round the table in `Library.tsx`.
   `Actions` joins the table group; `VIEW_TIPS.table` rewritten.
   Tests red first: the card opens on hover and on focus, carries the gist and exact dates, repeats
   no visible column's value; exactly one card open under `document.body` across title→action and
   action→title, including a focused title plus a hovered action; no `title` attribute anywhere in the
   table body; the title and byline are not truncated. The jsdom recipe in
   [tooltips.md § Three things about testing a card in jsdom](../project/tooltips.md#three-things-about-testing-a-card-in-jsdom)
   — native `mouseenter` to open, bubbling `mouseout` plus two `act` blocks to close, a third to wait
   out the group — copied from `tests/dock-mode-tooltips.test.tsx`'s `cardFor`.
2. **Hiding columns.** `DataTable.tsx` (opt-in visibility, header context menu), a small
   `useHiddenColumns` storage module, the Columns menu in `ShelfControls.tsx`, two lines in
   `Library.tsx`, and the row card learning to carry hidden columns. Tests red first: hide via menu
   and via right-click; focus lands on a neighbouring header after a right-click hide; restored after
   remount; bad storage → all shown; Article and Actions are never offered; a hidden column's value
   appears in the card. Sol P-6: hide the **active primary sort column** and assert order,
   missing-last, chip state and direction are unchanged; `/admin`'s table keeps every header and cell,
   still sorts, and offers no menu. Visibility is optional state — the column-definition array is
   never filtered.
3. **Browser check and docs.** A Sonnet subagent at desktop and phone widths
   ([browser-control.md](../project/browser-control.md), then
   [browser-testing.md](../project/browser-testing.md)) at 1280, 390 and 320px, asserting
   `documentElement.scrollWidth === clientWidth` on the controls row. Update
   [library.md](../project/library.md) and the file table in
   [tooltips.md](../project/tooltips.md).

GPT Sol reviews this plan read-only before stage 1, and each stage's code afterwards (write-capable).

## Coordination

The `shelf-topics` session is adding topic filters to the same page. Edits to `Library.tsx` and
`ShelfControls.tsx` stay small and targeted; merge `origin/dev` before each stage and before pushing.

## Out of scope, noticed

- `DataTable`'s sort chips and header buttons still carry `title` attributes (their hint sentence),
  as does `ShelfControls`' Unread chip. Those are the chip row and the header, not the rows Greg asked
  about, and they are shared with `/admin`; worth their own pass.

## Assumptions waiting on Greg

- **A1.** No row card on touch; a tap on a title still opens the article straight away.
- **A2.** Hidden columns are remembered in this browser (not re-shown on every visit, not synced
  across devices).
- **A3.** Right-click opens a one-item "Hide" menu rather than hiding instantly. Sol suggested
  cutting right-click from v1 (P-4) for the focus problem; kept because Greg named it, with the focus
  rule above.
- **A5.** The Article and Actions columns cannot be hidden.
- **A4.** Titles wrap in full rather than the column being widened or clamped.

## Log

- 2026-09-28 — plan written. GPT Sol plan review (read-only): four P1s, four P2s, all taken —
  byline wraps too (P-1), Table control's card rewritten (P-2), one tooltip group per table (P-3),
  focus after a right-click hide (P-4), Actions not hideable (P-5), sort-while-hidden and `/admin`
  tests (P-6), the jsdom recipe (P-7), phone-width controls row (P-8).
- 2026-09-28 — stage 1 landed (714cc95b). Sol code review: ready; fixed S1-1 (P1, the Table control's
  card overpromised a blurb on every row) and S1-2 (P2, a wrapping test that survived its mutation) —
  8322b8a0. The builder found the `Shared` badge's `title` in rows too, so the badge's sentence moved
  into the card.
- 2026-09-28 — stage 2 built. "Four data columns" was wrong — there are five. Missing-last lives in
  `Library.tsx`'s `sorted` memo, not `DataTable`, so the P-6 test copies the two `sinkLast` passes.
  Unknown stored ids are dropped one by one rather than wiping the list. Open for the browser check:
  whether a long-press on a header also sorts on lift, and whether a finger starting a scroll on the
  Columns button opens it (Radix opens on `pointerdown`; `ShelfActionsMenu` works around this).
