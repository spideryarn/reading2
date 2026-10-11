You are reviewing built code in this worktree (Spideryarn), and you may fix what you find.

Read docs/plans/261011i-dictation-failures-reach-sentry.md (the plan, including the section on
what your own plan review changed) and docs/plans/261011i-dictation-failures-reach-sentry-plan-review-sol.md.
The change is commit HEAD: `git show HEAD` (or `git diff origin/dev...HEAD -- src tools tests`).

Focus:
1. useDictation.ts: `setError` is now a useCallback wrapper over `showError` that reports. Is every
   failure path reported exactly once per occurrence? Any path that calls `showError` directly, or a
   stale-session path that now reports a failure the reader never sees (e.g. a `setError` that runs
   for a session that is no longer current, an abandoned press, a retry superseded)? Is
   `failureCause` reset/set at the right moments (press, retry, recovered tape, chooseDevice
   restart)? Is any `setError` call ordering such that the cause belongs to a different press?
2. beginCapture: the `refused` reason and `no-track` default. Correct across all fallback branches?
3. dictation-report.ts and monitoring.ts: can anything a reader said, or an article slug, reach
   Sentry? Are the tags all from closed sets? Is the fingerprint safe?
4. The [mic-refused] sentence and tests/dictation-codes.test.ts (one code, one sentence).
5. Tests in tests/dictation-report.test.tsx: do they prove what they claim? Anything important
   untested?

Gates you can run: `npx vitest run tests/dictation-report.test.tsx tests/dictation-*.test.ts*
tests/monitoring-*.test.ts` and `npm run typecheck`. Do not run the full suite. Do not commit, do
not touch git state; edit files in place only for fixes inside this change's scope, and list each
edit you made. Anything wider: report it, do not build it.

Output: numbered findings with severity (P0-P3), what you changed for each (or "not changed: why"),
and finish with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REVISE.
