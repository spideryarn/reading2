# Code review 2: 261005f — the change made after your first code review

You reviewed this work at `3ad32b3e7` and fixed C1 and C2 (committed as `d128b1d3d`). A browser pass
on `d128b1d3d` then found one more defect, and this review is of the fix for it only. You may fix
what you find (workspace-write). Do not commit, and do not run git commands that change the tree or
the index. Do not edit your earlier review files. If you edit a doc, do not attribute any sentence
to Greg that is not already quoted there.

## The candidate

- `docs/plans/261005f-a-streamed-answer-code-review-2.diff` (`git diff d128b1d3d -- src/web tests`),
  which is also the working tree at `97938e5bc`.
- What the browser found, with its numbers: the plan's § The browser check, "Second pass", in
  `docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md`. In short: in a follow-up, the
  question was placed at 11px and then moved 31–57px up, clipped, at the moment the first words
  replaced "thinking…"; with `overflow-anchor: none` injected by hand that jump went away and the
  question instead sat 36px low from the send, which is the clamp from the first pass, uncorrected.
- The fix: `.chat-scroll { overflow-anchor: none }` (`src/web/styles/mode-band.css`), and in
  `Conversation`'s `onScroll` (`src/web/ChatPanel.tsx`) a branch that recognises a clamp — the hold
  is placed, `scrollTop` is below `h.top`, and it is exactly at the scroller's maximum — and calls
  `settle()` instead of recording the position as the reader's.

## What to do

1. **Is the clamp's signature safe?** Find a way a *reader* produces it (wheel, scrollbar drag,
   keyboard, touch with rubber-banding, the "Latest" press, a fractional `scrollTop` on a high-DPI
   screen, a scroller shorter than its content by less than a pixel), and say what `settle()` then
   does to them. Find a clamp it misses.
2. **`overflow-anchor: none` on every `.chat-scroll`, hold or no hold.** What did the browser's
   anchoring do for this transcript outside a hold that is now lost? Consider a reader scrolled up
   in history while turns above or below change height (an editor opening on an earlier question,
   a tool strip, the pencil row, images or maths loading in an earlier answer), and Live.
3. **My account of the cause is partly inferred.** I did not trace why Chrome's anchoring moved the
   view by the height the answer turn grew; I know only that turning it off removed the movement.
   If you can see the mechanism from the DOM (`.chat-room` after the last turn, the zero-height
   `.chat-answer-anchor`, the "thinking…" span replaced by prose), say so, and say whether the fix
   addresses it or merely hides it.
4. Whether `settle()` called from inside a scroll handler can loop with the scroll event its own
   write produces.

You may run `npx vitest run tests/chat-streamed-answer-stays.test.tsx tests/chat-empty-reads-from-the-top.test.tsx tests/chat-dialog-in-column.test.tsx tests/chat-live-handoff.test.tsx tests/live-tail-handoff.test.tsx`.
Do not run the full suite.

Severity as before (P0–P3). Give every finding an id (`D1`, …), the evidence, whether you fixed it
and what you changed. End with a verdict line: `VERDICT: approve` / `approve with changes` /
`rework`.
