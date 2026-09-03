# Review this plan before it is built

You reviewed the design question behind this a few hours ago and recommended logical-database
isolation. This is the plan written from that. Review the PLAN, not the design question again.

Repo root: /home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation
Plan: docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md

Please read these in the repo:
- the plan itself
- tests/helpers/expect-claimed.ts and tests/expect-claimed.test.ts (Stage A, already built)
- tests/store-jobs-parity.test.ts (37 call sites converted)
- tests/helpers/run-lock.ts (the existing mitigation — its docstring matters)
- src/store/pg-jobs.ts (claim, the NOWAIT singleton)
- src/env.ts (the ordering trap the plan leans on)
- scripts/spike-migrate-to.ts, tests/setup/spike-db.ts, scripts/spike-hold-singleton.ts,
  scripts/spike-contended-claim.ts, vitest.spike.config.ts (the throwaway spikes that produced the
  evidence — Stage B promotes them)

**Run something yourself.** Your sandbox allows it, and a finding you reproduced outranks one you
reasoned to. Suggestions:
  npx vitest run tests/expect-claimed.test.ts
  npx tsx scripts/spike-contended-claim.ts     # holds the singleton, proves the message fires
Note that the local Supabase is shared with other agents, so a job-suite run may be contended —
which is the point of the whole plan, and Stage A means it should now SAY so.

## What I most want challenged

1. **Stage A's contention set.** `expect-claimed.ts` treats exactly two `why` fragments as foreign
   contention — "another claim is being decided" and "already running" — and deliberately does NOT
   treat "another job on this article is ahead of it" as contention, on the grounds a suite can
   cause that itself. Is that split right? Is there a fourth reason, or a case where "already
   running" is genuinely the suite's own doing and would now be misreported as pollution? Note the
   suites pass CAP = 100.

2. **Is Stage A actually complete, or did converting 37 assertions lose something?** Look for sites
   where the old `expect(...).kind).toBe("claimed")` was load-bearing in a way `expectClaimed` is
   not — e.g. somewhere the returned job is now unused where it was checked before, or a test whose
   point was the assertion itself. I did the conversion mechanically with a regex plus three
   hand-edits; check the three (a loop with an else branch around line 747, and two multi-line
   wrapped ones).

3. **The per-run vs per-worktree fork in Stage B.** The plan explicitly leaves this to you rather
   than to Greg. Which, and why? Per-run self-cleans after a killed run and cannot be crossed by
   another branch's migrations; per-worktree is cheaper per run and matches how worktree-setup
   already works. Pick one and say what would change your mind.

4. **What the plan has missed entirely.** Especially: anything about the ~93 other Postgres test
   files that Stage B would silently redirect. The plan assumes zero of them need editing because
   they all read process.env.DATABASE_URL. Is that assumption safe, and how would I find out cheaply
   rather than by running the suite and reading a hundred reds?

5. **Stage ordering and stopping points.** Does each stage end somewhere the tree is safe to commit
   and deploy? Is Stage B too big for one stage?

6. **The dump-and-restore recipe.** `pg_dump -s -N spideryarn -N drizzle` from `postgres`, restored,
   then the real migrator. I ran exactly this and it worked (0 errors, 63 migrations applied). But
   is it right *in principle* — what does it carry that it should not (grants? event triggers?
   publications? RLS policies on auth/storage tables?), and what does it silently omit that a test
   might need? Note the plan does NOT use CREATE DATABASE ... TEMPLATE, because Supabase's services
   hold permanent sessions to `postgres` and Postgres refuses to clone a template in use.

7. **The claim that `DATABASE_URL=... npx vitest` silently does nothing.** I believe this because of
   src/env.ts's snapshot rule, and the plan makes every stage carry a positive control because of
   it. Verify the reasoning against the actual code; if I have it backwards the plan's traps are
   backwards too.

Be specific, name files and lines, and say which findings are certain versus speculative. If a
stage should be cut, split or reordered, say so.
