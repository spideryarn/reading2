# The mode herald moves to the foot of the band

Greg, 2026-09-28, about the card report 3Q added
([260915e](260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md)):

> It's nice how it shows the Mode title at the top of the Mode column when clicking to a new Mode.
> But it gets in the way. Perhaps show it at the bottom-left (instead of the top-right) of the Mode
> column (so that hopefully it'll still be pretty salient, but not occlude important information)?
> Or if you have a better idea, try that instead.
>
> — Greg, 2026-09-28

## What it is today

`ModeHerald.tsx` — a Dock press or a command-bar pick lays the mode's name and its catalog sentence
over the **top** of the band (`.mode-herald-slot`, `top: var(--bar-bottom)`, the band's full width)
for three seconds, then fades. It takes no taps, and any press or key inside the band clears it.

The top is the worst place in the band to cover. It is the band's first row — Search's box (focused
on mount), Glossary's and Quotes' counts, Chat's thread title — and the first items of every list,
which is exactly what a reader who has just opened a mode looks at first.

A browser pass at 1440, 834 (iPad, touch) and 390 (phone, touch) confirmed it for all five modes it
tried: Glossary's order and threshold controls, Quotes' order row, Search's Words/Meaning toggle,
Chat's first thread titles and Summary's first line were all under the card for its three seconds.

## Where it goes: the bottom-left — of the band's reading area, not of the band

Greg's suggestion, taken, with one correction the recon forced. **The literal bottom of the band is
not free.** Eleven modes can end in pinned furniture: Chat and Remember's composer; the `foot` that
`ModeSurface` places for Glossary, Quotes, Ideas, Timeline, Debate, Quiz, Citations and FAQ — mostly
*Find more* / *Write them again*; and Diagram's step row and detail card (or Sketch's nested card).
A card at the band's bottom edge would have moved the occlusion from the top controls to the bottom
ones, which Greg asked us not to do.

So the card **stands on the foot**: its bottom edge is the bottom of the band's scrolling area, and
beneath it the composer or *Find more* stays in view and pressable.

```
 spine │ ┌─ band ─────────────────────┐ │ prose
       │ │ 40 terms · order · slider  │ │   ← first row: now never covered
       │ │ term …                     │ │
       │ │ term …                     │ │
       │ │ ┃Glossary              │   │ │   ← the card, ~3s: bottom-left of
       │ │ ┃The terms this piece… │   │ │     the scroller, inset, rounded
       │ ├────────────────────────────┤ │
       │ │ [Find more]                │ │   ← pinned foot: never covered
       └─┴────────────────────────────┴─┘
         Dock
```

What it covers now is the tail of whatever list or text is at the bottom of the scroller — on
opening a mode, the part the reader reaches last. For Summary and Search, which have no foot, that is
the band's bottom edge, and on this article Search's bottom is empty.

**How it finds the foot.** Every band is a flex column whose scroller is the child that grows
(`flex: 1`); a pinned foot is whatever comes after it. So the room to leave is *the band's bottom
minus the bottom of its last growing child* — one rule that reads the layout, rather than a list of
eight class names that the ninth band would not be on. A band with no growing child leaves no room. **A grower that does not itself scroll is a wrapper, so
the rule looks inside it**: Sketch's band child is `.sk`, which grows and holds its own growing
`.sk-scroll` and, after that, the pinned `.sk-card` (Sol). A grower that scrolls is where it stops —
what is inside a scroller is content.
Measured when the card appears and again whenever the band's children change or resize, because a
foot such as *Find more* can arrive after the card does (the list loads). Chat's composer is not a
`ModeSurface` foot, but it is a direct child after the growing transcript, so the same rule finds it.

**Its shape changes with its place: a toast, not a strip.** Full-width with a bottom rule was right
for a card standing in for the band's title row; at the foot it would read as another pinned row. It
becomes a rounded, inset card, as wide as its words and never wider than the band, with the same
panel, border and shadow, plus a left edge in `--highlight` so it still catches the eye down there.

**Checked against the other furniture at the bottom** (the brief asked):

- **The Dock** — the band already ends above it, following it as it slides (`--dock-bottom`), and the
  slot uses the band's own bottom, so the card can never reach the Dock.
- **The Feedback button** — not in the reading view's corner at all; it is a Dock button there.
- **The way-back chip** — sits right of the band, over the prose, where the band has a width of its
  own. **Where the band covers a phone's window, `--mode-w` is 0 and the chip lands in the band's
  bottom-left corner** — this card's corner (Sol). So under `.band-covers` the card leaves
  `max(foot, --return-chip-h)`, the token the offline strip already uses to stand above the chip.
- **iOS's keyboard** — WebKit leaves `position: fixed` under the keys, and Search focuses its box on
  mount, so a card at the foot could be named to nobody (Sol). The slot takes `--kb-inset` from
  `useVisualViewport`, as the three bottom-anchored dialogs do, and adds it to the room.
- **Chat's *Latest* button** — absolutely placed just above the composer, shown only while the
  reader is scrolled up a thread. **Accepted, not handled**: it is reachable only by pressing Chat
  again while scrolled away, a tap on it still goes through the card and clears it, and seeing it
  would mean measuring out-of-flow children too.
- **The iPad and iPhone bottom edge** — the band's bottom already takes `max(--dock-bottom,
  --safe-bottom)` and the install hint's current height; the slot reads the same expression, so the
  home indicator and the hint are covered by the same arithmetic.
- **The offline strip** is full-width at z-index 97 above the Dock; while offline it may lie over the
  card's lower edge for its three seconds. Accepted: offline outranks it.

**Everything else stays as 260915e built it**: which presses count, three seconds, the fade, no taps,
any press or key inside the band clears it, the screen-reader region.

### The simpler option passed over

Anchoring the card at the band's bottom edge with no measurement — pure CSS, a one-line change. It
covers *Find more* and Chat's composer, the control a reader opening Chat has come for. The
measurement is about twenty lines in one component.

### Other places considered

- **In the Dock**, the pressed button growing its word for three seconds. Never over content, but the
  Dock drops its words precisely because the row does not fit, so a word appearing would reflow the
  row under the reader's finger.
- **Above the band, in the top bar.** The recon found there is no top bar in any band mode (it is not
  rendered when empty, since 2026-09-08), so the band starts at the top of the window.
- **Over the prose beside the band.** Covers the one thing more important than the band.
- **A shorter life.** Does not stop it covering what it covers; three seconds stays.

## Tests, written first

1. **Geometry, in Chrome** (`tests/mode-herald-in-chrome.test.tsx`): the real stylesheet compiled
   through `tailwind.css`, a band with a head row, a growing scroller and a 60px foot, and the slot
   and card as `ModeHerald` renders them with the foot's room applied, and the way-back chip. At
   1440×900, 834×1194, 390×844 covering, and 390×844 covering with no foot (Summary, Search): the
   card is below the band's first row, not over the foot, at the band's left, inside the band, and
   not on the chip. And at 390×844 with a 330px keyboard inset, above the keyboard. Every case red
   against the code before it — the chip and keyboard ones against the first draft of this change.
2. **The measurement, in jsdom** (`tests/mode-herald.test.tsx`): a foot's height is left under the
   card; none where the scroller runs to the bottom or nothing grows; a foot that arrives after the
   card is measured again; Sketch's nested card is found through a grower that does not scroll; and
   a growing item *inside* a scroller is not mistaken for the band's layout.

## Reviews

- **Plan, GPT Sol, 2026-09-28** — *"Sound direction, but not ready."* Five findings: Sketch's nested
  card, the way-back chip on a covering phone, iOS's keyboard, and fixtures that assumed the happy
  shape — all four built above, each with a test that went red first; Chat's *Latest* button,
  accepted with its reason. It also caught a miscount (ten modes, not eight); the built-code review
  caught the remaining omission, Diagram, and corrected that to eleven modes that can have pinned
  furniture.

- **Code, GPT Sol, 2026-09-28** — *"Pass after the nested-observer fix."* One medium finding, fixed by
  the reviewer with two tests that went red first: Sketch's nested card could arrive or change height
  without the outer `.sk` changing, so the observers now watch every non-scrolling level `footRoom`
  reads, stopping at the scroller. It also added fixtures for the standard and illustrated Diagram,
  cleanup, and the slot's inline style. Its sandbox could not launch Chrome, so the geometry tests
  were run here: all green.

## Browser check, 2026-09-28

Playwright on the box, article `writes`, at 1440×900, 834×1194 (touch) and 390×844 (touch), pressing
Glossary, Quotes, Chat, Summary, Search and Diagram (Sketch) at each: the card never touched the
band's first row or the Dock, sat inside the band at its left, stood clear of Glossary's and Quotes'
*Find more*, Chat's composer and the Sketch card (about 10px above each), faded by three seconds, and
went at once on a tap inside the band. In Summary and Search it lies over the last lines of the
scroller, as designed. On the phone, with the way-back chip showing after a Structure jump, a
Summary press put the card 11px above the chip.

## Assumptions

Small calls Greg's words did not settle, taken here:

- **"Bottom-left" is read as the bottom-left of the band's reading area**, above any pinned row,
  rather than the band's literal corner — because the literal corner is *Find more* or the composer.
- **A toast rather than a full-width strip**, with a `--highlight` left edge for salience at the
  bottom. Width is the words' own, capped at the band.
- **Three seconds, the fade and every dismissal rule are unchanged** from 260915e.
- **Chat's *Latest* button** may sit under the card for its three seconds when Chat is pressed
  again while scrolled up a thread; not handled (Plan review, above).
- **Offline strip** may lie over the card's lower edge while offline; offline outranks it.
- **With iOS's keyboard up the card stands a foot's height higher than strictly needed**, the price
  of not re-deriving the band's bottom inside a CSS `max()`.
