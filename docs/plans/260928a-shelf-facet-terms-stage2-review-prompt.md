# Stage 2 code review prompt: shelf filter terms (260928a)

You are the reviewer-fixer for Stage 2 of docs/plans/260928a-shelf-facet-terms.md.

**Candidate (committed)**: commit ab85237c. `git show ab85237c --stat` lists every changed path. Start with:
- src/store/pg-shelf-terms.ts, the `GET /api/library/terms` route in src/routes.ts, `revisionPhraseRuns` in src/db/schema.ts, drizzle/20260928023038_shelf_terms_revision_phrase_runs.sql
- scripts/shelf-terms-report.ts
- tests/shelf-terms-pg.test.ts, tests/shelf-terms-warm-path.test.ts
- the plan's § Storage, § Filling it, § The route, and the "Landed" note under Stage 2

This does not limit scope: read src/store/pg.ts (`listArticlesQuery`, `onTheShelf`, `ownedByReader`), src/store/isolation.ts, src/shelf-terms/*.ts (stage 1, already reviewed), and anything else. Earlier reviews: docs/plans/260928a-shelf-facet-terms-plan-review-sol.md (F1, F2, F8, F10 are this stage's), docs/plans/260928a-shelf-facet-terms-stage1-review-sol.md.

**The Postgres tests need a database your sandbox cannot reach.** Their raw verbose output from my run is docs/plans/260928a-shelf-facet-terms-stage2-pg-run.txt (10/10). Read the test file to judge whether each case proves what its name claims. `tests/shelf-terms-warm-path.test.ts` needs nothing outside the tree — run it.

## What the stage is for

A cache of stage 1's per-article extraction, one JSONB row per (revision, extractor version); a fill bounded by a time budget inside the GET, reporting `pending`; the route choosing topics over exactly the signed-in reader's current revisions, never anyone else's; a report script that writes nothing.

## Please

1. An independent pass: owner isolation (can any path read or write a row outside the reader's set? can the report script write?); atomicity and concurrency of the fill (two tabs; a republication mid-fill; two deployments of different versions); correctness of `pending`; the superseded-row delete (can it delete a row somebody still needs?); whether the owner-scoped set can disagree with what `GET /api/library` puts on the shelf (an article on the shelf with no topics row ever, or the reverse); the route's auth, headers and ordering relative to `/api/library/:slug`.
2. **One known issue to fix, inside this stage:** skipped articles (`skipped: "not-english" | "no-text"`) are passed into `chooseTerms`, so they count as works — widening the df band's denominator and the <8-works threshold — and they sit in the coverage denominator though they can never have a topic. Decide the right treatment (my expectation: exclude them from the chooser and from coverage, and keep reporting them as `scope.skipped`), fix it red first, and make the report script agree.
3. **Fix what is inside this stage**, narrowly, red first. **Report, do not fix**, anything wider. Do not commit; leave changes in the working tree. If you change Postgres test files you cannot run, say so, and I will run them.

## My own suspicions (lower priority)

- The set query is not `listArticlesQuery` itself but built from the same pieces; is that a divergence waiting to happen?
- `scope.articles` counts pending articles; is that what the UI should say?

## Output

Findings with stable IDs S2-1, S2-2, … each with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose), established or reasoned, evidence (file:line), and what you changed (or why only reported). Then the final lines of any test command you ran. Then a one-line verdict.
