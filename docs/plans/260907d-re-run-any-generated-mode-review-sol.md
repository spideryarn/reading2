## Verdict

**Refuse as written.** There are established P1 defects: the proposed request can cause multiple paid calls, Illustrated can replace a good artefact with a degraded one, and a hierarchy rerun currently removes labels without scheduling their replacement. No P0 found.

### F1 — P1 — established: one step is not one model call

(a) The plan equates membership in `FORCE_ONLY_WHEN_NAMED` with “one press, one model call” ([plan:70](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md:70)). The job runner explicitly says a step is not a model call ([jobs.ts:1002](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/jobs.ts:1002)).

- Debate normally makes two separately metered calls ([debate.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/debate.ts:35)).
- Illustrated makes one brief call ([illustrated.ts:895](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/illustrated.ts:895)) followed by one image call per plate ([illustrated.ts:1042](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/illustrated.ts:1042)).

`FORCE_ONLY_WHEN_NAMED` describes force-cascade semantics, not cost, runnable prerequisites, or replacement safety. Automatically adding every future member to the UI is therefore unsafe. A direct client import of `pipeline.ts` would also violate the enforced client/server boundary ([client-imports.test.ts:2](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/tests/client-imports.test.ts:2)).

(b) Replace lines 70–89 with:

> `FORCE_ONLY_WHEN_NAMED` is not the Metadata allowlist: it governs positional force cascades, not the number of calls, runnable prerequisites, or replacement safety. Define `METADATA_RERUN_STEPS` in a pure browser-safe shared leaf. The first version contains `arc`, `tweets`, `glossary`, `quotes`, `ideas`, `timeline`, `quiz`, and `sketch`. `illustrated`, `debate`, and `hierarchy` remain out until they have a re-run operation that satisfies the one-metered-call contract. This is therefore a partial first version, not yet “any generated mode”.

That exposes a real requirements conflict: full coverage and exactly one model call cannot both be claimed with the current stage implementations.

### F2 — P1 — established: one press can be automatically attempted three times

(a) Identical-job deduplication prevents two rows from two clicks; it does not limit executions of one row. A lapsed job receives three lease windows ([jobs.ts:306](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/jobs.ts:306)), with no progress requirement. The code explicitly says an uncheckpointed paid step can be bought once per window ([jobs.ts:365](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/jobs.ts:365)). Settlement moves its running step back to pending ([pg-jobs.ts:1109](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/store/pg-jobs.ts:1109)).

Concrete scenario: Quotes returns a paid answer, the claimant dies before its transaction commits, the lease expires, and the same job buys Quotes again—up to three times from one Metadata press.

(b) Add under “Concurrency”:

> Metadata re-run jobs have a durable zero-automatic-requeue policy. Persist that policy on the job, and make both expired-lease settlement and cooperative deadline hand-back terminal once its zero-window budget is exhausted. Add a regression in which the model call completes, the claimant disappears before commit, and the job is never claimed for a second paid call. An explicit reader Retry is a new press and may create a new job.

### F3 — P1 — established: Illustrated is offered where it can only fail

(a) The plan offers controls on eligible rows even when they have not run ([plan:218](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md:218)). Illustrated is exceptional: its single-step runner refuses when Sketch is absent, stale, or for another profile, and does not pull the prerequisite in ([pipeline.ts:3637](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/pipeline.ts:3637), [pipeline.ts:3716](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/pipeline.ts:3716)). Most articles can legitimately lack Sketch.

`StageState.done` is insufficient: Metadata’s Illustrated currency only compares the illustration with its Sketch, not whether that Sketch remains valid for the article and reader ([pg.ts:2772](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/store/pg.ts:2772)).

(b) If Illustrated is later restored to the set, add:

> Do not render the Illustrated control unless the metadata server returns a server-owned `runnable: true` verdict using the runner’s exact prerequisites: a usable Sketch, current against the article, and compatible with the reader profile. Do not infer this from `StageState.done`. A false verdict offers no control.

### F4 — P1 — established: a degraded Illustrated result counts as success and replaces the good one

(a) Illustrated deliberately catches individual image-provider failures and continues ([illustrated.ts:1016](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/illustrated.ts:1016)). Storage failures likewise become failed plates rather than a failed step ([pipeline.ts:3779](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/pipeline.ts:3779)). The runner then returns the partial artefact successfully ([pipeline.ts:3834](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/pipeline.ts:3834)).

Thus a good four-plate illustration can be replaced by a “successful” rerun containing four failed plates. Draft publication is atomic, but the success condition is too weak for replacement.

(b) Replace the universal safety claim with:

> Illustrated is not eligible for replacement until it has replacement-specific success semantics. When a current illustration exists, any plate-generation or plate-storage failure must fail the whole forced step before publication, leaving the previous illustration current. Partial-plate publication remains valid for first generation. Test a complete old illustration against one failed new plate using the real store.

### F5 — P1 — established: hierarchy is neither fresh nor safely self-contained

(a) The plan says the lone hierarchy job “re-cuts the tree” and leaves nothing stranded ([plan:105](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md:105)). Both halves are false at this commit:

- Force does not bypass hierarchy checkpoints. The source records two consecutive forced runs where the second made no model call ([hierarchy.ts:2853](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/hierarchy.ts:2853)).
- A hierarchy publication writes an empty pending label manifest and a tree with no navigation labels ([hierarchy.ts:2631](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/hierarchy.ts:2631), [hierarchy.ts:2658](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/hierarchy.ts:2658)). Publication deletes the carried Labels receipt ([artifacts-pg.ts:1448](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/store/artifacts-pg.ts:1448)).
- The successor job is not built yet; its plan says only stage 1 has landed ([labels plan:3](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md:3)).

Once that successor does land, a hierarchy press can create a second Labels job and its model-call fan-out—again violating invariant 2.

(b) Replace the entire hierarchy section with:

> `hierarchy` is out of this first version. A forced hierarchy step may replay its durable checkpoint and make no fresh model call; at this commit it also publishes an empty pending-label state without enqueueing the Labels successor. Once the successor lands, a changed tree may buy a second job and multiple label calls. Treat hierarchy repair as a separate control with explicit checkpoint, downstream-label, cost, and atomicity semantics.

### F6 — P1 — established: the universal confirmation is false for Glossary

(a) The confirmation says the old result is “replaced” ([plan:230](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md:230)), but forced Glossary appends terms ([pipeline.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/pipeline.ts:385)). Changing only its button label does not repair the confirmation.

(b) Replace the confirmation copy with two exact variants:

> Default: “Another model call. The result changes only if the run succeeds.”

> Glossary: “Another model call. New terms are added only if the run succeeds.”

I found no other append operation in the proposed set.

### F7 — P1 — reasoned: completion refresh is an unspecified required behavior

(a) `useStepJob` requires `onFinished` specifically so the surface reloads what the job wrote, and instructs callers to pass `refresh`, not `reload` ([useStepJob.ts:294](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/useStepJob.ts:294)). Metadata currently has only a one-shot effect ([Metadata.tsx:374](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:374)); the plan’s build step leaves this argument as `…` ([plan:378](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md:378)). Without a refresh, `ranAt`, `done`, generators and label state remain old after success.

The repository’s ordered-read contract documents why a completion read must trail rather than join an earlier request ([useOrderedRead.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/useOrderedRead.ts:25)).

(b) Replace the build bullet with:

> Refactor the metadata GET through `useOrderedRead`. Pass the same stable `refresh` callback—not `reload`—to every row’s `useStepJob`. Add a race test in which an older metadata GET resolves after the completion refresh and cannot win, and assert that `ranAt` and `done` update without navigation.

### F8 — P3 — established: the carried-tree refusal paragraph describes a fixed bug as current

(a) Lines 290–297 say an unrelated step may still be refused because it carries a bad tree. Current publication logic explicitly exempts `checkTree` problems when blocks and tree are carried unchanged, logging them instead ([pg-revisions.ts:1605](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/store/pg-revisions.ts:1605)).

(b) Replace lines 290–297 with:

> Publication still validates any blocks or tree changed by this draft. `checkTree` problems on unchanged carried inputs are logged and do not refuse an unrelated mode publication; hierarchy remains the repair path for the stored tree itself.

## Answers to the remaining suspicions

- Eleven hooks do mean one shared poll and eleven subscriptions. Every snapshot can rerender the eleven row components, but `useNow` receives `null` unless that row has a job, and `announced` is a ref. With a stable shared `refresh`, this is acceptable.
- Excluding standalone `labels` is right for a “generated mode” control. It does not make the proposed hierarchy action safe.
- Excluding `blocks` is also right. `["blocks", "hierarchy"]` would satisfy the static runnable-plan check and Blocks itself makes no model call, but it is article-structure regeneration rather than mode regeneration; after the Labels successor lands it may also trigger further paid work.
- The document-link suite passed: 14/14. `tests/jobs.test.ts` could not be collected in this environment because its Vitest project attempted the unavailable private Postgres lane. No files were changed.