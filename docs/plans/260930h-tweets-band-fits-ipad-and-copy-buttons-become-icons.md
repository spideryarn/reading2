# Tweets: a band that suits an iPad both ways up, and copy buttons that are icons

Two reports from Greg (admin), both on Tweets mode, one session. Sentry
SPIDERYARN-READING2-6G and SPIDERYARN-READING2-6H, sent from
`/read/dongetal25-spya-vfmvmm?mode=tweets&at=spya-ptnkr7`.

> The tweet thread column perhaps could be slightly wider when I'm looking at it on my iPad in
> portrait mode, and slightly narrower when I'm looking at it on my iPad in landscape mode.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6G)

> In tweet thread mode, we have a button to copy each tweet item. Let's just have the icon. I don't
> think we need the text copy. Maybe there's a tooltip. Perhaps the same for copy the thread. This is
> part of our sort of general principle of trying to use icons and reduce the amount of text labels
> because there's just so much text already on the page.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6H)

Background: Tweets became a mode with a wide band on 2026-09-29
([260929f](260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md)). The icon rule is
[icons.md § Navigation: an icon with a tooltip, not a text label](../project/icons.md) — *"Every
icon has a tooltip."*

## 6G — why the band is the width it is

`bandWidth` in [`src/web/layout.ts`](../../src/web/layout.ts), for `bandShape: "wide"`:

```
band = clamp(avail − PROSE_MIN, MODE_MIN, max(MODE_IDEAL, wideIdeal(root)))
     = clamp(avail − 544,       288,      544)            at a 16px root
avail = window − 12 (the rail)
```

The prose is *defended* at 544px, and the band only gets what is left over, up to 544. So:

| window | avail | band now | prose now |
|---|---|---|---|
| 834 (iPad portrait) | 822 | **288** (the floor: 822 − 544 = 278 < 288) | 534 |
| 1194 (iPad landscape) | 1182 | **544** (the cap: 638 ≥ 544) | 638 |
| 1440 (laptop) | 1428 | 544 | 884 |

Portrait is pinned at the band's floor because the prose is defending 544; landscape is pinned at
the band's ceiling, so band and prose are nearly equal (544 vs 638). Both of Greg's observations
follow from the same rule: the band's width is "whatever the prose leaves", which swings from floor
to ceiling across a 360px difference in window.

Measured in WebKit with an iPad user agent and touch: see § Measurements.

### The change: the wide band takes a share of the room, not the leftovers

```
standard = clamp(avail − PROSE_MIN, MODE_MIN, MODE_IDEAL)          (every other mode, unchanged)
wide     = clamp(round(avail × WIDE_SHARE), standard, min(wideCap, avail − MODE_PROSE_FLOOR))
wideCap  = max(MODE_IDEAL, wideIdeal(root))                         (unchanged: 544 at 16px)
WIDE_SHARE = 0.42
```

| window | band before → after | prose before → after |
|---|---|---|
| 834 portrait | 288 → **345** (+57) | 534 → 477 |
| 1194 landscape | 544 → **496** (−48) | 638 → 686 |
| 1280 laptop | 544 → 533 | 724 → 735 |
| 1440 laptop | 544 → 544 (cap) | 884 → 884 |
| 700 (the crossover) | 288 → 288 | 400 → 400 |

"Slightly" both ways: roughly +55 and −50. One number replaces the two floors/caps binding at
opposite ends; the band grows smoothly with the window and stays about two fifths of it, so the
prose is always the larger column.

**Only the wide band changes.** Standard bands (every other mode) and Structure's columns keep
`clamp(avail − PROSE_MIN, …)` exactly. The prose's `PROSE_MIN` defence is what gives way in
portrait (477 < 544): in Tweets mode the thread is what is being read and the prose is where its
links land, so that trade is the one Greg asked for. It never goes below `MODE_PROSE_FLOOR` (400);
the `avail − MODE_PROSE_FLOOR` term in the upper bound makes that explicit rather than leaving it
to `fitMode`'s `Math.max`, which would otherwise report `overflowing` at avail 688 (289 + 400).

The crossover to a covering band (`bandCoversProse`, 700px) does not move.

**Never narrower than a standard band.** A bare share dips under the ordinary band for avail
939–951, which would break 260929f's "the wide band is never the narrower" invariant — hence the
standard band as the lower bound.

**What this gives up at a large root.** `wideIdeal(root)` becomes a ceiling rather than a target: at
a 20px root and a 1440 window the band is 600 (0.42 × 1428), not 680; 680 arrives from about a
1630px window. The posts still get a wider cap with a larger root, but not at every width. Accepted:
the share is the relationship Greg is reacting to, and a larger root at a laptop width was already
the case where the prose had least room.

**Simpler option passed over:** re-tune the two constants — lower the wide band's cap to ~31rem
and let Tweets defend a smaller prose. That is two numbers each tuned to one of Greg's two widths,
and the next window size (a 1024 iPad mini landscape, a split-view Safari) lands on whichever
floor or cap happens to bind. A share is one number that describes the relationship Greg is
reacting to.

**Why 0.42:** it lands both iPad widths about equally far from where they were, and keeps 1440
where 260929f put it (the cap still binds from ~1310 up). Not tuned further; Greg's word was
"slightly", and a v1 that moves both in the direction asked is the test.

## 6H — copy buttons become icons

`CopyButton` in [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) draws an icon plus a visible word
("Copy", "Copy the thread"). It becomes icon-only, following the `BackLink` idiom:

- The icon (`Copy`, then `Check` for a moment on success, `X` on failure; all `aria-hidden`) inside
  a square `Button variant="ghost" size="icon-xs"`, 40px under a coarse pointer
  (`tw:pointer-coarse:size-10`, BackLink's number).
- Wrapped in `<Tooltip>` with a `TipNote`: *"Copy this post"* and, for the thread, *"Copy the whole
  thread, numbered, with the article's title and link"* — the second says what the thread copy adds,
  which is not guessable from the icon.
- `aria-label` carries a stable name ("Copy this post" / "Copy the thread"); `title` is dropped,
  since two tooltips on one control race.
- **One status span beside the button, not inside it** (the button stays square): mounted always,
  `aria-live="polite"`, `aria-atomic`, saying "Post copied" / "Thread copied" (visually hidden) or
  "Couldn't copy the post" / "…the thread" (visible, destructive colour) for the 1.6s the state
  lasts. The `ml-auto` moves to the wrapper. A failed copy that only swapped a glyph is the
  silent-success shape (docs/reusable/silent-success.md), and it is rare enough that its words cost
  nothing.

Hover and keyboard focus show the tooltip. **A tap copies immediately**, and the card a touch
browser opens from compatibility mouse events closes with the press (added after the WebKit
check, § What landed). No reveal-then-commit,
because copying is harmless. Checked in WebKit with touch: one tap copies, and a lingering card does
not block the next post's button.

## Stages

1. **Layout (6G)**: `WIDE_SHARE` and the new wide branch in `bandWidth`; update the `a wide band`
   block in `tests/layout.test.ts` with hand-computed numbers (portrait 834 → 345, landscape 1194 →
   496, 1440 → 544, the 688–700 edge never overflowing). Red first.
2. **Icons (6H)**: `CopyButton` as above; a test that the buttons have no visible label text, carry
   the accessible names, and that a failed copy shows its words.
3. Measure after in WebKit, update this doc, cross-family review of the code, docs (`tweets` line in
   260929f's notes is history; the user-feedback note), push.

## Plan review (GPT Sol, 2026-09-30) — proceed with changes

All eight taken: (1) the formula written with the standard band as its lower bound, in one place;
(2) 1280 is 533/735, and the overflow without the ceiling is at avail 688 only; (3) failure text as a
sibling of a square button, 40px coarse target; (4) the touch-tooltip claim weakened to what is
true, plus a WebKit tap check; (5) the 20px-root change named and accepted (above); (6) a sweep test
of the invariants across roots 9/12/16/20 and both spine states, plus the crossover pairs; (7) 0.42
kept, the after-measurement is the calibration; (8) object-specific, atomic status and
`aria-hidden` icons. Answer file kept out of the repo; prompt at
[260930h-sol-plan-review-prompt.md](260930h-sol-plan-review-prompt.md).

## Measurements

Playwright WebKit, iPad Safari user agent, `hasTouch`, `isMobile`, device scale 2, signed in as
the dev admin, on `antikythera-mechanism-spya-zhxrzm` (a real 17-post thread), local dev build.
Band is `aside.mode-band`, prose is `.reader td.text`, the post is the first
`aside.mode-band ol > li > p`; characters a line = text length ÷ distinct line tops from
`Range.getClientRects()` (it counts the `1/17` prefix, so slightly high). Script:
`scripts/scratch-tweets-ipad-measure.ts` (not committed; a one-off).

**Before** (2026-09-30, `7e1dd2cb`):

| | portrait 834 × 1194 | landscape 1194 × 834 |
|---|---|---|
| band | 288 | 544 |
| prose column | 534 | 638 |
| `--mode-w` | 288px | 544px |
| `band-covers` | no | no |
| root font | 16px | 16px |
| post paragraph | 255 | 511 |
| one 277-character post | 10 lines, **~28 a line** | 5 lines, **~55 a line** |

The arithmetic above matches the browser exactly.

**After** (same script, same article, this worktree's dev server):

| | portrait 834 × 1194 | landscape 1194 × 834 |
|---|---|---|
| band | 288 → **345** | 544 → **496** |
| prose column | 534 → 477 | 638 → 686 |
| `--mode-w` | 345px | 496px |
| `band-covers` | no | no |
| post paragraph | 255 → 312 | 511 → 463 |
| one 277-character post | 10 → **8 lines, ~35 a line** | 5 → **6 lines, ~46 a line** |

Screenshots: `260930h-tweets-ipad-{before,after}-{portrait,landscape}.jpg` (halved) beside this file.

## Deferred

- Whether other modes' copy buttons (chat's is already icon-only; Quotes?) should match — not asked.
- Whether the *standard* band should also take a share rather than leftovers — not asked, and it
  would move every mode on every laptop.

## What landed

- **Stage 1 (6G)**: `WIDE_SHARE` and the wide branch of `bandWidth` in `src/web/layout.ts`, exactly
  as the formula above; `tests/layout.test.ts` § a wide band, red first on the iPad, 1280 and
  20px-root cases, plus the invariant sweep (which passed on the old code too, as a sweep of
  invariants should — it guards, the hand-written cases are what went red).
- **Stage 2 (6H)**: `CopyButton` in `src/web/Tweets.tsx`; `tests/tweets-copy-icons.test.tsx`, red
  first.

**WebKit touch check** (iPad user agent, `hasTouch`, `locator.tap()` only): one tap copies every
time, on two posts in a row and on the thread; each 40 × 40 button is what `elementFromPoint`
finds at its centre. WebKit refuses clipboard permissions to Playwright, so *what* was copied
is checked by the unit test, not in the browser. **It found one thing:** the card a tap opens
stayed up until the next tap elsewhere, over the post above. Fixed by turning the tooltip off
while the tick or the failure is showing (`enabled={state === "idle"}`), which closes it; test
"put the card away when pressed", red first.

## Code review (GPT Sol, 2026-09-30)

Round 1, workspace-write, **ship after my fixes**: it strengthened the copy-button test (the
tooltip's props and ref actually reaching the shadcn `Button` via focus → `aria-describedby`, the
stable label, the live region's attributes, the coarse-pointer class) and corrected one
`layout.ts` comment that still implied every band defends `PROSE_MIN`. It confirmed the sweep's
bounds, that Tailwind emits the coarse-pointer size after the base size, and that `tw:sr-only`
and the test's selector are right. Its one FOR YOU was a type error in an untracked scratch
script, since deleted.

Round 2, read-only, on the lingering-card fix: **ship**. The disabled tooltip hides at once and
clears its open state; after the reset nothing reopens it on its own (`useHover` is event-driven with
`move: false`, and re-enabling `useFocus` on a focused button fires no focus event); focus is kept
because the wrapper stays mounted. Re-checked in WebKit with taps: no `[role=tooltip]` at 100, 400,
1000 or 2500ms after a tap, and one tap still copies.

**Noticed, not fixed:** `scripts/browser-sign-in.ts` refused to run against port 5273 on the
assumption that 5273 is the primary checkout's server; here it was this worktree's (checked in
`/proc`). Setting `SPIDERYARN_BASE_URL` explicitly got past it. Left for whoever owns that guard.

**Pushed** to `dev`; not deployed (the Overseer deploys).
