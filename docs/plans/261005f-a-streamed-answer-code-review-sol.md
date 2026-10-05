Two P1 findings were reproduced red-first and fixed. No wider issues need a product decision.

### Findings

- **C1 — P1 — fixed:** Live stopped following after a held typed answer overflowed, even when the reader never scrolled. `settle` incorrectly treated the deliberate hold as opting out of follow mode. I separated reader scroll intent from programmatic hold movement using the hold’s recorded `scrollTop`; Live now follows unless the reader actually moved. Evidence: [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbnq847n-stream-stays-in-place/src/web/ChatPanel.tsx:1323), [regression tests](/home/greg/code/spideryarn2/.claude/worktrees/fbnq847n-stream-stays-in-place/tests/chat-streamed-answer-stays.test.tsx:492). Before the fix, `scrollTop` remained 900 instead of reaching the bottom.

- **C2 — P1 — fixed:** Answers beginning with bare CommonMark text nodes—such as raw HTML or reference definitions—anchored the streaming cursor at the answer’s end. The view therefore followed that cursor, recreating the reported bug. I added an explicit zero-height prose anchor after the tool strip, including CSS that preserves first-heading spacing. Evidence: [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbnq847n-stream-stays-in-place/src/web/ChatPanel.tsx:1248), [mode-band.css](/home/greg/code/spideryarn2/.claude/worktrees/fbnq847n-stream-stays-in-place/src/web/styles/mode-band.css:514), [regression test](/home/greg/code/spideryarn2/.claude/worktrees/fbnq847n-stream-stays-in-place/tests/chat-streamed-answer-stays.test.tsx:256). Before the fix, streaming moved `scrollTop` from 900 to 1060.

### F1–F7

After these changes, all seven findings are closed:

- F1: cards never follow; room appears only once already capped.
- F2: send, `begin` ID replacement, deltas, done, Retry, Edit, Stop, failure, and recovery preserve the intended hold lifecycle.
- F3: Live retires the hold and follows correctly; C1 fixed the overflowed-answer case.
- F4: tool insertion preserves the prose position; C2 fixes the bare-text variant.
- F5: visibility, placement, panel resizing, composer growth, and pill changes re-settle through the layout effect/observer.
- F6: placement tests establish that the first readable line is visible, not merely stationary.
- F7: geometry reads precede writes, unchanged room writes are skipped, and state updates occur only when `away` changes.

The room calculation protects both the original target and the reader’s current position, so shrinking it cannot clamp someone who has scrolled down. “Latest” remains a one-shot jump; subsequent typed deltas do not resume following.

The React #185 path is bounded: `setAway` is guarded in both `settle` and `onScroll`, and the pill’s size change reinforces rather than reverses the threshold state, so its resize callback cannot oscillate.

### Verification

- Scoped tests: **5 files, 130 tests passed**
- Typecheck: all 3,115 source files passed. The prescribed command hit a sandbox `tsx` IPC `EPERM`; the same script passed via `node --import tsx scripts/typecheck.ts`.
- Targeted lint: no errors; advisory complexity and pre-existing stylesheet-specificity notices remain.
- `git diff --check`: passed.
- No commit made.

On this code, the original complaint is fixed in both Chat and block chat because both render the corrected `Conversation`, including the card-specific sizing path.

VERDICT: approve with changes