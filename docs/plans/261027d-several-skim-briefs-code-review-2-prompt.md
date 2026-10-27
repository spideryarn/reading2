# Code review round 2: several Skim briefs, stage 2 fixes (261027d)

You are reviewing and may fix committed code in the repo at the current directory. This is round two, scoped narrowly to the fixes made after your round one (`docs/plans/261027d-several-skim-briefs-code-review-sol.md`). Discovery is otherwise closed.

Candidate: commit `fd143749e` alone (`git show fd143749e`). It holds your own round-one fixes (C1–C3: owner-filtered brief reads/locks in `src/store/pg-skim-briefs.ts`, the brief route written inside `StoreSession.commit` in `src/store/pg-session.ts` via `src/store/pg-skim-brief-route.ts`, force vs deleted brief in `src/jobs.ts`) plus two later fixes by another agent, which are unreviewed:

1. `retryJob` in `src/jobs.ts` no longer passes the old job's `url` for a brief's retry, because `slugForRetry`'s URL branch picked a different article that shared the URL; and `briefRouteIsDone` now returns `"gone"` for a missing brief, so the skip says the brief was deleted rather than "already done".
2. C5: `create` in `src/store/pg-skim-briefs.ts` answers 409 when a queued or running job on this article still targets that brief id, checked under the article lock (refusal chosen over a per-row incarnation token on the job). The acknowledged gap: a delete and re-create between the job route reading the brief and the job insert.

## What I want

Is each fix correct and sufficient? For 1: is dropping `url` safe for a brief retry (does anything else in the retry path need `url`, e.g. an upload or a fetch step — note a brief job's steps are limited to quotes, ideas, skim)? Should the fix be keyed on "is a late-stage retry" rather than "is a brief"? For 2: is the gap real and acceptable, and is the live-job query right (statuses, article scoping, lock order article-then-job)? Also confirm your C1–C3 fixes landed as you intended.

Fix narrowly, red-first, inside these fixes only; report anything wider. You have no network: Postgres tests won't run for you, so list the ones I should run. Severity: P0 data loss/security, P1 broken/visible bug, P2 worth fixing, P3 nit. IDs R1, R2, ….
