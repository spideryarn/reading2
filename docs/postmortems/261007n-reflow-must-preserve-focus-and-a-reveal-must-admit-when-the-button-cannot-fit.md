# Reflow must preserve focus and a reveal must admit when the button cannot fit

The F2 follow-up review found a focused button that could be scrolled away by a
reflow, an outer focus ring inside the new fade, false fades during elastic
scrolling, and alternating scroll positions for wide buttons. These were found
in commit review; reader impact has not been established. The findings and final
validation belong to [the review answer](../plans/261007h-f2-fade-code-review-sol.md).

## A focus reveal is incomplete when the next callback restores selection

Commit `2a7eacc0a` added focus reveals and edge masks to
[useRevealChosen.ts](../../src/web/useRevealChosen.ts). Its intent was to show
that a phone-width bar had more parts, while protecting the chosen or focused
part. `git log -S` identifies that commit as the introduction of the focus
listener.

The listener revealed the focused button, but resize, font and child-list
callbacks still revealed the selected button. Selection and keyboard focus are
different states: Tab can focus the last button while the first remains selected.
A later callback then scrolled back to the first and hid the control that still
held focus. The class is **focus ownership that differs between synchronous and
asynchronous paths**. Shared use of this hook in OrderGroup and the part-switchers
made this one defect apply across modes; the sweep found no separate reveal
implementation to repair.

## Edge fitting needs a defined answer when both edges cannot fit

The same commit assumed that the button could fit between two 20px fades in a
200px row. A 180px interior button cannot. Successive reveals alternated between
`[0,180]` and `[20,200]`, each fixing one edge and breaking the other. This was not
a self-running observer loop: scroll events only updated the marks. The class is
**edge correction without a feasibility condition**.

Two related geometry assumptions also failed: the OrderGroup outline extends
3px outside its button box, and an elastic scroll can report a position outside
the scroll range. Protecting only the box left the outline in the mask;
`Math.abs(scrollLeft)` turned a bounce past the LTR start into a false start fade.

## Why the tests agreed

The original tests checked focus reveal separately from reflow reveal, used
80–90px buttons inside a borderless 200px rectangle, and supplied ordinary scroll
positions. They verified each event's arithmetic while excluding the conflicting
ownership and impossible geometry. The CSS assertion established that a mask was
conditional; it did not establish that its protected content remained visible.

## The durable fix and the checks worth their cost

The implemented fix preserves the focused direct child during reflows, while a
selection change reveals the chosen button. It reserves outward outline space,
clamps direction-normalized scroll positions, omits the mask when the protected
button cannot fit between fades, and consistently aligns the reading start when
the button exceeds the available width. These changes address the cause rather
than delaying callbacks or forcing focus to follow selection.

1. **Exercise conflicting state and infeasible geometry in the existing unit
   harness** — implemented in
   [reveal-chosen-more.test.tsx](../../tests/reveal-chosen-more.test.tsx). Six
   regression cases were observed failing before the fixes: focus followed by
   reflow, an outward ring, elastic positions in both directions, and two wide
   button sizes. Repeated reveals must settle, and shrinking the chip restores
   the mask. This is cheap and catches the classes without screenshot timing.
2. **Check real scrollport boundaries when refining edge containment** — the
   rectangle still includes the part-switcher's 1px borders; its client viewport
   is narrower. That predates this commit and remains separate geometry work.
   The regressions do not prove border-pixel visibility or browser mask painting.
3. **A new browser matrix for every font, width and focus transition** — rejected
   for this fix. It would cost substantially more and still be weaker than the
   small deterministic tests for conflicting ownership and repeated impossible
   fits. The existing visual pass remains useful for mask painting.

Up: [Postmortems](../project/postmortems.md).
