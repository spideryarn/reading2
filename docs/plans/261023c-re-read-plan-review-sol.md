The current driver should not be run unchanged. The intended refresh is sound, but the implementation has two blocking gaps.

1. **Blocker — it bypasses the shelf’s stored-source safety gate.**

   Evidence: the shelf permits an uploaded-PDF refresh only when there is no fetchable web URL and `sourceReusable === true` ([ShelfEntry.tsx:728](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/web/ShelfEntry.tsx:728)). That value requires both a raw-source reference and a completed fetch run ([pg.ts:3133](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg.ts:3133)). The driver checks only ownership, revision, block count and extraction method ([driver:45](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:45)).

   Fix: immediately before enqueueing, prove the article has no fetchable web URL and satisfies the exact `sourceReusable` predicate. Abort otherwise.

2. **Blocker — successor selection and ordering are unsafe.**

   Evidence: `queuedAt` is recorded but never used; the query selects every queued job for the article and orders by random `id` ([driver:84](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:84), [driver:92](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:92)). Publication deliberately stamps `matter` before `labels` ([pg-revisions.ts:2630](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:2630)), while job claims enforce `(created_at, id)` order ([pg-jobs.ts:790](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-jobs.ts:790)). If labels sorts first, the driver waits on it while the undriven matter predecessor blocks it, eventually timing out. It can also drive an unrelated queued labels/matter job. Finally, successor failures are ignored, so the script can exit successfully after an error ([driver:103](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:103)).

   Fix: snapshot existing job IDs before enqueueing, identify only newly created successors, reject unexpected shapes, and drive them in `created_at, id` order. Include `queued` and `running` successors so browser-claimed work is awaited, and require every expected successor to finish `done`.

3. **Should-fix — it is not exactly the route because it omits Greg’s profile.**

   Evidence: the API resolves Greg’s global profile plus article purpose and passes it to `enqueue` ([routes.ts:14132](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/routes.ts:14132)). Profile participates in the job work key ([jobs.ts:3953](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/jobs.ts:3953)); the driver omits it ([driver:82](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:82)).

   The default refresh steps probably produce the same output without it, but a simultaneous browser Refresh can become a second forced reread instead of joining the same job.

   Fix: resolve and freeze the same rendered profile as the route. `pump:false` is an intentional and reasonable difference because this process drives the job itself.

4. **Should-fix — the concurrency preflight does not enforce anything.**

   Evidence: the live-job query merely prints its answer ([driver:54](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:54)). It also excludes nonexistent status `failed`; the actual terminal status is `error` ([schema.ts:3264](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/db/schema.ts:3264)). Consequently, historical errors look live, while real live jobs do not stop execution. The earlier dry run does not protect the later `--go` invocation.

   Fix: immediately before enqueueing, abort on any `queued` or `running` job. Claims make concurrent attempts to advance the same job safe ([jobs.ts:2818](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/jobs.ts:2818)), and publication lineage prevents one concurrent draft from burying another ([pg-revisions.ts:2424](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:2424)). The remaining risk is duplicate work and cost, particularly because of the profile mismatch above.

5. **Should-fix — environment pinning protects the main targets, but not the whole execution environment.**

   Evidence: importing `env.ts` first and then assigning `.env.prod` is correct ([driver:20](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-refresh-prod-driver.ts.txt:20)); pinned names cannot be replaced by `.env.local` ([env.ts:359](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/env.ts:359)). Importing the store normally rejects missing storage credentials and mismatched database/storage projects ([store/index.ts:212](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/index.ts:212), [blobs.ts:309](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/blobs.ts:309)). Therefore, under an ordinary shell, the driver will not silently use the local database, filesystem storage, or a different Supabase project.

   However, inherited variables absent from both env files remain. `VITEST` or `NODE_ENV=test` disables the store-pair boot check; `SPIDERYARN_PIPELINE_EFFORT` changes paid calls ([models.ts:2009](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/models.ts:2009)); `SPIDERYARN_JOB_CONCURRENCY` changes queue behaviour ([jobs.ts:542](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/jobs.ts:542)); and model-override variables can affect front-matter work ([models.ts:1786](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/models.ts:1786)).

   Fix: run from a clean, allowlisted environment built from `.env.prod`, explicitly set production mode, and reject `VITEST`, pipeline-effort, concurrency and model overrides unless deliberately included. Keep the explicit database/storage project-pair check enabled.

6. **Should-fix — “under a dollar” and the stated stop rule are not established.**

   Evidence: every step reads the article’s current High-powered AI setting ([jobs.ts:2694](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/jobs.ts:2694)); structure and labels are capable-tier tasks ([models.ts:1267](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/models.ts:1267)). The driver does not read `high_power_since`, so its quoted $0.25 + $0.45 figures may be using the wrong model.

   Also, “OpenRouter charged $0” is not necessarily “the call cost $0”: BYOK cost lives in `byok_upstream_nanos` ([ai-calls.ts:94](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/ai-calls.ts:94)). Measured PDF-reader runs have cost $0.49–$0.63 for 79–83 calls ([pdf-read.ts:271](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/pdf-read.ts:271)). Those measurements are not a direct estimate for this 36-chunk reread, but they show why a credits-only zero is insufficient.

   Finally, the driver never prints cost, so the plan’s instruction to stop if output exceeds $1 cannot happen. One `advanceJob` call may walk several steps ([jobs.ts:2368](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/jobs.ts:2368)), so it is not a hard pre-spend cap either.

   Fix: preflight `high_power_since`; re-estimate or abort if enabled. Snapshot the ledger before enqueueing and report credits, BYOK upstream, computed cost and unpriced calls for the main and successor job IDs. Describe $1 as an estimate unless the driver is changed to stop between paid stages.

7. **Note — the refresh does not directly delete Greg’s comments, notes or reading-time rows.**

   Evidence: the new draft copies the current revision’s blocks and step runs ([pg-revisions.ts:1238](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:1238)). Comments reference permanent block identities ([schema.ts:2827](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/db/schema.ts:2827)), and reading time uses the same never-deleted identities ([schema.ts:5856](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/db/schema.ts:5856)). If a block disappears from the new revision, those reader-owned rows remain; their anchors merely cease to be current.

   No fix is required for physical row preservation, but the verification should distinguish “row was lost” from “its block is no longer in the current revision.”

8. **Should-fix — partial block-ID and reading-position loss remain possible.**

   Evidence: `assertIdsCarried` succeeds as soon as one old ID survives; partial losses are deliberately allowed ([blocks.ts:2058](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/blocks.ts:2058)). The block-ID documentation specifically records model-driven PDF rereads reminting IDs and says an edited paragraph loses its anchor ([block-ids.md:304](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/project/block-ids.md:304), [block-ids.md:317](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/project/block-ids.md:317)).

   Greg’s last reading position is not in the database: it is a per-browser `localStorage` copy containing a paragraph ID ([last-view.ts:16](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/web/last-view.ts:16), [last-view.ts:437](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/web/last-view.ts:437)). The driver cannot verify it from production SQL.

   Fix: enumerate all carried, changed, minted and dropped IDs; require every textually unchanged block to retain its ID. Compare full comment and reading-time rows, not just anchor existence. Record Greg’s current/saved `?at=` block from his browser before the run and verify it remains current, or explicitly accept that residual risk.

9. **Note — driving matter and labels from this process is conceptually right after fixing selection and ordering.**

   Evidence: a publication that cut blocks may enqueue matter, and a publication with pending labels enqueues labels ([pg-revisions.ts:2611](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:2611), [pg-revisions.ts:2658](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:2658)). Production has no autonomous Vercel worker; an open browser normally advances jobs ([jobEngine.ts:1](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/web/jobEngine.ts:1)). A refresh correctly does not meet the first-import or stand-in conditions for regenerating the main modes ([pg-revisions.ts:2751](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/src/store/pg-revisions.ts:2751)).

   Fix: drive only the exact newly created matter and labels successors, matter first, and verify both terminal states.

10. **Should-fix — expand the post-run verification.**

   Evidence: the current list checks important passages and anchors but not execution provenance or job settlement ([plan:63](/var/tmp/spideryarn-worktrees/fbj4zg9m-reread-order-of-time/docs/plans/261023c-re-read-the-order-of-time-from-its-pdf-in-production.md:63)).

   Add checks that:

   - The raw-source SHA/kind is unchanged and `fetch` skipped.
   - The new revision is based on the captured old revision and is now current.
   - Exactly `extract`, `blocks`, `structure` and `assets` reran.
   - Matter and labels both finished `done` and are current for the new blocks.
   - No unexpected main-mode or other jobs were queued.
   - Full comment/note and reading-time rows are byte-for-byte/value-for-value unchanged.
   - Carried, minted and dropped block IDs are listed.
   - All expected figure locations are checked, rather than one example plus an approximate count.
   - Ledger cost includes every cost pocket and identifies unpriced calls.
   - No queued/running jobs remain for the article.

**Verdict: DO NOT RUN.** This verdict applies to the current driver copy. The underlying one-off refresh is reasonable once the two blockers and the should-fix items above are addressed.