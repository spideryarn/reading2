## Findings

- **C1 — P0 — established:** a pending Reception activation could survive navigation to Claims and later start the paid Reception search when the delayed GET completed. Fixed by making auto-run eligibility view-sensitive and consuming disabled activations in [useAutoRun.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useAutoRun.ts:162), [useDebate.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useReception.ts:228), and [DebateMode.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/modes/debate/DebateMode.tsx:96). Added a regression test that holds the GET open, navigates to Claims, and verifies no POST occurs.

- **C2 — P1 — established:** pressing Debate’s own Reception segment did not arm Reception, including when Reception was already selected. Fixed in [DebatePanel.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/ReceptionAndClaimsPanel.tsx:1692). Added owner/visitor and Reception/Claims coverage; Claims never arms a search.

- **C3 — P1 — established:** the eval still modeled every current Debate as two searches. It reported missing Claims as zero, required both result groups, and rejected the valid one-search topology, so current live runs failed evaluation. Fixed in [run.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/evals/reception/run.ts:158), [bears.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/evals/reception/bears.ts:105), and [cost.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/evals/reception/cost.ts:97). Legacy two-group replay remains supported.

- **C4 — P1 — established:** several reader-facing descriptions falsely said current Debate searched individual claims, while the Claims tooltip said “Found by a second search” even for `not-run`. Fixed the marker-aware tooltip in [DebatePanel.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/ReceptionAndClaimsPanel.tsx:1722), sharing inventory in [messages.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/messages.ts:5228), rerun description in [rerun-commands.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/rerun-commands.ts:86), reset copy in [ResetArticle.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/ResetArticle.tsx:403), and adjacent factual documentation/comments. Legacy documents retain their previous searched-Claims wording and rendering.

- **C5 — P1 — established, not fixed:** export omits Debate documents entirely—both legacy and current—because the artefact chain in [export.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/export.ts:441) has no `revision.debate → debate.json` path. This predates stage 1 and is wider than its marker migration, so I left it for separate work.

No further stage-1 defect was found in the public DTO, marginalia, chat tools, registry, legacy rendering, direct links, restore/Back behavior, or command activation. Public DTO refusal paths remain intact. `modeStep("debate") === null` does not break Reception: auto-modes exclude the experimental Debate mode, while reruns use their separate registry.

## Files edited

- Core/web: `src/debate-themes.ts`, `src/debate.ts`, `src/jobs.ts`, `src/messages.ts`, `src/pipeline.ts`, `src/public-types.ts`, `src/types.ts`, `src/command-pick-catalogue.generated.json`, `src/web/DebatePanel.tsx`, `src/web/Metadata.tsx`, `src/web/ResetArticle.tsx`, `src/web/modes/debate/DebateMode.tsx`, `src/web/params.ts`, `src/web/rerun-commands.ts`, `src/web/sub-modes.ts`, `src/web/useAutoRun.ts`, `src/web/useDebate.ts`
- Eval/docs: `evals/debate/bears.ts`, `evals/debate/cost.ts`, `evals/debate/run.ts`, `evals/debate/themes.ts`, `evals/README.md`, `docs/project/debate.md`, `docs/project/ingest-queue.md`
- Tests: `tests/debate-panel.test.tsx`, `tests/debate-themes.test.ts`, `tests/debate-work-fields.test.ts`, `tests/every-mode-draws-its-surface.test.tsx`, `tests/jobs-lease-budget.test.ts`, `tests/metadata-rerun-section.test.tsx`, `tests/metadata-reset-section.test.tsx`, `tests/modes-that-start-themselves.test.tsx`, `tests/shared-inventory.test.ts`

The two untracked stage-review prompt/answer files already present in the worktree were untouched. No commit was made.

## Checks

- Targeted Vitest tests were run red before each behavioral fix, including the delayed-GET activation race and Reception-segment arming.
- Final targeted run:

  `npx vitest run tests/command-pick-catalogue.test.ts tests/debate-panel.test.tsx tests/debate-themes.test.ts tests/debate-work-fields.test.ts tests/every-mode-draws-its-surface.test.tsx tests/jobs-lease-budget.test.ts tests/metadata-rerun-section.test.tsx tests/metadata-reset-section.test.tsx tests/modes-that-start-themselves.test.tsx tests/shared-inventory.test.ts`

  **434 passed, 2 skipped across 10 files.**

- `node --import tsx evals/debate/run.ts check` — **23/23 passed**; no model, network, database, or paid calls.
- `node --import tsx scripts/typecheck.ts` — **passed all four projects; 3,521 source files covered**.
- `npx biome lint <touched TypeScript files>` — **passed**, with only non-blocking complexity/style advice.
- `git diff --check` — **passed**.
- `npm test` — could not begin because the sandbox could not connect to local Postgres/Docker.
- The `npm run typecheck` and `npm run eval:debate -- check` wrappers hit a sandbox-denied `tsx` IPC socket; the equivalent direct commands above passed.
- An independent final GPT Sol review found no additional stage-1 issue.

**Verdict: land with the fixes made.**