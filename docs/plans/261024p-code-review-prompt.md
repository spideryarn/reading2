# Code review: a multi-page article imports from its first page (261024p, stages 2–3)

You are reviewing **built code** for Spideryarn, a reading app (TypeScript, Node, Postgres), and you
may **fix what you find** inside this change. Worktree
`/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import`, branch
`worktree-fbqkyukr-multi-page-import`. The candidate is `git diff 4430de193..HEAD` (and the working
tree, if anything is uncommitted). Read `CLAUDE.md` first: never run git commands that discard work
(stash, reset, checkout --, restore, clean), do not commit, do not touch `.env.local`, `infra/`,
systemd, or any remote database.

## What it is for

Pasting the front page of a piece split across pages (https://superdark.antikythera.org/ — an
abstract and three chapter pages) should import the whole piece, with no question to the reader. A
cheap model (Haiku, `src/multi-page.ts`) judges page 1's same-site links; stage 1 fetches the pages
it picks and stores each as its own source object; stage 2 reads each with Readability and joins
them. The plan is `docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md`, and your
own plan review, which reshaped it, is `docs/plans/261024p-plan-review-sol.md`. Check that the code
honours what that review's findings were accepted as.

## The code

- `src/follow-pages.ts` — following the pages: fetching through `fetchDocument`, same-site after
  redirect, the byte budget reserved before each fetch, skips, time budget.
- `src/pipeline.ts` — `STEPS.fetch` (the integration, after `priceTheDocument`) and `STEPS.extract`
  (reading the parts' bytes, handing them to `runExtract`).
- `src/fetch.ts` — `RawManifest.parts`, `RawPart`, `readPartBytes`.
- `src/db/schema.ts`, `drizzle/20261024102437_article_revision_parts.sql` — the child table.
- `src/store/artifacts-pg.ts`, `pg-revisions.ts`, `article-rows.ts`, `export.ts`, `contracts.ts`,
  `pg.ts`, `index.ts` — persistence, revision copy, export/import, `loadSourceParts`.
- `src/source-scan.ts` — the injection scan, page by page.
- `src/read-parts.ts` — the join; `src/extract.ts` `runExtract` now calls `readParts`.
- `src/multi-page.ts` — `sameSite` (now origin-like) and `judgeInput`.
- Tests: `tests/follow-pages.test.ts`, `tests/multi-page-fetch-step.test.ts`,
  `tests/multi-page-extract-step.test.ts`, `tests/read-parts.test.ts`, `tests/multi-page.test.ts`,
  and the extended `tests/source-scan.test.ts`, `tests/store-export-raw.test.ts`,
  `tests/store-export-covers-tables.test.ts`, `tests/db-schema-drift.test.ts`. The Postgres ones need
  the local Supabase that is running.

## Where to look hardest

1. **Security.** A hostile page steers the judge. What can it make us fetch, store, or show? Every
   fetch through `fetchDocument`? Same-site checked on the *final* URL? Reserved `data-spya-*`
   attributes from a later page scrubbed before the join, and nothing a page writes able to forge a
   part, a note, or an anchor of page 1? Logging: no prose, no model reason (docs/project/logging.md).
2. **Silent success.** Places a part could go missing with nothing saying so: a revision copy, an
   export round trip, a re-fetch, `readPartBytes` failing, a stage that reads `readRawBytes` and
   should have read the parts too. Find every reader of the raw source (`readRawBytes`,
   `loadSource`, `raw_source_sha256`) and say whether it should be parts-aware.
3. **The join against stage 3.** Ids (docs/project/block-ids.md), notes (`src/notes.ts`,
   `src/supplement.ts` `splitBlocks`), the restored `<h2>`, namespacing; would a re-extraction of
   the same pages mint the same block ids?
4. **Budget and failure.** The byte budget can never be exceeded; the time budget; a judge failure
   imports page 1 exactly as before; `ctx.signal` honoured.
5. **Tests that could not fail.** Any test that passes whatever the code does.

Grade each finding P0–P3 (P0 data loss, exploitable security, wrong charging, service unusable; P1
user-visible wrong behaviour or a contract violated; P2 design risk, nothing wrong today; P3 prose),
give it an id (F1…), say whether it is *established* (a path, a test you ran) or *reasoned*, and say
whether you fixed it. Fix P0–P2 inside the change where the fix is clear, with a test that fails
without it; report anything wider for me to decide. Run `npm run typecheck` and the tests above
after your fixes.

Write your answer as markdown: findings first, most severe first, then what you changed (files),
then what you ran and its result.
