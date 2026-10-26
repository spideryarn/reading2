# Review: Stage 1 of plan 261025h — twin OpenAlex records, the topic view, editions in Not cited, two dossier checks, a code-written query

Repo: this worktree (TypeScript/ESM, vitest, Postgres via drizzle). Read-only code review.

## The candidate (live, pre-commit — another agent is editing client files in this tree at the same time; ignore src/web/** except NotCitedPanel.tsx)

Base: HEAD. Scoped diff: `git diff HEAD -- src/citation-index.ts src/store/pg-citation-index.ts src/situate-citers.ts src/situate.ts src/related-work.ts src/routes.ts src/types.ts src/messages.ts src/web/NotCitedPanel.tsx src/db/schema.ts docs/project/reception.md tests/citation-index.test.ts tests/citation-index-pg.test.ts tests/situate.test.ts tests/related-work.test.ts tests/not-cited-panel.test.tsx`
Untracked, also in scope: drizzle/20261025185019_citation_index_twins_and_topic.sql, drizzle/meta/20261025185019_snapshot.json, tests/fixtures/openalex/extended-mind-*.json, tests/fixtures/openalex/related-extended-mind.json.
(src/db/schema.ts, src/types.ts and drizzle/meta/_journal.json also carry the other agent's chat-origin change, migration 20261025183854 — out of scope.)

The plan: docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md (decisions 2, 3, 4, 6, 10; § Stage 1; the eval result paragraph under Stage 3). Its plan review: docs/plans/261025h-sources-plan-review-sol.md (F8, F9, F10, F15 are this stage's). The trial: docs/investigations/261025a-….md. The contracts: docs/project/security-map.md (model output and article metadata are untrusted), docs/project/bibliography.md, docs/project/sql.md, docs/project/logging.md.

## What I want

An independent attack. In particular: identity — can the twin rule join two different works, or let a stranger's record in (it loosens a rule chosen on purpose: "the most cited is not evidence")? Is the union key/cache sound (key check constraint, stale handling, `alsoHeldAs` round-trip)? Does `?about=topic` add an OpenAlex request on every open, and is that within the privacy promise (OpenAlex is sent the DOI or title; the keyword is OpenAlex's own)? Editions: can a real, different paper be mislabelled "Other editions of this piece"? The Since check: can it drop a legitimate finding? The reserved code-written query: does it go through every check the planner's do (S3), and are search operators really stripped? Is `situate/2` right? Run `npx vitest run tests/citation-index.test.ts tests/situate.test.ts tests/related-work.test.ts` yourself (no network or DB available to you; the *-pg tests were run by me: 30/30 green).

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability; P3 prose. Refuse only on an established P0/P1. IDs F1… (new chain, prefix S1-F1 etc. to avoid clashing with the plan review). Evidence file:line and a suggested fix. Do not change any file.

## My suspicions (worth less)

- The twin rule when the article has no year (the trial's Extended Mind has none).
- The topic list being fetched eagerly for every list over 1000 citers.
