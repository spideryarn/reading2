## Findings

### F1 — P1: only partially answered; an older-base dedupe still loses regeneration

Moving successor creation into publication fixes the normal ordering problem, but the plan assumes every identical pre-reset job must already have finished ([plan:74](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:74)). The existing helper explicitly disproves that assumption:

- `enqueueSuccessorIn` may find an active matching job whose `draftRevisionId` is non-null and return `boundToOlderBase`, without inserting another job ([pg-successor.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-successor.ts:170)).
- That holder cannot publish over the reset revision because the lineage guard rejects its older base ([pg-revisions.ts:2102](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:2102)).
- This is not hypothetical: the existing successor test constructs exactly that reachable state and confirms publication proceeds with no second successor ([publication-enqueues-the-labels-successor.test.ts:965](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/tests/publication-enqueues-the-labels-successor.test.ts:965), [publication-enqueues-the-labels-successor.test.ts:1027](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/tests/publication-enqueues-the-labels-successor.test.ts:1027)).

For regeneration, that leaves the requested extra absent. The proposed test covers only a queued holder ([plan:211](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:211)); it must also cover a matching active holder with an older-base draft.

A reset-scoped successor work key, or an explicit replacement queued when `boundToOlderBase` occurs, is still required.

### F2 — adequately answered

The route now resolves one profile snapshot, persists it with the reset, and passes it to successors. Supplying that profile to both `jobs.profile` and `workKeyFor` is compatible with dedupe: profiles already participate in the canonical work key ([store/jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/jobs.ts:81)), and `activeHolder` looks up that exact key ([pg-successor.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-successor.ts:249)).

Minor wording: this preserves the current reader/profile snapshot at the press, not necessarily the historical profile under which the originals were generated.

### F3 — adequately answered

The revision now states the boundary explicitly, preserves reader-requested rows, explains their freshness behaviour, and exposes the choice as assumption 8. That resolves the earlier contract ambiguity.

Prose correction: the covered list contains twelve artefacts, not eleven—`arc` plus eleven others ([plan:112](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:112)).

### F4 — adequately answered

The revised cost section correctly distinguishes stored document bytes from re-fetched assets, identifies the PDF front-matter call, describes checkpoint replay probabilistically, and separates quota use from provider spend.

### F5 — adequately answered

The revision now compares the actual two-job alternative and names the genuine trade-off: shared caching/all-or-nothing publication versus independent landing and failure. The chosen separate-job design has a new correctness problem below, but it answers the original F5.

### F6 — P1: “queue them in order” does not preserve `sketch → illustrated`

All successors are inserted inside one transaction, omitting `createdAt` ([pg-successor.ts:147](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-successor.ts:147)). The database default is `now()` ([schema.ts:121](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/db/schema.ts:121)), which is transaction-start time and remains fixed throughout the transaction ([job-fence.ts:26](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/job-fence.ts:26)). Therefore all N successors receive the same timestamp.

The queue breaks ties by random job id, ordering claims on `(created_at, id)` ([pg-jobs.ts:725](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-jobs.ts:725)). Calling `enqueueSuccessorIn` in `STEP_ORDER` does not make them run in that order.

If both Sketch and Illustrated existed, Illustrated can claim first. It expressly refuses when Sketch is absent ([pipeline.ts:3790](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:3790), [pipeline.ts:3869](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:3869)). Sketch may then succeed, but Illustrated remains failed, contradicting “regenerate.”

Chain Illustrated from successful Sketch publication, put those two in one successor job, or introduce a real successor dependency/order. Add a test where their IDs sort in the adverse order.

### F7 — P2: the plan has not specified how revision code obtains `jobs.reset`

Neither draft creation nor publication currently receives the job row:

- `BeginRevisionOptions.job` carries only `id` and `attemptId` ([pg-revisions.ts:875](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:875)).
- `PublishRevisionOptions.job` has the same narrow shape ([pg-revisions.ts:1871](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:1871)).
- `claimSession` deliberately strips the full `Job` down to those two fields ([jobs.ts:1975](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:1975)).

The plan needs to name the seam: either read the immutable `reset` column from the fenced job row in both transactions, or carry it through the session/draft reference and publication options. It should also define how the existing singular `PublishRevisionResult.successor` represents the labels outcome plus N regeneration outcomes.

## Retry and duplicate-publication check

There is no ordinary path where one successful reset publishes twice:

- Publication, successor insertion, and terminal job settlement occur in one transaction ([pg-session.ts:439](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-session.ts:439)).
- A lease requeue keeps the same row and draft.
- `retryJob` accepts only `error` or `cancelled` jobs ([jobs.ts:4051](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:4051)); a successfully published job is `done`.
- If publication or any successor insertion rolls back, none of them survives.

The plan correctly requires `reset` to be copied by `retryJob`; that remains essential.

**Verdict: refuse — F1 remains P1, and F6 is a new P1. F2–F5 are adequately answered; F7 is a design gap to close.**