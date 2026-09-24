# Review: the fixes for F10 and F11 only (plan 260924a § Stage 2c)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924. Read-only. Live pre-commit;
other agents edit other files. **Scope is these two fixes and nothing else** — do not reopen other findings.

Your earlier review (docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader-2c-code-review-sol.md)
raised F10 and F11 as P1 outside your file list; I fixed both afterwards.

## F10 — Live voice's `[live-upstream]`

Files: `src/live.ts` (`mintLiveToken`: both branches now `throw stageFailure(LIVE_UPSTREAM, diagnostic)`),
`src/messages.ts` (`LIVE_UPSTREAM`, and `"live-upstream": "retry"` in `CODE_KINDS`),
`src/web/live/useLiveConversation.ts` (`startupMessage`, unchanged — matches `[live-upstream]`),
`src/reader-sentence.ts` (`authoredSentence`), `src/job-failure.ts` (`stageFailure`, `declaredFailure`),
the 5xx rule at the end of `handleApi` in `src/routes.ts`, and the live-token route (`mintLiveToken` caller).
Test: `tests/live.test.ts` § "keeps OpenAI's sentence for the log, and says only its own to the reader".

Claim: the reader now gets `LIVE_UPSTREAM` (ending `[live-upstream]`, so the client still shows "Live
voice is unavailable"); OpenAI's response body stays only in the error's own message (the diagnostic,
logged), which carries no code and so is never treated as authored — neither by `handleApi` nor by the
Sentry scrubber (`authored` in `src/monitoring-scrub.ts`). Check especially: does registering
`live-upstream` let any *other* string ending in that code through (grep for remaining throw sites with
`[live-upstream]`)? Does the route answer with a status ≥ 500 so the rule applies, or does it pass the
diagnostic through some other path?

## F11 — `useJobs` job actions

File: `src/web/useJobs.ts` (`act`: `describeFetchFailure(err)` for `lastFailure` and
`jobEngine.actionFailed`, `statusOf(err)` still from the original error). Also
`src/web/lib/describe-failure.ts`, `src/web/jobEngine.ts` (`actionFailed`, `send`).
Test: `tests/refused-job-reason-survives.test.tsx` § "says a lost connection in its own words, whatever
the browser calls it"; the existing cases there prove a server refusal's words still survive.

Claim: a job action failing on transport shows `[net-down]` whatever the browser's wording; a server
refusal still shows the server's sentence; a 401 still pauses the engine.

## Answer

For each of F10 and F11: **closed** or **still open**, with the evidence. New findings only if they are
about these two fixes: ID from F16, P0–P3, established/reasoned, reproduction, fix. Do not change any file.
