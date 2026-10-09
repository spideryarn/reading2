You are reviewing code in the Spideryarn repo, and you may fix what you find inside this stage.

The change is commit db2ab36f7 (`git show db2ab36f7`). The plan it builds, with your own earlier
plan review folded in, is
docs/plans/261010a-gpt-live-is-the-live-engine-for-everyone-realtime-from-an-arrow-on-the-live-button.md;
your plan review is docs/plans/261010a-gpt-live-is-the-live-engine-for-everyone-plan-review-sol.md.

Greg has decided the product question (GPT-Live for everyone; Realtime only with Experimental on,
from a small arrow joined to the right of the Live button). Do not relitigate it.

Review the diff for:

1. Correctness of src/web/live/engine.ts and src/web/live/useLive.ts: the effective engine, the
   loading-window rule (`experimental.on || !experimental.loaded`), the hang-up-on-switch-off
   effect, the lingers rule, cross-engine Reconnect.
2. src/web/live/LiveButton.tsx's `EngineArrow`: Radix DropdownMenu usage (controlled open with
   `useFingerPressMenu` from src/web/menu.ts — compare with Dock.tsx § DockMore and
   ShelfEntry.tsx), Tooltip wrapping a Trigger asChild, accessible name, keyboard (does stopping
   keydown propagation on the trigger break Radix's own Enter/Space/ArrowDown handling? Radix's
   handlers run on the element itself, so it should not — check), focus return, disabled state.
3. src/web/live/LiveStatus.tsx: hiding noise reduction when `live.placement === null`. Is there a
   moment in a Realtime call when placement is null and the control should be there?
4. CSS in src/web/styles/mode-band.css for `.chat-live-btn.split` and `.chat-live-arrow`: the
   negative margin joining them, the composer height rule, the coarse-pointer width, the lit state.
5. The privacy page sentence and tests/privacy-page.test.ts.
6. The tests in tests/gpt-live-engine.test.tsx and tests/chat-live-handoff.test.tsx: does each
   one fail if the behaviour it names breaks? Any silent success?
7. Docs: anything stale left saying Realtime is the default or GPT-Live is the experimental one
   (grep docs/project and src comments).

Fix what you find inside these files, keeping to the surrounding style. After fixing, run
`npx vitest run tests/gpt-live-engine.test.tsx tests/chat-live-handoff.test.tsx tests/privacy-page.test.ts tests/doc-links.test.ts`
and `npm run typecheck`, and report the results.

Then write your answer: findings numbered C1.. with severity (P1/P2/P3), file:line, what you
changed (or why you left it), and anything wider for the author to decide. End with one line:
APPROVE, APPROVE WITH FIXES, or REJECT.
