# Logo animations drew into hidden letters

Report [SPIDERYARN-READING2-3P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3P), from
Greg, 2026-09-12 10:32 UTC, build `d358f773`:

> The playful animations for the Spideryarn logo/wordmark animation don't seem to be showing. Our at
> least I'm not finding them.

**Nothing was broken.** All thirteen animations ran, on every hover, exactly as coded. Seven of them
just had nothing to draw on, on the page most readers spend the most time on, at the widths most
readers use. [design-logo.md](../project/design-logo.md) and
[260915c-logo-animations-draw-only-what-can-be-seen.md](../plans/260915c-logo-animations-draw-only-what-can-be-seen.md)
are the fix.

## What happened

Seven of the thirteen wordmark animations select only `.logo-letter` — they animate the ten letters
of "Spideryarn", not the spider mark beside them. On the reading view's bottom bar (`DockHome` in
[`Dock.tsx`](../../src/web/Dock.tsx)), those letters are inside `.dock-btn-label`, which the bar's
own fit ladder ([`dock-fit.ts`](../../src/web/dock-fit.ts),
[`dock-fit.css`](../../src/web/styles/dock-fit.css)) hides completely — `display: none` — at rung 1,
**the first rung it reaches for**, ahead of every mode label.

Measured 2026-09-15 with Playwright on `/read/fowler-phrenology`: at 1280, 1440, 1680 and 1920px the
bar sits at rung 2 (word and mode labels both gone); at 1024px touch it's rung 3. The word only shows
at 2560px. So on every ordinary desktop width, a hover on the reading view's wordmark has better than
even odds of landing on `pluck`, `sag`, `register`, `seam`, `i`, `type` or `abseil` — and drawing
nothing at all.

## The class: a risk was scoped from memory, a day after a sibling file had measured it

The mechanism was correctly identified, in writing, the same day the feature shipped. What was wrong
was the claim about *who it applied to* — and that claim was already false when it was typed, because
the number that would have disproved it was sitting in the very next file over, written the day
before.

**The state was not "later left".** It's tempting to read this as a feature calibrated against a
layout that later drifted away from it — the framing the fix's own plan doc reached for first. The
timeline says otherwise:

- **2026-09-06 10:26, `12bdca54`** ("The wordmark and Feedback leave the corners for the bar") moves
  the wordmark into the dock's fit ladder and creates rung 1 for exactly this purpose. Its own doc
  comment in `dock-fit.ts` measures and prints, that same commit: for the default nine-mode reader,
  rung 0 (word shown) needs **1397px**; rung 1 (word gone, mode labels kept) needs only **1263px**.
  The comment says so explicitly — *"a 1280 and a 1366 laptop keep every mode label and give up only
  `Spideryarn` and `Feedback`"*. Two of the commonest laptop widths there are, already at rung 1,
  already documented, a full day before the animations existed.
- **2026-09-07 21:47, `f881f3f9`** ships the thirteen animations, seven of them letters-only, with no
  check against that number.
- **2026-09-07 23:46, `ac5bb690`**, the same evening, edits
  [design-logo.md § What a phone sees](../project/design-logo.md#what-a-phone-sees) to correctly name
  the mechanism — *"the dock's `.dock-btn-label` goes at **rung 1** — the first thing the bar's fit
  ladder gives up, not the last"* — but the paragraph directly underneath, carried over unedited from
  the section's first draft earlier that day (`428353bd2`), still calls the consequence *"a hover that
  does nothing for every reader **on a phone**"*, and closes with *"the fix if it ever becomes one is
  to weight the pool."* Rung 1 was never a phone-only rung. It was already true at 1280 and 1366px,
  in the sibling file `ac5bb690` itself links to two lines above.
- **2026-09-08 through 2026-09-12** (`24d4901f`, `08fcf555`, `abde65f7`, `2aa16ee7`, `7ffcb898`) keep
  growing the bar — seven command-bar rows, Citations, Comments, a bookmark button — which is what
  pushed 1280–1920px on from rung 1 to rung 2 by the time Greg filed the report. That growth made the
  *mode labels* disappear too. It did not create the original miss; the word was already gone at
  ordinary widths from day one.

So the class isn't "a good measurement went stale". It's: **the scope word in a written-down risk
("phone") was never checked against the number a sibling file had already measured**, and having
named the mechanism correctly one line above didn't stop the wrong scope word surviving underneath it,
in the same edit.

## Why nothing went red

- **`tests/logo-animation.test.tsx`** checks the registry against the stylesheet — that a claimed
  animation actually has rules, that nothing reaches `.logo-text`. It asks nothing about whether the
  DOM it targets is rendered at all; visibility was never in its vocabulary until this fix.
- **The one check that drove a real browser**,
  [260907f-logo-animations-browser-check.md](../plans/260907f-logo-animations-browser-check.md), on
  2026-09-07, tested `a.logo.logo-home` on `/privacy` — the fixed corner copy — and the `/design`
  gallery. Both are correct and thorough about what they cover: they sample computed style through
  whole animation cycles rather than trusting a screenshot, and they confirm the narrow-window case
  (390px, `.logo-text` gone, six mark animations still fire) as intended. **They never open the
  reading view.** design-logo.md's own table names two mount points —`HomeLogo` (corner) and
  `DockHome` (reading view) — and the check exercised exactly one of them. "No silent no-ops" was
  true of the mount it looked at and reported as true of the feature.
- Both checks share the same gap: each treats "the word is hidden" as one on/off fact (below 731px),
  because that's how it works on the mount they were looking at. Nobody asked the dock's own fit
  ladder, a second, independent, currently-shrinking mechanism for the same question, at the widths
  that matter for the page most readers use.

## What would have caught it, ranked by ease against value

1. **Draw only what the DOM says is visible, checked at the moment of the roll.** This is the shipped
   fix: each registry entry is tagged `reach: "letters" | "mark"`, the hook reads
   `.logo-letter`'s `getClientRects().length` at hover/long-press time, and draws from the `mark` six
   only when the letters render no box. It answers all three ways the word can be hidden (the 731px
   query, the fit ladder, a host with no letters) with the one question all three actually affect —
   whether the box is there. Cheap, and it's the countermeasure the whole postmortem exists to argue
   for; see [the plan](../plans/260915c-logo-animations-draw-only-what-can-be-seen.md).
2. **A browser check against a feature with two documented mount points opens both, every time.**
   Costs nothing beyond remembering design-logo.md's own table exists. Belongs in
   [browser-testing.md](../project/browser-testing.md) or as a line in design-logo.md's checklist for
   adding an animation, next to "and then look at it in a browser".
3. **A written risk that ends "if it ever becomes one" names the trigger as a number, not a feeling** —
   a width, a rung, a count — so the next reader can grep for it rather than re-derive it. `ac5bb690`
   had the number two lines away and didn't reach for it. Cheap; a habit, not a check.
4. **Rejected: a continuous CI probe that measures every animation's target against every dock rung
   on every push.** It would have caught this, but the whole point of this feature's apparatus is
   that it stays small — one stylesheet, one hook, no route of its own
   ([design-logo.md](../project/design-logo.md)). A geometry-aware gate for thirteen decorative hover
   effects is disproportionate to what's at stake; item 1, decided at draw time, gets the same
   correctness for a fraction of the machinery.

## The fix that is right for the long term

Not "weight the pool" — a weight still draws a null sometimes, and choosing the weight means
re-deriving the same widths again by hand whenever the bar changes shape. **Filter by asking the
element**, item 1 above: the picker only offers what the current DOM can show, decided once, at the
moment of the hover, from the one measurement that answers all three ways the word can be absent.
That is what shipped, alongside this file.

## The lesson

`ac5bb690`'s paragraph — "rung 1, the first thing the bar gives up" — and the one under it — "does
nothing for every reader on a phone" — read as consistent, and nobody re-opened the file linked two
lines above to check the scope word against its table. **Naming a mechanism correctly is not the same
fact as scoping its consequence correctly**, and the gap between the two is where this lived for five
days.
