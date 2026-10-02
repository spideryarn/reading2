Build with changes. The rename’s core data model and migration ordering are sound, and I found no additional production storage column or Storage-object path containing `hierarchy`. Before building, fix two blocking issues: stage 1 currently changes the persisted AI-call purpose despite promising not to, and stage 2 is unsafe while a `hierarchy` job is active. Also, the inner pass is not accurately described by “sections”; `whole-document` matches the code.

1. **P1 — Stage 2 needs a real maintenance/drain guard, not an accepted live-worker failure.**

   The exact incompatibility identified during `toc` → `hierarchy` still exists. A worker already running with `stepName === "hierarchy"` will look for that row when finishing ([src/store/pg-revisions.ts:1664](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/pg-revisions.ts:1664)); after the migration renames it to `structure`, the update affects zero rows and throws `StepRunNotHeld` at line 1672. The old precedent explicitly requires blocking new work, stopping workers, draining, migrating, deploying, then reopening ([260831ak…md:212](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/docs/plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md:212)).

   It is worse than the plan’s “fails loudly” wording suggests:

   - `hierarchy` is in every ordinary ingest ([src/pipeline.ts:287](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/pipeline.ts:287)), unlike the rare optional Skim job whose window was accepted.
   - An old worker can write its whole in-memory `JobStep[]` back through `noteProgress` ([src/store/pg-jobs.ts:1934](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/pg-jobs.ts:1934)) or release/finish paths ([src/store/pg-jobs.ts:2201](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/pg-jobs.ts:2201)), reintroducing `"hierarchy"` after the migration’s postcondition ran.
   - Checkpoint-write failures are deliberately swallowed as warnings, not raised as step failures ([src/hierarchy.ts:2773](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy.ts:2773), [src/labels.ts:2478](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/labels.ts:2478)).

   **Change the plan:** before dropping constraints, have the migration refuse any queued or running job whose `steps` contain `hierarchy`, as `0041` does. Operationally block new work, drain those jobs, apply the migration, deploy, and reopen. A table lock during the migration protects its own transaction, but maintenance is still needed for the minutes after commit. This is simpler than expand/migrate/contract.

2. **P1 — Stage 1’s `Task`/`AiJob` rename silently changes a stored value.**

   The plan says stage 1 leaves persisted values untouched ([plan:101](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/docs/plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md:101)), but its change table includes `AiJob` ([plan:43](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/docs/plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md:43)). `AiJob` includes `Task` ([src/models.ts:939](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/models.ts:939)), whose literal is currently `"hierarchy"` ([src/models.ts:559](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/models.ts:559)). `streamMessage` passes it to `beginSpend` ([src/messages-stream.ts:494](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/messages-stream.ts:494)), and it becomes the persisted ledger job/purpose ([src/ai-spend.ts:1047](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/ai-spend.ts:1047), [src/db/schema.ts:2888](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/db/schema.ts:2888)).

   **Change the plan:** keep the `Task`/`AiJob` literal and all task-keyed records (`TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`, `JOB_DISPOSITION`) on `"hierarchy"` during stage 1. Move them to stage 2 together with `StepName` and add `RENAMED.hierarchy` in that same stage. Renaming TypeScript identifiers such as `HierarchyRun` remains safe in stage 1.

3. **P2 — “The stored spellings … in one place each” is false; stage 1 needs an explicit protocol-literal inventory.**

   The compiler will help with exhaustive records, but several string boundaries are independent:

   - default job construction: [src/pipeline.ts:287](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/pipeline.ts:287)
   - pipeline registry and stored artefact reads: [src/pipeline.ts:2605](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/pipeline.ts:2605)
   - freshness lookup: [src/store/pg.ts:2933](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/pg.ts:2933)
   - publication’s raw Drizzle predicate: [src/store/pg-revisions.ts:1907](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/pg-revisions.ts:1907)
   - feedback’s copied list: [src/feedback-payload.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/feedback-payload.ts:162)
   - a direct checkpoint query that would silently return zero rows if renamed in stage 1: [evals/paperwork/structure-starts-replay.ts:291](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/evals/paperwork/structure-starts-replay.ts:291)

   **Change the plan:** define stage 1 as “internal names and presentation only.” Explicitly list `StepName`, `Task/AiJob`, all step-keyed records and raw DB predicates, checkpoint namespaces, and direct checkpoint queries as protocol literals retained until stage 2. Add a stage-1 grep allow-list test or review checklist; typechecking alone cannot prove this split.

4. **P2 — The first pass is not a “sections” pass; the plan’s one-sentence description is wrong.**

   The current prompt requests a recursively nested tree of internal nodes: root, chapters, and sections ([src/hierarchy.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy.ts:94)), including titles, gists, questions, headings, and ranges ([src/hierarchy.ts:109](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy.ts:109)). Its result is a recursive `ModelNode`, not a list of top-level section starts ([src/hierarchy.ts:218](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy.ts:218)). Even the incoming starts-only representation recursively reconstructs the complete nested proposal ([src/hierarchy-starts.ts:1](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy-starts.ts:1)). The prompt module itself calls this the “whole-document prompt” ([src/hierarchy-prompt.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy-prompt.ts:25)).

   A correct description is:

   > The first, whole-document call proposes the complete nested internal-node tree—root, chapters and sections, with their titles, gists, questions and starts/ranges. Optional deepen/expand calls then replace oversized frontier nodes with finer child subtrees.

   **Change the plan:** use `wholeDocument` for identifiers and `whole-document` for paths/namespaces: for example `wholeDocumentRequest`, `WholeDocumentCheckpointEntry`, `structure-whole-document`, and `evals/structure-whole-document/`. `sections` suggests the call returns only leaf-level sections, which it does not.

5. **P2 — The historical cost-baseline reproducer is another deliberate survivor missing from the plan.**

   The plan exempts `evals/results/`, but not `evals/cost/baseline/`. Its reproduction script intentionally selects old ledger rows where both step and job are `"hierarchy"` ([evals/cost/baseline/final-numbers.py:138](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/evals/cost/baseline/final-numbers.py:138)). Renaming those literals to `structure` would silently print zero for the historical structure-call calculation.

   **Change the plan:** add `evals/cost/baseline/` to the historical-evidence exclusions, including its executable reproduction code, and allow its old literals in the final grep. Alternatively, deliberately normalize both spellings, but leaving the frozen reproducer untouched is simpler and more faithful.

6. **P3 — Fine: checkpoint namespace renaming does not change checkpoint keys.**

   `checkpointKey` hashes only the canonical object supplied by the caller; it never receives the namespace ([src/source-hash.ts:221](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/source-hash.ts:221)). The whole-document key contains the prompt version and rendered wire request ([src/hierarchy.ts:676](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy.ts:676)); the task name is used to choose a model but is not serialized into that wire body ([src/messages-stream.ts:462](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/messages-stream.ts:462)). Deepening likewise hashes request/body/seed/recipe/targets, not its namespace ([src/hierarchy-deepen.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/hierarchy-deepen.ts:341)). Label fingerprints contain neither namespace nor step ([src/labels.ts:1040](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/labels.ts:1040)).

   `structureHash` also hashes tree content only ([src/source-hash.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/source-hash.ts:198)). The only relevant hash that actually contains the step spelling is `work_key` ([src/store/jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/store/jobs.ts:81)), which the plan already identifies.

   **Change the plan:** replace “to be verified” with this conclusion. Keep the existing exact whole-document key pin, add an exact deepening-key pin before the rename, and have the migration verification compare `(article_id, key, value)` before and after—not merely row counts.

7. **P3 — Fine: the migration’s data order and compatibility aliases are otherwise correct.**

   Drop constraints → update rows → rewrite JSON arrays with ordinality → assert postconditions → re-add constraints is the correct order. Mixed-name rows should refuse, as planned. Drizzle 0.31.10 does emit CHECK changes—the identical `0041` precedent says both CHECK statements were generated ([0041…sql:4](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/drizzle/0041_rename_toc_step_to_hierarchy.sql:4))—so generating for the snapshot and inserting data movement between DROP and ADD is fine.

   Leaving the append-only AI ledger unchanged is also correct once `RENAMED` is added: the classifier normalizes both `job` and `stepName` ([src/cost-categories.ts:323](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/src/cost-categories.ts:323)). Keeping feedback evidence and normalizing stale incoming payloads is fine. Keeping `?mode=hierarchy`, prompt versions, `structureHash`/`structureVersion`, and the immutable historical `work_key` is fine.

   **Change the plan:** only add the active-job refusal/maintenance sequence from finding 1 and spell the checkpoint rewrite as an explicit `CASE`, especially for `hierarchy-structure` → `structure-whole-document`.

The simplest safe shape is therefore: stage 1 renames files, identifiers, docs and visible copy while retaining every protocol literal; stage 2, under a short maintenance window, changes all protocol literals and migrates the database in one act. No expand/contract rollout is needed.