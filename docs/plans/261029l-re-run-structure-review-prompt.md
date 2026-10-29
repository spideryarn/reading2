You are reviewing a plan, read-only. Plan: docs/plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md in this repo (Spideryarn). Read CLAUDE.md first.

Check the plan's claims against the code, especially:
1. That a forced `structure` job (POST /api/jobs {slug, steps:["structure"], force:["structure"]}) replays its checkpoint when prompt/model/content are unchanged, and that the labels successor replays its batch checkpoints too — so the cost note on the row is honest. src/structure*.ts, src/store/checkpoints.ts, src/pipeline.ts, docs/project/structure-step.md.
2. That nothing else goes wrong when `structure` is added to METADATA_RERUN_STEPS (src/rerun-steps.ts): cascadeForce/FORCE_ONLY_WHEN_NAMED (tests/metadata-rerun-steps.test.ts asserts every member is in FORCE_ONLY_WHEN_NAMED or otherwise cascades into nothing — is structure? what would forcing it cascade into within a one-step job?), unrunnableStepPlan, useStepJob, the command bar's rerunRows (src/web/CommandBar.tsx) and its "rerunHeld" guard, Metadata RerunRow `done` provenance, explanations/crossrefs/relations/skim or anything keyed to the tree that would silently go stale after a re-cut tree (the plan claims the arc self-heals via useArc).
3. That the reader's data (comments, highlights, notes on block ids) is unaffected by a structure-only rerun.
4. The command-bar "Start this article again" row: gating on the experimental switch, collisions with existing aliases (src/web/article-commands.ts SECTION_ROWS, rerun-commands.ts RERUN_PHRASES, tests/command-match-*.test.ts).
5. Anything simpler, or any missing place that must hear about a new rerun step (docs/project/mode.md, explanations test).

Report findings ranked by severity, each with file:line evidence and a concrete fix. Don't edit files.
