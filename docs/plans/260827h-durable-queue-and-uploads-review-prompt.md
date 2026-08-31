# Review this plan before it is built

You are reviewing a **design plan**, not code. It is
`docs/plans/260827h-durable-queue-and-uploads.md` in this repository. Read it first, then read the code it
describes. Everything is on disk; nothing is pasted below.

## What the plan proposes, in one line

Move the ingest job record and the PDF upload record out of one process's memory and local disk into
Postgres, behind a store seam with two adapters, and fence every write a claimant makes with an
attempt token — so that the already-built browser-driven advance endpoint (`POST /api/jobs/:id/advance`)
actually works across serverless invocations, and PDF uploads stop refusing themselves on Vercel.

## Read these, in this order

1. `docs/plans/260827h-durable-queue-and-uploads.md` — the plan under review
2. `docs/plans/260826q-job-queue-rethink.md` — the design decision this implements, and the three things it
   says must survive from the design it replaced
3. `docs/plans/260826e-postgres-storage-implementation.md` § "Step 12 — jobs and claiming" — the superseded
   autonomous-worker design, kept for its fencing reasoning. Note that its own first pass had three
   critical faults found by a previous review, including dropping `status = 'running'` from a fence.
4. `src/jobs.ts` — today's queue: an in-memory `Map`, p-queue at concurrency 1, JSON files under
   `data/_jobs/`, and `advanceJob` (already built, already reachable at the route above)
5. `src/upload-records.ts` — today's upload record, filesystem, with `recordsSurviveTheRequest()`
6. `src/db/schema.ts` — the `jobs` table (fully specified, entirely unused) and `queue_state`
7. `src/store/contracts.ts` — the declared-and-unimplemented `JobStore`
8. `src/store/artifacts.ts` — `beginStep` / `finishStep`, which already fence an artefact write by attempt
9. `src/pipeline.ts` — `stepIsDone`, `assertProduced`, `STEPS`
10. `src/store/index.ts`, `src/store/live.ts` — how the two adapters are selected
11. `src/routes.ts` — the jobs and uploads routes
12. `docs/project/deployment.md`, `docs/project/ingest-queue.md`

## Context you need in order to judge it

- **One user.** This is a single-reader beta behind an email gate. Concurrency 1 is deliberate.
- **Vercel.** No long-lived process, functions capped at 300s in `vercel.json`, no `waitUntil`
  anywhere in the repo, ephemeral filesystem.
- **Supabase Postgres** through the transaction pooler, connecting as an ordinary login role
  (`spideryarn_app`), not as a Supabase user with a JWT. RLS is inert on that connection — already
  argued out; do not re-litigate it.
- **The migration situation.** Several agents share `src/db/schema.ts`; `drizzle-kit generate` diffs
  the whole schema against the last snapshot, so an unrelated in-flight column gets swept in. Latest
  migration on disk is `drizzle/0013_ideas.sql`.
- Steps 10 and 11 of the Postgres migration are largely built; step 13 (cutover) is not.

## What I want from you

Findings, most severe first. For each: what is wrong, the file and line, why it follows, a concrete
reproduction where one exists, and your confidence. Then a verdict.

Please concentrate on these, which are where I think this plan is most likely to be wrong:

1. **The fence.** Is `where id = $id and attempt_id = $attempt and status = 'running'` sufficient for
   every write a claimant makes? Is there a write in the built pipeline — artefacts, revisions, the
   draft, the shelf — that a stale claimant can still make and that this plan does not fence? The
   plan claims the artefact store's own attempt marker covers that half; check whether it actually
   does, including for the stage CLIs.

2. **Stealing an expired lease.** The plan takes over a `running` row whose `lease_expires_at` has
   passed, rather than marking it failed, and argues this is safe because nothing here is unattended.
   Is that argument sound? What breaks if the old claimant is merely slow rather than dead?

3. **The lease number.** Set once at claim to `now() + leaseMs`, never extended, justified as
   "longer than `maxDuration`, so a living claimant cannot outlive it". Does that hold locally, where
   nothing kills a step? Open question 2 in the plan.

4. **`jobs_only_one_running`.** The plan leans on the existing partial unique index for global
   concurrency 1 and deletes `queue_state`. It catches `23505` from a claim and reports `busy`.
   Is that a correct and complete substitute? What does it do to a second job that is queued behind
   a first — does it ever start, and who makes it start?

5. **§5, the p-queue.** The plan keeps a local step-loop as a second caller of the same
   `runOneStep` primitive, which is a deliberate departure from `260826q-job-queue-rethink.md`'s rejection of
   "browser drives while open, server picks up when it is not". Is that departure justified by the
   lease and fence now existing anyway, or is it the trap the rethink named?

6. **The uploads table and its claim.** Is the conditional `UPDATE … where status = 'pending'` really
   equivalent to the filesystem `wx` marker it replaces? Is anything lost in the move — the sweep,
   the grace window, the ownership check, the never-delete-the-staging-object rule?

7. **Migration and typing.** The two new columns on `jobs` (`upload_id`, `upload_filename`,
   `failure_kind`) and the new `uploads` table: are the types, constraints, FK actions and nullability
   right? Is anything on the `Job` or `UploadRecord` TypeScript types that has no column, or a column
   with no field?

8. **What the plan does not mention at all.** That is the most useful category. Retention, the
   `example` fixture, `retryJob`, `forgetJob`, `prune`, the shelf's own job lookups, `sweepStopped`,
   the CLI stage runners, tests that will break.

Be blunt. If the plan is wrong in shape rather than in detail, say so and say what shape it should be.
Do not soften a critical finding into a suggestion. If something in it is already right, say that
briefly rather than inventing an objection.

Do not edit any files. This is read-only review.
