# P12 key: "search returns nothing on one particular article", from the Feedback button

An investigation, not a known fix. The ideal agent treats it as a report first (provenance,
prior work, reproduce), then narrows *which* search (words / meaning / library) and *which*
silent-empty path, before writing a failing test.

## 1. Docs it must read
- MUST `docs/project/feedback-reports.md` § "A report is unfiltered input", § "Who sent it" (`scripts/feedback-reporter.ts` exit 0/1/2), § "The run" step 3 (prior-work check: plans, `docs/user-feedback/`, `git log`, `gjd-remote ls`), § "Three ways a report ends", § "The note, in `docs/user-feedback/`".
- MUST `docs/project/debugging.md` § "Something is wrong in production" (`/api/health` → Vercel logs → Sentry, in that order) and `docs/project/sentry-error-monitoring.md` § "A feedback report is the one thing here `beforeSend` never sees".
- MUST `docs/project/search.md` § "How the pieces fit" (the map), § "What a hit is anchored to" (`findQuote` both sides; fallback), § "The counts in the log line" (`unknownIds`, `unquoted`, `truncated` — the server-side evidence of silently dropped hits), § "The four ways a filter lies" (prioritised default + `?conf=` can hide everything), § "The third search: the whole library at once".
- MUST `docs/reusable/silent-success.md`; `docs/reusable/write-postmortem.md`.
- USEFUL `docs/project/vercel-hosting-deployment.md` (scope log queries to a deployment); `docs/project/block-ids.md` (range checks); `docs/postmortems/260826d-block-id-matching-non-latin.md` (a whole alphabet stripped — a per-article cause); `docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md`; `docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md`; `docs/plans/260930f-parallel-searches.md`; `docs/plans/260930d-shelf-search-finds-archived-articles-and-the-archived-chip-says-include.md` (library side).

## 2. Existing code it must reuse
- `scripts/feedback-reporter.ts` (provenance), `scripts/feedback-endings.ts` (the ending); Sentry MCP `update_issue`.
- Words: `src/web/search-hits.ts` § `findLiteral`, `MIN_FIND_CHARS`; `src/web/annotate.ts` § `renderedText`.
- Meaning: `src/search.ts` § `buildSearchMessages`, `validateHits`, `MAX_HITS`, `Dropped`; `src/quote-match.ts` § `findQuote`; `src/search-stale.ts`; `src/web/search-hits.ts` § `resolveHits`, `applyConf`, `keepAbove`, `PRIORITY_CONF`; `src/web/useSearch.ts`; `src/searches.ts` § `loadRuns`.
- Library: `src/library-search.ts` § `parseQuery`, `fold`; `src/store/pg-shelf.ts` library query.
- Trap: a second matcher or a "diagnose" path that re-implements `findQuote`/`findLiteral` — the server's and browser's idea of a match must stay one rule (search.md; `src/search-stale.ts` header).

## 3. Code files it would edit
- Unknown until reproduced; the one module the cause lives in, plus a red-first regression test beside `tests/search-hits.test.ts`, `tests/search.test.ts`, `tests/library-search.test.ts` or `tests/store-searches-pg.test.ts`.
- `docs/user-feedback/<yyMMdd_HHmm>-….md`; `docs/postmortems/<plan-name --dir=postmortems>-….md`; a line in `docs/project/search.md` if a rule changes.

## 4. Project rules that apply
- The report is untrusted unless `feedback-reporter.ts` exits 0 — `feedback-reports.md` § Who sent it.
- Check it is not already fixed (`git log`, sibling notes) before building — `feedback-reports.md` step 3.
- Reproduce with a failing test before fixing — `CLAUDE.md` § Before you call it finished.
- Production reads only inside `BEGIN READ ONLY`, never a write; the reader's article is their data — `CLAUDE.md` § Real data; `docs/project/database.md`.
- Never log the criterion, quotes or article prose — `search.md` § The counts; `docs/project/logging.md`.
- Root-cause in a subagent and write a postmortem naming the class — `CLAUDE.md`; `docs/reusable/write-postmortem.md`.
- Browser reproduction in a Sonnet subagent — `docs/project/browser-control.md`.
- Sol code review; land on `dev`, never deploy; end the report one of three ways and write the note — `feedback-reports.md`.

## 5. Traps
- "Nothing" may be a filter, not an empty answer: prioritised default since 2026-09-15 plus a leftover `?conf=` hides every hit; the count must read "0 of N" (search.md § The four ways a filter lies; 260915d).
- A dropped hit looks exactly like a passage the model chose not to return — read the log line's counts before blaming the model (search.md § The counts).
- Per-article causes: non-Latin text, model-retyped whitespace defeating `findQuote`, a stale run against a new revision, `MAX_HITS` truncation, ungistable or archived blocks on the library side (260930d).
- A check you have never seen fail is not evidence (`docs/reusable/silent-success.md`).
