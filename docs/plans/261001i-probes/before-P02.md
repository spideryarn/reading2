# Probe P02, round: before
Task: a one-sentence "why this matters" line, generated once per article (a new paid AI call), shown on the metadata page.

## 1. Docs opened, in order
1. `CLAUDE.md` (AGENTS.md) — signpost; pointed at cost-tracking, new-mode, architecture. Helped.
2. `docs/project/cost-tracking.md` — the three rules for a new AI call (gateway, scope, article attribution), and the admin-only-figures rule. Very helpful.
3. `docs/project/new-mode.md` — the "artefact" and "its cost" sections are effectively the checklist for any new pipeline step. Very helpful, though framed as "a mode".
4. `docs/project/architecture.md` — § Adding an artefact-backed mode is only a redirect to new-mode.md. Minor.
5. `docs/project/web-client.md` — found `Metadata.tsx` row. Helped.
6. `docs/project/sql.md` — column taste (columns over JSON). Partly helped.
7. `docs/project/database.md` (grep only) — migration commands. Helped.
Not opened but would: `prompting-guide.md`, `testing.md`, `typechecking.md`, `code-quality-overview.md`, `copy.md`.

## 2. Code files you would edit
- `src/types.ts` (`StepName`, new artefact type), `src/store/artifacts.ts` (`ArtifactKind`, `ArtifactMap`, `SHAPE`, `STAMP_SOURCE`)
- `src/step-order.ts` (`STEP_ORDER`), `src/pipeline.ts` (`STEPS` row, maybe `DEFAULT_INGEST_STEPS`), `src/jobs.ts` (`STEP_BUDGET_MS`)
- `src/models.ts` (`TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`, `STAGE_EFFORT`, `ARTICLE_RENDERER`, and the `AiJob` union)
- `src/cost-categories.ts` (`JOB_DISPOSITION` row)
- `src/store/pg-revisions.ts` (`REVISION_CARRY_POLICY`), `src/store/pg.ts`, `src/store/contracts.ts` (`ArticleReader`)
- `src/db/schema.ts` (new column on `article_revisions` plus the hand-kept CHECK list on `revision_step_runs.step_name`), a new `drizzle/` migration via `npm run db:generate`
- `src/store/export.ts` (put-chain line), `src/rerun-steps.ts` (if re-runnable from Metadata)
- new `src/why-it-matters.ts` (generator, modelled on `src/faq.ts`)
- `src/web/Metadata.tsx` (show the line, plus the stage row)
- `src/messages.ts` / `src/title-text.ts` if it needs a label
- public DTO side (`src/store/public-reader.ts`, `src/public/dto.ts`) only if visitors should see it; I'd say no for v1.
- tests: `tests/db-step-constraint.test.ts` and the new test for the generator.

## 3. Existing helpers/components/functions you would reuse
- `src/pipeline.ts` § `STEPS.faq` (or `STEPS.arc`) — template for a step with `stamp`/`run`
- `src/faq.ts` § `generateFaq`, `inputFingerprint`, `FAQ_PROMPT_VERSION` — template for generator and stamp
- `src/messages-stream.ts` § `streamMessage` (or `src/ai-call.ts` § `openRouterJson`) — gateway call
- `src/jobs.ts` § `runStep` — scope and attribution come free
- `src/plain-words.ts` § `plainWords` — shared prompt rule
- `src/web/Metadata.tsx` — existing sections to copy; `ArticleCost.tsx` shows the new step's spend automatically
- No new generic helper found that makes "add a small per-article scalar artefact" cheap; I would copy `faq`'s shape.

## 4. Rules/policies you would follow
- Call via the gateway, inside `runStep`; step name becomes its line in the cost breakdown (`cost-tracking.md`, `new-mode.md` § Its cost).
- `JOB_DISPOSITION` row for any new `AiJob` (`cost-tracking.md`).
- Never show cost to non-admins; `tests/no-ai-cost-for-readers.test.ts` guards (`cost-tracking.md`).
- Total records are compiler-checked; run `npm run typecheck` (`new-mode.md`, `CLAUDE.md`).
- Bump `PROMPT_VERSION` on prompt change (`new-mode.md`).
- Migration: `npm run db:generate` then `db:migrate`, read the `Target:` line (`CLAUDE.md`, `database.md`); additive migration needs no approval.
- Column, not JSON blob (`sql.md`) — though `faq` is jsonb; a text column fits a sentence.
- Prompt: `plainWords`, `prompting-guide.md`; stream only if a person waits (batch step: not required).
- Failing test first; `npm test`; plan doc in `docs/plans/` plus GPT Sol review before and after; work in a worktree; commit by name; push to `dev` (`CLAUDE.md`).
- No description line in the UI band (`new-mode.md`) — not a band here, but relevant to the wording.
- Real data: don't run it against production.

## 5. Where you got lost
- Nothing says plainly "a one-off non-mode step" — new-mode.md is titled for modes, so I had to infer which rows (`MODE_CATALOG`, `Dock`, `POLICY`) to skip.
- Unclear whether the line should be in `DEFAULT_INGEST_STEPS` (paid on every ingest, so affects cost per ingest) or force-only; I'd have to read `src/pipeline.ts` comments and decide; no doc states the default for a cheap new step.
- Whether the free-text one-sentence needs the stamp/staleness/`outdated` machinery was not documented.
- `schema.ts` hand-kept CHECK list: documented, but easy to miss before the test goes red.
- Did not find a doc on how the Metadata page's sections are laid out (`Metadata.tsx` is 3,891 lines); would need grep.

## 6. Confidence
6/10 — the compiler-checked list is well signposted, but the choice of ingest default, the Metadata layout, and visitor exposure were left to inference.
