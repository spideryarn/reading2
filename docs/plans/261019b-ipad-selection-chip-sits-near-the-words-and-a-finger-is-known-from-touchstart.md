# On an iPad, the "Highlight or comment" button sits near the words, and a finger is known from `touchstart` too

Report `spya-kwcn4x` (#607, SPIDERYARN-READING2-JY, queue item `qi-6ybwkegr`), a problem, from Greg
(admin, proven by `feedback-reporter.ts`), 2026-10-18 23:37 UTC, on an iPad, build `956a2380`, on
`/read/rovelli-order-of-time-…?at=spya-g83jsr&margin=1`:

> I tried to select some text on an iPad, and it showed me the iPad text selection menu with cut and
> copy and whatever, but didn't seem to show me any kind of Spideryarn context menu.

Up: [touch.md § A finger's selection gets a button](../project/touch.md#a-fingers-selection-gets-a-button).
Prior work: [261018c](261018c-touch-selection-chip-docks-away-from-the-ios-callout.md) (the iPhone
fix, in the build Greg used) and [261003e](261003e-span-highlights-with-a-colour.md) (the chip itself).

## What we know

- **The chip has never been seen on a real iPad.** 261003e built it for Greg's first iPad report
  (`spya-ma5h9b`) and said so: *"This has not been tried on a physical iPad."* Greg's iPhone report
  (`spya-bynh22`) is the only sighting on a device, and there it worked: the chip was there, under
  the iOS menu.
- **Emulation cannot reproduce it.** Playwright WebKit, iPad Pro 11 and iPad (gen 7), portrait and
  landscape, with and without `?margin=1` and `?at=`: the chip appears every time, uncovered,
  `elementFromPoint` hits it, and no `scroll` or `resize` event fires after the selection to keep
  hiding it. The only way the run lost it was a tap on an existing comment mark, which opens that
  comment's box and suppresses the chip by design (Sonnet subagent, 2026-10-19; scripts kept in the
  session scratchpad).
- **No code change between the iPhone fix and Greg's build touches it.** `TouchSelectionChip.tsx`,
  `selection.ts`, `annotations.css` and the Reader mount are byte-identical from `ed00c851` to
  `956a2380` (GPT Sol, read-only, 2026-10-19). `margin=1` adds no scroller, no stacking context
  above z-index 50 and no containing block for a fixed child.

So the cause is on the device. Two candidates are both plausible and cheap to remove (GPT Sol
ranked them first); others stay open and only a trace from a real iPad can settle them: a stream of
`selectionchange`, `scroll` or `resize` events restarting the 300ms settle, or iPadOS's selection not
starting inside `td.text .prose`.

1. **It was drawn, a long way off.** Since 261018c, the build Greg used, the button docks at the
   *screen edge* away from the words. On a phone that is a short way. On an iPad in portrait
   (1194px) it can be 600px from the words, at the bottom edge, while the reader's eyes are on the
   words and the iOS menu beside them. 261018c named this cost (*"on an iPad it can be a long way
   down"*) and took it; this is the first iPad use since.
2. **It was never started.** The chip shows only if the last `pointerdown` said `touch` or `pen`,
   and only if a `selectionchange`, `pointerup` or `pointercancel` reaches it once the words are
   selected. Whether iPadOS keeps to that on a long-press is exactly what touch.md lists as
   unmeasured. (260924c's mislabelled event on an iPad was the later `click`; its `pointerdown`
   was right, so that is a reason for caution, not evidence.)

We cannot tell these apart from here, and both fixes are small, so we do both. If Greg still sees
no button afterwards, the next step is an event trace from his iPad, not a third guess.

## The change

### 1. The button sits just clear of the iOS menu, not at the screen edge

Same side as now (the one with more room between the words and the screen edge), but **only as far
from the words as the iOS menu needs**, then no further: 80px (`--chip-clear`) past the words'
edge, which should clear the selection handle and a one-row iOS menu on that side. When the gap
cannot hold the edge's own offset, the button and those 80px, it docks at the edge exactly as today,
and may then meet the menu or the words, as it could before. That covers a tall selection with two
small gaps, not only one that fills the screen; with no range geometry (`room: 0`) it docks.

```
 iPad portrait, words near the top          today (261018c)
 ┌──────────────────────────┐               ┌──────────────────────────┐
 │ ═══════ top bar ═══════  │               │ ═══════ top bar ═══════  │
 │ [Copy|Look Up|…]  ← iOS  │               │ [Copy|Look Up|…]         │
 │ ▓▓▓▓ selected ▓▓▓▓       │               │ ▓▓▓▓ selected ▓▓▓▓       │
 │ [Copy|Look Up|…]  ← or   │               │                          │
 │   [ Highlight or comment ]  ← 80px       │                          │
 │                          │               │        (600px)           │
 │                          │               │                          │
 │                          │               │   [ Highlight or comment ]
 │ ═════════ Dock ═════════ │               │ ═════════ Dock ═════════ │
 └──────────────────────────┘               └──────────────────────────┘
```

Mechanically: `placeFor` also returns `room`, the distance in px from the words' edge to the chosen
viewport edge (`innerHeight - bottom` or `top`), and the button gets `--chip-room`. The CSS keeps each
edge's existing offset as the floor:

```css
[data-edge="bottom"] { bottom: max(<today's offset>, calc(var(--chip-room, 0px) - var(--chip-clear) - var(--control-h-lg))); }
[data-edge="top"]    { top:    max(<today's offset>, calc(var(--chip-room, 0px) - var(--chip-clear) - var(--control-h-lg))); }
```

Measured in the layout viewport, as now, so the edge chosen and the place drawn still agree;
pinch-zoom stays the known limit 261018c wrote down.

**80px is a guess, not a measurement**: Playwright draws no iOS menu. It is about the handle (~12px)
plus a one-row menu (~44px) plus a gap. In px, not rem, because the system draws that menu and it
does not grow with our root size. If Greg sees the two meet again, the number is the thing to change.

### 2. A `touchstart` also says "a finger"

`touchstart` fires for the glass (a finger or a Pencil) and not for a trackpad or a mouse. In iOS
WebKit it comes after `pointerdown` (the spec leaves the order open), so a finger whose
`pointerdown` were labelled `mouse` is corrected before the selection settles. It only sets the
flag: the `touchstart` itself neither hides nor schedules, so a press on the chip and the grace
period are untouched. Passive, and exempt on the chip itself.

## The simpler options passed over

- **Do nothing and ask Greg to look at the screen edge.** It may be all that is wrong, but the
  far-off button is a cost we already named, and on a big screen it is a bad place regardless.
- **Revert to "just under the words".** That is the iPhone bug back.
- **A diagnostic build that reports the event trace to Sentry.** It would settle candidate 2, but it
  is new plumbing for one question. If Greg still sees nothing after this lands, that is the next
  step, and the note says so.

## What it gives up

The button now sits closer to the words on any screen with room, which on a phone is most of the
time; 261018c's "a thumb's reach at the bottom" is traded for "where the reader is looking". Nothing
else changes: when it appears, what pressing it does, the suppression while a box is open, the side
it picks.

## Code

- `src/web/TouchSelectionChip.tsx`: `placeFor` returns `room`; `--chip-room` on the button;
  one passive capture `touchstart` listener, removed on cleanup.
- `src/web/styles/annotations.css` § `.touch-select-chip[data-edge=…]`: the `max(…)` above.
- `tests/touch-selection-chip.test.tsx`, written first and seen red: `--chip-room` per edge for
  words at several heights; the CSS rule for each edge keeps today's offset inside a `max()` with the
  room, and the clearance is 80px; a `pointerdown` labelled `mouse` followed by a `touchstart` gets
  the chip; a mouse alone still does not; a press on the chip with its own `touchstart` still opens
  collapsed words; a `touchstart` alone does not hide a chip; the
  listener is passive, capturing and removed on cleanup; no geometry is `room: 0`.
- `docs/project/touch.md` § A finger's selection gets a button: where it sits, and the touch events.

## Review of this plan

GPT Sol, read-only, 2026-10-19 ([answer](261019b-ipad-selection-chip-plan-review-sol.md)): *changes
needed*, four findings, all taken. The diagnosis claimed only two candidates survive; it now says
these are the two cheap ones and names what stays open. The `touchend`/`touchcancel` re-arm was
dropped: it would schedule a mouse selection after an unrelated touch, and it answered a
hypothesis with nothing behind it; `touchstart` only sets the flag. The fallback-to-the-edge case is
described exactly. 5rem became a fixed 80px, since the native menu does not scale with our root.

## Checks

- `npm test`, `npm run typecheck`, lint on touched files.
- Browser (Sonnet subagent, Playwright WebKit, iPad Pro 11 portrait and iPhone 13): words near the
  top, the middle and the bottom; the chip's distance from the words.
- GPT Sol on this plan (read-only) and on the code (workspace-write).
- Greg on a real iPad, after deploy: the note asks.

## Review of the code

GPT Sol, workspace-write, 2026-10-19 ([answer](261019b-ipad-selection-chip-code-review-sol.md)):
*approve* after fixes. Kept: the stronger tests (each new one red with the production change
reverted), the listener test (passive, capture, removed on cleanup), and the doc corrections.

**Not kept: "input ownership" recorded when a selection first becomes readable** (a second ref,
`selectionFinger`, about 25 lines), meant to stop a later, unrelated touch promoting a live mouse
selection. Its test needed a `touchstart` with no `pointerdown` before it, which a real touch does
not produce: every touch sends a `touch`-labelled `pointerdown` first, which already set the flag
before this change. So it guarded a case this change does not open, and added state to the one path
we cannot watch on a device. If a hybrid machine ever shows the button for a mouse selection, that
is the place to start.

## Results

- `npx vitest run tests/touch-selection-chip.test.tsx`: 29 passed. The four tests written first
  were seen red before the change.
- Browser, Playwright WebKit on this worktree's dev server, `?margin=1`, 2026-10-19 (Sonnet
  subagent): iPad Pro 11 portrait, words at y 150, 600 and 1046 of 1194 → chip 80px below, above,
  above; iPhone 13, words at 152, 334 and 516 of 664 → 80px below, above, above. Every chip fully on
  screen and the top element at its centre; every press applied a highlight and opened the box. A
  `pointerdown` labelled `mouse` followed by a `touchstart` showed the chip.
  [shot 1](261019b-shot-1-ipad-words-top.png), [shot 2](261019b-shot-2-ipad-words-bottom.png),
  [shot 3](261019b-shot-3-iphone-words-middle.png).
- Before the change, the same harness showed the chip on every iPad profile and layout tried, so
  emulation never reproduced Greg's report; only his iPad can confirm this fixes it.
