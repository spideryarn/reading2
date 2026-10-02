# 261002i — iPad touch targets: shelf card actions on the bottom row, bigger close crosses, a visible band scrollbar

Five admin reports from Greg's iPad, one session (queue item qi-ppaw8fvj). His words are in the
feedback note, `docs/user-feedback/261002_*-ipad-touch-targets.md`; the short version:

> Make the triple dot menu for items in my shelf a bit more visible. It's very small on my iPad in
> portrait mode. — 9E, spya-d7ftwk

> … we could move the opened, you know, three days ago to the bottom left, and then we could put the
> icons in the bottom right, so they'd all be on that same bottom row … save me a click. And we could
> keep the three dots menu just in case things are really, really narrow or whatever. — 9F,
> spya-n3zujy

> Can you make the little cross to close a comment a little bit larger? I kept missing it on my iPad.
> And if there are any other similar to the modals or panels, apply it to them as well. — 9G,
> spya-gvcmx2

> Oops, there IS a scroll bar in summary mode on my iPad. It's just very hard to see. — spya-af6hy8
> (after spya-f602m6)

— Greg, 2026-10-01 and 2026-10-02

Prior-work check (feedback-reports.md § The run, step 3): nothing on dev, in `docs/plans/` or
`docs/user-feedback/` covers these; no running session holds this ground. qi-djn8h9bn (rich tooltips
that open on a tap) waits on this one and is not built here.

## What is there now

- **Shelf card.** Title row: title, then `Actions` at the right. Bottom row: words · comments ·
  the sort's note pushed right with `ml-auto`. Wherever `any-pointer: coarse` matches, `Actions`
  draws no icon row at all and a 40px "⋯" (`ShelfActionsMenu`, an 18px muted glyph with no border)
  opens the five as words — 260915b, because on iOS 18.2+ a finger's click reports `mouse` and the
  row's reveal-then-commit could not work, and because five unlabelled glyphs read as decoration.
  The list is one column, so an iPad-portrait card is ~700px wide: room to spare.
- **Close crosses.** Each is its own rule. The comment card's `.cmt-close` is a 15px glyph with
  `0 0.15rem` padding — about 20 × 15px of target. `.annotate-close` and `.chat-dialog-close` are
  the same shape; `.fb-close`, `.dock-close`, `.lightbox-close` are 26–28px boxes.
- **Band scrollbar.** Nothing in the app sets `scrollbar-color`. iOS draws its own overlay
  indicator, thin and only while scrolling; on the band's dark `--panel` it is barely there.

## The change

### 1. The shelf card's actions move to the bottom row (9F, card only)

- `ShelfCard`: `Actions` leaves the title row and goes to the end of the bottom row, `ml-auto`. The
  note loses its `ml-auto` and sits beside the word count and comments — Greg's own layout. The
  title gets the full width. **Same for every pointer**, so there is one card layout, not two; on a
  mouse the row is still hover-revealed, it is just at the bottom right now.
- The card is a CSS container (`tw:@container`). `Actions` takes a new prop, `fingerRow`, which only
  the card passes:
  - **card, finger, container ≥ 28rem** (iPad, either orientation): the icon row is drawn,
    opaque, with **40px** icons (the house finger number, narrow-windows.md § What a control owes a
    finger); the "⋯" is not.
  - **card, finger, container < 28rem** (a phone): unchanged — the "⋯".
  - **table** (`RowActions`): unchanged — the "⋯" for any finger. A prop rather than the query
    alone because the press changes too and must be the card's alone, and so the table's classes
    stay exactly what they were.
  - **no finger**: unchanged — the 28px hover-revealed row.
- **A finger's tap on the row presses the button — for the free, undoable ones.** The row's
  reveal-then-commit is already dead on iOS (the click says `mouse`, so it commits), and Greg asked
  to save the click. So where the row is drawn for a finger (`any-pointer: coarse` matches at the
  time of the click), `pressCapture` stops reading the click's `pointerType` and lets the device
  decide: Edit, Open, Copy, Archive and Put back press on the first tap (Archive's Undo strip is its
  confirmation, as in the menu). **Two kinds still reveal first** (Sol's plan review, P1 and P2):
  an *unavailable* control, which would otherwise be a faded icon that refuses the tap and never
  says why; and **Re-fetch**, which queues paid work and was two taps from a closed "⋯" — one
  unlabelled tap is not the same trade. The reveal stays as it was for a pen on a machine with no
  touchscreen.
- **Why `any-pointer` for the 40px and not `pointer`**, which touch.md asks of a size rule: this is
  not chrome grown for a hybrid laptop's benefit, it is the row taking the "⋯"'s place, and the
  "⋯" it replaces is already chosen by `any-pointer`. Whoever gets the row instead of the menu
  gets it finger-sized.

### 2. The "⋯" is easier to see (9E)

It stays where it is needed (phones, the table) and moves with the row to the bottom right of the
card. Glyph 18 → 22px, the foreground colour rather than muted, and a `rule-strong` border so it
reads as a button and not a stray mark. Still 40px.

### 3. One close cross (9G)

A new `src/web/styles/close.css`, imported straight after `shell.css` so every component rule after
it still wins on order, defines `.close-x`: a **32px** box, the glyph drawn at **18px** whatever
it, centred; and under `(any-pointer: coarse)` an invisible `::after` that
extends the target to **40px** (4px a side) without growing the header it sits in. Anything beside
a close needs 4px of gap: Annotate's Copy sat 2.4px from Close, so their targets would have
overlapped and Close would have taken Copy's taps (Sol, P1) — that gap is 8px now. That last part asks
`any-pointer` because it paints nothing — the rationing argument in touch.md is about visible
chrome. Each modal/panel close gets the class, and its own rule loses the width, height and
padding it set, keeping colour, border and position:
`.cmt-close`, `.annotate-close`, `.chat-dialog-close`, `.fb-close`, `.dock-close`,
`.lightbox-close`, `.ref-how-close`. Small dismiss chips on banners and hints (toasts, the install
hint, the return chip) are not panels and are left for the next report.

### 4. The band's scrollbar shows (spya-f602m6, spya-af6hy8)

`.mode-band { scrollbar-color: <a light grey thumb> transparent }`. The property is inherited, so
every scroller in every band gets it. WebKit taught iOS to paint the overlay indicator in the thumb
colour (bug 258461, landed 2025-08; Apple lists `scrollbar-color` as new in **Safari 26.2**, so
iPadOS 26.2 and later); before that it is ignored and nothing changes.
On a desktop with classic scrollbars the band's bar takes the same colour; `scrollbar-width` is not
touched, so no width moves and narrow-windows.md's rules about room under a scrollbar are untouched.

## The simpler option passed over

Leaving the card layout alone and only enlarging the "⋯" would answer 9E and not 9F, which is the
one with the click Greg wants back. Making the row show on every finger regardless of width would
answer 9F and break the phone, where five 40px icons and the meta line do not fit. Per-close size
edits in seven stylesheets would work but leave seven numbers to drift; one class is fewer parts.

## Deferred, named

- Banner and toast dismiss crosses (not panels).
- Chat's open-conversation header ✕ (`ChatPanel.tsx`, `.chat-icon`, 1.4rem). Sol found it: it
  looks like a panel close but goes back to *All conversations*, beside a Delete. Sol's suggestion
  is an arrow that says what it does, which is a product call for Greg rather than a size change.
- A custom, always-visible scroll indicator for iOS before 26 — `scrollbar-color` is the cheap
  version; if Greg's iPad does not show it, the next step is a fade at the band's bottom edge.
- Tooltip cards opening on a tap (qi-djn8h9bn, queued separately).

## Plan review

GPT Sol, read-only, 2026-10-02 (`261002i-…-plan-review-sol.md` beside this plan): no P0; two P1s
(silent unavailable controls on a direct press; Annotate's Copy/Close overlap) and the Re-fetch
trade-off, all fixed as above; the Safari version corrected to 26.2; the prop's stated reason
corrected; the WebKit `mouse`-typed click and the unavailable and Re-fetch cases added to
`tests/shelf-action-touch.test.tsx`. Chat's header ✕ deferred, above. Sol confirmed the Tailwind
variants compile and nest as intended and found no stuck-tooltip bug (`mouseOnly` ignores touch).

## Checks

- `npm test`, `npm run typecheck`; existing shelf tests (`shelf-actions-menu`,
  `shelf-actions-visible-to-a-finger-in-chrome`) updated for the card's new switch and kept for the
  table.
- A test that the card draws the row and not the menu when `fingerRow` and the built CSS carry the
  container-plus-coarse rule (the class strings in the built stylesheet, since jsdom has no layout).
- Browser, Sonnet subagent, Playwright Chrome with `hasTouch` at 820 × 1180 and 390 × 844, plus a
  mouse at 1280: row vs menu, one tap archives, close crosses measured, band `scrollbar-color`
  computed.
- What cannot be checked here: the iOS overlay indicator's colour — Playwright's WebKit on Linux has
  no iOS scroll indicator. Greg's iPad is the check, and the note says so.
