# Not ready.

The load-bearing rejection is wrong, the “not wired” census is incomplete, and work from the unreviewed plan has already landed.

## Blocking findings

1. **`streaming` is not adequately protected by its durable store fence.**

   The store’s attempt token prevents a stale request from overwriting durable state. It does not preserve cancellation or stop duplicate paid work.

   - Stop, retry, edit, and settle depend on the process-local `streaming` map to find and await the active request: [src/routes.ts:1880](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:1880), [src/routes.ts:2516](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:2516), [src/routes.ts:2615](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:2615).
   - Module re-evaluation leaves the old request running: [src/process-state.ts:24](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/process-state.ts:24).
   - The new module receives an empty `streaming` map, so it cannot abort or await that request.

   `streaming` therefore needs `processSingleton` or equivalent preservation. Calling it clean leaves a real cancellation and money bug.

2. **The other four “protected” registries are only clean under PostgreSQL semantics.**

   The filesystem implementations do not consistently implement the durable grace half:

   - Comment answering immediately rejects pending work absent from `keep`: [src/comments.ts:695](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/comments.ts:695).
   - Search immediately sweeps absent entries: [src/store/fs.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/fs.ts:456).
   - Referee criteria does likewise: [src/store/fs.ts:512](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/fs.ts:512).
   - Claims receives only a boolean “live” flag and immediately errors otherwise: [src/referee-claims-store.ts:160](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/referee-claims-store.ts:160).

   The plan’s `pullingClaims` description is also factually inaccurate: its route does not pass `SweepOptions`; it passes a boolean at [src/routes.ts:7019](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:7019). PostgreSQL applies its cutoff internally at [src/store/pg-referee-claims.ts:242](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/pg-referee-claims.ts:242).

   These may reasonably be deferred behind the database migration, but they are not “not defects at all.”

3. **The sweep missed the filesystem answering fence that actually matters.**

   `src/comments.ts` has its own module-scoped `begun` set at [src/comments.ts:371](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/comments.ts:371). `beginAnswer()` relies on it to prevent reclaiming a pending answer and starting another paid call: [src/comments.ts:399](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/comments.ts:399).

   Its comment assumes a restart means no old work remains, but Vite module replacement is not a process restart. Preserving only `routes.ts`’s `answering` set would not repair this fence.

4. **`turnOrder` does need preservation, and preserving its promises is correct.**

   A module reload does not kill the old module’s request or closures. The old request will still settle the promise held in a process-wide map. Only a full process restart destroys both the promise and the global state.

   However, the plan overstates that the tail “always settles.” At [src/routes.ts:1790](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:1790), the tail absorbs fulfillment and rejection, but it remains pending if `fn` remains pending. That is proper lock behaviour, not a dead promise caused by module replacement.

5. **T2.2’s census missed two stronger paid-work registries.**

   - Similar-block embedding coalescing explicitly exists so concurrent readers do not buy duplicate calls: [src/similar.ts:183](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/similar.ts:183), with the paid call at [src/similar.ts:294](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/similar.ts:294).
   - Article-vector generation has a module-scoped `INFLIGHT` map and per-module concurrency cap: [src/article-vectors.ts:186](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/article-vectors.ts:186), with paid embedding at [src/article-vectors.ts:302](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/article-vectors.ts:302).

   Module duplication defeats both coalescing and, for article vectors, the cap. Rejecting a generic “all mutated maps” meta-test remains sensible because it would be noisy, but the claimed census and rationale are not sound. A narrower inventory or rule for server-side `INFLIGHT`/`Map<…, Promise<…>>` state is warranted.

6. **T1.1 missed at least one live stale statement.**

   [src/store/db-errors.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/db-errors.ts:58) says the PostgreSQL chat store is not wired into the index. It is wired at [src/store/index.ts:230](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/index.ts:230), and it throws `ChatConflict` at [src/store/pg-chat.ts:471](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/pg-chat.ts:471).

   Therefore the minimum is **five false sites in four files**, not four in three.

   The claimed total of 43 is not auditable because the plan records no exact grep command or result set. Re-running the explicit alternatives shown in the plan produces materially different totals depending on scope. A quantified census needs its exact command.

   The billing statement should remain unchanged, and the review prompts should remain historical records.

7. **The declared Stage 1a/1b file lists are disjoint, but the staging is still invalid.**

   There is no explicit file overlap and no `tests/*` wildcard. That part passes.

   But:

   - “Prose only and cannot break a test” is false. Documentation links are tested, and even quoted source text has broken import-scanner tests before: [src/process-state.ts:17](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/process-state.ts:17).
   - The proposed `testing.md` change adds normative instructions. Important project-doc rules require before/after approval; unattended execution means it must be deferred.
   - During this review, commits `5a5d9645`, `b939989f`, and `a3d5f310` landed portions of T1.1, T1.2, T1.4, T1.5, and T1.6 before the plan-review gate. The plan’s progress table and future-stage descriptions no longer match the tree.

## T1.3 is correct

Do not scope the advance-path `settleExpired()` call to the current owner.

The global concurrency claim locks `queue_state` and counts every running row: [src/store/pg-jobs.ts:768](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/pg-jobs.ts:768), [src/store/pg-jobs.ts:830](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/pg-jobs.ts:830). Owner filtering is applied during settlement at [src/store/pg-jobs.ts:940](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/store/pg-jobs.ts:940).

The only production doors are the global advance path and owner-scoped `listJobs`. If the former becomes owner-scoped, an owner who never returns leaves its expired running job consuming a global slot indefinitely. The cheap scoping fix is unsafe.

## Other corrections

- Deferring the five `httpError` copies is reasonable. Their implementations have not drifted, and extraction would create a new one-function module and another public import boundary.
- T1.4 and T1.6 are **proved from code/history**, not reproduced bugs. The first sweep explicitly distinguished grep/history evidence from reproduction.
- The prior-plan correction saying all seven SSE streams emit an explicit terminal frame is too strong. Search and both referee streams deliberately omit it in some paths: [src/routes.ts:3452](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:3452), [src/routes.ts:3698](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:3698), [src/routes.ts:3832](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:3832).
- The `sse()` comment is itself stale: it says only chat and comments use it, despite six callers: [src/routes.ts:947](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/src/routes.ts:947).
- The deferred CSS quantifier is stale. On the plan’s stated baseline, `src/web/styles.css` is 12,898 lines, not 12,830.

The plan needs a revised T2.1/T2.2 census, a repaired T1.1 count, corrected evidence labels, and staging reconciled with what has already landed before further construction.