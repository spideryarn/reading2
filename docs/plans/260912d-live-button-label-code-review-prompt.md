# Code review: the Live button's label (plan 260912d)

You are reviewing a small change in the worktree you are running in. You may fix what you find inside
its scope; report anything wider rather than doing it.

**Read first:** `docs/plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md`
(the diagnosis, the design table, and the option passed over) and
`docs/user-feedback/260912_0833-live-button-says-resume-before-any-live-conversation.md`.

**The change:** `src/web/live/LiveButton.tsx` (prop `resume` → `continues`; visible label never
"Resume"; accessible name "Continue this conversation live" / "Start a live conversation"; a tooltip
`state` line), `src/web/ChatPanel.tsx` (`resumeLive` → `continuesLive`), the test block "what the
button says" in `tests/chat-live-handoff.test.tsx` (seen red on the old code: Expected "Live",
Received "Resume"), and `docs/project/live-conversation.md`. See it with `git diff HEAD`.

**The conclusion to check, and the one I would least like to be wrong about:** that the old
`thread.messages.length > 0` test was *not* a broken "has this thread been live?" test, because no
stored field marks a spoken exchange — so there was no correct state test to fix, only a label that
named the wrong thing. Grep `src/types.ts` (`ChatMessage`), `src/live.ts`, the `/spoken` route and
`src/web/chat/` for any marker I missed. If one exists, say so; that changes the design.

Also check:
- Every other place `LiveButton` is mounted (Remember's composer passes `labelled`) still gets a
  truthful name in every phase — idle, connecting, live, closing, failed.
- The `ControlTip` `state` prop is used the way other controls use it (`src/web/Tooltip.tsx`,
  `docs/project/tooltips.md`), and the tooltip still reads correctly on touch.
- Anything else in `src/`, `tests/`, `e2e/` or docs that asserts or describes the old "Resume" label.

Gates: `npm run typecheck` (exit 0) and `npx vitest run chat-live live-`. Do not run the full suite.

Answer with: a verdict (READY / NOT READY), each finding with severity and file:line, and the diff
of anything you changed.
