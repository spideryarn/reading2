# Second review of the same plan, revised

You reviewed this plan an hour ago and answered **not ready**. Your answer is at
`docs/plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep-review-sol.md`. The plan has
been rewritten around it: `docs/plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep.md`.

Repo root is the working directory. Read the files; run a test file if it helps.

Answer plainly and briefly. Lead with **ready to build** or **not ready**.

## What changed, and what I want checked

1. **The clock is now `finished_at desc nulls last, created_at desc, id desc`** within each kind,
   as you said. I verified your premise myself: `DEFAULT_JOB_CONCURRENCY = 3` in `src/jobs.ts`, and
   every terminal transition on both adapters stamps `finishedAt` — Postgres `finish` (~915),
   `settleExpired` (~1265), `requestCancel` (~1212), `releaseStep`'s cancelling branch (~1103);
   filesystem `finish` (~603), `releaseStep`'s cancelling branch (~579), and the two expiry paths
   (~231, ~288). **Check that list is complete** — a terminal path that does not stamp it would
   sort to the back of its kind under `nulls last` and be swept first, which is the same bug wearing
   a different hat.

2. **The tie-break test is now planned to change**, with a `stampFinished(id, iso)` helper added to
   the `Adapter` seam table in `tests/store-jobs-parity.test.ts` (~line 268) — Postgres by direct
   `update`, filesystem by a new `stampFinishedForTests` export beside the three `*ForTests` it
   already has. Is that the right shape, or is there a way to tie `finished_at` through the contract
   that I have missed? A seam is machinery and I would rather not add one.

3. **The trade against `0d42a484` is now stated** rather than denied, and the partition is described
   as "not a success" including cancellations.

4. **The client half's reasoning is corrected** — "always pollable" is gone, your fence design is
   recorded for whoever builds it, and the plan now says the hole remains and only the trigger is
   removed.

5. **The stale-wording list is widened** to the five places you named plus `ingest-queue.md:1436`.

## The questions

- Does anything in the revision still overclaim or misstate this codebase?
- Is the Postgres statement in Stage 1 correct as written, including the `is_done` alias and the
  outer `order by rank, is_done`? Watch for the `nulls last` interacting with `desc` the wrong way.
- **Do the two planned red cases actually go red against the current code, and green after?** Case 2
  in particular — several successes created after a job but finished before it — is the one that
  distinguishes the two clocks, and I want it to be a real discriminator rather than a test that
  happens to pass either way.
- Is `keep` ever 0 or 1 in practice, and does the interleave behave sanely there?
- Anything in Stage 2 or Stage 3 you would reorder or drop.

## House rules that bind the answer

- Simplest version first; fewer moving parts, not more.
- A test that was never red proves nothing.
- Both store adapters must agree — `tests/store-jobs-parity.test.ts` is the contract.
