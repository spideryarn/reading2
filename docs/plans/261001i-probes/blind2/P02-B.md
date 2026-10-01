# P02 (after2) — "why this matters" line, once per article, on the metadata page

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) — signpost; pointed at architecture, cost-tracking via the entry points.
- `docs/project/cost-tracking.md` — very helpful: the three rules (gateway, scope, attribute to article), admin-only figures, "What it cost" section.
- `docs/project/ai-gateway.md` — skimmed top only; confirms all paid calls go via OpenRouter; marginal.
- `docs/project/new-mode.md` — most useful: § "Adjacent shapes" (a step with a line on the Metadata page, no band), § "The artefact", § "Its cost", § "The words the mode puts in front of the reader".
- `docs/project/architecture.md` — grepped only (STEPS, stage table, `articleFingerprint`, tweets row).
- `docs/project/tweets.md` — a small precedent for a step with `src/<name>.ts` and a hook.
- Not opened but cited: `docs/project/prompting-guide.md`, `docs/project/admin.md` (§ metadata page cost section).

## 2. Code files I would edit
- `src/types.ts` (`StepName`), `src/store/artifacts.ts` (`ArtifactKind`, `ArtifactMap`, `SHAPE`, `STAMP_SOURCE`)
- `src/step-order.ts` (`STEP_ORDER`), `src/pipeline.ts` (`STEPS`, maybe `DEFAULT_INGEST_STEPS`), `src/jobs.ts` (`STEP_BUDGET_MS`)
- `src/models.ts` (`TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`, `STAGE_EFFORT`, `ARTICLE_RENDERER`)
- `src/store/pg-revisions.ts` (`REVISION_CARRY_POLICY`), `src/store/contracts.ts` (`ArticleReader`), `src/store/pg.ts`
- `src/db/schema.ts` + a new migration (new column on `article_revisions`; the step_name CHECK literal, per new-mode.md)
- `src/store/export.ts` (put-chain), `src/cost-categories.ts` (`JOB_DISPOSITION` if a new `AiJob`)
- new `src/why-it-matters.ts` (stage, modelled on `src/arc.ts` / `src/tweets.ts`)
- `src/routes.ts` (GET for the artefact, if the page reads it separately), `src/web/Metadata.tsx` (the line)
- Public/visitor side only if shown to visitors: `src/store/public-reader.ts`, `src/public/dto.ts` (probably not: metadata page is owner-side)

## 3. Existing helpers to reuse
- `src/messages-stream.ts` § `streamMessage` (pipeline stage call, per cost-tracking.md); `src/ai-call.ts` § `openRouterJson` if a non-streamed JSON call fits better.
- `src/jobs.ts` § `runStep` (opens collector and attributes spend to article for free).
- `src/models.ts` § `effortFor`, `generatorFor`, `CAPABLE_MODEL`; `src/arc.ts` § `inputFingerprint`/`PROMPT_VERSION` pattern for content-hash caching.
- `plainWords(...)` shared prompt rule (prompting-guide.md).
- `src/web/Metadata.tsx` existing sections as the pattern for the display line.
- No band, so no `ModeSurface`, `useStepJob`/`useOrderedRead` unless I add a re-run button.

## 4. Rules to follow
- Call via gateway, inside runStep scope, attributed to the article — cost-tracking.md; `tests/no-undeclared-spend.test.ts` guards it.
- Step name becomes its own cost line on the metadata page; generate once locally and check the line — new-mode.md § Its cost.
- Cost figures admin-only; never put dollar amounts in reader copy — `tests/no-ai-cost-for-readers.test.ts`.
- `JOB_DISPOSITION` row for any new `AiJob` — cost-categories, new-mode.md.
- Cache on a content hash, stage runnable alone by slug; `PROMPT_VERSION` single constant, bump on prompt change — CLAUDE.md, new-mode.md.
- Plain-words prompt rule — prompting-guide.md. Prompts are not streamed to a person waiting here (batch step), so streaming rule N/A unless a button triggers it.
- Columns not JSON; migration additive, apply and state Target line — CLAUDE.md, database.md/sql.md.
- Test first (red before fix); `npm test`, `npm run typecheck`, lint on touched files; GPT Sol plan and code review; plan doc under `docs/plans/` via `scripts/plan-name.ts`; work in a worktree; commit by name, push to `dev`.
- Public/export: decide `PUBLIC_PROJECTIONS` and export put-chain (silent if forgotten) — new-mode.md.
- Simplest first: ask Greg whether it must be a step in `DEFAULT_INGEST_STEPS` (spends on every import) or on demand.

## 5. Where I got lost
- No doc says where the metadata page's per-step lines or its "Re-run" list are driven from (is a step list there hand-kept?). I did not trace `Metadata.tsx` fully in budget.
- new-mode.md is mode-shaped; the "step with no band" case gets only a short paragraph, and it is unclear which of the artefact residue items apply to an owner-only metadata line (e.g. whether `REVISION_READ_POLICY` needs a row).
- `docs/project/tweets.md` is a signpost, not a worked example of a bandless step; `src/arc.ts` header was the nearest thing.
- Did not find a doc listing which `ArtifactKind`s are columns vs other storage; relied on new-mode.md.

## 6. Confidence
7/10 that I found everything; weakest on the Metadata.tsx integration and the public/export decisions.
