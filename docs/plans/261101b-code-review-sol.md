1. **P2 — Fixed:** [tests/referee-hidden-check.test.ts:279](/var/tmp/spideryarn-worktrees/qizymqjvd3-referee-hidden-deadline/tests/referee-hidden-check.test.ts:279). Readiness failures leaked the timeout spy; assertions before firing the deadline left the stream running. Cleanup now covers readiness and assertions, closes the stream independently, and observes rejections immediately.

2. **P3 — Fixed:** [plan:34](/var/tmp/spideryarn-worktrees/qizymqjvd3-referee-hidden-deadline/docs/plans/261101b-referee-hidden-text-deadline-from-its-ceiling.md:34). The 108-row measurement was still called a worst case. Corrected the plan and source comment, plus the helper’s argument notation.

3. **P3 — Outside scope:** [feedback report:53](/var/tmp/spideryarn-worktrees/qizymqjvd3-referee-hidden-deadline/docs/user-feedback/261009_2359-referee-criterion-answer-was-longer-than-there-was-room-for.md:53) still lists the flat deadline as outstanding. Left unchanged. No stale claim found in `referee-mode.md` or `runHiddenCheck`.

Timeout plumbing is correct: the derived or overridden value reaches the timer and both abort-message paths; no rows arms no deadline. Logs record elapsed time and timeout flags, but omit the configured deadline.

Validation: **23 tests passed**. Mutation checks caught the old deadline, disconnected signal, and stale abort-message durations without unhandled errors. Typecheck passed via `node --import tsx scripts/typecheck.ts`; the requested npm command was blocked by the sandbox’s IPC restriction.

No commits; Git index and history untouched.

**SHIP**