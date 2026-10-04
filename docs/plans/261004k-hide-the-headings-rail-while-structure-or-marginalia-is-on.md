# The headings rail is hidden while Structure or Marginalia is showing where you are

Report `spya-rx43ku` (SPIDERYARN-READING2-C3), from Greg, filed 2026-10-04 on
`?mode=summary`. Queue item `qi-5hzbvgcm`. Proven an admin's with `feedback-reporter.ts` (exit 0)
by the sweep that relayed it. It builds on
[261002h](261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md) (the breadcrumb),
[261003n](261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md)
and [261004a](261004a-headings-rail-uses-the-width-above-the-mode-band.md), all on `dev`.

> We have a horizontal rail at the top that shows us where we are with heading breadcrumbs in terms
> of the structure. We don't need to show that horizontal rail when either structure or annotations
> mode are on, because they both provide that information too.
>
> — Greg, 2026-10-04 (`spya-rx43ku`)

## What the words mean in the code

- **"The horizontal rail"** is the headings breadcrumb, `nav.crumbs` in the controls bar
  (`src/web/HeadingsCrumbs.tsx`). `Reader.tsx` § `showCrumbs` decides whether it is drawn. It is
  behind the Experimental switch.
- **"Structure mode"** is `?mode=structure`: the tree in the left band, with its own "you are here".
- **"Annotations mode"** is Marginalia, `?margin=1` (renamed on 2026-10-01; `annotations` is still an
  alias). Its head, `MarginaliaHead`, pinned at the top of the right column, names the part and the
  section you are in.

## What to build

Two more reasons for `showCrumbs` to be false, in `Reader.tsx`:

1. **Structure's band is open** — `mode === "structure"`.
2. **Marginalia's column is drawn** — `marginOpen && fit.margW > 0`, which is `marginRoom`, the
   condition `MarginaliaHead` is given as `room`.

```
Summary open, Marginalia off        → breadcrumb, as today
Structure open                      → no breadcrumb (the band says where you are)
Marginalia on, window wide enough   → no breadcrumb (the column's head says it)
Marginalia on, window too narrow    → breadcrumb, as today (there is no column and no head)
```

**"On" means "showing", for Marginalia.** On a window with no room for the column, `?margin=1` is
still in the URL but nothing is drawn beside the prose (and with a band open and no room for both,
the band wins). Nothing else says where you are there, so the breadcrumb stays. Greg's reason was
*"they both provide that information too"*, and there it is not provided.

Structure needs no such clause: where its band covers the prose (a phone), the breadcrumb is already
hidden by `!bandCovers`, and where it is beside the prose it is showing.

### What follows from it, and why none of it needs new code

- **The bar itself goes for an owner.** `showBar = owner === null || showCrumbs`, so with the
  breadcrumb hidden an owner has no controls bar and the prose starts 44px higher. A visitor keeps
  the bar for the View-only chip, without the crumbs.
- **The rows move when it goes, and `layoutKey` already hears it**: `showBar` and `tallCrumbsBar`
  are both in the key, and opening Structure or the margin also changes `fit.modeW` /
  `fit.margReserve`, which are too.
- **`BarStuckSentinel`** is rendered on `showCrumbs`, so it and `data-bar-stuck` go with the
  breadcrumb (`watchBarStuck` clears the attribute on unmount).
- **The tree is still built** (`crumbsRoot`) while hidden. It is one memo per article, not per
  scroll, and skipping it would thread mode state into a second place for no measured gain.

## The simpler options passed over

- **CSS only** (`display: none` on `.crumbs` under some root attribute). Passed over for the reason
  the bar is an element and not a hidden one (Reader.tsx § the `.controls` JSX comment,
  [260908a](260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md)): `scroll.ts` asks
  the DOM whether there is a bar, an unpainted one answers yes, and the owner would keep an empty
  44px strip.
- **Hide whenever `?margin=1` is set**, whether or not the column is drawn. One term shorter, but a
  reader on a medium window with the margin switched on and hidden would lose the only thing saying
  where they are.

## Known, and left

- **Marginalia's head can be empty where the breadcrumb would not be.** The head's path follows
  `?at=` (`headPath`), the breadcrumb follows the 40% focus line, and the head draws nothing
  wherever the tree does not cover the current block and no arc has been written: usually the rows
  above the first part, but the code does not bound it to those (GPT Sol, ALT-ABSENT). There neither
  says where you are. That is how Marginalia has behaved since it shipped, and making the bar come
  and go as the reader scrolls past the first heading would move the prose by 44px mid-read. Not
  built, not queued. Sol's suggestion, also not built: start the head from the first section rather
  than the first block, so it names the first part at the very top as the breadcrumb does.
- **A contained failure.** If Structure's band or Marginalia's boundary has thrown, what is drawn in
  its place is an error line with no location in it, and the breadcrumb is still hidden. The way out
  the error offers (back to Plain) brings it back.
- **An old `?mode=annotations` or `?mode=marginalia` link can draw the bar for one frame**: it
  parses as Plain, then an effect rewrites it to `?margin=1` (GPT Sol, ALIAS-FLASH). Not a loop, and
  `layoutKey` restores the position.
- **Entering or leaving Structure, or toggling Marginalia, now moves the prose by the bar's height
  for an owner** (44px, on a wide window). The same thing already happens when the Experimental
  switch is pressed; `layoutKey` restores the position.

## Stages

One stage.

1. Red first: in `tests/headings-crumbs-wiring.test.tsx`, through the real `App`:
   - `?mode=structure` on a wide window, switch on → no `nav.crumbs`, and for an owner no
     `.controls` at all.
   - `?margin=1` at a width with room for the column → no `nav.crumbs`; the head
     (`.marg-head`) is there instead.
   - `?margin=1` at a width with no room (the `.marg-narrow` line is drawn) → `nav.crumbs` is there.
   - `?mode=summary` → `nav.crumbs` is there (the control: the first two cannot pass by the
     breadcrumb being broken).
   - A signed-in visitor on `?mode=structure` keeps `.controls` with the chip and no crumbs.
2. The two terms in `showCrumbs`, with its comment saying why.
3. Docs: `experimental-features.md` § the breadcrumb paragraph, one sentence in `structure.md` and
   `marginalia.md` if they describe the bar.
4. Gates: the test file, `npm test`, `npm run typecheck`, lint on touched files. A browser look on
   the box (Playwright, Sonnet subagent): Summary, Structure, Marginalia wide, Marginalia narrow.
5. GPT Sol code review, then push to `dev`.

Done is: the four states in the table above hold in a browser, the tests went red before the change
and green after, and Sol's review is in.

## What landed

- GPT Sol's plan review: [approve with changes](261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on-plan-review-sol.md),
  three P2s. TEST-HEAD taken (the wide-Marginalia test now has the first part cover the first block,
  and asserts the head's path; `?at=` does not survive jsdom's no-layout page); ALT-ABSENT and ALIAS-FLASH written into "Known, and left" above. Sol confirmed
  the two conditions, that `fit` does not depend on the bar, and the jsdom thresholds (the column
  has room from 612px alone, 900px beside a band).
- `marginRoom` moved up beside `showCrumbs` rather than being written twice.
- **In a browser** (Playwright on the box, a Sonnet subagent, local dev from this worktree with the
  change uncommitted, article "A Matched Filter Hypothesis for Cognitive Control", 1400×900 unless
  said). Shots: [Summary](261004k-shot-1-summary.png), [Structure](261004k-shot-2-structure.png),
  [Marginalia](261004k-shot-3-marginalia.png).

  | state | `nav.crumbs` | `.controls` | what says where you are |
  |---|---|---|---|
  | `?mode=summary` | 1 | 1 | the breadcrumb |
  | `?mode=structure` | 0 | 0 | Structure's band |
  | `?margin=1` | 0 | 0 | `.marg-head`: part › section |
  | `?mode=summary&margin=1` | 0 | 0 | `.marg-head` (both fit at 1400) |
  | `?mode=structure&margin=1` | 0 | 0 | both |
  | `?margin=1` at 600 wide and below | 1 | 1 | the breadcrumb; `.marg-narrow` is drawn, 67px bar |
  | `?mode=plain` at 390×844 | 1 | 1 | the breadcrumb, three lines, unchanged |

  `data-bar-stuck` is absent while the breadcrumb is. No console errors beyond 404s for artefacts
  the article has not made. At 700 wide Marginalia's column still fits, so the breadcrumb is hidden
  there too; the cut is about 612px.
- **Not verified:** switching Summary → Structure in place kept the passage on screen but moved it
  (y≈100 to 437, then 481 on the way back). Opening a wider band rewraps the prose and the position
  is restored to the `?at=` block's top, so most of that is not this change; only the 44px of the
  bar is. It was not compared against a build without the change.

## Questions and decisions

None for Greg. The one reading of his words I chose: "annotations mode on" means its column is on
screen, not merely switched on (above).
