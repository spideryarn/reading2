# A saved search that knows the article moved

*Written 2026-08-26, part-way through the work, because the work stopped part-way.*

A saved search is answered against the article as it was. Re-extract the article and hits whose
blocks are gone are silently dropped, the rest may have moved, and **nothing says the run is out of
date** — where [260825g-tweet-thread-page.md](260825g-tweet-thread-page.md) does say exactly that. Recorded as open
in [search.md](../project/search.md) § What is still open, and that entry is still there because
this is not finished.

## What is in the tree, uncommitted

Everything below is written and typechecks. It is **not committed**, because the half of it that
runs against Postgres cannot currently be verified — see the blocker.

- `src/source-hash.ts` — the fingerprint, and `currentSourceHash(slug)`
- `src/searches.ts` — `loadRuns` returns `{ runs, sourceHash }`; a run records the hash it was
  answered against
- `src/store/contracts.ts`, `src/store/fs.ts`, `src/store/pg-searches.ts` — both stores carry it
- `src/store/export.ts` — exports the field
- `src/store/import.ts` — **committed**, the one line that imports it (see below)
- `src/web/useSearch.ts`, `src/web/SearchPanel.tsx` — the reader-facing half
- `drizzle/0009_search_source_hash.sql` — `search_runs.source_hash`, generated and applied locally
- `tests/searches.test.ts`, `tests/use-search.test.ts` — **33 passing**
- `tests/store-searches-pg.test.ts` — cannot run, see below

## The shape, and why it differs from the other three

`stale` is computed at the **read seam**, never stored — the same call `GlossaryResponse` and
`SummariesResponse` already make, and for the reason `src/api.ts` gives: a flag written at
generation time is a claim about a moment that has passed.

But those two answer for **one** artefact, and there can be several saved searches at once, each
captured at a different moment. A single response-level `stale` boolean would tell the reader that
all their searches were out of date when only the oldest was. So the response carries the article's
current `sourceHash` and each run carries its own, and the comparison is a `!==` per run.

The alternative — a transient `stale` boolean attached to each run by `loadRuns` and stripped again
by `save` — was rejected. It puts a derived fact on a persisted type and relies on a stripping step,
which is the "two facts in one shape" mistake this repo keeps writing postmortems about.

## The one line that is committed, and why it was urgent

`src/store/import.ts` carries `sourceHash: run.sourceHash ?? null`, landed on its own.

Without it an import drops the field, the export writes it back absent, and **`isStale` reads an
absent hash as out of date** — so every saved search on every imported article would show the
"answered against an older version" banner permanently, for no reason. `tests/store-roundtrip.test.ts`
catches it, but only once some real article's `searches.json` carries the field, which is why it did
not wait.

## What is blocking it

`src/db/schema.ts` declares `purpose` on `articles` and **no migration adds it**. Every `beforeAll`
that inserts an article dies, and vitest reports those files as *skipped* rather than failed — which
is why the suite looks healthier than it is, and why `tests/store-searches-pg.test.ts`,
`store-parity` and `store-roundtrip` currently prove nothing. 183 tests are in that state.

That column belongs to an in-flight reader-profile change. Generating the migration would bake in a
schema somebody is still designing, and would also generate their new profile table, so it is theirs
to land. `npm run db:migrate` will not help — there is nothing to apply until `npm run db:generate`
runs.

## What the migration and the review changed, 2026-08-26 (later)

The `purpose` migration landed, so the Postgres half runs at last. Two things followed.

**The parity fixture was comparing two different situations**, and `sourceHash` was the first field
to notice: `currentSourceHash` falls through to `example/` for a slug with no directory — mirroring
what `articleDir` serves the reader — while Postgres has no fixture fallback. Neither store was
wrong. `tests/store-reader-state-parity.test.ts` now builds a real article on both sides, and the
comparison is load-bearing: making `sourceHashFor` return `undefined` turns it red.

**GPT Sol found a correctness bug that is not about tests.** The article lock in
`src/store/pg-searches.ts` covers hashing and creating the pending run, and is released *before*
`src/routes.ts` loads the article the model actually reads. A publication landing between the two
means **the stored hash describes different blocks from the answer beside it** — which is the one
thing this number must never do, in the words of `hashDir`'s own comment. The fix Sol names is to
hash the exact `article.blocks` handed to `findPassagesStream` and persist that with the result,
rather than hashing separately and earlier. That is a design change, not a wiring one, and it is why
this is still uncommitted.

## What is left

1. Land the `purpose` migration (not this work's to do).
2. ~~Run `tests/store-searches-pg.test.ts` and the parity suite.~~ Done — the reader-state parity
   suite now covers `sourceHash` across both stores, and was mutation-checked.
3. `GET /api/search/:slug` must return the article's current hash beside the runs. One field on the
   `send` in `src/routes.ts`, agreed but not confirmed landed.
4. Break the fix and watch each test go red. The filesystem tests have not been mutation-checked.
5. **Hash what the model actually read**, per the review above. Until then the number can be wrong in
   exactly the way it exists to prevent.
5. Strike the open item in [search.md](../project/search.md) § What is still open.

## See also

- [search.md](../project/search.md) — the feature, and the open item this closes
- [260825g-tweet-thread-page.md](260825g-tweet-thread-page.md) — the staleness sentence to match
- [260826e-postgres-storage-implementation.md](260826e-postgres-storage-implementation.md) — the store seam
