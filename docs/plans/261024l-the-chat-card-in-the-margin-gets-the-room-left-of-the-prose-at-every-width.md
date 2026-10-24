# The chat card in the margin gets the room left of the prose, at every width

Report `spya-rgh26u` (Greg, admin, suggestion, 2026-10-23 21:54 UTC, Sentry
`SPIDERYARN-READING2-N7`):

> Look at the ratio of the columns here for the Marginalia mode, especially when there's a chat
> involved. There's plenty of space, and yet, you know, the chat in the right is all crammed into a
> tiny, tiny gap and isn't wide enough to really read, and the margins are unhelpful. So I just feel
> like there's got to be a better way to arrange things. Take screenshots and see what you can do to
> improve things.
>
> — Greg, 2026-10-23

The reading column's 42rem cap stays (Greg's choice the night before,
[261023a](261023a-reading-column-cap-a-middle-value.md)).

## What his screen was doing

His screenshot (from the report's row, shrunk to 1600 wide, dark theme) matches a window of about
1512px at a 20px root, the larger text sizes: the prose cell is 870px, about **315px of empty
page sits left of the prose**, and the chat card right of it is **282px**, of which its words get
about 230. Two things from 2026-10-06 meet here:

- The prose moves left for the card only **from a 1600px window**, and then **by 100px at most**
  (`PROSE_SHIFT_FROM`, `PROSE_SHIFT_MAX` in `src/web/layout.ts` § `shiftForCard`). Greg chose that
  ("B give it more room on wide windows") from three options; the numbers were ours. His 1512px
  window is below it, so nothing moved.
- At a 20px root and 1440px the room right of the prose is 255px, one short of the card's 256px
  minimum, so the chat is not a card at all there and falls back to the docked panel.

Today, no band, rail on (`fitView` + `chatCard`):

| root | window | empty left of prose | card |
|---|---|---|---|
| 16 | 1280 | 284 | 260 |
| 16 | 1440 | 366 | 338 |
| 16 | 1512 | 402 | 374 |
| 20 | 1440 | 270 | none (docked panel, 272) |
| 20 | 1512 | 315 | 282 |
| 20 | 1600 | 259 | 426 |

## The change

**One rule at every width: the prose moves left as far as the card can use, keeping 4rem of page
left of it, or half the room that was there when that is less.** `shiftForCard` loses its 1600px
gate and its 100px cap, and its "half the room on the left" limit becomes "all but
`min(half of it, PROSE_SHIFT_KEEP_REM)`", with `PROSE_SHIFT_KEEP_REM` = 4. It still stops where the card reaches
36rem (576px), so from about 1916px at a 16px root the prose is centred again, as now.

- **Still applied whether or not a card is open.** Opening a chat never moves the paragraph the
  reader is looking at, which is today's rule and the reason it was made that way. The cost: with
  the column on and no chat, the prose sits left of centre with room right of the notes, which stay
  capped at 24rem (384px) because a longer note line is too long to read. Set-left text with a wide
  margin on the right is the ordinary margin-note page, and it is that room that answers "the margins
  are unhelpful".
- **4rem rather than a fraction, but never more than half.** Half the left room (today's limit)
  leaves the most empty page in exactly Greg's case, large text on a mid-sized window. 4rem scales
  with the text size and keeps the prose clear of the rail. Where the left room is under 8rem, the
  old half rule still applies: at a 28px root and 1600px the left room is only 82px, a flat 4rem
  (112px) would shift nothing, and the card would fall back to the dock, where today it is 286px
  (GPT Sol on the plan, finding 2).
- **The 1600px step goes.** Today the prose jumps 100px as a window is dragged across 1600px. The
  new shift is continuous.
- **Nothing changes beside a band** (`fitBoth`): the band already has the page left of the prose.
  The masthead title already follows (`margTitleReserve`).

Expected, from the same arithmetic:

| root | window | empty left of prose | card |
|---|---|---|---|
| 16 | 1280 | 64 | ~480 |
| 16 | 1440 | ~128 | 576 |
| 20 | 1440 | 80 | ~445 |
| 20 | 1512 | 80 | ~517 |

## Simpler option passed over

**Keep "half the room on the left" and only drop the 1600px gate and the cap.** One fewer constant,
but Greg's own case gets 440px instead of ~517, and the larger text sizes, where room is shortest,
gain least. Opus, asked to arbitrate, recommended the fixed rem margin for that reason.

**Shift only while a card is open.** The no-chat page would stay centred, but the paragraph the
reader is asking about would slide 150–240px sideways the moment they ask, and back when they close
it.

## Changes

- `src/web/layout.ts`: `PROSE_SHIFT_FROM` and `PROSE_SHIFT_MAX` go, `PROSE_SHIFT_KEEP_REM = 4`
  comes in, `shiftForCard` and the `fitMargin` comment rewritten.
- `tests/layout-margin.test.ts`: the "below 1600px nothing moves" tests become the new rule's
  invariants across the existing sweep (prose width unchanged, never past what the card uses, the
  shift never takes more than `left − min(left/2, 4rem)`), with hand-derived numbers at 1280, 1440
  and 1512 at 16 and 20px roots, continuity at 1599/1600/1601, and the 28px-root card kept at 286.
  Red first.
- `docs/project/marginalia.md` § "From a 1600px window the prose moves left": rewritten.

## Evidence

A Sonnet subagent ran Playwright (classic scrollbars, dark, signed in as the dev admin) against
this worktree's dev server, on `love-spya-kwm06n` with its existing conversation open as a card on
the block `spya-rxxexg`, before and after the change. "Larger" text is the 20px root. Px; the
answer is the content box of the model's turn.

| window, root | empty left of prose, before → after | card, before → after | answer text, before → after |
|---|---|---|---|
| 1280, 16 | 277 → 57 | 260 → 480 | 213 → 433 |
| 1512, 16 | 395 → 193 | 374 → 576 | 327 → 529 |
| 1728, 16 | 409 → 409 | 576 → 576 | 529 → 529 |
| 1920, 16 | 599 → 599 | 576 → 576 | 529 → 529 |
| 1512, 20 (Greg's) | 308 → 73 | 282 → 517 | 224 → 459 |
| 1728, 20 | 316 → 230 | 490 → 576 | 432 → 518 |
| 1440, 20 | — → 73 | docked panel → 445 card | — → 387 |
| 1512, 16, Glossary band | 516 (the band) | 260 → 260 | 213 → 213 |

Measured cell positions sit 7px left of `fitView`'s arithmetic in both runs (296 computed, 288.5
measured before at 1280), so that offset is older than this change. No horizontal scroll and no
card past the window's edge in any shot; the margin head stays on the notes' edge; with no chat
open the page is set left with the notes on the right (`261024l-after-1512-larger-text-no-chat.png`).
Before, at 1512 with Larger text, the answer ran 12–14 characters a line and the composer's
microphone dropped to a second row; after, the composer is one row.

Kept here: [Greg's screenshot](261024l-greg-report-screenshot.png),
[before](261024l-before-1512-larger-text.png) and [after](261024l-after-1512-larger-text.png) at
his size, [after with no chat](261024l-after-1512-larger-text-no-chat.png), and
[before](261024l-before-1280.png) / [after](261024l-after-1280.png) at 1280.

**Not changed, and worth saying.** The gap between the end of a line and the notes, about 170px at
a 20px root, is the 42rem cap's slack plus the gutter icons; Greg set the cap on 2026-10-23 and it
stays. Beside a band the card is still 260px at 1512: the band has the left of the page, and
taking room from it is a different trade.

## Status

- [x] Before screenshots
- [x] GPT Sol plan review: go with changes ([review](261024l-plan-review-sol.md)). Finding 2
  taken (keep `min(half, 4rem)`, not a flat 4rem); its tests taken (continuity, the 28px root, the
  bound rather than "never under 4rem", which rule 2 already breaks). The four expected rows were
  confirmed exact.
- [x] Built, red then green: nine new or changed tests in `layout-margin.test.ts` red against the
  old code (the 1280, 1440, 1512, 1600 continuity, rail-off and title-reserve numbers, and the
  keep constant), green after. The sweep also caught that a small window can still be short of a
  card after the shift; it now asserts `null` there.
- [x] After screenshots (§ Evidence)
- [x] GPT Sol code review: ship with one out-of-scope comment fix. The focused layout and chat-card
  tests pass; restoring the 1600px gate, restoring the 100px cap and dropping the keep each made
  `layout-margin.test.ts` fail. The non-browser `layout.ts` importers pass; this sandbox could not
  launch Chrome or WebKit for the two browser-owning importer files. `marginalia.css` § the room
  still says the prose does not move when the centred page already holds the notes column; that
  comment predates this rule and needs the building agent to correct it. Corrected.
- [x] Note ([261023_2154](../user-feedback/261023_2154-marginalia-chat-card-gets-the-room-left-of-the-prose.md)),
  pushed to dev. Full suite: 3 failures, all outside this change (`pg-author-gifts.ts` in
  owner-isolation, a latexml fixture biome cannot parse).
