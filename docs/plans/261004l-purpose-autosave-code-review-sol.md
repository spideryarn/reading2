Fixed four established findings, each reproduced red-first:

- **F14 — P0:** A suspended new-address render retired the session still on screen, dropping subsequent edits. Retirement now happens during layout commit; the session owns its debounce so saving continues during suspended renders.
- **F15 — P1:** Changing address reset the focus flag while the reused textarea retained focus, allowing automatic navigation. The flag now reflects actual DOM focus.
- **F16 — P1:** After probe exhaustion, `completed()` retained the exhausted counter, allowing only one further attempt. It now grants all five completion-time attempts.
- **F17 — P1:** A speculative render overwrote navigation fences, disabling Open on the visible page. Those fences now update during layout commit.

**F9 holds:** the handoff preserves ordering across replacement, unmount followed by a later mount, and three rapid sessions. Added tests verify this; bypassing the barrier made both additional cases fail.

Remaining findings:

- **F18 — P1, reasoned, wider:** High-powered AI still disposes its active intent during render. A suspended address change can leave its visible checkbox calling a disposed intent, silently ignoring the reader’s choice. Proposed fix: publish the replacement and dispose its predecessor during layout commit.
- **F19 — P3, established, documentation follow-up:** The timer fix makes plan §3’s shared-timer description stale. Replacement: “AddPurposeSession owns the add page’s 700 ms timer so saving continues during suspended renders. ProfileBox uses useIdleCommit for its boxes. The leave warning and status line remain shared.”

All six named test files passed: **192 tests**. The new Done/close tests progressed after an older save was refused. Typecheck passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper encountered a sandbox IPC restriction. Lint reported only AddPage’s complexity advisory.

No commits or docs edits. Changed files:

- [AddPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/AddPage.tsx), [add-purpose.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/add-purpose.ts), [ProfileBox.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx)
- [add-page-purpose.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/add-page-purpose.test.tsx), [add-purpose.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/add-purpose.test.ts), [purpose-prompt.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/purpose-prompt.test.tsx), [profile-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/profile-panel.test.tsx)