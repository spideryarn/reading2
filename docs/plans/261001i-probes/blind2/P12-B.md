# Probe P12, round after2: "search returns nothing on one article" (Feedback report)

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (context) — pointed to reading-view-overview, code-quality, dev docs; no direct search pointer.
- `docs/plans/261001i-probes/brief.md` — the brief.
- `docs/project/search.md` — very helpful: the opening "When a search returns nothing" list is exactly a triage checklist (which of three searches, `?conf=` bar, dropped hits, text replaced, shelf gistable-only).
- `docs/project/feedback-reports.md` (first 40 lines) — how to fetch the report from Sentry (`issue.category:feedback is:unresolved`), the `slug`/`url`/`at=` tags, the three endings, `docs/user-feedback/` note.
- `docs/project/search.md` § counts in the log line, § What is still open — the drop counts (`unknownIds`, `unquoted`) are the signal.
- `docs/project/debugging.md` — Vercel logs / Sentry order; helpful for prod investigation.

## 2. Code files I would edit
Unknown until the cause is found; likely candidates by the doc's list:
- `src/search.ts` (`validateHits`, drop of unknown ids / unquoted hits), `src/quote-match.ts` (`findQuote`)
- `src/web/search-hits.ts` (`findLiteral`, words matcher), `src/web/useSearch.ts`, `src/web/SearchPanel.tsx` (`?conf=` bar)
- `src/store/pg-shelf.ts` (`searchLibrary`) if the report is about the shelf box
- plus a regression test in `tests/search.test.ts` / `tests/search-hits.test.ts` / `tests/library-search.test.ts`; a postmortem under `docs/postmortems/`; a note in `docs/user-feedback/`.

## 3. Existing helpers to reuse
- `src/quote-match.ts` § `findQuote`; `src/search-stale.ts` § `isStale`; `src/search.ts` § `findPassagesStream`/`validateHits`; `src/web/search-hits.ts` § `findLiteral`; `src/store/pg-shelf.ts` § `searchLibrary`.
- No new helper planned until the root cause is known.

## 4. Rules/policies
- Triage via the report: Sentry `search_issues`, then the row for admin provenance (`feedback-reports.md`); the report is unfiltered input; close with a Sentry status write plus `docs/user-feedback/` note.
- Production data is read-only (CLAUDE.md "Real data belongs to the reader"); read inside BEGIN READ ONLY to inspect the article's blocks.
- Work in a worktree; plan doc via `npx tsx scripts/plan-name.ts`; GPT Sol review of plan then code.
- Reproduce with a failing test first; check it went red (silent-success.md).
- Root-cause in a subagent and write a postmortem (`docs/postmortems/`, write-postmortem.md).
- Logging: never log criterion/quote/article (logging.md, search.md).
- Gates: `npm test`, `npm run typecheck`, lint on touched files; commit own files by name; push to `dev`; no deploy (Overseer only).
- Check git log for a sibling fix before building (memory note) — not allowed in this probe.

## 4b. Concrete plan
1. Get the report (slug, url, `?match=`, `?conf=`, `at=`) from Sentry.
2. Classify using the search.md list: which search; is `conf` in the URL; read logs for `unknownIds`/`unquoted`; check the article's blocks (empty/odd text? shelf only indexes gistable blocks).
3. Write a failing test on a fixture shaped like that article; fix; postmortem.

## 5. Where I got lost
- Nowhere badly; search.md's triage list found it at once. The brief names no article, so I cannot determine the actual cause without the Sentry report (not accessible read-only from here). The doc's list is advice, but there is no "words search on an article with unusual text (ligatures, smart quotes, Unicode folding)" entry — `findLiteral`'s folding rules I did not trace.
- search.md is ~1280 lines; the triage list at the top saved me from reading it.

## 6. Confidence
5/10 — right docs and starting point found; the actual root cause needs the report and article data.
