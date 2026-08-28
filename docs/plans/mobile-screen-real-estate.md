# Mobile screen real estate, and a bottom bar you can hit

> I'm looking to improve the layout on mobile. Let's start by making more use of screen real estate
> (both for portrait and landscape) … Also, make our button-bar at the bottom a bit easier to press,
> e.g. bigger buttons, slightly more spaced out.
>
> — Greg, 2026-08-28

Follows [mobile-reading-view.md](mobile-reading-view.md), which took the *width* back on a phone and
made our own top bars slide away on scroll. This takes the rest: the browser's chrome, the status
bar, and the one bar of ours that never learnt to get out of the way.

## The finding that reframes the ask

Greg asked two questions — hide the address bar, hide the three buttons down the right edge — and
**the answer to both is that they are not ours and no web page can touch them.**

- The white strip reading `spideryarn.com` is *already* Chrome-on-iOS's collapsed toolbar. That is
  why it has no buttons on it. Chrome iOS shrinks to that strip on a downward scroll and never goes
  further; Safari can hide its bar completely, Chrome cannot.
- The three buttons down the right edge are Chrome's toolbar in landscape on an iPhone. Same
  answer.
- There is no fullscreen API on iOS for a document, and `window.scrollTo(0, 1)` has not hidden
  anything for many years.

**A page has no API for any of this**, and the residual strip is a fact about the Chrome build on
the phone in the screenshots rather than a law — Chromium's iOS code does carry a fully-hidden
toolbar state and a native "Hide Toolbars" action, so what survives a scroll is version-dependent
and worth re-checking on a current device rather than asserting for ever. GPT Sol, 2026-08-28.

**What we can be sure of is the way out: leave the browser.** Add to Home Screen launches the app in
iOS's standalone shell with no browser chrome at all. That is a real answer rather than a
consolation: it removes the bottom toolbar in portrait and the right-hand strip in landscape, which
is more screen than any amount of CSS was ever going to win.

So the work splits three ways:

1. **Make the install actually work and look right** (§ 1). It nearly does; three specific things
   stop it.
2. **Take the status bar too**, once installed (§ 2). Greg's call, 2026-08-28.
3. **Everything that helps in an ordinary browser tab as well** — the dock joining the hide-on-scroll
   it never joined, and bigger targets on it (§ 3).

### One thing of ours that makes it worse in landscape

A gist column carries `touch-action: pan-x` (styles.css § touch), so a vertical swipe over one steps
a section by JavaScript rather than scrolling the page. **iOS only collapses its toolbar for native
scrolls**, and `glide()` in scroll.ts moves the page with `scrollTo` — which iOS ignores entirely for
this purpose. In landscape, where the gist columns are most of the screen, a reader navigating the
way the app wants them to will never even get Chrome's shrink.

That is not a bug to fix — the stepping is [touch.md](../project/touch.md)'s whole design — but it is
the reason the landscape screenshot looks worse than the portrait one, and it is another argument
for the installed app, where the question does not arise. (The "iOS ignores programmatic scrolls"
half is established for Chrome-iOS, whose current code distinguishes user from programmatic
scrolling for exactly this; it is not established for Safari and should not be stated as if it
were.)

**And it now costs more than it did**, because § 3 puts our own bottom bar on the same switch:
`markOurScroll` makes `watchBarVisibility` ignore any scrolling we started, so a landscape reader
using the app's primary gesture keeps *our* chrome on screen indefinitely too. Sol raised it; it is
pre-existing behaviour rather than something this work introduces, and whether a deliberate step
should also hide the bars is a question for § Open for Greg.

## 1. The install path

`display: "standalone"` is already in `public/site.webmanifest`. Three things stop it working:

| What | Why it is wrong |
|---|---|
| `"orientation": "landscape"` | Locks the installed app out of portrait. Greg reads it both ways — both screenshots are in the ask. |
| `"background_color": "#FFFFFF"` | The splash screen behind a near-black app. A white flash on every launch, which is the exact thing `<meta name="color-scheme">` exists in `index.html` to prevent for the tab. |
| No `apple-mobile-web-app-*` tags | iOS 16.4+ does read `display` from the manifest, but older iOS and several in-app browsers read only the meta tag. It is two lines and it is what every install guide checks. |

**Changes:**

- `site.webmanifest`: drop `orientation` (`"any"` is the default and saying it adds nothing);
  `background_color` → `#0a0a0a`, matching `theme-color` and `--page`.
- `index.html`: add `mobile-web-app-capable`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-title` (`Spideryarn`, so the icon is not labelled with the `<title>`), and
  `apple-mobile-web-app-status-bar-style` — see § 2 for its value.
- `index.html`: `viewport-fit=cover` on the viewport meta, which § 2 needs. **It is not inert
  elsewhere** — see § 2's table.

None of that *guarantees* a clean launch: iOS composites its own launch frame, and there are current
WebKit reports of a white flash even with a dark manifest and dark CSS. `background_color` makes it
better rather than fixed. The `theme_color` stays the brand orange, which is a different job — it
tints Android's toolbar and is not the splash.

### The hint

Greg, 2026-08-28: a **one-time dismissible hint on mobile**. Without one, "install it" is advice
that reaches only the person who already knows.

`InstallHint.tsx`, a strip that sits directly above the dock. Shown when **all** of: a coarse
primary pointer, iOS (`navigator.standalone` is defined, or the UA is iOS), not already standalone
(`navigator.standalone === true` or `matchMedia("(display-mode: standalone)")`), and not previously
dismissed. Dismissal is a `localStorage` flag, and **every access is wrapped** — Safari's private
mode throws on `setItem`, and under vitest + jsdom `localStorage` is shadowed by Node's own and
reads `undefined` (`mic-devices.ts` has the same wrapper and the same reason).

Wording, since a reader has to be able to follow it without us naming a button they cannot see:

> Add Spideryarn to your Home Screen for the whole screen — tap Share, then **Add to Home Screen**.

## 2. The status bar

Greg chose to reclaim it. That means `apple-mobile-web-app-status-bar-style: black-translucent`,
which is the value Apple documents as making standalone content extend beneath the status bar, plus
`viewport-fit=cover` so the same is true of the notch and the home indicator.

**Documented is not the same as guaranteed.** WebKit bug 301994 reports standalone apps keeping a
system-owned top gap while `safe-area-inset-top` reports zero, so "the web view starts at y=0" is
what should happen rather than what is known to happen on Greg's phone. Every rule below is written
so that a top inset of zero simply means no reclaim — nothing breaks, the strip stays. That is the
fallback, and it is why this is worth trying rather than worth agonising over.

**Getting this half-right puts the granularity pills under the clock.** So the insets have to reach
every piece of fixed or sticky chrome, and the cheapest way to be sure of that is to notice that this
file already solved the same problem once: everything that pins below the controls bar reads one
token, `--bar-bottom`, precisely so that a change like this is one substitution rather than five
judgement calls.

### Four tokens, and one re-derivation

```css
:root {
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left, 0px);
  --safe-right:  env(safe-area-inset-right, 0px);

  --bar-bottom: calc(var(--bar-h) + var(--safe-top));   /* was: var(--bar-h) */
}
```

`--bar-bottom` keeps its existing meaning — *the y-coordinate of the controls bar's bottom edge* —
so **every consumer of it is already correct and none of them changes**: `thead th`,
`td.gist .sticky`, `.spine`, `.mode-band` and the overflow fade all keep reading it and all land in
the right place. That is the whole reason to spend the token rather than patch five rules.

Two rules that *set* it do change, and both are arithmetic on the same idea:

- `.controls` becomes `top: var(--safe-top)` and its transform gains the same term, or the bar is
  pushed down twice:
  `transform: translateY(calc(var(--bar-bottom) - var(--bar-h) - var(--safe-top)))`. At rest that is
  `0`; hidden it is `-var(--bar-h)`, exactly as today.
- § a small device's hidden state becomes `--bar-bottom: var(--safe-top)` rather than `0px`, so the
  table head still clears the clock while the bar is away. **`0px` there is the mistake that would
  look fine on every laptop and put the column headings under the time on the one device this is
  for.**
- `:root:has(.controls:focus-within)` restores `calc(var(--bar-h) + var(--safe-top))`.

### The other three edges

- `.masthead` — `padding-top` gains `--safe-top`; it is the thing at y=0 before you scroll.
- `.logo-home` — `top: var(--safe-top)`, `left: var(--safe-left)`. It is `position: fixed` at the
  corner, which is precisely the corner iOS rounds off.
- `.spine` — `left: var(--safe-left)`, and the `.reader` padding and both sticky bars' `left`/`width`
  gain the same term, or the rail sits under the notch in landscape and the article starts inside it.
- `.dock` — `padding-bottom: var(--safe-bottom)` and its height grows by the same, so the buttons sit
  above the home indicator rather than under it. See § 3, which changes this rule anyway.

### `viewport-fit=cover` is NOT inert in an ordinary tab

The first draft of this plan said the insets were all zero outside an installed app. **That is
wrong**, and Sol was right to shout about it, because most readers will never install:

| | Portrait | Landscape |
|---|---|---|
| Safari tab | sides ~0; **bottom can be non-zero and changes as the toolbar minimises** | **notch side is non-zero**; bottom likewise |
| Chrome-iOS tab | sides ~0; top/bottom depend on the build and the toolbar state | **notch side is non-zero** with `cover` |
| Installed | top and bottom non-zero on a notched phone | sides and bottom non-zero |

So the left, right and bottom terms earn their place for every reader on an iPhone, not only for
whoever installs — which is why they are threaded through `.reader`, both sticky bars, the spine,
the band and the bar rather than treated as a standalone-only nicety. Only `--safe-top` is reliably
zero in a tab, because the browser's own strip is already sitting in it.

Two consequences worth naming:

- **The layout budget has to know.** `fitView` divides up `window.innerWidth` in pixels, and the
  insets are width it does not have. `.reader` spending them on padding while `fitView` spent them
  on columns is a page that scrolls sideways by exactly the notch. `useWindowWidth` subtracts them
  and `.reader`'s inline `min-width` adds them back, which is where `safe-area.ts` comes from.
- **`--safe-bottom` is not constant in a tab.** It changes when Safari's toolbar minimises, so
  `--dock-space` — and therefore `.reader`'s bottom padding — moves by ~20px while the reader
  scrolls. That is a change to the document's *maximum extent* rather than to anything under the
  finger, and it is accepted rather than solved. If it ever reads as a jitter, the fix is a static
  allowance rather than the live inset.

**On every machine we develop on all four are `0px`**, which is the hazard rather than the
reassurance: a mis-typed `env()` name falls back to the same `0px` and looks perfect. See § How we
will know.

## 3. The dock

Two changes, and the first is what pays for the second.

### It hides on scroll, like everything else

`watchBarVisibility` in scroll.ts already sets `data-bars="hidden"` on `<html>` when a small device
is scrolled down through, and the masthead, the controls bar, the table head, the sticky gists, the
spine and the mode band all get out of the way. **The dock never joined**, so it costs 40px at every
scroll position — and § a small device *shrinks* it to 2.2rem on a landscape phone to claw some of
that back, which is exactly the wrong direction for "make the buttons easier to press".

Once it hides while you are reading, its resting height stops being scarce. That is the trade, and it
is the same one the top bars already took.

The *switch* needs no JavaScript changes — the attribute is already there and already correct, and
respects `markOurScroll` so our own jumps never move the chrome. **The measurements do**, and this is
the half the first draft got wrong:

- **`dockOffset()` returned `getBoundingClientRect().height`**, which a transform does not change.
  It would have gone on reporting a confident 52 for a bar that was entirely off screen, so every
  screenful step delivered a screen 52px short — of lines the reader then never sees. Now it returns
  `innerHeight - rect.top`, clamped at zero. `tests/mobile-chrome.test.ts` poses the bar off the
  bottom of the window and fails against the old expression.
- **`stickyOffset()` clamped its answer to the bar's height**, which stopped being the bar's bottom
  edge the moment `--safe-top` entered `--bar-bottom`. Every deep link and arrow-key step in the
  installed app would have landed a status bar's height under the chrome. The ceiling is now
  `rect.height + safeAreaInsets().top`, added to the *ceiling* rather than the result so the stuck
  case still prefers the measurement.

Both were found by GPT Sol against this plan, before either was built.

The dock itself becomes a consumer of the switch, by the same token-and-transform shape the controls
bar uses:

```css
:root {
  --dock-space:  calc(var(--dock-h) + var(--safe-bottom));  /* the room it occupies at rest */
  --dock-bottom: var(--dock-space);                          /* the room it occupies NOW */
}
.dock { transform: translateY(calc(var(--dock-space) - var(--dock-bottom))); }
```

- `.reader { padding-bottom: var(--dock-space) }` — **the resting value, deliberately, not
  `--dock-bottom`.** Tying the document's height to a value that changes while you scroll is how you
  get a page that grows and shrinks under your finger.
- `.mode-band { bottom: var(--dock-bottom) }` and the overflow fade likewise, so a band does not
  leave a strip of article showing through where the bar used to be. Both are `position: fixed`, so
  this costs no reflow of the table.
- `.cmt-dialog` and `.chat-dialog` keep reading the resting value. They are transient, and a dialog
  that resized itself mid-scroll would be worse than one sitting 40px high.
- **Never hidden while it is in use**: `:root:has(.dock-drawer)` and `:root:has(.dock:focus-within)`
  restore `--dock-bottom: var(--dock-space)`, the same guard and the same reasoning as
  `:root:has(.controls:focus-within)` — it must be set where the other consumers inherit from, not on
  the bar.

### Bigger, and evenly spread

On a **coarse primary pointer** (`@media (pointer: coarse)`, not `any-pointer` — an iPad with a
trackpad attached should not get finger-sized chrome):

- `--dock-h: 3.25rem` (52px), up from 40px, and the 2.2rem landscape shrink goes away. 52px clears
  Apple's 44pt minimum in the axis where we have room.
- `.dock-btn { flex: 1 0 auto; min-width: 2.5rem }` — **grow to share the bar, never shrink below
  40px.** Where the row fits, the buttons spread across the width instead of huddling at the left,
  which is the "slightly more spaced out" half of the ask.
- `flex-shrink: 0` is the load-bearing part and is why this is safe. The bug § a narrow window was
  written to fix was buttons being silently clipped out of an `overflow: hidden` segment; a button
  that may grow but may never shrink cannot re-create it. `.dock > *:not(.dock-gap) { flex: none }`
  had to become `flex-shrink: 0` for the same reason and the opposite direction: `none` pinned
  *grow* to zero as well, which silently outranked all of this on exactly the phones it is for.

### It does not fit on a phone, and that is the honest version

**Do the sum, do not trust a remembered count.** The first draft of this plan said nine buttons and
did the arithmetic on that; Sol counted eleven the same afternoon; a ninth mode (`outline`) landed
from another agent hours later, making it twelve. The count is `MODES_UI.length + 3` — the modes,
then Comments, Tweets and Metadata — and it only goes up. Each button costs 40px and each mode a
further 1px of hairline, so the row is about `40 × (m + 3) + m + 9`.

At eight modes that is 457px against 383.6px of bar; at nine it is 498. **A phone in portrait
scrolls, and every mode added from here makes it scroll by another 41px.** No floor small enough to
avoid it is worth having — twelve buttons sharing 384px is 32px each, which is smaller than they
were before any of this.

So the row scrolls sideways, which is what Greg chose when asked: *"maybe also row scrolls sideways
if it doesn't fit horizontally"* (2026-08-28). § a narrow window already gives `.dock`
`overflow-x: auto` with the scrollbar hidden, and that does not change. What this work honestly
delivers on a phone is **bigger buttons** (40×52 against roughly 30×35) rather than bigger *and*
spread out; the spreading arrives on a tablet, where the row fits.

**What it cannot claim is that they are all visible at once on an iPhone**, and the ones at the
right-hand end — Tweets and Metadata — sit past the edge until the reader discovers the bar
scrolls. The fix
for that is a two-row bar, which the hiding bar has just made affordable and which is a design
change rather than a size change. It is in § Open for Greg.

Labels stay hidden below 743px, as today. Every dock button carries its name in a tooltip and an
explicit `aria-label`, so this costs a sighted reader a hover and a screen-reader user nothing.

## What the second review found

The built code went back to GPT Sol
([mobile-screen-real-estate-code-review-sol.md](mobile-screen-real-estate-code-review-sol.md)),
which is worth more than the plan-stage pass and was: it verified the eight fixes above and then
found three collisions the plan had not thought about, all of the same shape — **`viewport-fit=cover`
changes the whole document, and only the reader shell had been audited.**

- **The corner wordmark against every page that is not the reader.** `.logo-home` rests at
  `top: var(--safe-top)` now, so in the installed app it occupies y=47…91 — while Metadata, Tweets,
  the three public pages and the profile page all reserved a flat `pt-14` (56px) for it. About 35px
  of overlap, on the back link. All six are `calc(3.5rem + var(--safe-top))` now.
- **The install hint had no clearance at all.** It is fixed above the bar, and nothing reserved its
  height — so it covered the last lines of the article and, worse, the bottom of every open mode
  panel, where the last glossary term or search hit becomes unreachable. There is a `--hint-h` token
  now, `0px` unless `:root:has(.install-hint)`, added to `.reader`'s bottom padding, the band, the
  fade and the three dialogs. **It is a fixed height rather than a measured one**, which is a real
  trade: 3.5rem holds the two lines the copy comes to at 390px, and rewriting the sentence longer
  means moving the number.
- **Three more horizontal gaps**: `td.pin-left` pinned to where the spine used to start rather than
  where it starts now; the comment, chat and annotate dialogs sat at `right: 1.25rem` from the
  physical edge.

And two things that were already broken and only became visible here:

- **`OfflineStrip` was drawn underneath the dock** — `z-index: 50` against the bar's 96 — so the one
  notice that says *nothing on this page is going to work* could not be read whenever the bar was on
  screen, which is most of the time. And at `bottom: 0` it emerged into the home-indicator strip the
  moment the bar learned to slide away. It is `z-index: 97` above the bar and the hint now.
- **A dialog open while the bars are hidden** floats ~98px above the bottom of the screen, because it
  is anchored to the bar's resting room. The three dialogs joined the never-hide guard rather than
  being made to chase the bar: a dialog is open because the reader stopped reading, which is exactly
  when the chrome should come back.

**One thing it validated that was wrong anyway.** Sol read the code before two fixes found by hand,
and pronounced both correct as they then stood: the `.controls` transform (which hid the bar by
`--bar-h` and parked it *inside* the status-bar strip, 44px of granularity pills behind a
translucent clock) and `stickyOffset`'s floor of `0` (which under-reported by a whole status bar in
the state a reader spends most of their time in). Both were found by doing the arithmetic at
`--safe-top: 47` on paper rather than by looking at a screen where it is 0. A cross-family review is
not a substitute for that.

**What was left alone, on purpose:** the `px-6` side padding on the non-reader pages. Those are
`mx-auto max-w-2xl`/`3xl` centred columns, and the notch only has a left/right inset in *landscape*,
where 844px of window leaves 86px of margin either side of a 672px column against a 47px inset. The
collision cannot happen at any width those pages are readable at.

## What we are not doing

- **No mobile layout.** Everything here is a rule the desktop already follows, followed further —
  the standing rule from [mobile-reading-view.md](mobile-reading-view.md). There is still no second
  view to keep in step.
- **No overflow `⋯` menu** hiding Tweets / Metadata / Info behind a tap. It was offered and Greg did
  not take it; growing the buttons and keeping the scroll fallback gets most of the spacing without
  moving anything a tap further away. If the row does turn out to scroll in practice, that is when to
  revisit it.
- **No service worker, and no offline.** `display: standalone` needs a manifest, not a worker. An
  installed app that goes stale in a cache is a different project.
- **Nothing that makes the prose scroll differently.** [touch.md § why the prose is untouched](../project/touch.md#why-the-prose-is-untouched) still holds.

## How we will know

The honest problem with all of § 2 is that **every expression collapses to today's behaviour on
every machine we develop on**, so "it looks fine" is not evidence of anything
([silent-success.md](../reusable/silent-success.md)).

- **A control that must go red.** Before trusting any safe-area rule, force the tokens to a visible
  value (`--safe-top: 40px`) in a desktop browser and confirm the chrome actually moves. A rule that
  cannot be made to move is a rule that will not move on the phone either. This is the check that
  catches a typo'd `env()` name, which is silent by design — an unknown `env()` falls back and
  everything looks normal.
- **The hidden-bar state read on a real device.** `data-bars="hidden"` with `--bar-bottom: 0px`
  instead of `var(--safe-top)` is the specific mistake here, and its symptom only exists in the
  installed app.
- **The dock's resting height is a number in a test.** `tests/layout.test.ts` already pins the
  744/743 crossover; the dock's contribution to `.reader`'s bottom padding wants the same treatment
  if anything starts computing it.
- **Install it and look**, in both orientations, on the phone in the screenshots. Nothing above
  substitutes for that, and § 2 in particular has no other witness.
- Browser pass in a Sonnet subagent for the ordinary-tab half (dock hiding, dock sizing, nothing
  clipped at 390px and at 844×390), per [browser-testing.md](../project/browser-testing.md).

### What the browser pass actually showed, 2026-08-28

The control worked, which is the only reason any of the rest counts. With
`--safe-top: 40px`, `--safe-left: 30px`, `--safe-bottom: 25px` forced on `:root` and transitions
killed:

| | before | after |
|---|---|---|
| `.controls` top | 223.2 | 263.2 (+40, height still 44, bottom flush with the table head — no double-shift, no gap) |
| `thead th` computed `top` | 44px | 84px |
| `.spine` left / bottom | 0 / 806 | 30 / 781 |
| `.masthead` padding-top / left | 20px / 24 | 60px / 54 |
| `.dock` height | 40 | 65, with 25px of bottom padding |

`elementFromPoint` inside the reclaimed strip hit nothing but the page background, and a nonsense
control (`--zz-nonsense: 40px`) moved nothing — so the method was being tested as well as the rules.

The dock hiding was checked in a real 900×337 window rather than an iframe (see below):
`data-bars` flips to `hidden`, `--dock-bottom` to `0px`, the bar's `top` reaches `innerHeight`
exactly, `.reader`'s `padding-bottom` does not move throughout, an open mode band tracks down with
it, and everything reverts on the way back up.

**And it corrected a number in this plan.** At desktop sizing all eleven buttons *do* fit 390px, with
25px to spare — it is the coarse-pointer sizing that takes the row to 467px against 390 of bar. So
the scroll is a consequence of making the buttons pressable rather than of there being eleven of
them, which is the more useful way round to know it. Every mode button stayed inside `.dock-modes`'
`overflow: hidden` clip at both sizes (`scrollWidth == clientWidth == 320`), which is the failure
that rule exists to prevent, and `body.scrollWidth == innerWidth` at both — no sideways page scroll.

**One harness limit worth knowing:** a scripted wheel event cannot be delivered into a same-origin
iframe. Dispatched well inside a 390px frame it scrolled the *outer* page instead, twice, with
neither document receiving a `wheel` event. So the iframe technique that
[browser-testing.md](../project/browser-testing.md) recommends for phone widths can measure a phone
layout but cannot scroll one; anything scroll-driven needs a real small window, which caps out at
605px wide and so can only reach the `max-height` half of § a small device.

## Open for Greg

- **Does the wordmark still earn its corner on a phone?** `--logo-w` is 8.5rem and the masthead
  reserves it. With the status bar reclaimed the corner gets busier, not quieter. Not touched here.
- **The right-hand strip in landscape is Chrome's, but the gist columns are ours.** If landscape
  still feels cramped after the install, the next thing to look at is how many gist columns a
  844×390 window should show — `fitView`'s call, not CSS.
- **Should the bar wrap to two rows on a phone, rather than scroll?** Eleven buttons cannot fit one
  384px row at a size worth pressing (§ Bigger). Two rows of five or six gives ~64×52 targets with
  nothing off-screen and nothing to discover — and it costs only height, which stopped being scarce
  the moment the bar learnt to leave the screen. The catch is `.dock-modes`: it is one flex item
  with a frame round it and cannot wrap internally without breaking the segmented control, so a
  naive `flex-wrap` gives a ragged first row. Worth doing properly if the scroll annoys you.
- **Should a deliberate gist step also hide the chrome?** `markOurScroll` makes the bars ignore any
  scrolling we started, which is right for the race it prevents and means a landscape reader using
  the swipe keeps every bar on screen for ever (§ One thing of ours). Now that the dock is on the
  same switch, that is more chrome than it was.
- **The install hint reappears for somebody who has already installed it** and then opens the app
  in an ordinary Safari tab. `navigator.standalone` and `display-mode` report the *window's* mode,
  not installation history, and Apple gives a Home Screen web app storage separate from the
  browser's, so a dismissal inside the app cannot reach the tab. Nothing to be done from here; the
  mitigation is that the second offer costs one tap.
- **The masthead's narrow `padding-left`.** Pre-existing and untouched: the base rule reserves
  `--logo-w` for the wordmark and the narrow query's shorthand resets it to `1rem`, so at
  `--logo-w: 2.6rem` the title overlaps the logo by 0.1rem. Adding `--safe-left` shifts both
  together, so this is exactly as wrong as it was. Sol spotted it in passing.
- **VoiceOver and Switch Control on a bar that slides away.** A transformed bar is still in the tab
  order and the accessibility tree, and `:focus-within` should bring it back — but whether
  VoiceOver's virtual focus produces the same DOM focus state is untested, here and in touch.md.
  Sol flagged it; it wants a device, not a browser pass.
