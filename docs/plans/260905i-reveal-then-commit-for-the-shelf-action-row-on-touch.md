# Reveal, then commit — the shelf's action row on a finger

> fix the touch behaviour, then push
>
> — Greg, 2026-09-05

The touch behaviour being fixed is the one
[260905h](260905h-rich-tooltips-on-the-shelf-action-buttons.md) left open. That change gave every
button on a shelf card a card explaining what it does — and on a touch screen the tap that would
open the card *also performs the action*, so Open leaves the page, Archive takes the card away, and
Edit opens the editor before a word of the explanation can be read. The row is visible on touch
(`hover-none:opacity-100`), so these are five controls a finger can press and cannot read.

**So: the first tap on a control reveals its card, the second commits.** The gesture is not new —
it is [touch.md](../project/touch.md)'s rule, already used by
[the spine's bands](../../src/web/Spine.tsx) (`bandPress`) and by
[the glossary hover card](../../src/web/useHoverCard.ts) (`onCommit`). A third spelling of it here
would be a third place to get it wrong, so this reuses the *rule* and the reasoning; see
§ Why not import `bandPress` below.

A mouse is untouched. `pointerType` is read from the press, not from the device — the media query
`(hover: none)` describes the UA's *primary* pointer, so a touchscreen laptop and a tablet with a
mouse both get it wrong, in opposite directions. That is `bandPress`'s own second version, on GPT
Sol's correction of 2026-08-27.

## Where the gesture lives, and why not on the buttons

**One capture-phase handler on the row**, not five handlers on five controls.

`onClickCapture` on the row `<div>` runs before any control's own `onClick`, so a reveal can cancel
the press with `preventDefault()` + `stopPropagation()` and nothing downstream ever sees it. That
matters because the five controls are not the same kind of thing:

| Control | Would need, if handled per-control |
|---|---|
| Edit, Copy, Archive | wrap the caller's `onClick` |
| Open the original | an `<a>`, whose default navigation must be cancelled |
| Re-fetch / Open when unavailable | an `IconButton` that **swallows its own click** ([`IconButton.tsx`](../../src/web/IconButton.tsx) § `disabled`), so an injected `onClick` never runs at all |

That last row is the one that decides it. A per-control design would have to punch a hole in the
swallow that 260905h had just added at GPT Sol's request — and the unavailable controls are exactly
the ones whose card is worth reading. Capture needs no hole: the button goes on refusing its own
click, and the row has already stopped the event before the button ever sees it.

The control is identified by a `data-action` attribute rather than by React identity, because the
handler is reading `e.target.closest(…)` from wherever inside the button the finger landed — the
`<svg>`, usually.

## The trap this walks straight into

[260828g-spine-hover-cards.md](../postmortems/260828g-spine-hover-cards.md) ends by naming this
exact situation:

> if a new surface puts several controlled hover cards inside one `<TooltipGroup>`, it will meet
> this on its first hover.

Revealing a card by tap means the tooltips become **controlled**, and once controlled, every path
Floating UI has to `onOpenChange(false)` becomes a path into our state — including
`useDelayGroup`'s one-open-at-a-time effect, which closes *every other member* the instant one
opens, and `useHover`'s close timer, which runs 90ms behind the pointer and does not check who is
open now. With one `armed` for five triggers, an unguarded `setArmed(null)` takes the card away
before a frame is drawn.

So the close is guarded by identity, which is the postmortem's own fix:

```ts
onOpenChange={(v) => setArmed((prev) => (v ? {…} : prev?.id === id ? null : prev))}
```

The test for it is the reader's question, not the code's: hover a control, is the card **still there
a moment later**, and does moving to the next one **hand it over**.

## Why not import `bandPress`

It is exported, and importing it would guarantee one rule. Passed over for two reasons:

- It would make the shelf depend on `Spine.tsx`, a 900-line reading-view component, for a
  three-line decision — and the name (`band`) means nothing here.
- There is already a precedent for the other choice: [`useHoverCard.ts`](../../src/web/useHoverCard.ts)
  § `onCommit` re-states the same rule for the glossary card, with a pointer to `bandPress` for the
  reasoning rather than an import.

The shared thing is the *rule*, and its home is [touch.md](../project/touch.md), which now lists all
three of its users in one table.

## The card says "tap again"

Only when a finger opened it, and only where there is something to commit — the spine's
`showTapHint` decision, for its reason: telling somebody holding a mouse to tap again is noise. A
new `tap` slot on `ControlTip`, sharing the styling of the `learned` footer it sits in the same
place as.

## What the review changed

GPT Sol found five, all confirmed against the code before acting:

- **A pen committed blind.** `pointerType === "touch"` excludes `pen`, and
  [touch.md § An Apple Pencil counts as a finger](../project/touch.md) is an explicit rule that
  [`swipe.ts`](../../src/web/swipe.ts) already follows. Worse than an inconsistency: Floating UI
  treats `pen` as *mouse-like*, so a Pencil got neither the hover card nor the reveal.
  **`Spine.tsx` § `bandPress` has the same narrow check and so breaks the same rule** — left alone
  here rather than changing reading-view behaviour in a shelf change, and flagged instead.
- **"A mouse is unchanged" was false.** The commit branch cleared `armed` unconditionally, so
  clicking Copy closed a *hover-opened* card and left it closed with the pointer still on the
  button — `useHover` had already fired its `mouseenter` and would not fire another. Before these
  tooltips were controlled, `useDismiss`'s `referencePress: false` meant a press never closed its own
  card. Only a finger's card is cleared now.
- **A mistyped `data-action` would fail open**, not loudly: `actionAt` returns `null`,
  `pressCapture` returns early, and the press goes through — the original bug restored for one
  control, with every test that did not name it still green. Proved: mistyping `copy` left **13 of
  14** green. The attribute is now written by `ActionTip` from the same typed `id` that keys the
  state, `ActionKey` is derived from the `KEYS` list so the two cannot drift, and a new case walks
  every control in the row.
- **"Tap again to do it" appeared over a control mid-flight**: `commits` ignored `rerunning`, so
  tapping the spinner promised an action the second tap would refuse.
- Non-actioned, and worth knowing: **the row's *visibility* on a hybrid still keys off
  `(hover: none)`**, which a touchscreen laptop does not match. The gesture is right there; the
  discoverability is not. That is 2026-08-26's `hover-none:opacity-100` rather than anything here,
  and fixing it means deciding whether the icons are always visible.

## And one thing the new test found on its way past

Adding a case that presses **every** control meant pressing Copy, which jsdom has no clipboard for —
and [`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx)'s copy handler dereferenced
`navigator.clipboard` without a guard. Outside a secure context that object is `undefined`, so on
anything but https or localhost the press threw a `TypeError` **out of a React event handler, past
the handler's own `.catch`** — which only ever sees a rejected promise — and the reader got a button
that did nothing and said nothing.

[`BlockGutter.tsx`](../../src/web/BlockGutter.tsx) and
[`AccessSharing.tsx`](../../src/web/AccessSharing.tsx) had both guarded this for weeks, each with a
comment about the same trap, including why it must be a statement rather than
`navigator.clipboard?.writeText(…)` (the optional chain evaluates to `undefined` and `.then` throws
on it). This was the odd one out.

Worth noting how it surfaced: **vitest reported an uncaught exception while every assertion in the
file passed.** The gate is what caught it, not the test — a green test file was sitting on top of a
real fault, which is [silent-success.md](../reusable/silent-success.md)'s shape exactly.
`tests/shelf-action-tooltips.test.tsx` now pins the report.

## Files

- [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) § `Actions` — the state, the capture
  handler, the controlled tooltips. The dense table gets it free
  ([`library-columns.tsx`](../../src/web/library-columns.tsx) § `RowActions`).
- [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) § `ControlTip` — the `tap` slot.
- [`src/web/styles.css`](../../src/web/styles.css) § tooltip — one selector added to an existing rule.
- `tests/shelf-action-touch.test.tsx` — new.
- [touch.md](../project/touch.md), [library.md](../project/library.md) — the docs.

`IconButton.tsx` is deliberately unchanged.
