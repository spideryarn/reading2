# Key — P02: a paid "why this matters" line, once per article, on the metadata page

Shape: a **pipeline step**, artefact a column on `article_revisions`, cached on a content hash,
shown in its own /metadata component. Template: Simple (260930i); FAQ's stage-1 commit `b31d8b87`.

## Docs it must read
- MUST `docs/project/cost-tracking.md` § "The short version: you should not have to do anything"
  and § "The route table says where the article is".
- MUST `docs/project/new-mode.md` § "The artefact, if the mode shows one" (every total the compiler
  asks for, and the residue nothing checks), § "The words the mode puts in front of the reader", § "Its cost".
- MUST `docs/project/prompting-guide.md` (`plainWords`; § "Measuring a prompt change").
- MUST `docs/project/vision.md` § Anti-goals — without passage links it is the summary that replaces reading.
- USEFUL `docs/project/ai-gateway.md` (the prompt inventory a new stage joins); `docs/project/summaries.md`
  § "Simple — a plain-words orientation", § "A summary is a door"; `docs/project/architecture.md` § Conventions.

## Existing code it must reuse
- `src/messages-stream.ts` § `streamMessage` — the only way a stage calls a model. Trap: your own
  client or `fetch` (`tests/no-undeclared-spend.test.ts` refuses it).
- `src/jobs.ts` § `runStep` — attributes spend to the article for free. Trap: a hand-rolled
  `withSpendAttribution`, or a route that calls the model directly.
- `src/simple-summary.ts` (prompt, `inputFingerprint`, ids validated against the exact body-evidence
  set, one version constant) and `src/faq.ts` — the nearest artefacts.
- `src/plain-words.ts` § `plainWords`. Trap: a prompt with its own "use simple words" sentence.
- `src/web/ArticleCost.tsx` — precedent for a /metadata section in its own file (`Metadata.tsx` is
  ~3,900 lines); `src/web/BlockRef.tsx` for passage chips; `src/cost-categories.ts` § `JOB_DISPOSITION`.

## Code files it would edit
`src/types.ts`, `src/store/artifacts.ts`, `src/step-order.ts`, `src/pipeline.ts`, `src/jobs.ts`,
`src/models.ts`, `src/store/pg-revisions.ts`, `src/store/pg.ts`, `src/store/contracts.ts`,
`src/db/schema.ts` + a migration in `drizzle/`, `src/routes.ts`, `src/store/export.ts`,
`src/store/public-reader.ts`, `src/public/dto.ts`, a new `src/<name>.ts`, a new `src/web/*.tsx`
mounted from `src/web/Metadata.tsx`.

## Project rules that apply
- Failing test first; plan doc, GPT Sol plan review, then a code review that fixes (CLAUDE.md).
- Additive migration: apply it and say so; widen the `revision_step_runs.step_name` CHECK by hand
  (`tests/db-step-constraint.test.ts`); read the `Target:` line (`docs/project/database.md`).
- A batch step nobody watches need not stream; a press-generated wait must be named for Greg
  (CLAUDE.md "Stream any model call…"; 260930i § "A departure from CLAUDE.md").
- Plain text (`docs/project/security.md`); visitor-readable by default (`new-mode.md`; postmortem 260929a).
- Adding it to `src/pipeline.ts` § `DEFAULT_INGEST_STEPS` makes every import pay: name it for Greg
  (CLAUDE.md "Simplest version first"). Then generate once and see its line in the cost section.

## Traps
- Overlap: Simple's second paragraph is already "why it matters"; the tree root has a gist (260930i).
- `medium` effort swapped the author's term for its opposite; word targets overshoot ~⅓ (260930i, 261001h).
- A route cannot write a revision column — `requireLiveJobOwnsDraft` (260930i § The artefact).
- One exported version constant, stamped and compared; `stale` is shown, `outdated` is not (`new-mode.md`).
- The cost query keys on `article_id`, and the admin sees only their own articles (260930f, review P1).
