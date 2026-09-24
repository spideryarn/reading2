## F10 — still open

The reader-facing half is fixed:

- `stageFailure(LIVE_UPSTREAM, diagnostic)` separates the safe sentence from OpenAI’s body in [live.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/live.ts:578).
- The thrown error has no status, so the live route’s failed `await` reaches `handleApi` as 500; `authoredSentence` returns the declared `LIVE_UPSTREAM` sentence in [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/routes.ts:6660).
- That sentence retains `[live-upstream]`, so `startupMessage` shows “Live voice is unavailable…” in [useLiveConversation.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/live/useLiveConversation.ts:325).
- Grep found no other live-upstream throw site.

However, the Sentry claim is not closed.

**F16 — P1, established:** provider-controlled text can acquire authored status by ending in `[live-upstream]`.

Reproduction: return a non-2xx body of `provider-controlled [live-upstream]`. `mintLiveToken` produces:

```text
OpenAI refused the live session (400): provider-controlled [live-upstream]
```

Because `live-upstream` is registered in [messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/messages.ts:311), the scrubber reports `withheld: false` and forwards that complete diagnostic to Sentry through [monitoring-scrub.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/monitoring-scrub.ts:233). The existing test uses a body ending in `}}`, so it misses this case.

Fix: frame the response body so fixed server-authored text always follows it—for example, quote/serialize it and end the diagnostic after the closing delimiter—then test that a body ending in `[live-upstream]` still yields `sanitise(err).withheld === true`.

## F11 — closed

- `apiFetch` brands browser transport `TypeError`s independently of their wording in [api.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/lib/api.ts:436).
- `describeFetchFailure` maps that brand to `[net-down]`, while preserving `ReaderFacingError` sentences from the server in [describe-failure.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/lib/describe-failure.ts:31).
- `useJobs.act` uses the described sentence but passes the original error to `statusOf`, preserving 401 in [useJobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useJobs.ts:351).
- Every add/run/cancel/retry/forget action passes through that `act`.
- `jobEngine.actionFailed` pauses immediately on 401 in [jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/jobEngine.ts:804).

Verification: the three focused files passed, 37 tests total. `npm run typecheck` could not start because this read-only sandbox denied tsx’s `/tmp` IPC socket; that was an environment failure, not a typecheck result. No files changed.