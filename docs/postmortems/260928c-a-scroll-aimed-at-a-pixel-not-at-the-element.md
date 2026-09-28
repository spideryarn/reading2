# A scroll aimed at a pixel, not at the element

**2026-09-28.** In Trajectory mode, pressing *Next stop ›* scrolled to the next stop and flashed it —
and left its first lines under the top edge of the window. It reached a reader: Greg, on production.

> when I clicked to go to the next Stop, it correctly flashed the block … but somehow the scrolling
> wasn't quite right, i.e. the page was scrolled down a bit and I think the Quote was cutoff at the
> top. Maybe this is a problem with the general block-links rather than Trajectory mode itself, I
> don't know.
>
> — Greg, 2026-09-28

He was half right: the trigger is Trajectory's, the defect is in the shared helper.

## What happened

Measured in a real browser (Playwright, the entropy paper, at 1440, 1024 and 820px): whenever the
next stop was **below** the current one in the article, the target row came to rest at `top ≈ −86px`
and its quote mark at `≈ −51px`, stable, no late drift. When the next stop was above, it landed
right. Every Trajectory path failed the same way — ‹ ›, the → key, the door in the prose, a row
pressed in the band (`beginJump`). An ordinary glossary block link landed at `+0.45px`. The sticky
bar offsets were checked and ruled out.

The mechanism, confirmed in the code:

1. The **"Next stop ›" door** (~75px) hangs *inside the current stop's row* — `TableView`'s
   `afterBlock` slot, fed by `Reader` from the Trajectory control's `blockId`.
2. A press calls `goStep` → `setRoute({stop})` (queued, not yet committed) → `arrive` →
   `scrollToBlock`, which computed its destination **synchronously, at click time**:
   `row.getBoundingClientRect().top + scrollY − stickyDestination()`, and handed that **number** to
   `glide`.
3. React then commits the step, and the door moves from the old row to the new one. When the new
   stop is below, 75px vanish from **above** the target — after the target was measured.
4. `glide` spends 200ms travelling to the number, arrives exactly where it was told, and reports
   `settled`. The row is 75px higher than when it was measured, so it lands 75px too far — under
   the bar.

When the stop is above, the door's removal happens below the target and moves nothing that matters,
which is why only one direction failed.

## The class: a destination measured once, for a journey the layout does not hold still for

**A scroll computed its target as a pixel from one measurement and then trusted that pixel for the
length of an animation**, while the thing it was aiming at was free to move. Anything that changes
layout above the target between the measurement and the last frame — a state change the same click
started, an image loading, a band opening, a gutter note appearing, a rotation — leaves it landing on
where the element *was*. It reports success because it did exactly what it was told: the check
(`settled`) was about the number, not the element.

It is a [silent success](../reusable/silent-success.md): `settled` meant "arrived at the pixel" and
every caller read it as "the row is under the bar".

**This is the second instance, and the first was patched at the caller.** Plan
[260916a](../plans/260916a-back-to-where-you-were-survives-a-mode-change.md) found the same shape on
rotation — *"`scrollToBlock` works out a destination in pixels and `glide` spends ~200ms going to
that number, so a reflow mid-flight leaves it aiming at a layout that no longer exists"* — and fixed
it inside `useReadingPosition` (abandon the glide, move instantly) for the one reflow it was looking
at. The helper kept the property, so the next caller to shift layout during a glide met it fresh.
That is the difference between noticing a class and closing one.

## Which commit

**64595ca9**, *Trajectory stage 2: the mode, behind the experimental switch* (2026-09-28). It added
both halves at once: the door rendered after the current stop's block, and steps that call
`scrollToBlock` in the same handler that queues the stop change. `arrive` and the flash on settle
came later (71256d78, stage 5-i) and inherited it. The fixed-pixel destination itself dates from the
first `scrollToBlock` (e6eb7e07, 2026-08-25) and the custom `glide` (e24c9e62) — correct for as long
as nothing a click did could move the layout above the target.

## Why nothing went red

- **Every scroll test stubbed `getBoundingClientRect` with a constant**, independent of `scrollY`.
  That is only consistent with a helper that measures once; it encodes the assumption the bug lived
  in. A test could not have moved the row during a glide even if someone had thought to.
- **`settled` was verified as "the glide's last frame ran"**, which is true of a glide to the wrong
  place.
- **The Trajectory tests mock `scrollToBlock` out entirely** (jsdom has no layout), so the door and
  the scroll never met in a test.
- **The browser check for stage 2 stepped *somewhere*** and saw the flash. The flash is on the right
  block whatever the scroll does, so the most visible confirmation was blind to the defect.

## The fix, and the right one for the long term

Shipped in the shared helper, which is where the class lives (`src/web/scroll.ts`):

- `glide` takes **`aim: () => number`** — a question, not a number — and asks it on every frame. The
  eased position is the fraction of the way from the start to where the element is *now*, so the
  last frame lands on the element whatever moved above it. `scrollToBlock` passes `aimAt(id, row)`,
  which re-measures the row (re-finding it by id if React replaced it) and the bars each frame.
- **The instant path** (reduced motion, `behavior: "auto"`) still moves synchronously, then runs one
  corrective frame after the commit, and only then reports `settled`. Before, it reported `settled`
  on a position measured before the commit — the same bug, without the animation.
- Cancellation is unchanged: the same wheel / touch / `pointercancel` listeners, the same `cancel`.
  `scrollByScreen` passes a constant, so its behaviour is identical.

That is the long-term fix, not a patch; the Trajectory-local alternative — scroll from a layout
effect after the door has moved — was **rejected**: it fixes the door and nothing else, and it moves
the scroll out of the handler that owns the gesture, which is exactly how 260916a ended up with a
caller-local fix to a helper's property.

**What it touches** — every `scrollToBlock` caller: `beginJump` (keynav.ts, so every history-pushing
jump: block links, search hits, glossary, diagram nodes, gist cells, the Trajectory row press),
the arrow keys (keynav.ts), swipe steps (swipe.ts), comment stepping (comment-jump.ts),
`Reader`'s note-arrival scroll, `useReadingPosition`'s restore and reflow re-anchor (both `"auto"`,
now with the one-frame correction), and Trajectory's `arrive`.

**What it does not cover.** A layout shift *after* the last frame (an image finishing after
arrival) still moves the row; nothing chases it, and nothing should — at that point the reader is
reading. And the `< 1px` early return still settles at once without a re-check.

## What would have caught it, ranked by ease against value

1. **Scroll-aware rect stubs** — `top = docTop − scrollY`, with `docTop` a map a test can move.
   Done in `tests/scroll-settlement.test.ts`; the four new tests there (a shift before the first
   frame, a shift mid-glide, the instant path, the wheel after re-aiming) go red with the per-frame
   `aim()` mutated back to the first measurement. A constant rect is a stub that agrees with the
   code by construction.
2. **When a caller patches a helper's property, move the fix into the helper or say why not.**
   260916a is the example: the sentence describing the class was written, and the fix went one
   level too shallow. A habit, costs nothing.
3. **For any "go to X" feature, check the landing position in the browser, not the flash.** The
   browser pass already existed; it looked at the wrong evidence. Cheap, and it is the check that
   found this in the end.
4. A Playwright suite that steps a Trajectory route and asserts each landing — rejected for now.
   The unit tests above cover the helper's contract; the browser suite would cost more than it
   adds while the mode is still moving.

## The thing I would tell myself

The door was put in the current stop's row on purpose — that is where the reader's thumb is — and
nobody asked what happens to the rows below when it moves. The scroll helper's comments already
explained, twice, that its destination was a number computed once and that the bar sliding
mid-glide was a problem for exactly that reason; the fix each time was to make the number better
rather than to stop trusting it. Aim at the element.
