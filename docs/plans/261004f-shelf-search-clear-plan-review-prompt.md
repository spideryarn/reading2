Review this plan before it is built. Read-only: do not edit files.

Plan: docs/plans/261004f-shelf-search-clear-cross-that-can-be-seen.md
The code it changes: `SearchBox` in src/web/Library.tsx (around line 1173), src/web/styles/close.css,
and how the page's stylesheets are ordered (src/web/styles.css; Tailwind utilities are prefixed `tw:`
and sit in a later layer than the app's own CSS). Existing test harness: tests/shelf-search-focus.test.tsx.
Screenshots of today's state: docs/plans/261004f-shot-before-focused.png, 261004f-shot-before-unfocused.png.

Please check, and say for each whether it holds:
1. Is the diagnosis sound, given that the report asks for a button that already exists? Is there a
   better-supported explanation I have missed (read the code; do not take the plan's word)?
2. `.close-x` sets `position: relative`, a 32px size and an `::after` hit area; the button is
   absolutely positioned by `tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:size-7`. Will
   the two compose as the plan says (which wins, on layer order)? Any overlap between the 40px touch
   target and the input's own text or edge that matters?
3. Escape clearing the box: does anything on the shelf page already listen for Escape that this
   would break or double-handle? Is `stopPropagation` right here?
4. Refocusing after the press, and not on a coarse primary pointer: any case where this is wrong?
5. `onChange("")` goes through `setQuery(null)` in Library — is the history behaviour (push vs
   replace) what a reader would expect from a clear?
6. Is anything in "Not doing" something that should be done, or anything planned that should not be?
7. Is the plan's conclusion about what Greg met overstated anywhere?

Give a verdict line at the end: `VERDICT: build as planned` / `VERDICT: build with changes` /
`VERDICT: do not build`, with findings numbered and ranked P0–P3.
