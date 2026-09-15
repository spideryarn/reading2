# The wordmark's animations draw only what can be seen, and the shelf's spider plays them too

Report [SPIDERYARN-READING2-3P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3P), from
Greg, 2026-09-12 10:32 UTC, build `d358f773`, on the reading view (almost certainly the home-screen
iPad he filed `-3Y` from 97 minutes later):

> The playful animations for the Spideryarn logo/wordmark animation don't seem to be showing. Our at
> least I'm not finding them. Ideally they should show up on hover or movie-tooltip click tried
> anther the logo is present

Dictated; the last sentence is read as *"on hover, or on a tap, wherever the logo is present"*.

## Goal, context

The thirteen animations ([design-logo.md](../project/design-logo.md)) are mounted, their
stylesheet ships, and the hook fires. **They are not broken. On the reading view, more than half of
them animate letters that are not on the screen.**

### What was measured

A Playwright probe against this worktree's dev server, signed in, on `/read/fowler-phrenology`
(scratchpad `probe.mjs` and `widths.mjs`, 2026-09-15):

| Window | Dock rung | The word "Spideryarn" in the dock |
| --- | --- | --- |
| 1280 × 900 | `dock-fit-2` | hidden |
| 1440 | `dock-fit-2` | hidden |
| 1680 | `dock-fit-2` | hidden |
| 1920 | `dock-fit-2` | hidden |
| 2560 | none | shown |
| 1024 × 1366, touch (iPad) | `dock-fit-3` | hidden |

The dock's fit ladder gives the brand word up at rung 1, first of anything
([dock-fit.css](../../src/web/styles/dock-fit.css) § the fit ladder). **It was already gone on a
1280 or 1366 laptop the day the animations landed** — the commit that moved the wordmark into the
bar (`12bdca54`, 2026-09-06) measured rung 0 at 1397px for the default reader — and the controls
added since have pushed every width up to 1920 the same way. So the word is gone at every ordinary
desktop width, not only on a phone. [design-logo.md § What a phone sees](../project/design-logo.md#what-a-phone-sees)
predicted the null draw for phones and said *"the fix if it ever becomes one is to weight the
pool"*. It has become one, on every screen.

Each of the thirteen applied directly to the iPad bar's wordmark, counting running animations whose
target is not under a `display: none` box:

- **Visible with the spider alone (6):** `settle`, `warm`, `strain`, `dawn` (masks the whole
  anchor), `dragline`, `radius`.
- **Nothing visible (7):** `pluck`, `sag`, `register`, `seam`, `i`, `type`, `abseil`. (`pluck`
  counted one on the first run; that was the previous draw's `.logo-image` transition still in
  flight — its rules select `.logo-letter` only.)

Three consecutive desktop hovers drew `spya-i`, `spya-type`, `spya-abseil`: class on the anchor,
zero visible animations. An iPad long press drew `spya-register`: the same. **A reader hovering the
reading view's wordmark sees nothing at all 7 times in 13**, and on a touch screen the only trigger
is a 350ms hold that nobody would guess — a tap goes home, by design.

**Where a tap on the logo does nothing else:** the shelf's heading (`Library.tsx`), where the spider
beside "Spideryarn" is a plain `<img>` and not a link — the page Greg lands on. It is "deliberately
not animated" today, on the grounds that the set is calibrated in pixels against a 20px mark. That
argument is about the letters; the six mark animations are what would run there.

## Principles, key decisions

- **Filter the pool by what is on screen, at the moment of the draw.** Each registry entry says
  whether it needs the word (`reach: "letters" | "mark"`). When the host's letters render no box,
  the picker draws from the `mark` six only. Decided at roll time from the DOM
  (`.logo-letter`'s `getClientRects().length`), because the three things that hide the word — the
  731px query, the fit ladder's rungs, and a host that has no letters at all — are three
  mechanisms, and asking the element is the one question all three answer.
- **The tag is checked against the stylesheet**, the way the registry already is: a `letters`
  entry must have no rule reaching `.logo-image`, `.logo-mark` or the anchor itself, and a `mark`
  entry must have at least one. Otherwise the tag is a claim nothing checks.
- **The reading view's tap still goes home.** Changing it so the first tap plays and the second
  navigates would match what links now do on the iPad (`-3Y`), but it doubles the cost of the way
  home for every reader to show a spider. That is Greg's call, not an unattended run's; it goes in
  the note as a question.
- **The shelf's spider plays on hover and on tap**, mark animations only (the filter above gives
  that for free — the heading has no `.logo-letter`). A tap there does nothing else, so a tap is a
  fair request.

### Simpler options passed over

- **Keep the word in the dock** (move it later on the ladder). It would bring the seven back on a
  desktop, but the bar is full, the ladder's order is its own argued decision, and a phone still
  hides the word.
- **Weight rather than filter.** A weight still draws a null sometimes; with the element in hand,
  filtering is both simpler and exact.
- **Rework the seven to move the mark as well.** The design reasons for each are long; this is a
  cosmetic feature whose apparatus is meant to stay small.

### GPT Sol's plan review, 2026-09-15, and what changed

Confirmed the 7/6 split rule by rule, the `getClientRects()` predicate for all three hosts, that
Tooltip composes rather than replaces the handlers, and the radius mask. Changed by it:

- **A plain tap on the reading view still plays nothing**, and that is the half of Greg's sentence
  this does not answer. Left to him as the two-tap question, and the note says so outright rather
  than calling the report fully answered.
- **Reduce Motion** leaves four of the six mark animations finishing in 0.01ms at their resting
  look. That is the accessibility contract working, not a null draw; recorded, not changed. And
  Chrome's touch emulation is not Mobile Safari — a hold that iOS turns into a scroll is a
  `pointercancel`, which the hook deliberately aborts on. Unverified on a device.
- **The shelf's tap is the `click`, not a short `pointerup`**, which the hook hears on `window` and
  would fire for a finger that slid off. Tests for: cancel, release elsewhere, no second draw from
  the click after a hold, no draw from a mouse click, a tap during a linger.
- **The spider stays decorative**, not a `<button>`: a tab stop that plays a hover flourish is noise
  to a keyboard or screen-reader user. Said in the code.
- **A pre-existing orphan in the mouse path, fixed here**: press, leave before 350ms, release
  outside — the timer rolls while the pointer is away and nothing ever clears it. Test first.
- **The measurement is one configuration**, the default modes on one signed-in article; the dock's
  width depends on modes, counts and settings (`dock-fit.ts`). The docs say *at ordinary widths in
  the measured configuration*, not *every reader*.
- **The tag test names the anchor, `.logo-image` and `.logo-mark` explicitly** rather than treating
  "not `.logo-letter`" as proof, and a browser check after the change confirms the real dock draws
  from the six.

## Stages & actions

### Stage 1: the picker draws only what can be seen

- [x] Failing test first, in `tests/logo-animation.test.tsx`: a hover (and a long press) on a
  wordmark whose letters report no client rects never draws a `letters` animation, over many
  draws; and with rects, every animation is still reachable. Watch it go red.
- [x] `LogoAnimation` gains `reach: "letters" | "mark"`, set on all thirteen from the
  measurement above.
- [x] `pickLogoAnimation(previous, wordShown)`; `roll` reads the host element (`currentTarget` at
  enter, captured at pointerdown for the long-press timer).
- [x] Test: the tag agrees with the stylesheet, both directions. Watch it go red by flipping one tag.

### Stage 2: the shelf's spider

- [x] `useLogoAnimation({ tap: true })` for a host that is not a link: a touch press released
  before the long-press threshold rolls and starts the touch linger. Test red first.
- [x] `Library.tsx` heading: the `<img>` gets its `.logo-mark` wrapper and the hook's class and
  handlers on a host around the spider (not the `<h1>`), with `-webkit-touch-callout: none` and
  `user-select: none` so a hold does not raise iOS's image menu.
- [x] `spya-radius`'s mask: `center / 20px 20px` → `center / 100% 100%` (the `::after` is `inset: 0`
  on `.logo-mark`, which is exactly the image), so it fits a 28px spider and is unchanged at 20px.
- [x] Browser: each of the six on the 28px spider, and each of the six in the 20px dock, to check
  nothing looks wrong at the larger size.

**Found in the browser check:** the spider is not square (the PNG is 1203 × 1272; drawn 20 × 21.14
in the dock and corner, 28 × 29.59 on the shelf), so the old fixed `20px 20px` mask drew the sweep
about 5% short in every host. `100% 100%` of `.logo-mark` fixes that as well as fitting the shelf.
After the change: dock at 1280px, 40 hovers, only the six drawn; at 2560px, letters ones drawn too.

### Stage 3: docs and the note

- [x] design-logo.md: § What a phone sees widens to the reading view at ordinary desktop widths, in
  the measured configuration, with the table above; § The trigger gains the filter and the shelf's tap; Library.tsx's "deliberately not
  animated" comment rewritten.
- [x] Postmortem, written by a subagent: the class is *a feature calibrated against a layout state
  the layout later left* — the prediction was written down and the trigger to act on it was "if it
  ever becomes one", which nothing watched.
- [x] `docs/user-feedback/260912_1032-logo-animations-not-showing.md`, ending: **shipped**, with the
  two-tap question for Greg.
- [ ] GPT Sol code review; full suite once via tmux-job; push to `dev`.
