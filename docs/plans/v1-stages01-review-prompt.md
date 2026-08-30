# Review request: built code for stages 0 and 1 of the v1 ingest plan

Review **built and committed code**, not a plan. You reviewed the plan and returned NO-SHIP; the plan
was re-cut around your findings and is at `docs/plans/v1-imports-on-vercel.md`. Your plan review is at
`docs/plans/v1-imports-review-sol.md`. This is the first two stages of the re-cut plan.

Weight this higher than a plan review: a plan-stage review cannot find a guard that is written but
never reached.

The scoped diff is at
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/ea28dc64-f00c-4081-a3f9-9bfa822443c5/scratchpad/stages01.diff`
(commits `f3db91e` and `0fdd2fe`). Read the diff **and** the surrounding code — the diff alone will
not show you the callers.

## Stage 0 — the time budget (`f3db91e`)

`LEASE_MS` 240s → 420s, `DEADLINE_MARGIN_MS` unchanged at 20s (so the per-step self-abort moves
220s → 400s), and `vercel.json` `maxDuration` 300 → 800. Plus `tests/jobs-lease-budget.test.ts`.

Motivation: measured per-article step totals from `data/_ai-calls.jsonl` are `toc` 324.0s over three
calls and `summarise` 240.3s over ten, both over the old 220s deadline — so a long step could not
complete through the job path on **any** machine, only via the lease-free CLI.

The invariant, caught in review before it shipped, is that raising `LEASE_MS` alone moves the
self-abort past the platform kill so it never fires. The test pins
`LEASE_MS - DEADLINE_MARGIN_MS < maxDuration` rather than the values. Fluid Compute is confirmed
enabled on the project (`resourceConfig.fluid = true`).

## Stage 1 — one job-scoped writable root (`0fdd2fe`)

Two module-level constants derived from `import.meta.dirname` (`artifacts-fs.ts`, `import.ts`) are
replaced by `dataRoot()`, called at the point of use. New files `src/store/data-root.ts` and
`src/job-scope.ts`, plus `tests/data-root.test.ts`.

Resolution order: `SPIDERYARN_DATA_ROOT` → not deployed: repository root (found by walking up for
`package.json`) → deployed with a job in scope: `/tmp/spideryarn/<ownerId>/<jobId>` → deployed with no
job scope: **throw**.

Job-scoped rather than owner-scoped is your Critical 4 from the plan review.

## Answer these

1. **Does stage 1 actually work in the bundle?** The whole bug is that a path derived from a module's
   location is wrong once bundled. `findRepoRoot` walks up from `import.meta.dirname` for
   `package.json` — in the deployed bundle that finds `/var/task`. Confirm that branch is genuinely
   unreachable when deployed, and that nothing else in the ingest or publish path still derives a
   root of its own. I believe only these two files did; verify it rather than believe me.

2. **The `AsyncLocalStorage` job scope.** `src/job-scope.ts` is a sibling to `src/owner.ts`'s scope
   rather than a field on it. Is the nesting correct, does it survive the `await` boundaries the
   pipeline actually crosses, and is there any path where the job scope is lost mid-step so
   `dataRoot()` starts throwing (or, worse, silently answers differently) partway through a job?

3. **Is throwing right when deployed with no job scope?** It is currently reachable from any deployed
   request that touches `fsLocations` outside a job — `GET /api/source/:slug` (`routes.ts:243`) is one
   we know about. Does this turn a 404 into a 500, and is that an improvement or a regression? Are
   there other callers I have not seen?

4. **Stage 0's numbers.** 420s lease / 400s deadline / 800s `maxDuration`. Is the arithmetic right
   against the coming route-level budget check, which must reserve a whole deadline before starting a
   step? Does a 400s deadline leave the last short step of a long article unable to start?

5. **The test quality.** `tests/jobs-lease-budget.test.ts` and `tests/data-root.test.ts` — do they
   actually pin what they claim? Both were watched failing first, the lease one against the exact bad
   intermediate (lease raised, `maxDuration` not). Is either passing for a reason other than the one
   intended, and is there a mutation to the source each would not catch?

6. **What is now broken that was not.** Stage 1 removes the accidental cross-job warm cache. Name
   anything that silently depended on the old repository-root behaviour — CLI scripts, evals, tests,
   the exporter, `db:import` — and say whether it still works.

7. Anything else, ranked.

Verdict: SHIP / SHIP WITH CHANGES / NO-SHIP, findings ranked, criticals first, each citing file and
line and saying what to do instead.
