**Verdict: do not ship yet.** The narrow fixes are applied, but a wider completion-receipt defect can repeat paid work. Nothing was committed or pushed.

**C1 — P0: a completed forced step can run again. Wider blocker; not fixed.**

Input: forced Extract commits successfully; its completion progress write and the next starting write fail; the next step requests another window. Pause resets the stored Extract entry from `running` to `pending`, preserving `force: true`. Resume bypasses freshness and runs Extract again. PDF front-matter calls can be charged again even when transcription checkpoints survive.

Reproduced at the coordinator: the offline characterisation executes Extract twice. The required-one-execution Postgres regression is written **unrun**. This predates the stage through lease expiry after a failed progress write; tolerant continuation adds a clean-pause route. The fix needs an atomic completion receipt in session/store work, including the forbidden `pg-session.ts`.

**C2 — P1: a successful progress response carrying Stop was ignored. Fixed.**

Input: the between-step write fails after remote Stop, then the next starting or skipped-step write successfully returns `cancelling`. Previously the queue ignored that response and could finish `done`.

Both interleavings reproduced with failing offline tests. The queue now consumes cancellation at those boundaries. Offline regressions pass; corresponding Postgres regressions are **unrun**. The two characterised outcomes for Stop during an already-running last step remain unchanged.

Judgment on tolerance: fences prevent spending after a refused `beginStep`, and persistent database failure prevents starting work. But progress writes also carry cancellation and force receipts; treating them as harmless display writes is insufficient. Repeated failures can hide Stop across several steps. The finite walk and deadline bound that exposure.

**C3 — P1: blank titles erased stored titles. Fixed.**

Input: Extract or Metadata returns `""`, or `noteProgress` receives an empty/whitespace title. The coordinator and store accepted it as replacement data.

Two coordinator cases reproduced red, then passed. Both boundaries now preserve existing titles for blank values; omitted store arguments already preserved them. Forwarding spies now pass the fourth argument. Postgres cases for `undefined`, `""` and whitespace are **unrun**.

**C4 — P2: the deadline regression could pass after committing the late product. Fixed test gap.**

Reasoned wrong implementation: commit the seeded product, then pause. Fake freshness still forces a second execution, so the original assertions can pass.

The revised test returns a distinct metadata title, asserts zero commits before pause, and reads the real draft. **Unrun** against Postgres. Offline tests pass for discarding late products, retaining earlier commits, all four pause answers, and budget exhaustion.

The deadline path cannot pause indefinitely: `REQUEUE_BUDGET = 2` permits two requeues, then interruption. Leaving failed settlement writes to the lease is appropriate; the queue must not report an ending it could not persist.

**C5 — P3: rewritten comments contained false claims. Fixed.**

All **55 edits** were checked. Corrections cover the retained test-only filesystem session, same-request reclamation, Stop precedence, conditional deadline resumption, exception/exit inventories, obsolete step comparisons, arithmetic, and fencing scope.

For `db08f2408`, comment-stripped compiled output is identical for **5/5 files: 85,336 bytes on each side**. No executable change was found.

The original stage tests have these limits:

| Cases | Plausible wrong implementation they miss |
|---|---|
| Freshness failure | Beginning a marker before recording the failure; no paid execution is still asserted. |
| Three progress failures | Swallowing cancellation/control information; no Stop is combined with those failures. |
| Skipped progress failure | Omitting that write; strengthened with call and next-step-state assertions. |
| Stale progress failure | Refusing only the injected stale error, without testing real fence loss. |
| Deadline return | Committing before pausing; corrected above. |
| Two Stop characterisations | Writing no novel product; they establish outcomes and draft disposition. |
| Contended missing/live job | Dropping owner scope; inspected callers and scoped `get` support the fix. |
| Two title cases | Erasing blank titles; added boundary cases cover this. |

Files changed: [jobs.ts](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/src/jobs.ts), [pipeline.ts](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/src/pipeline.ts), [store contract](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/src/store/jobs.ts), [Postgres store](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/src/store/pg-jobs.ts), [walk tests](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/tests/jobs-walk.test.ts), [offline tests](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/tests/jobs-tier0-offline.test.ts), [lease test comments](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/tests/jobs-lease-budget.test.ts), [queue doc](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/docs/project/ingest-queue.md), [plan](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/docs/plans/261007b-seventh-sweep-job-queue-tier-0.md), and [postmortem](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/docs/postmortems/261007b-a-progress-write-can-carry-a-stop-and-a-blank-title-can-erase-a-heading.md).

Validation: four-file offline run **42/42 passed**; updated offline queue file **14/14 passed**, giving **43 distinct verified cases**. Typechecking passed **4 projects, 3,339 sources** via `node --import tsx scripts/typecheck.ts`; the npm entrypoint was blocked by IPC restrictions. Scoped lint: **1 existing error, 1 warning, 5 complexity notices**. `git diff --check` passed. No `npm test` or Postgres test ran.

Wider notes: preserve both budget numbers as requested. Assets’ **185 s** admission estimate omits PDF recovery, taking the step toward **360 s plus overhead**. Fetch’s **150 s** can be exceeded by multiple paper candidates. Both can waste requeue windows; neither is a whole-step bound.