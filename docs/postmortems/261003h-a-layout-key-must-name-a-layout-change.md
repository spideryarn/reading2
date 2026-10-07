# A layout key must name a layout change

Commit `84ad9e8bd` added breadcrumb visibility to the reading position's `layoutKey`. That fixed a
real narrow-window reflow and also told the position tracker that the article had reflowed on every
wider window, where the bar stayed 44px tall. A signed-in visitor who changed Experimental state
with `?at=` set could therefore be moved back to the start of their section. The candidate was still
in review, so this reached no reader.

## What happened

The bar exists for a signed-in non-owner's View-only chip whether or not it also holds the headings
breadcrumb. At 731px and below, adding that breadcrumb raises the bar from 44px to 68px; above the
query it stays 44px. The candidate keyed on raw `showCrumbs`, so it represented the first change and
invented the second.

`useReadingPosition` does not treat `layoutKey` as an optimisation hint. On a changed key with an
unchanged, non-null `?at=`, its layout effect deliberately calls `scrollToBlock(at, "auto")` to
repair a real reflow. The false key therefore had a visible consequence.

A wide-window regression test was written against the candidate and failed red:

```text
expected '768|0|on|756|0|1|1' to be '768|0|on|756|0|1|0'
```

## The class: visible state is not geometry state

A reflow key is a compact claim about geometry. Feeding it the state that *causes* geometry only
under another predicate broadens that claim silently. The local state looks relevant, the key
changes reliably, and every ordinary rerun agrees; only the consumer reveals that a false positive
is an action, not harmless extra work.

The root cause was therefore not an omitted width check on one boolean. It was naming a UI state in
a geometry contract instead of naming the effective geometry produced by UI state **and** CSS.

## Why nothing went red

The plan-review regression covered the narrow signed-in visitor: at 390px, opening a covering mode
hides the breadcrumb while leaving the chip's bar present, and the key correctly must change. Its
observer mock was sound, but the test had no wide control. The implementation and the test shared
the assumption that breadcrumb visibility always changed bar height.

The screenshot pass showed wide rendering was pixel-identical. That could not catch the defect:
the unwanted movement needs a non-null `?at=` and a later Experimental-state change, not the first
paint the screenshots measured.

## What would have caught it, ranked by ease against value

1. **Pair every conditional geometry-key case with a control outside its predicate.** The 390px
   visitor must change key; the otherwise-identical 768px visitor must not. Done here, and watched
   fail on the candidate.
2. **Name the effective geometry before serialising the key.** `tallCrumbsBar` makes the contract
   reviewable in a way a raw `showCrumbs` field was not. Done.
3. **Drive the predicate from the same derived boundary and ask `matchMedia`.** The page-width value
   deliberately excludes a classic scrollbar, while CSS media queries ask the viewport. Done; the
   CSS copies remain guarded by `spine-width-check` markers.
4. **Replace the string with a typed geometry object.** Rejected. A type could name fields but could
   not prove they represent effective geometry; it would add machinery without closing this class.

## The long-term fix

The shipped fix keys on `showCrumbs && matchMedia(narrow-window).matches`, not on `showCrumbs`.
`NARROW_WINDOW_MAX` gives TypeScript one derived boundary; the CSS copies keep their markers because
CSS cannot import it. The narrow case still restores position when the bar becomes taller, and a
wide visitor's one-line breadcrumb no longer claims the article moved.

## The thing I would tell myself

I knew `layoutKey` existed to describe reflow, but I tested the state transition that motivated the
change rather than the exact set of windows where it changes geometry. When CSS supplies the second
half of a condition, that half belongs in the key and in the red test.
