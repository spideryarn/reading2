# Diagram mode's ↑ / ↓ buttons: step by paragraph, and follow the reader

Status: built, 2026-08-31, after two ⟨Sol⟩ reviews — of the plan (`-sol.md`) and of the built
code (`-code-review-sol.md`), both beside this file. Owner: this change. Area:
[diagram.md § the step bar](../project/diagram.md#the-step-bar-and-the-key-that-was-firing-twice).

Greg, 2026-08-31:

> There's something wrong with the up/down buttons in Diagram mode, e.g. for Drift. If I press
> down, it seems to jump more than one paragraph. Also, the tooltip isn't that helpful and gets in
> the way, so get rid of them for the big Up/Down buttons. And also, if I click up/down to move
> paragraphs in the text, it doesn't update the position correspondingly in the diagram.

Three complaints. The middle one is a deletion and is already done. The other two turn out to be
two faces of one thing: **the panel does not know where the reader is to better than a section.**

## What was measured

In a browser on `scaling-hypothesis` (186 blocks, 34 sections), Drift drawing 102 dots and its own
strip saying *"84 too short or not prose to place"*:

- One press of ↓ moved the article **two block rows**, every time. Not a race and not a stale
  position — the ladder simply has no rung on the rows in between, because a rung is a **dot** and
  a block under `MIN_WORDS` (12) is never embedded and so never gets one
  ([`src/article-vectors.ts`](../../src/article-vectors.ts)).
- `?at=` names **the first block of the section the reader is in**, by design
  ([position.ts](../../src/web/position.ts)). Measured mid-section it was two rows behind the
  paragraph actually at the reading line, and on an article with longer sections it will be many
  more.

`DiagramPanel` computes everything positional from `atRow`, which is that section-granular value:
the you-are-here line on Drift, the marked dot, the `12 / 47` readout, **and the row the next press
steps from**.

## The two changes

### 1. The reader's row is measured, not read off the address

`?at=` is deliberately coarse and should stay coarse — the three reasons are in
[position.ts](../../src/web/position.ts)'s header and none of them has weakened. What is wrong is
this panel *believing* it.

`keynav.ts` already has the right answer and this panel is the odd one out: `measureRow()` — the row
under the reading line, straight from the DOM. Exported already, and used by `swipe.ts` too, for the
stated reason that a finger and a key must not disagree about which item the reader is in. A picture
whose axis *is* the article is the third thing that must not disagree.

So: DiagramPanel keeps the measured row as state, updated from a `scroll` listener throttled to one
`requestAnimationFrame` and setting state only when the row actually changes — **and re-measured
whenever the article's table resizes**, which is Sol's second finding and a real hole in the first
draft. A column toggle, the spine going away, a resize, a late image or a font swap all rewrap every
paragraph and move no scrollbar, so a scroll-only listener goes on reporting a row that has stopped
being under the reading line.

The plan first said `layoutKey`, App.tsx's string of the reader's own layout choices, which two
other position-measuring hooks take. Sol pointed out on the built code that it cannot see a late
image or a font swap, and that `useColumnContext` therefore observes the table as well. So the panel
does the observing and does not take the key: every reflow the key describes changes the table's
box, so the observer already hears them, and threading a prop through two components to hear them
twice is a part touching another part for nothing. If a reflow ever turns up that moves the rows
inside a table whose box has not changed, the key is what to add.

Sol also said, and I agree, **keep the measurement local rather than lifting it into
`useReadingPosition`**: lifting it would re-render the whole `Reader` at every paragraph crossing,
where a second passive listener re-renders only this panel — and the two want different policies
anyway, since the URL deliberately sits out a jump in flight and the picture must not.

**Gated on the pictures that can use it.** Only Drift and Trail draw at paragraph resolution
(`NEEDS_AT_ROW`, already a set in that file). Force's nodes are sections, so a finer row would change
its mark at exactly the same moments `?at=` already does — while making it re-render on every
paragraph crossing, and Force's layout is the 300-tick d3 simulation that was deliberately taken off
`atRow` for that reason on 2026-08-27. Force keeps `atRow`.

### 2. On the scatters the ladder is the article's paragraphs, not the dots

`stepStops` builds one rung per distinct **drawn row**, which is right on Force (rungs are sections,
and the picture is made of sections) and wrong on the scatters, where a fifth to a half of the
article's paragraphs have no dot. Greg's *"it seems to jump more than one paragraph"* is exactly
that: a press walks to the next **embedded** paragraph, skipping the short ones — which are still
paragraphs, still on screen, and still places the reader is standing.

So on a picture made of points the ladder becomes one rung per body block, and each rung carries the
node that answers for it — `nodeAt`, which is already the rule, and it works because **a dot's range
tiles the article** (scatter.ts § dots) precisely so that a reader in an unembeddable paragraph has
a dot answering for them.

The readout then counts the article's paragraphs rather than the dots. That is the honest number for
a control that moves the reader, and its hover card had to change with it: it said *"out of N the
picture draws"*, which is precisely what the number stops being. It now says *"out of N the ↑ and ↓
buttons walk"*, and the strip above the picture stays the one place that reports how many paragraphs
got a dot.

**"Paragraph" means every body row**, which includes headings, captions and code blocks. That is
already this app's convention — `bodyOrdinals` counts the same set and the dots' own spoken labels
say *"paragraph 7 of 145"* off it — so the ladder follows it rather than inventing a second meaning
of the word. Sol was right to make us say so out loud.

### 3. The mark is withheld in the apparatus, and the ladder is not

Sol's third finding, and it is a real contradiction inside one picture. Both scatters plot the
argument: `bodyRowOf` asks the *block* rather than the range, so a reader in the notes gets no
you-are-here line. But a dot's range is stretched to tile the article, so a note stranded mid-body
falls inside one — and `nodeAt` would light that dot, brighten Trail's chain around it and count the
reader as a paragraph of the argument, while the line beside it had honestly withheld itself.

So the panel now holds two rows: the measured one, which is where a press steps from, and a
body-only one, which is what the mark, the line and the readout use. Outside the body the readout
says `—` rather than rounding the reader to the nearest paragraph of the argument.

### 4. The chain is a timer, not the glide's handle

The first build asked `glideTarget()` whether a jump was in flight and, if so, stepped from its
destination. Sol found the gap: `glide` clears its own handle in the same tick as its final
`scrollTo`, so between that and the scroll event it causes there is a window where nothing is in
flight and the measurement is still mid-air. `CHAIN_MS` — `keynav.ts`'s constant, for this exact
problem — has no such window. The press also measures the page there and then rather than reading
React state, which is a frame behind at best.

### 5. On Drift the panel follows the line, not the nearest dot

`here` changes only when a *dot* changes, and a long run of paragraphs too short to place is one dot
— so the inner scroller could sit still while `nowY`, the thing the reader is actually watching,
walked off the bottom of it. The follow effect now scrolls to `line.diag-now` where there is one and
to the marked node where there is not, which is right for all three pictures.

## What this costs, said plainly

**On Trail, some presses will move the text and not the picture.** Trail has no you-are-here line —
its mark is the highlighted dot and the brightened chain, both keyed to the dot whose range contains
the reader — so two paragraphs answered for by one dot look identical. That is the inverse of the
failure `stepStops` was written to avoid ("three presses and the article moves nowhere"), and it is
the better half of the trade: the reader pressed a button to move through the text, and the text
moved. Drift is unaffected, because its `nowY` is continuous in the row.

**A scroll listener and a re-render per paragraph crossing, on two pictures.** Drift's layout is one
pass over the dots and no simulation. Force, the expensive one, is excluded.

## Alternatives weighed

- **Leave the ladder on the dots and only fix the position.** Cheaper, and does not answer the
  complaint: from row 10 the next dot may still be row 12.
- **Lower `MIN_WORDS` so more paragraphs get dots.** Wrong lever — it spends money to change a
  picture in order to fix a button, and short blocks embed badly, which is why the floor is there.
- **Write the paragraph into `?at=`.** Rejected: it undoes a deliberate decision that three other
  features depend on, to serve one panel.
- **Keep `atRow` and add `measureRow()` only at press time.** Fixes the step and leaves the mark
  frozen while the reader reads, which is the third complaint.

## Tests

- [`tests/diagram.test.ts`](../../tests/diagram.test.ts) § `paragraphStops` for the pure ladder: one
  rung per body block, the apparatus off it, each rung carrying the dot `nodeAt` would light, and —
  on the same fixture — the three-rung answer the dot ladder gave, which is the bug written down.
- [`tests/diagram-step.test.tsx`](../../tests/diagram-step.test.tsx) for the wiring, which is where
  the bug actually lived. *"The pure coverage cannot catch any of those wiring failures"* — Sol, and
  the plan's first draft was too quick to say the DOM half could not be tested when this directory
  already mounts this panel. Nine tests: the mark moving on a scroll `?at=` never hears about, a
  reflow with no scroll, one press moving one paragraph rather than one dot, two rapid presses
  counting as two, the chain expiring, ↑ walking back, and a reader in the notes being marked
  nowhere while still stepping out from where they physically are.

All of them were watched failing against the old behaviour before the new one was kept — position
from `?at=`, the dot ladder, no chain — and all of them pass with it. The two chain tests added after
the code review were likewise watched failing against the chain rule they replaced.

**Not covered by a test:** that Drift's inner scroller follows `line.diag-now` rather than the
nearest dot. The tests assert that the line's coordinate moves; nothing asserts where the scroller
goes, because jsdom lays nothing out and the effect is entirely about rectangles.

## And one the browser found that neither review did

With everything above in, a browser pass showed the readout a press behind: `9, 10, 10, 12, 12, 14`
over six presses of ↓, each of which had in fact moved the article exactly one paragraph, and the
same block reading `9 / 145` when opened directly and `10 / 145` when stepped onto. The step logic
was right and the *display* was late, because every route into the measured row is a measurement and
a measurement costs a frame.

A press is the one case where the answer is known before the page has moved, so it now sets the row
itself and lets the next measurement overwrite it. Worth writing down for the shape rather than the
fix: two careful reviews and a passing test suite all looked at a number that was correct one frame
later than it should have been, and only a person watching it move could see it.

## The second review, of the built code

Six findings, and two of them were real defects rather than tidying.

**The chain was dropped by any `touchstart`, which is every tap on an iPad.** So the second tap of a
rapid pair cleared the chain a moment before the `click` that needed it, putting the original race
back on the one device these buttons were added for — and the rapid-press test passed throughout,
because `button.click()` fires no touch. The rule is now about *where* a gesture landed rather than
which gesture it was: anything outside `.diag-step` ends the chain. With that in hand the list of
events could widen to `pointerdown` and `keydown` as well, which closes the second defect —

**— the chain outliving the jump it belonged to.** A scrollbar drag, PageDown, keynav's own ↑ / ↓, a
click on a dot and the footer card's jump all leave the reader somewhere the last press knows
nothing about, and none of them fires `wheel` or `touchstart`. All of them begin with a pointer or a
key outside the step bar, so one rule covers them; the alternative was a wrapper round `onJump`,
which is the version that goes stale the next time something new can jump.

**And four smaller ones**: `canStep` now consults the chain as `stepFrom` does, so a button cannot
announce itself unavailable while working; `useReaderRow` watches the article's table, because a
column toggle, a late image and a font swap all move the rows and none of them scrolls;
`paragraphStops` fills a row → node array in one pass instead of calling `nodeAt` per row, which
matters because the scatters' layout — and therefore this ladder — is recomputed on every paragraph
crossing; and several comments that claimed more than the code does have been cut back, including
one that put the cost of a measurement at "a rect read per frame" when it is one per row per frame.
