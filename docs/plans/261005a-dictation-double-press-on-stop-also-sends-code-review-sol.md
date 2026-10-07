Found and fixed four issues:

- **C1 — P1 — fixed.** A target could change in the same React batch as `onEnd`, causing the deferred effect to call the new target’s `onDone`. The effect now rechecks the captured key. Reproducer went red first: “does not send to a target that changes in the same React batch as the ending.” [useDictationField.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/useDictationField.ts:259)

- **C2 — P1 — fixed.** Changing targets during the 600 ms window could transfer the second press to the new target; an accepted wish also survived Feedback closing and reopening. Key changes now immediately close the window, withdraw the wish, and clear the misleading “then sending” state. Three reproducers went red first. [tests](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/tests/dictation-double-stop-sends.test.tsx:222)

- **C3 — P2 — fixed.** Added real-hook coverage proving the final transcript is present, `busy` is false, `onDone` runs once, and Retry after failure does not send. A mutation deleting the done call made this test red. [real-hook test](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/tests/dictation-double-stop-sends-real-hook.test.tsx:126)

- **C4 — P3 — fixed.** `/help` omitted the comment follow-up from its list of supported boxes. The prose test went red first. [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/help/help-modes.tsx:175)

- **C5 — P1 — reported.** The pre-existing, already-deferred issue remains: on browsers without live words, a transcript itself can land in the next comment/question. This stage now prevents automatic sending, but fixing transcript placement is wider work.

`CommentDialog`’s plain submit behavior remains equivalent: the added ownership/pending guards only cover states where its form is not rendered.

Verification: 8 focused jsdom files, 309 tests passed; web and test TypeScript projects passed; touched-file Biome lint and `git diff --check` passed. The wrapper `npm run typecheck` could not open its sandbox IPC pipe (`EPERM`), so I ran the relevant `tsc` projects directly. No commit was made.

VERDICT: ship with the fixes I made