# Code review: GPT-Live's backend report carries its terminal status (qi-p78m9ch9)

Repo: this worktree. TypeScript + ESM. The fix for your F30 in
`docs/plans/261006f-plan-review-sol.md`.

## The candidate

Live and uncommitted: `git diff HEAD` plus the untracked `docs/plans/261006g-*` files. The plan
is `docs/plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md`; your plan review
of it is `docs/plans/261006g-plan-review-sol.md`, and the plan's § Review notes say what was done
with each finding.

Changed: `src/web/live/gpt-live/delegations.ts`, `src/web/live/gpt-live/meter.ts`,
`src/web/live/gpt-live/useGptLive.ts`, `src/live.ts`, `docs/project/live-conversation.md`, and
tests `gpt-live-delegations`, `gpt-live-meter`, `gpt-live-session-flow`, `realtime-usage`,
`live-session-routes`.

## What I ran

Each new assertion was seen red before the fix (11 failing across the four database-free files),
then green, and two more (G1, G2) red then green: 165 passed. `tests/live-session-routes.test.ts` (needs Postgres): 25 passed.
`npm run typecheck` clean.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red first with the test
that reproduces it, and leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. Do not invent or attribute any quotation to a person.

You have no network, not even loopback, so the Postgres-backed test will not connect for you.
The four database-free files run: `npx vitest run tests/gpt-live-delegations.test.ts
tests/gpt-live-meter.test.ts tests/realtime-usage.test.ts tests/gpt-live-session-flow.test.tsx`.
Typecheck: `node --import tsx scripts/typecheck.ts`.

## Attack it

- Can a failed or incomplete backend response still reach `ai_calls` as `ok`? Every path.
- Can a completed one be written as failed?
- `parseLiveUsage`: absent status allowed, anything else outside the three refused. Any input
  that gets through wrongly, or a legitimate one refused (which would lose its cost, because the
  browser does not retry a 400)?
- A `backend` row with `outcome` `error` or `aborted`: does any database check, any fold in
  `src/cost-cube.ts`, `src/ai-spend.ts`, or any SQL reading `provider_status` break or mislead?
- Are the comments and the doc sentence true?
- Anything simpler.

## Answer format

Findings numbered H1, H2, …, each with a priority (P0 to P3), established or suspected, file and
line, and what you did about it (fixed, with the red test named, or left for me). Then the list
of files you changed, and one line: ship, ship with the fixes, or do not ship.
