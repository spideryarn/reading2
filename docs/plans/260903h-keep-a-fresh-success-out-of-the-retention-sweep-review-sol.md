**Not ready.**

1. The load-bearing claim is false. `created_at` records when a job was queued, not when it finished. With concurrency three and per-article queues, an older, slow job can finish after many newer jobs. It can therefore be rank 26 among successes and be deleted immediately despite having just ended. The proposed 50-failures-plus-one-success test misses this because there is only one success.

   Use `finished_at DESC NULLS LAST, created_at DESC, id DESC`. Nullable is not a blocker: active jobs account for the nullability, while every normal terminal transition stamps `finishedAt`; `NULLS LAST` handles legacy or malformed terminal rows conservatively. Add a red parity case where an older-created job finishes after newer-created jobs.

2. Both existing parity assertions do pass the proposed `created_at` interleave by hand:

   - The oldest failure and newest success survive the first case.
   - With all successes, the two highest IDs survive the timestamp tie case.

   But that is evidence for the wrong clock. After switching to `finished_at`, the second test cannot stay unchanged: it deliberately finishes the jobs in reverse ID order. Its fixture must tie `finishedAt`, not merely `createdAt`. The plan’s “[if either needs changing, the rule is wrong]” condition should be removed. See [store-jobs-parity.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/tests/store-jobs-parity.test.ts:1658).

3. Interleaving is a defensible simple compromise, but it does weaken `0d42a484` materially. With both kinds abundant, the reader retains 25 failures rather than 50. Also, the SQL’s “failure” partition includes cancellations—really it is the non-success partition. The old test’s specific protection survives, but the old absolute preference does not. The plan should state that trade explicitly rather than claim it preserves the documented intent unchanged.

4. The PostgreSQL shape is sound as one statement, and two concurrent ending-time trims do not need a lock. Each statement sees a consistent snapshot; overlapping deletions merely make one returned count smaller. Ensure the ranked subquery projects an `is_done` alias so the outer `ORDER BY kind_rank, is_done` can reference it. The returned count has no production reader: [noteEnded](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/jobs.ts:1137) discards it; only tests assert it.

5. Deferring the full client fix is fair under “simplest version first,” but the stated reason overclaims. Alternation makes a terminal row likely to remain visible; it does not make it “always pollable.” Enough later completions can still evict it, and timestamp ties prevent a strict rank-1 guarantee. The 404 change stops useless traffic but would still leave `useStepJob`’s starting state stuck if disappearance recurred.

   If the class is closed later, the fence should be a monotonically numbered poll-start sequence: record the current sequence when the POST returns, and infer “gone” only from a successful list request that started after that sequence and lacks the exact returned ID. Keep tracking the receipt after first seeing it active; [useStepJob currently clears it immediately](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/web/useStepJob.ts:408).

6. Stale wording is broader than `docs/project/*`: update the shared store contract, `KEEP_FINISHED`, `AddArticle`, `tests/add-article-history.test.ts`, the parity test title/comments, and [ingest-queue.md](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/docs/project/ingest-queue.md:1436). There are no other `trimFinished` callers.