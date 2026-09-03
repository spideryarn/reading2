# Review this plan before it is built

You are reviewing a plan, not code. Repo root is the working directory. Read the files; run one test
file if it helps — a finding you reproduced outranks one you reasoned to.

Answer plainly and briefly. Lead with a verdict: **ready to build** or **not ready**, then the
findings that justify it, most important first. Say if a claim in the plan is factually wrong about
this codebase — that has happened twice on this feature already and both times it was load-bearing.

## What to read

1. The plan: `docs/plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep.md`
2. The postmortem it fixes:
   `docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md`
3. `src/store/pg-jobs.ts` § `trimFinished` (~line 1130)
4. `src/store/jobs-fs.ts` § `trimFinished` (~line 700)
5. `src/jobs.ts` § `KEEP_FINISHED` (~2795) and § `noteEnded` (~1110), the only caller
6. `src/web/jobEngine.ts` § `recordCompletions` (~436), § `step` and § `drive` (~560-610)
7. `src/web/useStepJob.ts` — the reconciliation effect at ~409 and `stalled` at ~540
8. `tests/store-jobs-parity.test.ts` — the two `trimFinished` cases at ~1658 and ~1690
9. `git show 0d42a484 -- src/store/pg-jobs.ts` — the commit that made the ordering deliberate

## The questions I actually want answered

1. **Is the interleave rule right?** It replaces an absolute preference for failures with an
   alternating one. Does it preserve what `0d42a484` was protecting? Is there a reader for whom it
   is worse in a way I have not noticed? I claim both existing parity cases pass unchanged under it
   — check that by hand, it is the plan's main evidence.

2. **Is "a just-finished job is rank 1 of its kind" actually true?** The ranking is by `created_at`,
   not `finished_at`, and jobs can finish out of the order they were created. I convinced myself the
   gap is unreachable in practice. `finished_at` is nullable in the schema, which is why I did not
   use it. Am I wrong, and if so is `finished_at desc nulls last` the better key?

3. **The Postgres statement.** Planned as
   `row_number() over (partition by (status = 'done') order by created_at desc, id desc)` in a
   subquery, then `order by rank, (status = 'done') offset $keep`, feeding a
   `delete ... where id in (...)`. Is that correct, and correct under concurrency — two endings
   trimming the same owner at once? The current version has the same shape and no lock.

4. **Am I right to drop most of the client fix?** The postmortem I wrote ranks *"a vanished job is a
   completion"* as the highest-value fix because it closes the class. The plan now says: after the
   retention fix there is no known trigger, and telling "not yet" from "gone" needs a poll-ordering
   fence that is real machinery on a path with eight callers. Is that a fair re-evaluation or am I
   talking myself out of the root cause? If you think it must be built, say what the fence should be.

5. **Anything the plan misses.** Other callers or tests that assume the old ordering; a doc that
   states the rule and would go stale; a place where the count `trimFinished` returns is read.

## House rules that bind the answer

- Simplest version first; fewer moving parts, not more. Adding machinery is a proposal, not a
  freebie.
- A test that was never red proves nothing.
- Both store adapters must agree — `tests/store-jobs-parity.test.ts` is the contract.
