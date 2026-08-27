# Review the built code: `toc`'s stamp, and the step-run fence

This is a review of **built code**, which this repo weights above a plan review and for a stated
reason: a plan-stage review cannot find a `PATCH` that writes one field and then rejects the request.

You have reviewed the plan behind this three times (NO-SHIP each time; findings folded in) and given
a narrower input round on the adapter's shape. This is C1 and C2 of the seven-commit build order in
`docs/plans/delete-the-importer.md`.

Be adversarial. Every previous round found something real; assume this one does too.

## The commits

| commit | what |
|---|---|
| `59e8e3a` | **C1** — `STEPS.toc` gets a `stamp`, hashing the **stage-3** `blocks` artefact. `tests/toc-stamp.test.ts`. |
| `1f624e6` | `copyArtefacts` now runs `beginStep` → `write` → `finishStep`, your finding 2 from the last round. |
| `4da9bcf` | **C2** — `beginStepRun` and `finishStepRun` in `src/store/pg-revisions.ts`, the first writer and first reader of `revision_step_runs.attempt_id`. `tests/store-step-fence.test.ts`. Plus `NO_INPUT_HASH`/`PIPELINE_RUN` moved from `revisions.ts` to `artifacts.ts` to break an import cycle. |

`git show` each. Also read `docs/plans/delete-the-importer.md` § The build order for C, which these
two implement, and § What the second review changed, where I recorded that one of your criticals did
not survive checking.

## Attack these specifically

1. **`finishStepRun`'s fence.** Two conditions plus `rowCount !== 1`. Is there a state that gets
   through, or a legitimate state it wrongly refuses? Consider: a retried step, a step whose job was
   swept and re-claimed by the same worker, concurrent callers with the same token, and the
   `error` status path.

2. **`beginStepRun`'s four conditions**, one of which is `draft_revision_id = revisionId`, taken with
   `for update`. Is the lock ordering right against `openOrBeginJobDraft` (job then article)? Can it
   deadlock with `publishRevision` or `beginDraftIn`? And is `onConflictDoUpdate` on
   `(revision_id, step_name)` safe here — what happens when a step is legitimately re-run by a *new*
   attempt while an old row still carries the previous token?

3. **`NO_INPUT_HASH` on begin, real hash on finish.** `finishStepRun` only overwrites `inputHash`
   when the caller passes one. Does that leave any row claiming something false — in particular a
   step that began, failed, and left `unstamped` behind, versus one that never ran at all? How does
   `articleMetadata`'s `isCurrent` read such a row?

4. **C1's stamp.** It hashes `read(slug, "blocks", "blocks")` — stage 3's output. I checked your
   previous round's claim that this orphans consumers and concluded it does not, because summaries and
   the rest key on **block-id ranges** rather than tree nodes, and `toc` rewrites the stage-4 blocks
   copy that stamped consumers read through `inputHashFor`. **Check that reasoning against the code
   and say if I am wrong.** Specifically: is there any artefact or reader that resolves a tree *node
   id* across an artefact boundary and would break when the tree is rebuilt?

5. **The constants move.** `artifacts.ts` now defines `NO_INPUT_HASH`/`PIPELINE_RUN`, `revisions.ts`
   re-exports them. Does that re-export keep every existing importer working, and is there any
   remaining cycle or evaluation-order hazard?

6. **The tests.** Both files claim to have been watched red in specific ways. Verify the claims are
   *achievable* — that the named mutation really does fail the named test and nothing else. In
   particular `tests/store-step-fence.test.ts` asserts that removing the attempt condition fails two
   tests and removing the status condition fails one; check that the third case ("refuses a row that
   carries no token at all") is genuinely testing the attempt fence and not something incidental.
   Also: `withClaimedJob` retries on `jobs_only_one_running` and rolls back. Is that sound, or can it
   mask a real failure?

7. **What I have not thought about.** Each previous round found one.

## Format

Ranked findings, each with a confidence and a concrete `file:line` or reproduction. A verdict at the
top. **Markdown links must be repo-relative** or plain code spans — absolute paths break
`tests/doc-links.test.ts`, which has happened in every previous round.
