# The spy wrote a section over the paragraph a button had just set

> Try and fix/improve the Diagram up/down buttons (e.g. for Trail) — they don't seem to work very
> reliably. I press them, something changes, and then sometimes it seems to revert back to the
> active node it was on.
>
> — Greg, 2026-08-30

He was describing the flicker, which is the half you can see. The half you can measure is that after
the first press the buttons stop moving the reader at all: four presses of ↓ land on the same row
four times.

The fault was not in the picture. It was one comparison in
[`useReadingPosition`](../../src/web/App.tsx), written five days earlier, in a file the diagram panel
does not own.

## The real cause

**`?at=` is two things at once, and only one of them may be overwritten.**

It is a *broadcast*: the scroll spy names the section under the sticky line once the reader stops
moving, and everything that follows the reader reads it. It is also a *working memory*: the diagram
panel's ↑ / ↓ buttons ask the address where the reader is, step from there, and write the answer
back.

The spy's guard was:

```ts
// src/web/App.tsx, as of e6eb7e0
const id = sections[activeSectionIndex(tops, STICKY_OFFSET + 1)]?.blockId ?? null;
if (id === null || id === synced.current) return;
```

`id` is **the section it has just measured**. `synced.current` is **the value currently in the
address**. Comparing them asks "has the reader crossed a boundary?" — but only while every value in
the address is a section. It is not the question the spy means. The question the spy means is *is the
reader still inside the section the address already names?*, and the two coincide only by accident.

The diagram panel's step buttons ended the accident. On Drift and Trail a rung is one paragraph
(`stepStops` in [`diagram.ts`](../../src/web/diagram.ts)), so a press puts a paragraph in the
address. The spy measured the enclosing section, found it different from the paragraph, and wrote the
section's first block over it, when the queued position write landed — `POSITION_SETTLE_MS`, the
nuqs debounce on `atParam`, which is 300ms *after the scroll stopped* rather than 300ms after the
press.

```
   press ↓
      │   onJump(rung.blockId)  →  spya-blk015, a PARAGRAPH
      ▼
   ?at=spya-blk015              the mark moves. so far, right.
      │
      │   the jump scrolls the page; the spy measures; 300ms of debounce
      ▼
   spy: "the section under the line starts at spya-blk010"
      │
      │   is spya-blk010 the value in the address?   ← THE WRONG QUESTION
      │   no — the address says spya-blk015
      ▼
   ?at=spya-blk010              the mark springs back to the top of the section
      │
      │   the next press asks the address where the reader is
      ▼
   stepTarget(rungs, row 10, +1) → row 11
      │
      └───────────────────────────────────────────► and round again, forever
```

Every press after the first steps 10 → 11, gets measured, and is put back to 10. The reader sees a
twitch and no progress. Measured over the real `stepTarget` and a thirty-block fixture, with the fix
removed: `[10, 10, 10, 10]`.

**The rest of the app never had this bug, and the reason is worth keeping.** The arrow keys
([`keynav.ts`](../../src/web/keynav.ts)) and the swipe gesture ([`swipe.ts`](../../src/web/swipe.ts))
do exactly the same stepping, and both take their current row from `chain.current ?? measureRow()` —
their own short-lived memory of the last target, falling back to measuring the DOM. Neither ever asks
the address. The diagram panel was the first widget to use `?at=` as its own working state, and it
was the first to be overwritten.

## The commit

Two commits, and the interesting one is not the one that broke anything.

**[`e6eb7e0`](../../src/web/App.tsx) — *"Reading view: bird's-eye spine, chosen column widths, URL
state"*, 2026-08-25.** This is where the spy and its guard were written, and where the assumption was
already false. In that same commit `TableView` put an `onClick={() => onJump(node.range[0])}` on
**every** gist cell, including the leaf column, where there is one node per block — so a click on a
leaf label already wrote a paragraph into `?at=`. The spine was safe (`buildOutline` is capped at
depth 2, which is section depth), and the leaf column is behind a toggle, so it was rare. It was also
completely invisible: nothing read `?at=` back to draw anything, so the spy's overwrite changed a
URL nobody was looking at and moved nothing on screen.

**[`35835d4`](../../src/web/DiagramPanel.tsx) — *"Cut four pictures, and stop one arrow key from
being two"*, 2026-08-27 10:48.** This is the commit that made it a bug a reader can see. It added the
44px ↑ / ↓ buttons under the picture, "because an iPad has no arrow keys and this panel's hit targets
are a 6px band or a 3px dot". Those buttons closed the ring: they write a paragraph into `?at=`
**and** compute their next target from `?at=`, and the mark in the picture is drawn from it. Write,
read, draw — three uses of one value, and one of them was being overwritten by something else.

Neither commit is wrong on its own terms. `e6eb7e0` asked a question that was true of everything then
writing the address. `35835d4` used the address the way the address is documented to be used. What
changed between them is which values `?at=` can hold, and nothing anywhere said that was a constraint.

`e87612b` (2026-08-27) renamed `stepRows` to `stepStops` and fixed a different disagreement in the
same ladder; it is not implicated.

## Why it took five days

- **The one earlier writer of a paragraph was nearly unreachable.** A leaf gist cell, in a column
  that is off unless you turn it on, in a table most reading happens beside rather than in.
- **There was nothing to see.** Until the diagram drew a you-are-here mark from `?at=`, the spy
  correcting a paragraph to its section was a query-string edit with no consequence. It looked
  exactly like the spy doing its job, because that is what the spy was written to do.
- **The symptom is 300ms late.** A press moves the mark immediately and correctly. The revert
  arrives after the debounce, which is long enough to read as flakiness — "sometimes it seems to
  revert" — rather than as a rule.

## The fix

Three rules, all in one pure function, `positionToWrite` in
[`position.ts`](../../src/web/position.ts). Ordered, because the order is load-bearing.

1. **A jump of ours in flight writes nothing.** `glide` ([`scroll.ts`](../../src/web/scroll.ts))
   animates by calling `window.scrollTo` every frame, so a long jump fires exactly the scroll events
   a hand would; without this the spy names every section the page flies over and the last of those
   replaces the block the jump was aimed at. This one is **before** the top-of-the-article branch,
   because a jump that passes near the top would otherwise have its own target cleared on the way
   past.
2. **The spy asks whether the reader is still inside the section the address already names** —
   `sectionContaining(held)`, not `held` itself. A finer value a deliberate jump put there stands
   until the reader leaves that section.
3. **That section is derived at every measurement, never remembered.** A remembered one goes stale
   the moment `sections` changes underneath it — a column toggle, a granularity change, a
   re-extraction — and a stale one compares equal to whatever the reader has now reached, so the spy
   quietly stops writing at all.

Rules 1 and 3 are not Greg's bug. They are **holes the first fix opened**, found by GPT Sol in review
of the code before it shipped, and they are the reason a plan-stage review is not enough on its own
here: rule 1 only exists because of how `glide` is implemented, which no plan mentioned.

The related half is in [`App.tsx`](../../src/web/App.tsx): `DiagramBand` now takes `at` as a prop
from `useReadingPosition`'s own state instead of reading `location.search` at render. `jumpTo` writes
the URL with `throttle(0)`, which lands on the next task, so two fast presses could both step from
the same stale row. Same review. That one is a *different* bug with the same shape — a widget reading
a value that has not caught up yet — and it is worth noticing that the panel had two of them.

## What would have caught the whole class

**Not a browser test of the buttons, unless it waited.** A click-then-assert check goes green: the
mark is correct the instant it is pressed, and wrong once the debounced write lands. Any test of
this feature that does
not sit through `POSITION_SETTLE_MS` is testing the half that worked.

**Not a test of either side alone, either.** The spy had tests. The step ladder had tests. Both were
right. What was never exercised is **the value that crosses between them** — a paragraph id sitting
in `?at=`. Two green halves and an untested handshake. The cheap general form is a test that feeds
the spy one value from **each** thing that writes the address, rather than one value the spy would
have written itself. Reading `e6eb7e0`'s effect, that test fails there too — `id === synced.current`
with a paragraph in `synced.current` writes the section, exactly as it did five days later. But it
could not have been *written* there: the comparison was four lines inside a `useEffect`, and
`position.ts` exported `sectionDepth`, `buildSections` and `activeSectionIndex` and nothing that made
a decision. There was no seam to test at until this fix made one.

**What proved the three guards was making them reachable and then deleting them.** In the effect,
`glideTarget() !== null` is a call into module state during a scroll callback and no test can get at
it; as a `jumpInFlight: boolean` parameter it is one line of a fixture. Three clauses removed in
turn, each run against the 18 assertions of
[`tests/reading-position.test.ts`](../../tests/reading-position.test.ts):

| clause removed | what goes red |
| --- | --- |
| `sectionContaining(held)` → `held` | the paragraph is overwritten; four presses land `[10, 10, 10, 10]` |
| `if (jumpInFlight) return null` | writes on every frame the page flies over, and clears the address on a jump from the top |
| the in-flight guard moved *after* the top branch | a jump that begins at the top still clears its own target |

Three real failures, seen. A guard against a race that no test can reach is precisely the
[silent-success](../reusable/silent-success.md) shape: it looks like protection, it is never
executed under test, and nothing tells you the day it stops working — or the day someone reorders it.

**The third rule is not in that table, and cannot be.** "Derive the section rather than remembering
it" is not a clause you can delete — deleting it leaves the same code. The failure needs a *remembered
value* to go stale, and the shipped signature has nowhere to put one: `positionToWrite` takes `held`
and derives from it, so the stale state is unrepresentable.

Staged anyway, in a throwaway copy with an extra `heldSection` argument — a reader at row 26 whose
address holds a paragraph at row 14, and a remembered section left pointing at the wrong one — the
function returns `null` where it should write: **the spy goes silent exactly when the reader has
genuinely moved.** That is the worst failure of the four and the only one with no symptom, which is
why the design that makes it impossible is worth more than the test that would have caught it.

What the committed suite pins instead is the property that makes the design safe rather than the
failure it forecloses: § the section is worked out again every time shows the **same block placing
on a different section** once the boundaries move, and the spy still writing after that reflow. A
section worked out once and kept would be answering about an article that no longer exists, and
those two assertions are what would notice if someone ever cached it.

**Three things are still not covered, and saying which is the point of writing this down.** GPT Sol
listed them reviewing the built code, and none has a cheap honest test:

- **Reverting `DiagramBand` to `location.search` reddens nothing.** The step-button tests model two
  abstract presses; they never render the band and never exercise nuqs's delayed URL flush. The
  rule — *a panel that both writes the address and reads it back must take it as a prop* — is
  enforced only by the prop being there, and `SummaryBand` next door still reads at render, so
  copying it is how this comes back.
- **No test drives a real glide, a real scroll event and the spy's frame in sequence.** The order
  those run in is what makes `jumpInFlight` correct, and it is argued from reading `scroll.ts`
  rather than observed. `tests/scroll-glide.test.ts` drives the frames by hand for `scrollToTop`,
  which is the nearest thing there is, and it does not include the spy.
- **The browser could not check the two animated cases.** A jump has to *complete* for either, and
  the window was occluded all afternoon — zero animation frames, so the glide never ran
  ([browser-testing.md § an occluded window](../project/browser-testing.md#an-occluded-window-captures-as-solid-black-and-you-cannot-raise-it)).
  What was checked with a real wheel scroll is that a paragraph in `?at=` survives one, and that the
  spy still writes when the reader leaves the section.

**The durable rule, which is now written down where it belongs**
([url-state.md § the unit is a section](../project/url-state.md#the-unit-is-a-section-not-a-position)):
a section is what the *spy* writes, not a limit on what `?at=` may hold. Anything that overwrites a
shared piece of URL state must compare against the thing it means, not against the last value it
happened to put there — because the set of values that state can hold grows, and the guard that
encoded yesterday's set will not fail loudly when it does.

## See also

- [url-state.md § the unit is a section, not a position](../project/url-state.md#the-unit-is-a-section-not-a-position) — the contract, and what a jump is allowed to put in it
- [diagram.md § and then they sprang back](../project/diagram.md#and-then-they-sprang-back-which-was-not-the-pictures-fault-at-all) — the same bug from the panel's side
- [keyboard.md § rapid presses chain from the last target](../project/keyboard.md#rapid-presses-chain-from-the-last-target-not-from-the-page) — why the arrow keys never had this
- [`tests/reading-position.test.ts`](../../tests/reading-position.test.ts) — the red tests
- [`docs/plans/260830z-diagram-step-springback-review-sol.md`](../plans/260830z-diagram-step-springback-review-sol.md) — the cross-family review that found rules 1 and 3
