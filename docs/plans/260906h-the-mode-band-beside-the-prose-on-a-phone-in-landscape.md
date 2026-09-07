# The mode band beside the prose on a phone in landscape

**Status: built, 2026-09-06.** One constant split into two; the crossover at which the mode band
stops sharing the screen with the article falls from **844px to 700px**. Nothing above 844 changes
by a pixel.

## The ask

Greg, 2026-09-06:

> Somehow the responsive design/configuration isn't quite right. Even when my browser window is
> fairly wide, it still only shows the Mode column. Use browser screenshots for various sizes to try
> and get this right. If possible, I'd really like to be able to see a Mode (e.g. Outline) + Text
> side-by-side when viewing on a modern iPhone in landscape mode. Note that Hierarchy seems to have
> its own separate configuration, because that is visible even when narrower - that's fine.

Hierarchy is `fitToc` and was left alone, as asked.

## What was actually wrong — nothing, which is the point

The mechanism worked exactly as written. Measured in Chrome before any change, `/read/scaling-hypothesis?mode=outline`:

```
w= 800 --mode-w=  0px covers=true  band=[12,800] table=[12,800] overlap=788
w= 832 --mode-w=  0px covers=true  band=[12,832] table=[12,832] overlap=820
w= 844 --mode-w=288px covers=false band=[12,300] table=[300,844] overlap=0
w= 900 --mode-w=344px covers=false band=[12,356] table=[356,900] overlap=0
```

There was no bug in the wiring. **The threshold was simply set above every phone that exists.**
`fitMode` covered the article whenever `MODE_MIN + PROSE_MIN > windowWidth − SPINE_W`, i.e. below
844px — and `useWindowWidth` subtracts the safe-area insets first, so a notched phone hands it far
less than its spec sheet says:

| device | `innerWidth` landscape | notch L+R | what `fitMode` sees |
|---|---:|---:|---:|
| iPhone SE 3 | 667 | 0 | 667 |
| iPhone 13 mini | 812 | ≈94 | ≈718 |
| iPhone 14/15/16 | 852 | ≈118 | ≈734 |
| iPhone 16 Pro | 874 | ≈118 | ≈756 |
| iPhone 16 Pro Max | 956 | ≈118 | ≈838 |

**No iPhone ever made has cleared 844 in either orientation.** The feature was unreachable on the
device class it was most wanted on, and had been since the band was built.

## The change

`PROSE_MIN` was doing two jobs that pull in opposite directions, and splitting them is the whole fix:

- **`PROSE_MIN` = 544** — a *priority*. While there is room to give, the band gives it to the prose,
  and this is the point past which it stops giving. **Unchanged.**
- **`MODE_PROSE_FLOOR` = 400** — a *floor*. The width below which a reading column is no longer
  worth standing beside, so the band covers the article instead. **New.**

```ts
export function bandCoversProse(windowWidth, showSpine = null) {
  return MODE_MIN + MODE_PROSE_FLOOR > Math.max(0, windowWidth - spineWidth(modeSpine(showSpine)));
}

const modeW  = clamp(avail - PROSE_MIN, MODE_MIN, MODE_IDEAL);
const proseW = Math.max(MODE_PROSE_FLOOR, avail - modeW);
```

Three regions, by `avail` (the window minus the 12px rail):

| `avail` | behaviour |
|---|---|
| ≥ 832 | **Byte-for-byte as before.** `avail − modeW ≥ 544`, so the floor never binds. |
| 688–832 | **New.** `modeW` pins at 288 and the prose grows 400 → 544. Sums to `avail` exactly. |
| < 688 | Covers, as before. Crossover now **700px** of window (688 + rail). |

## The simpler option that was passed over

**Just lower `PROSE_MIN` to 400.** One constant, no new name. It was rejected because it changes the
*allocation policy* and not only the covering threshold — `modeW = clamp(avail − PROSE_MIN, …)` means
`PROSE_MIN` is what decides who wins the middle widths. GPT Sol did the table:

| effective window | `avail` | two-constant split | `PROSE_MIN = 400` |
|---:|---:|---:|---:|
| 734 | 722 | band 288, prose 434 | band 322, **prose 400** |
| 844 | 832 | band 288, prose 544 | band 400, **prose 432** |
| 900 | 888 | band 344, prose 544 | band 400, **prose 488** |
| 956 | 944 | band 400, prose 544 | band 400, prose 544 |

It takes 112px of article at 844 and 56px at 900 — on the laptop widths where most reading happens
and about which nobody complained — **and it produces a worse split on the phones the change is for.**

**Lower `MODE_MIN` instead** was also weighed and rejected: 272 gives a crossover of 828 and 256
gives 812, so it does not reach the mini, the regular iPhones or the 16 Pro at all. Only the Pro Max
clears it. Combined with the 400 floor it would buy 16–32px of prose in exchange for a band below the
width its own comment defends.

## Why 400, and the measurement that settles it

Measured in Chrome, 2026-09-06, at a 16px root. `1ch` in the reading face (Geist at 17px) is
**11.34px**, and the cell spends `--text-pad-l` + `--text-pad-r`:

| column | text run | measure |
|---|---:|---:|
| 390px window, portrait phone, no band | 328px | **29.0ch** |
| `MODE_PROSE_FLOOR` = 400 | 342px | **30.2ch** |
| `PROSE_MIN` = 544 | 486px | **42.9ch** |

The floor is a hair *wider* than what a phone reader gets in portrait today, which is the app's
everyday mobile experience and has drawn no complaint. So a landscape split is no worse for the
prose than portrait already is, and it comes with a mode panel beside it.

**One argument that was checked and did not survive.** Fable, arbitrating the split, proposed landing
the column on `.prose`'s own `clamp(45ch, 90vw, var(--reading-measure))` — reading 45ch as a floor
the app had already declared, which would have put `MODE_PROSE_FLOOR` at 420 and the crossover at
720. Measuring it killed the premise: **45ch is 510px of text, so a column honouring it would be
568px — wider than `PROSE_MIN` has ever been.** The clamp's low end is a lower bound on a
`max-width`, not a minimum width; the app already ships 42.9ch at `PROSE_MIN` and 29ch on a phone. It
was never a floor. The 18px of margin the lower number leaves the 13 mini (718 against 700) is worth
having, where 720 would have left 2px.

## What it cost elsewhere

- **The iPad in portrait is now side-by-side too** — 834px, band 288 against prose 534. Named here
  because it is a real product change nobody asked for, and it looks like an improvement rather than
  a regression. The small-screen banner correspondingly stops appearing on it.
- **`SmallScreenHint`'s copy had to change.** It said *"Showing both is work in progress"*, which
  became false the moment the crossover moved: a reader seeing that banner in portrait on a modern
  phone is one rotation away from exactly the thing it says is not built. It is now an offer in
  portrait (*"Landscape may have room for both"*) and a reason when already sideways (*"Showing both
  needs more width than this"*), because those two readers are in genuinely different situations.
  **"May" is load-bearing**: a portrait phone cannot read the insets it will have once rotated, and
  the outcomes really differ — a 393 × 852 clears 700, an SE at 375 × 667 does not. **"A little" came
  out** on Sol's review of the built code: the branch is `height <= width` and nothing else, so a
  390 × 300 window reaches it 310px short. `tests/small-screen-banner.test.tsx` asserts the old sentence's **absence** — an
  under-promise reads as harmless and is the hardest kind of stale copy to notice.

## What the 2026-09-03 work bought, collected

The crossover used to be hand-copied into the stylesheet as `@media (max-width: 843px)`. That copy
was deleted on 2026-09-03 in favour of a `.band-covers` class App.tsx writes from `fit.modeW`, and
`tests/spine-width.test.ts` was left standing to stop it coming back. **This change is the payoff:**
one constant moved in `layout.ts`, and **not one line of CSS and not one media query** had to be
found and moved with it. `tests/chat.test.ts` records that.

The tests did move, and the distinction is worth keeping straight — GPT Sol caught the first draft of
this paragraph overclaiming it. Nothing had to be *found*: every gate is written as
`MODE_MIN + MODE_PROSE_FLOOR` and followed on its own. What changed is the boundary *coordinates* a
few tests probe at — 838 → 694, 844 → 700, and a sweep of 800–880 → 650–730 — because those were
chosen to straddle the crossover and a probe that no longer straddles it is asserting nothing. Sol
found exactly that: the 800–880 sweep would have stayed green while both spine states were
side-by-side throughout, so a restored `@media` query near the real crossover would have sailed
through it.

## Evidence

Measured in Chrome via Playwright after the change, `?mode=outline`, band and table rects:

```
w= 390 --mode-w=  0px covers=true  overlap=378   (covers, as before)
w= 699 --mode-w=  0px covers=true  overlap=687   (one under the crossover)
w= 700 --mode-w=288px covers=false band=[12,300] table=[300,700]  overlap=0
w= 734 --mode-w=288px covers=false band=[12,300] table=[300,734]  overlap=0   ← a modern iPhone sideways
w= 834 --mode-w=288px covers=false band=[12,300] table=[300,834]  overlap=0   ← iPad portrait
w= 844 --mode-w=288px covers=false band=[12,300] table=[300,844]  overlap=0
w= 852 --mode-w=296px covers=false band=[12,308] table=[308,852]  overlap=0   ← unchanged from before
w=1200 --mode-w=400px covers=false band=[12,412] table=[412,1200] overlap=0   ← unchanged from before
```

Zero overlap at every width, and `document.scrollWidth === innerWidth` throughout — nothing overflows
sideways in any mode at 700, 734 or 834.

`tests/chat.test.ts` sweeps every integer width from 320 to 1600 and asserts `minWidth === w` and
`overflowing === false`, replacing six named widths that were all on the covering side of the old
crossover — so they proved the invariant for the branch that returns `avail` verbatim and never once
for the branch that does arithmetic.

## Reviews

GPT Sol reviewed the design before it was built and endorsed the two-constant shape, supplied the
allocation table above, named the constant (`MODE_PROSE_FLOOR` rather than `PROSE_FLOOR`, because
Plain mode already permits prose below 400px), caught the stale banner copy, and confirmed by grep
that no executable CSS hard-codes 832/843/844 — those numbers survive only in historical comments.
Fable arbitrated the band-versus-prose split; its recommendation was not taken, for the measured
reason above.
