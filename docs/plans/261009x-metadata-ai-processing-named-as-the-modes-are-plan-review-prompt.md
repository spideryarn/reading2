You are reviewing a plan, read-only. Plan: docs/plans/261009x-metadata-ai-processing-named-as-the-modes-are.md.

Read it, then the code it touches: src/web/Metadata.tsx (RerunSection, RerunRow, StageRecord, StageRow), src/web/rerun-commands.ts, src/rerun-steps.ts, src/web/sub-modes.ts, src/mode-catalog.ts, src/title-text.ts (MODE_LABEL), src/web/command-runners.ts, src/pipeline.ts (STEPS labels), src/types.ts (StepName), and the tests that pin re-run labels (grep tests/ for RERUN_LABEL and "Run again").

Questions:
1. Is each step's mapping in the plan's table right? Check where each artefact is actually shown to the reader.
2. Will deriving RERUN_LABEL from a `Mode › Sub` path break command-bar matching or tests, and how should the words that find a row be built?
3. Any client-import / leaf-module rule (tests/client-imports.test.ts) the new file would break?
4. Anything simpler that meets Greg's ask?
5. Conflicts with an in-flight rename of Peer review to Sources and of the debate/citations step keys (queue item qi-m9tmnpy3).

Answer with numbered findings, each with a severity (P1/P2/P3), the evidence (file:line) and a fix. Be concise.
