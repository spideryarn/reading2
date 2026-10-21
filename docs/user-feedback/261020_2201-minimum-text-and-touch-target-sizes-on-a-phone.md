---
reports: spya-y4yhnp
ending: shipped
comment: Text is now at least 13px on a touch screen everywhere, and Chat's and the hover card's buttons are 40px. The other small buttons (gutter, top bar, shelf, 32px buttons) need their layouts rethought and are queued.
---
# Minimum text and touch-target sizes on a phone

Report `spya-y4yhnp` (#667, SPIDERYARN-READING2-N0), Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-20 22:01 UTC, from Sources › Investigate in Chat on
`rovelli-order-of-time-…-spya-r26sug`. Filed as a suggestion.

> The new investigate chat is fine. I like the way it cites all of its sources, but the font is too
> small and they're too close together for an iPhone. And indeed, I think I had the same problem
> with, in the chat thread, or chat list of threads, the icons are too small. So can you just
> generally look for any, make, you know, make a minimum size, especially on an iPhone, but maybe in
> general, and make a minimal update to our sort of design system documentation to avoid this
> problem going forwards.

**Shipped**, to `dev`. There are two floors, and both apply only under a finger (`any-pointer: coarse`),
so desktop is unchanged.

- **No text under 13px.** A `--text-min` token, which grows with the reader's text size, floors
  every small size in the stylesheets, the type roles, Tailwind's `text-xs` and the arbitrary
  sizes in components. An answer's passage-id chips measured 11.1px before the change, and the
  "From the web" rows were 0–1.2px apart.
- **Nothing to press is under 40 × 40px** in Chat and the hover card. That covers the thread
  list's icons, the sources' links and their spacing, the steppers, Latest, the composer's buttons
  and the card's actions. Footnote markers get an invisible 40px-tall halo.
- **The design docs** each got one rule: typography.md § The smallest text, controls.md § The
  numbers, and a line in phone-and-touch.md. A test (`tests/minimum-text-size.test.ts`) fails on
  any new small size that skips the floor.

**Queued:** the rest of the small targets, as Overseer item `qi-c4nmmq5m`. These are the gutter,
the top bar, the 32px buttons, the shelf, Skim, Quiz and /profile. Each needs its layout rethought,
not a floor.

Plan, reviews and the 390px measurements:
[261021c](../plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone.md).
