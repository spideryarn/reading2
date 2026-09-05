# A small-screen banner, once, on a phone

> Perhaps show a small banner the 1st time someone tries to use Spideryarn on a phone to say words
> to the effect that it's really designed for larger screens. It's possible to use it, but it can
> really only show either the mode panel or the text, and that we're working on a way to be able to
> show both. You have to switch between back and forth between Plain mode to see the text and the
> mode. You could also try it in Landscape, and this is a work in progress. Make it succinct, clear.
>
> — Greg, 2026-09-05

The thing being explained already exists and is deliberate:
[layout.ts § `fitMode`](../../src/web/layout.ts) hands the band **zero** width below
`MODE_MIN + PROSE_MIN`, and styles.css § a band with no room then lays it over the article instead
of beside it. A reader on a phone meets that as *the text vanished*. This is one sentence saying
what happened and where the way back is.

## What it is

A one-line banner at the top of the reading view, above the controls bar, with a × that never
brings it back. Same shape as `InstallHint` — the pure half in a module, the strip in a component,
one bit in `localStorage`.

**The contract is *until dismissed*, not *once*, and that is a deliberate departure from the ask.**
Greg said "the 1st time"; nothing here records a view, only a press. A banner that spent itself on a
visit where the reader scrolled straight past would have explained nothing to the one person it
exists for, and the cost of the other way round is a single tap. Worth Greg's opinion if he disagrees
— it is one `useEffect` to change.

The words, and the whole of them:

> **Spideryarn is designed for a larger screen.** There's room here for the article *or* a mode
> panel, not both, so you switch between them — **Plain** is the way back to the article. Landscape
> gives you a bit more room. Showing both is work in progress.

Every clause is one of Greg's, in his order. The only one that moves is the landscape sentence,
which is dropped where it would be advice to do what the reader is already doing.

## The four decisions

**1. It shows when the band actually covers the article, and the pointer is coarse — not on "a
phone".** There is no reliable test for *phone*, and the device is not the fact that matters: it is
that this window cannot hold the band and the prose at once. So the gate is
[`bandCoversProse`](../../src/web/layout.ts) — the crossover lifted out of `fitMode`, which now asks
it too, so there is one statement of it and not two — and `(pointer: coarse)`, which keeps it away
from a laptop whose window is merely narrow and can be widened by dragging a corner.

**The first draft compared `windowWidth` against `MODE_MIN + PROSE_MIN` and called the 12px of spine
rail a harmless approximation. It was not.** An iPad in portrait is 834px, which is *above* that sum
and 10px *below* the real crossover with the rail on — so the approximation showed the banner on
every phone and on no iPad at all, missing the device it was most obviously for, by two pixels.
Caught by the test that stated the machine rather than the arithmetic. The crossover moves with the
rail because the rail is 12px of the window the band is negotiating for, and that is exactly the
disagreement that already cost this codebase a bug once — `App.tsx` § `band-covers`, where a
hand-copied `@media (max-width: 843px)` fought the layout for six days.

The crossover lands at 844px of **usable** width, and *usable* is the load-bearing word: the number
this is asked about is `useWindowWidth`'s, which is `innerWidth` minus the safe-area insets. So it is
a window rather than a device — a notched phone whose screen is 844pt sideways is handed rather less
and keeps the banner. The tests name the boundary as arithmetic for exactly that reason; an iPhone SE
at 667pt is far enough past it to be safe to name. GPT Sol caught the earlier wording, which called
844 "an iPhone 14 in landscape" and was false on any phone with a notch.

**And it is handed the raw `?spine=` parameter, not `Fit.spine`.** The resolved value answers a
different question — `fitView` turns the rail off in *outline* mode, where there is no band at all —
so reading it would have made the banner blink in and out as an iPad reader switched between Plain
and Outline. `modeSpine` in layout.ts is the one resolution both callers now use.

**2. Reactive, not read-once.** `InstallHint` reads its environment once on mount and argues,
rightly, that none of its four facts can change during a visit. This one's can — that is the *point*
of the landscape sentence. So the component takes `bandCovers` from `App.tsx`, which computes it from
the `useWindowWidth` it already tracks on `resize` and `orientationchange`, and no listener of our
own is added. `readMachine` is the read-once half, and the split is named in its docstring: the
pointer and the dismissal are settled in practice, and asking them in render would put a
`localStorage` read on every scroll frame.

**Two limits, both named in the code rather than glossed.** *Settled in practice* is not *cannot
move* — a hybrid device's primary pointer can change under it, and a dismissal in another tab is
invisible until this one reloads. And what follows the window is the *width*: a resize that changes
only the height (iOS collapsing its own toolbar) produces the same state and no re-render, so the
landscape clause can lag until something moves the width. A rotation always does, which is the case
the clause is about. All three were GPT Sol's, 2026-09-05.

**3. The landscape sentence is conditional on there being a landscape to go to.** Told to turn the
phone sideways while already sideways, a reader learns we are not looking. `moreRoomSideways`
compares the viewport's two sides; on a small phone already in landscape the sentence is dropped and
the rest stands.

**4. In flow at the top, not a fixed strip above the dock.** That slot is taken: `InstallHint` sits
there and `--hint-h` / `.offline-strip` are stacked on top of it, and a second occupant would mean
a second token and an ordering question. In flow it also costs one reflow, once, on arrival — before
the reader has started reading — rather than a permanent 3.5rem off the article. It scrolls away
like the masthead, which is right for something you read once.

The consequence, and it is **accepted rather than solved**. With a band covering the article the
banner would land under the fixed corner logo, exactly as `.shared-notice` did in August, so it gets
the same rule — `.reader.band-covers:has(.mode-band) .small-screen-hint`. That means arriving with a
mode already open (`?mode=chat` on a phone) shows the covering band and *no explanation* until the
reader reaches Plain, which is the one arrival where the sentence would have earned the most.

GPT Sol pushed on this, rightly, and the answer is still no: a fixed band covers the whole article
from the bars down, so there is nowhere stable to put a sentence while it is open, and any attempt
lands on either the logo or the panel. What makes it tolerable is that the default mode is Plain and
a shared link carries no mode, so the ordinary first arrival does get the banner — before the reader
presses the mode button that makes the article vanish. **Hidden, never dismissed**: pressing Plain
brings it back.

## Stages

1. **The predicate and the banner.** ✅ `bandCoversProse` lifted out of `fitMode` in
   [layout.ts](../../src/web/layout.ts); [`small-screen-hint.ts`](../../src/web/small-screen-hint.ts)
   (pure, plus the `localStorage` guard); [`SmallScreenHint.tsx`](../../src/web/SmallScreenHint.tsx);
   two blocks in `styles.css` (the banner, and hiding it under a covering band beside `.shared-notice`);
   mounted in `App.tsx` between the visitor's notice and the controls bar.
   [`tests/small-screen-hint.test.ts`](../../tests/small-screen-hint.test.ts) states the machines it
   means. Section in [touch.md](../project/touch.md).

   **`media()` moved to [`src/web/media.ts`](../../src/web/media.ts)** on the way, from
   `install-hint.ts`, where it was private: two hint modules wanting the identically-guarded
   `matchMedia` is a second copy, not a second question. `feedback-diagnostics.ts` and `scroll.ts`
   keep theirs — one needs a third state for *cannot tell*, the other a live `MediaQueryList`.
2. **Review and land.** ✅ Browser pass on the box at five viewports with touch emulation (390×844,
   844×390, 834×1194, 667×375, and 1280×800 with touch off) — all as designed, including the band
   hiding it and the × surviving a reload. GPT Sol reviewed the diff and found no P1 and four P2s;
   all four are addressed above and below. `npm test`, `npm run typecheck`, `npm run check`.

   **What the review changed.** The 844 case was named as a device and is now named as arithmetic
   (§ 1); *once per device* was the contract in the docs and *until dismissed* is the contract in the
   code, so the docs moved (§ What it is); the deep-link gap moved from an aside to an accepted
   limitation (§ 4); the reactivity comments stopped claiming more than they hold (§ 2). And the
   biggest of them: **the suite would have passed over a feature that never appeared.** Every
   assertion in `tests/small-screen-hint.test.ts` survives a `readMachine` that always answers
   `false` and a `rememberDismissed` that writes nothing, because jsdom has neither `matchMedia` nor
   a reachable `localStorage`. `tests/small-screen-banner.test.tsx` installs both and mounts the
   thing — and was checked the only way that is worth anything, by making
   `rememberDismissed` a no-op and watching it go red.

## What was passed over

- **A `matchMedia` hook of its own** for width and orientation. `App.tsx` already re-renders on both
  events; a second subscription would be a second thing to keep in step.
- **A dialog.** Greg asked for a banner, and a modal in front of an article a reader has just opened
  is a worse first impression than the layout it is apologising for.
- **A `reader_profile` column instead of `localStorage`.** Ruled out for the reason
  [referee-card.ts](../../src/web/referee-card.ts) gives at length: a per-device "I have read this"
  bit is not view state and not worth a migration.
