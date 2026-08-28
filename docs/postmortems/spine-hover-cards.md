# Fifty triggers, one piece of state, and a card that lasted 90ms

**2026-08-28.** Reported by Greg — *"it no longer has hover-tooltips"* — about
[the spine](../project/granularity-zoom.md#the-spine-a-birds-eye-rail), the rail down the far left.
The rail is proportional, so most of its bands are a few pixels tall and carry no label; the hover
card is where every word the rail knows lives ([tooltips.md](../project/tooltips.md)). Losing it
turns the rail into a decorative stripe that occasionally throws you somewhere — which is the exact
sentence `bf398f3` was written to stop being true on a phone, sixteen hours earlier.

## The real cause

**One `useState` was made to serve fifty tooltips, and Floating UI closes tooltips by calling their
`onOpenChange(false)` — including tooltips that were never open.**

Until [`bf398f3`](#the-commit) each band's `<Tooltip>` was *uncontrolled*: the component kept a
private `useState`, and a stray close touched that one tooltip and nothing else. `bf398f3` needed a
card that survives a tap (reveal, then commit — [touch.md](../project/touch.md)), which needs one
owner of "which card is open" that outlives a synthesised `mouseleave`. So every band became
controlled off a single piece of `Spine` state:

```ts
// src/web/Spine.tsx, as of bf398f3
open={armed?.id === b.entry.node.id}
onOpenChange={(v: boolean) =>
  setArmed(v ? { id: b.entry.node.id, byTouch: false } : null)
}
```

`setArmed(… : null)` is unconditional. It does not ask *which* band is closing. Two mechanisms then
tear the card down, and **both of them are correct behaviour** against the uncontrolled tooltip the
library assumes:

1. **The delay group closes every other member.** `<TooltipGroup>` is `FloatingDelayGroup`, and
   one-open-at-a-time is enforced in a layout effect that runs the instant any member opens:

   ```js
   // @floating-ui/react 0.27.20, useDelayGroup
   if (currentId !== id) onOpenChange(false);
   ```

   So the moment the band under the pointer set `armed = {id}`, the other forty-nine bands each
   called `setArmed(null)` — in the same commit, from an effect, before a frame had been drawn.

2. **A departing band's close runs 90ms behind the pointer and does not check who is open.**
   `useHover`'s `onReferenceMouseLeave` calls `closeWithDelay`, which is a bare
   `setTimeout(() => onOpenChange(false), closeDelay)`. Scrubbing from one band to the next therefore
   kills the card the pointer has just *arrived* at — the opposite of what the grouping exists for.

Measured against the real `<Spine>` in jsdom, sampling the DOM every 25ms after a native
`mouseenter`:

```
   0–225ms  cards=0     the 240ms open delay
 250–325ms  cards=1     the card
 350ms →    cards=0     and it does not come back
```

`armed` is already `null` in the commit the card mounted in. The ~80ms it stays on screen is nothing
but `useTransitionStyles`' exit animation running on a card that was dead on arrival. A reader sees a
flicker at the edge of vision and concludes there are no tooltips, which is what happened.

## The commit

[`bf398f3`](../../docs/plans/spine-rail.md) — *"Tap the spine to read it, and let a finger scroll one
way at a time"*, 2026-08-27. It is a good commit. It fixed a real and worse problem (the rail was
unusable by finger), it was reviewed by GPT Sol, and Sol found the *other* half of the same
seam — that a tap synthesises `mouseleave` before `click`, so hover handling cleared `armed` a moment
before the tap meant to commit it, fixed with `mouseOnly`. Both halves are the same underlying fact:
**once a tooltip is controlled, every path the library has to `onOpenChange(false)` becomes a path
into your state.** One of the two was found; the other was not, because it only shows itself when
there is more than one tooltip in the group, and the review was reading a single band's logic.

## The fix that is right for the long term

A close only counts from the band that is actually open:

```ts
onOpenChange={(v: boolean) =>
  setArmed((prev) =>
    v
      ? { id: b.entry.node.id, byTouch: false }
      : prev?.id === b.entry.node.id
        ? null
        : prev,
  )
}
```

Two lines, and it closes both mechanisms at once: a non-open band's `onOpenChange(false)` is a no-op,
and a departing band's stale timer cannot reach the card that replaced it. It also makes the handler
idempotent under the effect churn the library already causes — `onOpenChange` is a fresh closure on
every `Spine` render, so `useDelayGroup`'s effect re-runs and re-fires that `onOpenChange(false)`
every time the reader crosses a part boundary.

Rejected: **going back to uncontrolled tooltips**, which is what worked before. It would take the tap
gesture with it — `mouseOnly` in [`Tooltip.tsx`](../../src/web/Tooltip.tsx) is keyed on whether the
tooltip is controlled, and reveal-then-commit has nowhere to live.

Rejected: **dropping the delay group**. The grouping is the reason running the pointer down the rail
reads the article's sections one after another instead of waiting 240ms at each one. With the guard
it costs nothing.

## What would have caught the class

**A test that asks the reader's question rather than the code's.** There already was a test —
[`tests/spine-tap.test.ts`](../../tests/spine-tap.test.ts) — and every one of its assertions passed
throughout the outage, because it covers `bandPress`, which is the *decision* a press makes. The bug
is in the event and effect ordering *around* the decision. `bandPress` was extracted into its own
named function precisely because "it cannot be checked where it lives"; the honest conclusion is that
extracting the checkable part left the uncheckable part unchecked, and called it done.

[`tests/spine-hover.test.tsx`](../../tests/spine-hover.test.tsx) is the replacement. It renders the
real `<Spine>` over a fake table of `tr[data-block]` rows, dispatches a **native** `mouseenter` on a
band's button (Floating UI binds its listener to the DOM node directly, so a React synthetic never
arrives), and asserts what a reader would say out loud:

- a card opens;
- **it is still there a moment later** — the case that was red;
- **moving to the next band hands the card over** rather than losing it — also red;
- leaving the rail still closes it, which is the control that stops the fix being "never close".

Two things about writing it are worth keeping:

- **The control was green for the wrong reason before the fix.** "Closes when the pointer leaves"
  passed against the broken code, because the card was already gone. It only became evidence once the
  other two were green. A passing assertion in a suite whose subject is broken says nothing about
  itself ([silent-success.md](../reusable/silent-success.md)).
- **`act()` swallows a transition.** `act(() => { leave(); advanceTimersByTime(300) })` leaves the
  card in the DOM, because React runs the effect that schedules the 80ms exit only when `act`
  returns — after the advance is over. Two separate advances are needed, and getting it wrong makes
  a working close look like a card that never goes away.

The generalisation, worth applying anywhere else a controlled Floating UI component appears: **a
controlled tooltip's `onOpenChange(false)` is not a statement that it was open.** If one state serves
more than one trigger, the close has to be guarded by identity — and if a new surface puts several
controlled hover cards inside one `<TooltipGroup>`, it will meet this on its first hover.
