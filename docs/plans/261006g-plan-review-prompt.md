# Review: a plan to carry GPT-Live's backend terminal status into `ai_calls`

Repo: this worktree. TypeScript + ESM. Read-only review: change no file.

## The candidate

`docs/plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md` (untracked). It is the
fix for your own F30 in `docs/plans/261006f-plan-review-sol.md`. Nothing is built yet.

Start from: `src/web/live/gpt-live/delegations.ts` (`usageOf`, `completed`, `ended`, `parse`),
`src/web/live/gpt-live/meter.ts` (`backendReport`), `src/web/live/gpt-live/useGptLive.ts` (the
`case "usage"` near line 631), `src/web/live/meter.ts` (the retry queue), `src/live.ts`
(`GptLiveUsage`, `parseLiveUsage`, `backendRow`, `REALTIME_OUTCOME`, `acceptRealtimeUsage`),
`src/db/schema.ts` (`ai_calls` checks on `provider_status`, `outcome`, `failure_class`),
`src/cost-cube.ts` (the failure folds). Those are where to start, not a limit.

## What you can run

The tree is read-only; /tmp is writable. One test file at a time
(`npx vitest run tests/<one>.test.ts`) or a small Node snippet. No network, no Postgres.

## Attack it

- Is every statement in the plan true against the code?
- Is there any other path by which a backend response's usage reaches the ledger, or any other
  terminal event (a cancelled backend response, a hang-up mid-response, a top-level error) that
  this leaves recorded wrongly or not at all?
- The statusless report from an old tab: is `outcome ok / provider_status null` the right choice,
  and does any database check, fold, or reader of `provider_status` break or mislead on a
  `backend` row with a null status, or on a `backend` row with `outcome` `error` or `aborted`
  and `failure_class` `abort` with a null phase?
- Idempotency: the row id is derived from the response id and inserts are `on conflict do
  nothing`. Can one response id be reported twice with different statuses, and if so which wins
  and is that acceptable?
- Are the planned tests able to go red for the right reason? Name any that would pass before the
  fix.
- Anything simpler that does the same job.

## Answer format

Findings numbered G1, G2, …, each with a priority (P0 to P3), whether it is established (you
reproduced it or read the line) or suspected, file and line, and the smallest correction. Then
one line: build as planned, build with changes, or do not build. Do not invent or attribute any
quotation to a person.
