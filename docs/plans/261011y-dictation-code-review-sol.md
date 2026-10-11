I found and fixed six issues. No unresolved product findings remain.

1. **P1 — held Stop could stop a replacement capture.** [useDictationField.ts:480](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/useDictationField.ts:480)

   Choosing another microphone starts a new capture without another field press, so the old timer could stop it or treat its first Stop as the old session’s second press. Added a synchronous capture generation in [useDictation.ts:346](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/useDictation.ts:346) and bound each hold to that generation.

2. **P1 — Chat could start and immediately stop dictation.** [ChatPanel.tsx:3241](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/ChatPanel.tsx:3241)

   Two presses while awaiting Live’s asynchronous `stop()` queued two stale `dictate.toggle()` calls. The handoff is now coalesced, reads the latest toggle, and treats the in-flight promise—not Live’s rendered phase—as authoritative. Regression test: [chat-live-dictation.test.tsx:166](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/tests/chat-live-dictation.test.tsx:166).

3. **P1 — a second physical press could start a new recording.** [useDictationField.ts:527](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/useDictationField.ts:527)

   If the held session ended itself before the second press, the idle branch interpreted that press as Dictate. It now consumes the remainder of the gesture without starting another capture.

4. **P2 — `doneKey` ABA could send to a reopened target.** [useDictationField.ts:258](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/useDictationField.ts:258)

   Comparing only the string allowed Feedback’s `open → shut → open` sequence to revive an earlier hold or send wish. Holds, wishes, and deferred sends now include a target generation.

5. **P2 — hold cleanup and focus had lifecycle gaps.** [useDictationField.ts:488](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/useDictationField.ts:488)

   Withdrawing `onDone` during the hold could leave Stop waiting until expiry. Also, a same-session error or cap during the hold skipped the promised textarea refocus. Both paths now stop/settle correctly; unmount and replacement sessions remain protected.

6. **P3 — documentation was stale or too absolute.** [dictation.md:359](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/docs/project/dictation.md:359)

   Removed the obsolete `again` wiring, documented capture/target generations, and corrected “nothing changes on screen” to acknowledge Chromium live text can still grow the box. The plan now says the same.

Part 1 is sound: the client accepts recordings from 600 ms at [mic-recording.ts:312](/var/tmp/spideryarn-worktrees/fbaz6puq-dictation-short-and-double-click/src/web/mic-recording.ts:312), while both server floors are 2,000 base64 characters. One-second client and fleet cases are covered. I found no other duration gate that would discard an approximately one-second dictation.

Gate results:

- Typecheck: the literal `npm run typecheck` was blocked by sandbox `tsx` IPC socket `EPERM`. Running the same script as `node --import tsx scripts/typecheck.ts` passed all 3,713 covered source files.
- Requested Vitest command: Vitest 4 treated the eleven positional terms as one intersecting filter and selected no files; private setup also could not reach Postgres in this sandbox.
- Explicit intended union: **70 test files, 1,752 tests passed**.
- Four database-backed quiz suites could not run without Postgres.
- Final focused regressions: **35 tests passed**.
- Lint exited successfully with advisory-only complexity/`void` diagnostics.
- `git diff --check`: clean.
- No commit made; the existing untracked review prompt/output files were untouched.

**Verdict: SHIP WITH FIXES APPLIED.**