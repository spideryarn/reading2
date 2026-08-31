# The scroller that mounted after the measure

**2026-08-30.** Press Sketch, then press Drift or Trail, and the Diagram band draws a blank
rectangle for ever. The strip above it reports a projection that arrived perfectly well — *"155
paragraphs, 17 too short or not prose to place…"* — the step readout under it says `—`, and there is
nothing in the console.

Greg found it on production and could not tell what state it was in:

> I thought we had said this should involve a button to initiate, and/or a loading spinner. But it's
> just showing an empty space right now, and I don't know why.
>
> — Greg, 2026-08-30

He was right that the spinner exists. It was never reached.

## What was actually broken

[`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) lays its picture out against a **measured** box
rather than a computed one, for the reason the code gives: the scroller's inner width depends on its
padding and on whether a scrollbar appeared, and a scrollbar appearing is itself a consequence of the
height we choose. The measure lived in a layout effect:

```tsx
const scroller = useRef<HTMLDivElement>(null);
useLayoutEffect(() => {
  const el = scroller.current;
  if (!el) return;          // ← taken, once, on a panel that opened on Sketch
  …
}, []);                     // ← and `[]` means never again
```

`Sketch` arrived earlier the same day (`3897bc9`, *"Sketch becomes a fourth chip"*) and **replaces
everything below the chip row**, `.diag-scroll` included — that split is deliberate and is the right
one. What it also did was make the scroller conditional. A panel whose *first* render is a Sketch
runs that effect against a `null` ref, returns early, and with empty deps never runs again. `box`
stays `null` forever, which is the branch that renders

```html
<div class="diag-measuring" aria-hidden="true"></div>
```

— an empty `<div>` with `min-height: 100%`. No spinner, no words, no error. Every one of the three
pictures was affected, not just the two Greg happened to be looking at.

## Why nothing caught it

Three things had to line up, and each of them is individually reasonable.

- **The blank is a designed state.** `.diag-measuring` exists so that a diagram is never laid out
  against a guessed width — one frame of nothing is cheaper than one frame of visibly-wrong picture.
  It is supposed to last a frame. Nothing said what it means for it to last a session.
- **The panel's own reporting was intact.** The projection strip, the chip row and the step bar all
  render outside the scroller and all of them worked, so the band looked alive. A reader gets a
  correct sentence about a picture that is not there — the
  [silent-success](../reusable/silent-success.md) shape, with the loudest evidence pointing the wrong
  way.
- **No test had ever left Sketch.** The panel suite stubs `clientWidth` on `HTMLElement.prototype`,
  so a test that mounts straight onto a picture measures fine, and every one of them did. The bug is
  not about the *width* — it is about **which element** was measured, and the only way to reach it is
  to mount on Sketch and then switch. That is one line of test and it goes red on the old code, which
  is worth saying plainly: this was never beyond jsdom's reach, it was simply never asked. ⟨Sol⟩
  corrected an earlier draft of this paragraph, which claimed the environment could not see it.

The layout effect had also *already been repaired once for a neighbouring reason* — its first
measure was moved out of `requestAnimationFrame` because rAF does not run in a background tab, and
the comment left behind says exactly that, in the right words, about a blank picture that reports
nothing wrong. That fix was correct and it hardened the wrong half: the timing, not the lifetime.

## The fix

A **callback ref**. It fires when the element mounts, whenever that turns out to be, and again with
`null` when it goes — so the `ResizeObserver` is attached to the element that exists rather than to
the one that existed at first render. The measure stays synchronous inside it (the background-tab
finding above is unchanged), and the teardown moves in with it.

`useCallback` with `[]` deps is load-bearing there: a fresh function identity every render would make
React detach and reattach the ref every time, which is a disconnect and a new observer per render.

## What would have caught the class

**An effect with `[]` deps that reads a ref can only ever see the first render's DOM.** That is the
whole rule, and it is worth stating as a rule because the failure is silent in both directions: the
element renders correctly, the ref is populated correctly, and the only thing that is wrong is that
nobody looked at it. Whenever the element an effect wants is behind *any* conditional — an early
return, a `status === "ready"` branch, a sibling that replaces the subtree — a longer dependency list
is not the answer. A callback ref is the usual one; naming the conditional in the deps
(`[kind === "sketch"]`) or splitting the conditional subtree into its own component would each work
too, and the reason to reach for the callback ref is that it is the only one of the three that keeps
working when somebody adds a *fifth* chip.

**The other half of the rule is about the placeholder, not the ref**, and it is the more general
guard: a branch that renders **nothing at all** must be reachable only for a frame. `Waiting` in the
same file does this properly for every other way a picture can fail to arrive — a spinner and a
sentence, or the server's own words and a button. `.diag-measuring` was the one hole in it, and it
was a hole precisely because it was believed to be momentary. Anything that can be on screen for a
second owes the reader a sentence, and the way to keep that true is to ask, of every silent branch,
*what makes this end?*

The test that holds it is `tests/diagram-panel-hover.test.tsx` § *switching away from Sketch*: mount
on `sketch`, assert there is no scroller, switch to `force`, and assert that `.diag-measuring` is
**gone**. It goes red on the old code for the right reason.

## Related

- [diagram.md § Waiting, and failing, without borrowing a picture](../project/diagram.md#waiting-and-failing-without-borrowing-a-picture)
- [silent-success.md](../reusable/silent-success.md)
