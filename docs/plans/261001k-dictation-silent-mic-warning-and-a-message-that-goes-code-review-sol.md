1. **P1 — [useDictation.ts:1618](/home/greg/code/spideryarn2/.claude/worktrees/fb7z-dictation-silent-mic/src/web/useDictation.ts:1618):** `phaseNow` could still be `idle` immediately after a session or retry started, allowing `dismiss()` to hide a live operation. Fixed by checking the synchronous session/request refs too and clearing the retry ref when it finishes. Added mutation-tested coverage for session start, retry start, and completed retry dismissal.

2. **P2 — [dictation-quiet-warning.test.tsx:180](/home/greg/code/spideryarn2/.claude/worktrees/fb7z-dictation-silent-mic/tests/dictation-quiet-warning.test.tsx:180):** StrictMode double effects were not tested. Added an already-quiet StrictMode mount; removing the once-per-session guard now produces four notes and fails.

The remaining audit was clean:

- Every error/recording publication belongs to an already-incremented session, retry, or recovery artifact; superseded async paths are guarded.
- `clearRecording()` only clears errors describing its recording.
- Recognition restarts and part rollovers retain `startedAt`; a device change creates a new session and appropriately permits another warning.
- The committed tests were mutation-checked against identity removal, error retention, missing Feedback dismissal, missing warning styling, and repeated chimes.

Checks: focused suite passed, 107 tests. Typecheck passed all four projects via `node --import tsx scripts/typecheck.ts`; the requested npm wrapper itself is blocked by sandboxed Unix-socket creation. Full `npm test` could not start because this sandbox cannot reach the local Postgres lane. Lint passed with only pre-existing advisories.

**Verdict: fixed one P1 race and one P2 coverage gap; no wider decision needed.**