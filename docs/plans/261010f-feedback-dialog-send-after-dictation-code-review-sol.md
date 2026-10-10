Found and fixed seven issues. No wider product decision remains.

1. **C1 — P1 — [FeedbackDialog.tsx:1100](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/FeedbackDialog.tsx:1100):** A successful send could delete words added after Send, leaving a one-second reload window with no durable copy. The next report is now saved synchronously before completion.

2. **C2 — P1 — [FeedbackDialog.tsx:503](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/FeedbackDialog.tsx:503), [feedback-draft.ts:120](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/feedback-draft.ts:120):** ID-only cleanup could erase another tab’s newer draft. Cleanup now requires an exact ID/body/kind snapshot match.

3. **C3 — P2 — [FeedbackDialog.tsx:1110](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/FeedbackDialog.tsx:1110):** Restored drafts and edited retries could leave their earlier saved record behind, causing filed feedback to reappear. All snapshots this tab read or wrote are now conditionally cleaned up.

4. **C4 — P1 — [useDictationField.ts:260](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/useDictationField.ts:260), [useDictationField.ts:376](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/useDictationField.ts:376):** A failed ending followed by Retry could poison the fast-second-press state, making the next microphone press send unexpectedly. The window is now causally bound to exactly the ending produced by that Stop press.

5. **C5 — P2 — [FeedbackDialog.tsx:1105](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/FeedbackDialog.tsx:1105):** Changing only the feedback kind while Send was in flight was treated as finished and discarded. Completion now compares body, kind, consent, and screenshot.

6. **C6 — P3 — [feedback-draft.ts:56](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/feedback-draft.ts:56):** Malformed stored JSON was ignored but not removed, contrary to the documented behavior. It is now removed best-effort without turning storage failures into dialog failures.

7. **C7 — P2 — [FeedbackDialog.tsx:530](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/FeedbackDialog.tsx:530), [feedback-draft.ts:97](/var/tmp/spideryarn-worktrees/fbt9qu3v-feedback-dialog-hang/src/web/feedback-draft.ts:97):** A kind-only draft was neither persisted nor counted as unsent work. It now saves, restores, and prevents unsafe reloads.

The send refusal order, timeout ownership, `stillMine`, latch release, cap behavior, synchronous Safari ending, `doneKey` changes, opening transitions, and StrictMode effects have no remaining issue I could reproduce. I also corrected the plan and feedback guide to describe snapshot-based cleanup accurately.

Validation:

- Requested Vitest suite: **4 files, 288 tests passed**.
- `npm run typecheck` was attempted but the sandbox rejected the `tsx` IPC socket with `EPERM`; the equivalent `node --import tsx scripts/typecheck.ts` passed all TypeScript projects and coverage checks.
- `git diff --check` passed.
- No commit made. The two pre-existing untracked review files remain untouched.

APPROVE WITH CHANGES