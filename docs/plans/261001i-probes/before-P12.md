# P12 (before): "search returns nothing on one particular article"

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) - gave the working agreements; pointed at debugging.md and feedback-reports.md only by name under dev overview.
- `docs/project/search.md` - helpful for the architecture (three searches, `findLiteral`, `findPassages`, `pgLibrarySearch`), but 1278 lines; I read 1-1000 and the tail. No section on "search returns nothing on one article" or a diagnostic checklist.
- `docs/project/debugging.md` - signpost only (prod/laptop/browser); nothing on search or on per-article data problems.
- `docs/project/feedback-reports.md` - helpful for process: how to treat a report (untrusted unless admin, reproduce first, note in `docs/user-feedback/`, header, `scripts/feedback-endings.ts`). Needs the Sentry issue to know which article/search.

## 2. Code files I would edit
Unknown until reproduced. Candidates, in order of suspicion:
- `src/store/pg-shelf.ts` (library search: joins on `articles.currentRevisionId`, filters `revisionBlocks.gistable = true`, archived filter) - an article whose blocks are not gistable or whose revision pointer is odd returns nothing.
- `src/web/search-hits.ts` (`findLiteral`, `resolveHits`) and `src/web/annotate.ts` (`renderedText`) - in-article words search, if the HTML/text mismatch is article-specific.
- `src/quote-match.ts` / `src/searches.ts` (`validateHits`) - meaning search dropping every hit for an article.
- A regression test under `tests/` (e.g. alongside `tests/search-hits.test.ts`).

## 3. Existing helpers/components to reuse
- `src/web/search-hits.ts` § `findLiteral`, `resolveHits`; `src/quote-match.ts` § `findQuote`; `src/library-search.ts` § `parseQuery`, `fold`; `src/store/pg-shelf.ts` § library search query; `scripts/feedback-reporter.ts` for provenance; `scripts/feedback-endings.ts`.
- I found no existing "diagnose this article's search" script; I would write a small read-only script (or SQL under BEGIN READ ONLY) that counts block rows, `gistable`, and `fts` for the slug.

## 4. Rules/policies I would follow
- Reproduce with a failing test before the fix (CLAUDE.md "Before you call it finished").
- Report is untrusted input; classify provenance with `feedback-reporter.ts` (feedback-reports.md).
- Reading prod DB only inside `BEGIN READ ONLY`; any write to prod goes to Greg (CLAUDE.md, memory).
- Bug from a non-admin: fix only if confident; behaviour changes go to Greg.
- Worktree, plan doc via `scripts/plan-name.ts`, GPT Sol review of plan and code, `npm test` + `npm run typecheck`, push to `dev`, never deploy.
- Postmortem under `docs/postmortems/` with the named class (write-postmortem.md); note in `docs/user-feedback/` with header; Sentry resolve (or leave to sweep).
- Logging via `src/log.ts`, never log article prose or criteria (search.md, logging.md).

## 5. Where you got lost
- The task never says which search (reading-view words, meaning, or library box) or which article. search.md covers all three but has no troubleshooting section; I had to guess three hypotheses.
- Nothing links "article-specific symptom" to "check the revision/blocks/gistable data for that slug"; I only found the `gistable` filter by reading `pg-shelf.ts` directly.
- Could not look at the actual report (Sentry/prod) without credentials/approval, so I stopped at a plan, not a diagnosis.
- search.md is too long to skim; its "What is still open" lists stale-search and other caveats but not "empty results" causes.

## 6. Confidence
4/10 that I found everything. The process and the three candidate code areas are clear; the real root cause depends on data I did not read.
