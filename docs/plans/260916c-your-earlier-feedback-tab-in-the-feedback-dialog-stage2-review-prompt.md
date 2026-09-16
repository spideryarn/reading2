# Code review, stage 2: the Earlier tab in the Feedback dialog

Candidate: commit `19ed3436` in this worktree (`git show --stat 19ed3436`). Code:
`src/web/FeedbackEarlier.tsx` (new: the read hook and the list), `src/web/FeedbackDialog.tsx` (the
tabs, `choose`, the guards in `send`/`onPaste`/`onDrop`, the panels), `src/web/styles/feedback.css`,
`src/messages.ts` (`FEEDBACK_EARLIER_FAILED`), `tests/feedback-dialog.test.tsx` (§ the Earlier tab),
`docs/project/feedback.md`. Plan: `docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md`
— § Client, § Stages 2, and the log at the end. Your plan review (F1–F6) and stage-1 review (F7) are
beside it; check that F1–F3, F5 and F6 are really closed in the code. Start with the diff; it does
not limit scope.

## What to do

You may edit files. **Fix what is inside this stage** — narrowly, red-first — and **report, do not
fix**, anything wider. Findings first, with what you changed for each.

Attack, independently first:

1. Any way, in a real browser, that the hidden Write panel still acts: a focused element inside it
   when it becomes hidden, ⌘Enter from a focused Earlier control, a drop on the textarea itself, the
   `sending` stage or the failed-send panel interacting with a tab switch, a send in flight while
   the reader switches to Earlier and it lands (`sent` stage replaces the whole form — is that
   right?), dictation `readOnly` transcribing state while on Earlier.
2. The read: generation counter, the idle reset, the `useEffect` that starts it (can it loop, or
   fire twice under StrictMode, or never fire?), non-JSON or wrong-shaped 200 bodies, a 401.
3. Accessibility of the tabs (roles, ids via `useId`, roving tabindex, aria-controls on a hidden
   panel) and the CSS (`[hidden]` override; anything else with `display:` set on a hidden element).
4. Copy conventions (`src/messages.ts`, docs/project/copy.md) and doc accuracy.
5. Would each test go red if the thing it names broke? I mutated out each guard (send, paste, drop,
   microphone stop, focus, reset on close, generation check) and each turned its own test red.

## Evidence

`npx vitest run tests/feedback-dialog.test.tsx` → 50 passed (12 new, all watched red before the
implementation). `npm run typecheck` exit 0. Biome: one complexity *info* on `send`. A real-browser
check is running separately; you cannot run a browser.

## Severity and format

P0 data loss / exploitable security; P1 user-visible wrong behaviour or contract violated; P2 design
risk; P3 prose. IDs continue at F8. For each: severity, established or reasoned, file:line,
fixed-or-reported. End with `VERDICT: approve` or `VERDICT: refuse` (refuse only on an established
P0/P1 still open).
