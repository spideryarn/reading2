# Review the built code

You are reviewing built and tested code in the Spideryarn repo (TypeScript + ESM, React client,
Node server on Vercel, Postgres via Drizzle on Supabase). Read-only — do not edit files. Be
concrete, rank findings by how much damage they would do, and mark each must-fix / should-fix /
note. End with a one-line verdict: ready to commit, or not.

**This repo weights a code review above a plan review**, deliberately: a plan-stage review cannot
find a query that reads a column nobody selected, or a test that passes on broken code. Your review
of the plan for this change is `docs/plans/260828c-library-read-latency-review-sol.md`, and every one of its
four must-fixes was verified and acted on. What follows is what got built.

## What to read

- `docs/plans/260828c-library-read-latency.md` — the plan, **rewritten after your review**. Its § "How each
  part is checked" is now a table with a "what could keep it green anyway" column, which is your
  mutation audit turned into the build's own checklist.
- `docs/plans/library-read-latency-code.diff` — the scoped diff, plus the three new files in full.
  **`src/routes.ts`'s diff is contaminated**: another agent has +194/−68 lines of unrelated
  in-flight work in that file. Mine there is `withProfileChanged` and its four call sites, and
  nothing else. Judge only that.
- The files themselves, which are more readable than the diff:
  `src/library-scalars.ts` (new), `src/store/pg.ts`, `src/api.ts`, `src/store/pg-revisions.ts`,
  `src/routes.ts`, `tests/store-shelf-reads.test.ts` (new),
  `tests/route-profile-concurrency.test.ts` (new), `tests/store-revision-columns.test.ts`.

## What changed, in one paragraph each

1. **`deriveLibraryScalars` moved** from `src/store/pg-revisions.ts` to a new leaf
   `src/library-scalars.ts`, so `src/api.ts` (the filesystem store) can call it without importing
   drizzle. `pg-revisions.ts` **re-exports** it — partly because `PublishResult.scalars` is typed
   from it, partly because `src/store/import.ts` carries another agent's uncommitted work and
   `git add` stages files rather than hunks. That second reason is stated in the plan; say if you
   think it is the wrong trade.
2. **`headingTitleOf` joined it.** The "no stored title? use the article's own `<h1>`" rule existed
   in three places (`src/api.ts`, `metaFrom` in `src/store/pg.ts`, and now a fourth spelling in
   SQL). The three TypeScript ones are now one function.
3. **`describeArticle` receives the five scalars** instead of deriving them from `blocks` and
   `tree`. Both stores now go through `deriveLibraryScalars`: the filesystem at read, Postgres at
   publish (into columns).
4. **`REVISION_COLUMN_POLICY` → `REVISION_READ_POLICY`**, and its value type went from
   `RevisionReader[]` to `Partial<Record<RevisionReader, "value" | "presence">>`. The carry-forward
   map of the same name in `pg-revisions.ts` became `REVISION_CARRY_POLICY`.
5. **The shelf's projection** is now `META_COLUMNS` + the five scalars + five
   `sql<boolean>\`… is not null\`` flags, and **no JSONB at all**. `headingTitle` sits outside the
   projection as a correlated subquery. `listArticlesQuery` is exported as a builder seam.
6. **The comment count** is one grouped query for the page instead of one `select id` per article.
7. **A fallback**: if any of the four *numeric* scalars is `null`, that row's blocks and tree are
   read and `deriveLibraryScalars` recomputes them, with a `warn`. `root_gist` is deliberately not
   part of the trigger (your first finding).
8. **`withProfileChanged` takes a thunk** and `Promise.allSettled`s the artefact read with
   `resolveProfile`, rethrowing the artefact's rejection first.

## Measured, on this laptop against a local Supabase

```
                         before        after
  statements per call    13 (1+2N)     2
  row JSON per call      640,893 B     4,189 B
  wall clock (median)    558 ms        3 ms
```

## Mutations that were run, and went red

Each was applied to the source, the suite run, and the source restored. Listed so you can attack the
list rather than repeat it: presence expression → bare column; `hasArc` dropped while the policy
still grants it; the shelf query reverted to `revision: articleRevisions`; the title subquery's
`order by ordinal` removed (**green until a second `<h1>` was stored out of order** — added);
`level = 1` → `level = 2`; per-article block read restored; per-article comment read restored;
the comment map mis-keyed; a missing comment defaulting to non-zero; the fallback removed; the
fallback made silent; the fallback extended to `rootGist`; the `blockCount` skip dropped;
`allSettled` → `all`; the route awaiting before the helper; the profile rejection swallowed.

## What I most want you to attack

1. **The invariant, again, and harder.** The plan now says the safety of reading columns rests on
   every writer setting the five *in the same transaction* as the blocks and tree they describe —
   `publishRevision`, and the importer's in-place `on conflict do update`. Is that now complete? Is
   there a partial-failure path, a retry, a sweeper, an export/import round trip, or an
   `ON CONFLICT` branch where the tree lands and the scalars do not? What about a revision whose
   blocks are deleted by cascade while the row survives?
2. **The `sql<boolean>` presence flags.** They generate `"arc" is not null` **with no alias**, so
   drizzle maps them by position. Is that safe with node-postgres, or is there a path (prepared
   statements, `rowMode`, a driver upgrade) where two unaliased `?column?` results get mapped by
   name and swap? Should they be `.as("has_arc")`? And is `RevisionRowFor`'s new three-arm mapping
   sound — in particular, can a projection key that is *both* a schema column name and a presence
   alias be mistyped?
3. **The correlated subquery.** It runs once per shelf row. On a shelf of 500 articles with a
   360-block article among them, does `where revision_id = ? and kind = 'heading' and level = 1
   order by ordinal limit 1` use the `(revision_id, ordinal)` unique index, or does the planner
   choose the primary key and scan? Is `case when title is null then (…) end` worth it? And is
   there a correctness gap between it and `headingTitleOf`?
4. **The fallback.** Is `=== null` on exactly the four numbers right? Could a row have three of them
   and be silently half-trusted? Should it refuse rather than recompute? Is a `warn` per row per
   request a log-volume problem on a shelf where many rows are affected (see
   `docs/project/logging.md` and `tests/library-log-volume.test.ts`, which exists because of exactly
   that)?
5. **The tests, and this is the part that matters most.** Your review of the last change found one
   test that passed on broken code in *every* round, four rounds running. Go through
   `tests/store-shelf-reads.test.ts` and `tests/route-profile-concurrency.test.ts` and find the ones
   that would stay green. I am most suspicious of:
   - the statement count, which is written as `2 + 2 * warnings.length` rather than `2`, because
     vitest runs test files concurrently against one database and a foreign fixture can be on the
     shelf. Does that formulation still exclude `1 + 2N`? Have I bought robustness with the
     assertion's teeth?
   - `blockReads`, which classifies a statement as a per-article block read by
     `from "…revision_blocks"` **and not** `from "…articles"`. The first version of it matched
     `"revision_blocks"."html"` and reported zero block reads while one was plainly happening,
     because drizzle drops the table qualifier from a single-table select. What else does the
     current rule miss?
   - `route-profile-concurrency.test.ts`'s overlap test, which asserts an order of pushes into an
     array after one `setTimeout(0)`. Is that actually proving concurrency, or proving something
     weaker that would survive a serial implementation?
   - the "two spellings agree" test, which compares `loadArticle` against `listArticles` over the
     real corpus, and skips a slug whose `loadArticle` 404s (another suite's teardown). Does the
     skip swallow the failure it exists to catch?
6. **Anything the parity test cannot see.** `tests/store-parity.test.ts` imports `data/` and then
   compares both stores. Since the importer writes the columns the Postgres side now reads, the
   comparison can no longer catch a stale column — it compares files against columns derived from
   the same files, moments earlier. Is that a real weakening of the repo's strongest guard, and if
   so what should replace it?
7. **Scope and staging.** Parts 1–7 are one commit; part 8 (the routes) is another. Is that right?
   Is anything in here that should not ship at all?
8. **Anything asserted that you can falsify** — the measurement, the claim that the importer can
   publish a blockless revision, the claim that `metaFrom`'s narrowed parameter type is what stops
   the shelf's row pretending to be the reading view's, the log-volume reasoning, the comment about
   node-postgres parsing booleans.
