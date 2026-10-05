# Code review: 261005f — a streamed answer stays where it starts

You are reviewing **code**, and you may fix what you find inside this stage (workspace-write).
Report anything wider for me to decide. Do not commit, and do not run git commands that change the
tree or the index. Do not edit `docs/plans/261005f-a-streamed-answer-plan-review-sol.md` (your own
earlier review). If you edit a doc, do not attribute any sentence to Greg that is not already
quoted there.

## The candidate

- Base `ec37451e1` (origin/dev at the start). The whole change is
  `docs/plans/261005f-a-streamed-answer-code-review.diff` (made with `git diff ec37451e1`), and it is
  also the working tree you are in.
- The plan, with the reader's report, the before-measurement, your plan review's seven findings and
  what was done about each: `docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md`.
- The code: `src/web/chat-hold.ts` (new, the arithmetic); `src/web/ChatPanel.tsx` § `Conversation`
  (`hold`, `settle`, the layout effect, the resize observer, `.chat-room`) and the `data-turn`
  attributes on `Turn`'s roots; `src/web/ChatDialog.tsx` (the `sized` prop);
  `src/web/styles/mode-band.css` § `.chat-room`.
- The tests: `tests/chat-streamed-answer-stays.test.tsx` (new; it carries its own small layout
  model, and 13 of its tests were watched red against the old code), and two older tests whose
  assertion was "follow the bottom" and now assert the new rule
  (`tests/chat-empty-reads-from-the-top.test.tsx`, `tests/chat-dialog-in-column.test.tsx`).
- The browser check after the change, with its numbers: § The browser check in the plan.

## What to do

Make your own pass first, on the code as written, not on the plan's account of it.

1. **Is each of your plan findings F1–F7 actually closed by the code**, not just by a sentence?
   F2 especially: walk send → `begin` id swap → deltas → done, Retry, Edit, Stop, a failed stream,
   and `recovering`, through the layout effect's three-way branch and `wasBusy`.
2. **Find a sequence in which `settle` moves the view when it should not, or fails to place when it
   should.** Candidates: the effect running while `visible` is false and then true; `settle` called
   from the `ResizeObserver` between a commit and its layout effect; `h.target` after the reader
   has scrolled (it is only used for the room: is the room right when the reader is far from the
   target, and can shrinking it clamp their `scrollTop`?); the tool-row compensation when the
   reader has scrolled up above the answer; a hold that outlives its answer (it ends only when the
   turn count changes or Live speaks) and what `stick`, `away` and the room do during that time,
   including a turn deleted and a thread that shrinks; `toBottom` during a hold; the `onScroll`
   handler setting `stick` during a hold and what happens to it when the hold ends.
3. **The update-loop history.** `setAway` inside an effect that runs per streamed word once carried
   React to error #185 (docs/postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md).
   Check `settle`'s `setAway` cannot loop, including through the pill changing the scroller's
   height and so firing the resize observer.
4. **The tests.** Does the layout model in the new test file agree with a browser where it matters
   (clamping, `scrollHeight` including the room, rects moving with `scrollTop`)? Is anything
   asserted only because the model makes it true? Are the two rewritten older tests still worth
   what they were?
5. Anything else: the `data-turn` selector against every shape `Turn` can return, the `.chat-room`
   element's effect on other CSS that targets `.chat-scroll`'s children (`:last-child`, gaps), the
   Live tail sitting between the last turn and the room.

You may run `npx vitest run tests/chat-streamed-answer-stays.test.tsx tests/chat-empty-reads-from-the-top.test.tsx tests/chat-dialog-in-column.test.tsx tests/chat-live-handoff.test.tsx tests/live-tail-handoff.test.tsx`
and `npm run typecheck`. Do not run the full suite; the box is busy.

Severity, by consequence: **P0** data loss, security, charging, service unusable · **P1**
user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk with no wrong behaviour today · **P3** prose. Give every finding an id
(`C1`, `C2`, …), the severity, the evidence (file:line, or a test you ran), whether you fixed it,
and what you changed. Check the conclusion as well as the steps: say whether, on this code, the
reader's complaint is fixed in Chat and in the block chat. End with a verdict line:
`VERDICT: approve` / `approve with changes` / `rework`.

## My own suspicions (already mine; worth less than yours — spend most of the run elsewhere)

- A hold persists after its answer is done, until the next message. During that time a growing
  composer or the pill resizes the scroller and `settle` re-sizes the room; I think that is right
  but it is the least exercised path.
- `roomy` for the card flips from false to true when the transcript first overflows mid-stream.
- The effect became a layout effect; the old one was a passive effect.
