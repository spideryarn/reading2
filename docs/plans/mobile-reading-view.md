# The reading view on a phone

**Status:** built 2026-08-27, after Greg tried the app on a phone in both orientations. Reviewed by
GPT Sol at plan stage, which changed two of the decisions below outright — those are marked.

> Let's try and make this work better on mobile. … Try with a really narrow window (for portrait
> mode). Maybe we need to rethink the way we currently always show the block-ids to the left of the
> blocks. That's a big waste of horizontal space. … I also tried in landscape mode. Then the
> vertical screen estate was at a premium. What can we do about that? For example, combine the top
> two bars into one? Only show after certain kinds of scrolling? Also combine the bottom bar? …
> (Also, FYI I noticed that the bottom-bar didn't display properly - I couldn't see the radio-group
> properly.)
>
> — Greg, 2026-08-27

## How it was measured, and the three traps in doing so

**Chrome on macOS will not make a window narrower than 605 CSS px.** `resize_window` reports
success, `innerWidth` stays where it was, and nothing anywhere errors — the same class of thing
[browser-testing.md](../project/browser-testing.md) already warns about. A phone-width window is
simply not available, and asking for one leaves you measuring a 605px page you may well believe is
390.

What was used instead: a **same-origin iframe** of the exact size, injected into a page already
served by the dev server. Inside an iframe, `innerWidth`, `100vw` and every width media query are
the *iframe's*, so `fitView` and the stylesheet see a genuine 390 × 740. Being same-origin, the
harness reads computed boxes straight out of `contentWindow`. For a frame wider than the window, a
CSS `transform: scale()` on the iframe keeps the layout at full size and only shrinks the paint.

Two things that harness cannot do, both of which cost real time here:

- **`@media (hover: none)` and `(any-pointer: coarse)` still match the desktop**, so no rule keyed on
  touch is being exercised. One real bug was found by reading those rules instead — § the chat button.
- **The tab is not frontmost, so `requestAnimationFrame` never runs in it.** Every scroll-driven
  feature is therefore dead in the harness while looking perfectly healthy: the listener is
  installed, the page scrolls, `scrollY` updates, and nothing happens. A completely broken
  implementation and a correct one are indistinguishable. That is why the bar's decision logic was
  pulled out into a pure function with its own tests rather than checked in a browser.

And one that is not about the harness at all: **a long-lived tab accumulates a stale parsed
stylesheet.** After dozens of HMR updates, the `<style>` element's *text* was byte-for-byte correct
and the *parsed* rules were not — `--bar-bottom` switched on `:root` while `thead th` kept a `top`
resolved from an older build. Every check agreed with itself and all of them were wrong. A brand-new
tab settled it in one call. Check a CSS mechanism in a fresh tab before concluding the CSS is wrong.

## What was actually wrong

Measured on `/read/noema-mythology-of-conscious-ai` at 390 × 740 and 844 × 390.

| | Measured | Meaning |
|---|---|---|
| `.dock-modes` | `clientWidth 48`, `scrollWidth 245` | **five of the six mode buttons cannot be pressed.** Greg's radio-group |
| `.controls` | `clientWidth 366`, `scrollWidth 642` | 276px of the bar is off the right edge, silently |
| table | `720px` in a `390px` window | every line of prose cut mid-word; reading needs sideways scrolling |
| `.masthead` / `.controls` `padding-left` | `136px` | 35% of the window reserved for the wordmark |
| `td.text` `padding-left` | `83.2px` | 21% of the window reserved for a block id |
| landscape chrome | `44 + 40 + 40 = 124px` of `390` | **32% of the viewport** is permanently bars |
| a mode band | `288 + 544 = 832px` asked of `390` | chat, search, glossary, summary, ideas and diagram all unusable |

Three of those are the *same bug*: a flex row whose contents do not fit, with no scroll and no sign
that anything is missing. `.dock-modes` had `overflow: hidden` for an unrelated reason — it clips the
selected segment's fill to the frame's rounded corners — and that rule quietly became a different
rule as modes were added. The note above the `max-width: 1100px` query in styles.css predicted
exactly this and fixed only the half a laptop can see.

## What was decided

### 1. Below the width where one gist column fits, there are no gist columns

`fitView`'s auto-fit could never drop the *last* gist column (`while (n > 1 …)`) and reserved
`PROSE_MIN` (544px) for the prose whatever happened. Below `GIST_MIN + PROSE_MIN` (720px) those two
promises cannot both be kept, so the table became wider than the window and the page scrolled
sideways.

The rule is now the one the file already states, followed one step further: **shrink first, drop
second — and drop all the way to zero when zero is what fits.** A second change was needed to make
it real: `detailW` floors at `min(detailMin, avail)`, because a prose minimum applied to a column
with nothing left to be protected from was still forcing the overflow on its own.

Deliberately *derived* rather than a breakpoint — the crossover falls out of the two constants
already in the file (744px window, pinned in `tests/layout.test.ts` at 744/743), so a 700px laptop
window improves for the same reason a phone is rescued.

**What is honoured exactly is the reader's choice of columns, not their widths.** `?cols=` still
gets its columns at any width. Sol read the promise the stronger way and asked whether the prose
should keep its 544px floor there too; it should not, because the reader is going to scroll sideways
to the prose either way, and at 366px it then fills the screen while at 544px it is still cut off
when they arrive. Pinned by a test.

### 2. Below the width where a band fits beside the prose, a mode is full-screen

**The two thresholds in this doc are different numbers and must stay that way.** 744px is where the
prose column becomes the window; **856px** is where a band and the prose stop fitting together
(`MODE_MIN + PROSE_MIN + the spine`). Writing the band's CSS inside the 744 query — which is what
shipped first — left a 112px band of window in which `fitMode` handed the band a width of zero and
no rule widened it, so every mode was a correctly-positioned element nought pixels wide and nothing
errored. Sol caught it on the second pass. `tests/chat.test.ts` now pins 856/855 the way
`tests/layout.test.ts` pins 744/743.

**Sol's first blocker, and the plan was wrong.** The first version gave the band and the prose a
full screen each and let the page scroll between them. `.mode-band` is `position: fixed`, so it
cannot scroll away and the second pane never arrives — and `--mode-w` at a full screen makes
`calc(100vw - --spine-w - --mode-w)` zero, which is the masthead and the controls bar.

What shipped instead: `fitMode` returns **`modeW: 0`** on a narrow window, so every rule that makes
horizontal room for a band makes none and the rest of the page keeps the geometry it has when no
band is open at all. The stylesheet then widens the fixed band to the window *minus the rail* and it
sits on top of the article. The masthead is hidden while a band is open, so the controls bar sticks
at zero and the band sits directly under it — which is what names the current mode and offers the
way back. All six modes verified clean at 390px, nothing spilling outside its band.

The rail matters: `left: 0` was tried and the panel lost its left-hand 24px under the spine
(z-index 45 against the band's 44). Term names lost their first letter and the heading read
"reshold". Nothing overflowed and nothing scrolled — it looked like a panel laid out slightly wrong
rather than one being covered.

### 3. The block-id gutter is a desktop luxury

83px of every prose row for a 64px debugging affordance. On a narrow window `.block-id` is hidden and
the gutter shrinks to what the per-paragraph chat button needs.

**What survives is weaker than the first draft of this doc claimed**, and Sol was right to catch it:
`?at=` stores a *section*, not a paragraph ([position.ts](../../src/web/position.ts)), so scrolling
rewrites it to section starts and only a deliberate jump ever puts a given paragraph there. A phone
reader can still reach a section's id and cannot conveniently reach an arbitrary paragraph's. Judged
worth 21% of the screen; said out loud rather than glossed.

Not hidden on a wide window, and that is a decision rather than caution — there the prose column is
capped at a measure anyway, so the gutter costs nothing. See § Open for Greg.

### 4. The wordmark gives up its word

`--logo-w: 8.5rem` is reserved as left padding by *both* sticky bars, so the article's title started
136px into a 390px window. On a narrow window the letters hide and the token drops to the mark's own
width — both, in the same query, because HomeLogo.tsx is explicit that changing one without the
other is how a wordmark ends up sitting on the title. Measured after: 16px.

### 5. A bar that does not fit must scroll, not lie

`.dock-modes` gets **`flex: none`** — the segmented control must never shrink, because its
`overflow: hidden` turns shrinking into silent deletion. That is the actual fix for Greg's
radio-group and it applies at **every** width.

Then, so the honest overflow this creates is not just a different failure: on a narrow window every
dock button drops its label (`DockLink` and `DockTab` had to grow the class the modes already used),
and both `.controls` and `.dock` become horizontally scrollable as a safety net. All ten dock buttons
now fit 390px with 34px to spare, and `.controls` measures 366/366 against the old 366/642.

The label gives way rather than the button because each carries its name in a tooltip and in an
explicit `aria-label` — which was true only of the six modes when the plan claimed it, so
`DockLink`/`DockTab` were given one rather than leaving the claim false.

### 6. Landscape: the column header goes, and the controls bar hides while you read

**The table head goes when the article is the only column.** With no gist columns the header reads
`Text verbatim` above a column of the author's paragraphs. Worth 40px, and it is the same 40px in a
mode band on a laptop, where it has been equally redundant all along. The condition is *no gist
columns and the prose is on*, not *one column* — a single gist column still has to say which level it
is, and in outline mode the header is the only place saying so.

**The controls bar hides on scroll-down and returns on scroll-up**, on short viewports only, worth
44px. Four things make it correct rather than merely present:

- **It re-renders nothing** — a passive listener sets a `data-` attribute on the root element, and
  the listener is only attached while the short-viewport media query matches, so a laptop pays
  nothing at all. (The first draft of this doc claimed the two scroll listeners cost one rAF between
  them. They do not; they schedule their own. Sol caught it.)
- **It never reacts to our own scrolling.** Sol's second blocker: every jump computes its
  destination once from `stickyOffset()` and then travels, and a downward jump would hide the bar
  *during* the travel and land 44px under the header it was calculating clearance for. Every path in
  scroll.ts that moves the page now marks the window it owns, and the watcher sits it out.
- **`stickyOffset()` stopped reporting the bar's height as the answer**, because a moved bar still
  measures 44px tall. It now returns how much of the bar a row arriving at the top will have to
  clear: the bar's `bottom`, clamped to `[0, its height]`. The height is still read — it is the
  clamp's ceiling — and that ceiling is a *prediction* rather than current coverage, because at the
  top of the article the bar has not stuck yet and answering "it covers nothing" would send every
  jump 44px too high. Both of those sentences are in the code now; the first draft of this doc got
  the first one wrong and an earlier comment got the second one wrong.
- **It never hides a bar somebody is focused in**, or one that has not finished sticking.

### 7. The chat button was unreachable on a touch device

`.block-chat` was `opacity: 0; pointer-events: none` until `tr:hover`, and a finger produces no
hover — so the door into chat beside every paragraph did not exist on a phone. There is already a
`@media (hover: none)` rule doing this job for `.chat-actions`; this never got one. Found by reading
the stylesheet, which is the only way it could have been found here.

### 8. Two smaller things the review turned up

- **`useColumnContext` was doing its scroll-time geometry for nothing** when there are no gist
  columns: `ColumnPanels` mounted with an empty depth set and went on measuring every section row.
  Gated on there being a column to lay a panel over.
- **The comment and chat dialogs used `100vh`**, the *large* viewport, which overstates the room on
  a phone by the height of an address bar. Now `100dvh`. **This does not fix the on-screen keyboard,
  which is what it was first changed for** — Sol corrected that on the second pass: with the default
  viewport policy the keyboard resizes only the visual viewport and every viewport unit, `dvh`
  included, stays tied to the layout viewport. Making the keyboard shrink these needs
  `interactive-widget=resizes-content` on the viewport meta, which changes how every page in the app
  reacts to a keyboard and is not worth making blind. Deferred to a real-device pass.

## Deliberately not done

- **A separate mobile layout.** Every change here is a rule the desktop layout already contains,
  followed further. There is no second view to keep in step.
- **Hiding the spine.** 24px of 390 is 6%, and it is still the only whole-article overview on the page.
- **Stacking a gist above the prose row.** Sol's strongest push-back (§ Open for Greg, 1).
- **Touch-tuned hit targets throughout.** The dock's buttons are 35–40px tall against the usual 44px
  guidance. A real device is needed — [touch.md](../project/touch.md) lists what only an iPad can say.

## Open for Greg

1. **Granularity zoom on a phone is a switch, not a scroll — is that enough?** Sol's view is that
   dropping every gist column is "a useful emergency reflow, not an adequate mobile expression of
   granularity zoom", and proposes stacking the current section's gist above its prose row. Two
   coarse views are one tap away and both are full-screen (outline mode, and Summary mode), and the
   whole-article gist is in the masthead — but Sol is right that **the spine is not part of that
   answer on touch**: every name, gist and count it carries lives in a hover card a finger cannot
   open. So a phone reader gets the rail's shape and jumps and none of its words. Worth deciding
   deliberately.
2. **Should the block-id gutter be conditional on a wide window too?** "Always show" is the part that
   bothered you. The narrow case is fixed; the wide case costs nothing measurable, so it was left
   alone. Say the word and it becomes hover-only everywhere.
3. **Should the controls bar auto-hide in portrait as well?** Short-viewport only right now. Portrait
   has the height to spare, and a bar that moves is a bar you can lose track of.
