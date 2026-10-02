# Code review (reviewer-fixer): quick search on Jev (261002e)

You are reviewing **and fixing** committed code in the worktree you are in (branch
`worktree-fb-c77zuq-quick-search`). Your sandbox can write to this worktree; do not commit, push or
run any git command that changes state. I will read your diff and commit it.

## The candidate

Two commits plus one migration regenerated in a merge:

- `c549dda30` — the feature (server + client + tests): `git show --stat c549dda30`
- `a9f217311` — docs, comment fixes and the feedback note: `git show --stat a9f217311`
- `9916472b7` is a merge of `origin/dev`; the only change of ours in it is the migration being
  regenerated as `drizzle/20261002153556_search_runs_kind.sql` (+ its snapshot and journal entry)
  after dev added two migrations. Ignore everything else in that merge.

Start with: `src/quick-search.ts`, `src/ai-call.ts` (`openRouterDecisions`, `ProviderRefused.kind`
`context-exceeded`), `src/routes.ts` § `async function search`, `src/searches.ts` (`withRun`),
`src/store/pg-searches.ts`, `src/web/useSearch.ts`, `src/web/SearchPanel.tsx`,
`src/web/search-hits.ts`, `src/web/params.ts`, then the tests `tests/quick-search*.test.ts*`,
`tests/store-export-search-kind.test.ts`. That list does not limit scope.

The plan and its review: `docs/plans/261002e-quick-search-v1.md` (§ Plan review lists the nine
accepted findings F1–F9 from `docs/plans/261002e-quick-search-v1-plan-review-sol.md` — check each was
actually implemented), the spike `docs/investigations/261002o-quick-search-spike.md`.

## What I want

1. An independent attack: correctness, the silent-success shapes (a failed or partial Jev answer
   stored as "no matches"; a ledger row missing for a chunk or a retry; a quick run retried as
   meaning or vice versa; `kind` lost at a projection boundary; a visitor seeing owner controls),
   concurrency in the client (flesh out while the quick run is pending; double-press), the deadline
   and abort handling across parallel chunks and halving, and whether the docs changed in
   `a9f217311` are true against the code.
2. **Fix what is inside this feature**, narrowly, red-first (write the failing test, see it fail,
   fix). **Report, do not fix**, anything wider you notice.
3. You have no network: anything needing Postgres is mine to run. These files need nothing outside
   the tree and you may run them: `npx vitest run tests/quick-search.test.ts
   tests/quick-search-panel.test.tsx tests/use-search.test.ts tests/search-hits.test.ts
   tests/searches.test.ts tests/ai-call.test.ts tests/url-state.test.ts`.
   Already run by me and green: those plus `tests/routes.test.ts`, `tests/store-searches-pg.test.ts`,
   `tests/store-export-search-kind.test.ts`, `tests/public-dto.test.ts`,
   `tests/store-roundtrip.test.ts`, `tests/doc-links.test.ts`, `tests/privacy-page.test.ts`,
   `tests/no-undeclared-spend.test.ts`, `tests/declared-spend.test.ts`; `npm run typecheck` clean.
   A browser check passed all six scenarios (three radios, a ~0.3 s POST, bounded snippets, flesh out,
   survives reload, draft kept across switches).

## Severity and format

P0 data loss / security / incorrect charging / broadly unusable · P1 user-visible wrong behaviour or
an authoritative contract violated · P2 design/maintainability risk · P3 prose. Every finding gets an
ID continuing the plan review's (F10, F11, …), a severity, evidence (file:line), and either "FIXED
(files, test)" or "REPORTED (why not fixed)".

## My own suspicions (worth less; spend most of the run elsewhere)

- `askChunk`'s halving runs both halves with `Promise.all`; if one half throws, is the other aborted
  and are all ledger rows written before the generator throws?
- A stored quick run's `model` is the dated id (`typesafe/jev-1.13-20260917`); does any UI show it
  raw, and does `displayName` need to know it?
- The "Reading the article… takes a few seconds" wait copy and the legend line are unchanged for
  quick.

End with `VERDICT: land` / `land after my fixes` / `do not land`.
