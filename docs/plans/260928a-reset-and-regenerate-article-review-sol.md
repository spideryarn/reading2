I would refuse this plan as written. The core draft/reset mechanism is sound, but the queue does not guarantee that regeneration happens after reset.

## Findings

### F1 — P1: regeneration jobs are not causally ordered after the reset

The plan relies on sequential calls to `enqueue` creating a reset followed by extras ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:52)). The queue explicitly promises deterministic `(created_at, id)` order, not FIFO: timestamps have millisecond resolution and IDs are random within a tie ([src/store/jobs.ts:547](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/jobs.ts:547)). Therefore an extra created in the same millisecond can run before the reset and then be erased by it.

There is a more readily reachable failure through deduplication:

1. A `quotes` job is already queued or running.
2. The reader chooses reset + regenerate.
3. The reset queues behind that job.
4. Enqueuing the post-reset `quotes` job uses the ordinary work key, which contains steps, force, profile, upload and URL—but no reset generation or base revision ([src/store/jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/jobs.ts:81)).
5. `jobs_active_work` deduplicates it onto the pre-reset job ([src/db/schema.ts:2176](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/db/schema.ts:2176)), and `enqueue` returns that existing job ([src/jobs.ts:3224](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:3224)).
6. The pre-reset job publishes; reset then removes quotes; no post-reset job remains.

The final state contradicts `regenerate: true`.

The plan needs an explicit dependency or generation token. The cleanest version is to record the regeneration plan on the reset job and enqueue its successors only after the reset publishes successfully. At minimum, regeneration work keys must be scoped to the reset ID and claims must enforce that dependency; timestamps are insufficient. Tests need an already-active identical extra and deliberately equal timestamps.

### F2 — P1: regenerated profile-sensitive artefacts will use no reader profile

The normal `POST /api/jobs` route resolves the current reader/article profile by default and passes it into `enqueue` ([src/routes.ts:8724](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/routes.ts:8724)). The proposed reset route calls `enqueue` directly but never says to resolve or pass a profile.

`enqueue` only stores a profile supplied by its caller ([src/jobs.ts:3164](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:3164)). This materially changes regenerated output: ideas’ definition of “assumed” depends on the profile and its stamp includes the profile hash ([src/pipeline.ts:3284](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:3284)); sketch likewise treats the profile as part of the question ([src/pipeline.ts:3710](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:3710)). Tweets, glossary and quotes also receive it.

Resolve the profile once when accepting the reset and pass that same snapshot to every regeneration successor. Add a profiled ideas/sketch test.

### F3 — P1: “extras gone” covers only revision columns, not all generated article artefacts

The reset clears only artefact columns and `revision_step_runs` belonging to `StepName`s ([plan:63](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:63)). Generated article state also exists outside revisions:

- `referee_claims` is explicitly described as an article-derived reusable artefact whose eventual home should be a pipeline artefact ([src/db/schema.ts:1462](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/db/schema.ts:1462)). It is keyed only by article and will remain after reset.
- Saved semantic searches retain generated `hits` and a source hash ([src/db/schema.ts:3276](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/db/schema.ts:3276)).
- Referee criteria combine reader-written criteria with generated, block-anchored results ([src/db/schema.ts:1372](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/db/schema.ts:1372)).

On an unchanged re-extraction, block IDs/text—and therefore source hashes—remain the same, so these outputs can continue appearing current. That is not equivalent to a fresh import “with the extras gone.”

The plan must make the scope explicit. Pure generated state such as referee claims can be cleared. Hybrid rows need their reader-authored portion preserved while deciding whether generated results are cleared, retained, or regenerated. Chat and comment histories should remain intact.

### F4 — P1: the cost and stored-copy claims are inaccurate

The plan says an unchanged forced re-read costs nothing and returns the same text ([plan:45](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:45)). That is false for PDFs:

- Every PDF extraction constructs the OpenRouter front-matter reader ([src/pipeline.ts:2093](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:2093)).
- That pass is deliberately not checkpointed and is re-bought on retry/re-extraction ([src/pdf-read.ts:1945](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pdf-read.ts:1945)).
- Its result decides which records are hidden and can change the title and resulting article text ([src/pdf-read.ts:2761](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pdf-read.ts:2761)).

The reverse claim about labels is also wrong: forced labels runs replay retained batch checkpoints, and two measured unchanged forced runs bought calls and then none ([src/labels.ts:23](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/labels.ts:23)). Labels are queued again, but are not “always re-bought.”

Forced `assets` also re-fetches the live image URLs from the stored HTML ([src/collect-assets.ts:1028](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/collect-assets.ts:1028)), so “stored copy” applies to the document, not necessarily its images. `illustrated` can make a brief call plus an image call per plate, rather than one call ([src/pipeline.ts:479](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:479)).

The reset does not consume a billing quota slot—bare-slug reruns are expressly free ([src/billing/admission.ts:8](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/billing/admission.ts:8))—but it can spend provider money. The confirmation and cost section need correcting.

### F5 — P2: the rejected simpler design conflates two different designs

The plan rejects “one job with every extra” because a failure would discard the reset ([plan:188](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/plans/260928a-reset-and-regenerate-article.md:188)). That is true of one combined reset-and-extras job, but not of:

1. one reset job; then
2. one separate multi-step regeneration job.

A failure in job 2 would leave the already-published reset intact. It would also preserve the intended shared prompt-cache groups that only work among steps in the same job ([src/step-order.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/step-order.ts:77), [src/step-order.ts:87](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/step-order.ts:87)).

The trade-off is fault isolation: a multi-step regeneration failure publishes none of its extras, while separate jobs retain earlier successes. The plan should compare that real trade-off rather than rejecting the two-job design for a failure mode it does not have.

## Mechanics that do check out

- A forced `extract` does not force `fetch`: `cascadeForce` starts at the first named forced step ([src/jobs.ts:810](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:810)). The carried fetch artefact/run therefore skips, and extract reads the stored raw manifest and content-addressed bytes ([src/pipeline.ts:1889](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:1889)). This works for URL documents and uploaded PDFs.
- Drafts copy columns, blocks and step runs before any pipeline step runs ([src/store/pg-revisions.ts:1004](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:1004), [src/store/pg-revisions.ts:1035](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:1035)). Nulling immediately after that copy is sound.
- Lease recovery reopens the same draft without copying anything back ([src/store/pg-revisions.ts:1230](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:1230)). An unusable draft mints afresh; a retry mints a new draft, so carrying `resets` through retry is necessary and sufficient.
- After a successful reset, an unforced extra will run: `stepIsDone` returns false when its artefact/run is absent ([src/pipeline.ts:1029](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:1029)). If reset fails, it sees the old published artefact and skips. This works once F1 establishes the correct ordering.
- Block-ID preservation follows the existing contract: carried draft blocks are the baseline used by `previousBlocksFrom` ([src/pipeline.ts:2191](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/pipeline.ts:2191), [block-ids.md:73](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/project/block-ids.md:73)). Comments and reading time remain article/identity-scoped. The stated maths detachment caveat is real.
- Forced hierarchy writes pending labels and removes the carried labels receipt ([src/store/artifacts-pg.ts:1452](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/artifacts-pg.ts:1452)); publication atomically enqueues the labels successor ([src/store/pg-revisions.ts:2177](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-revisions.ts:2177)). Removing extra columns does not itself trip `reasonsNotToPublish`.

**Verdict: refuse — F1, F2, F3, F4, F5.**