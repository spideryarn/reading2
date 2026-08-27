## Findings, ranked

1. **Must-fix — this change fails the required typecheck gate.**

The current typecheck reports five errors across four files owned by this change:

- Unsafe `TreeNode | undefined` casts in [tests/library.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/library.test.ts:151) and [line 177](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/library.test.ts:177).
- Passing nullable `renderProfile(...)` into `hashProfile` in [tests/route-profile-concurrency.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/route-profile-concurrency.test.ts:68).
- An overly narrow inferred `Map` key type in [tests/store-revision-columns.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-revision-columns.test.ts:92).
- An invalid `Glossary` fixture (`terms` rather than a real `Glossary`) in [tests/store-shelf-reads.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:350).

There are unrelated type errors from other in-flight work, but these five belong to this scope. Parts 1–7 and Part 8 each contain at least one failure, so splitting the commits does not avoid the blocker.

2. **Must-fix — the fallback recreates data-scaled queries and logs, and can combine different snapshots.**

[scalarsFor](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:963) emits one warning and two queries per bad row, while [listArticles](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1055) awaits it serially.

With `M` affected rows, the shelf does `2 + 2M` statements and emits `M` warnings. At 500 rows that is 1,002 statements and 500 log lines—past the project’s explicit 256-line limit and contrary to the rule that data-scaled problems are reported once ([logging.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/logging.md:697)). `tests/library-log-volume.test.ts` covers only the filesystem shelf.

There is also a correctness race: blocks and tree are separate concurrent statements under `READ COMMITTED`. An importer commit between their snapshots can make the fallback derive numbers from one version’s blocks and another version’s tree.

Batch the affected revision IDs, read their fallback inputs consistently, and log one aggregate warning—or refuse and require a backfill. The current per-row fallback is not “correct if it ever fires,” as the plan claims.

3. **Must-fix — the strongest parity guard can no longer detect stale scalars, and its replacement misses one of the five.**

The parity suite imports every article immediately before comparing stores ([store-parity.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-parity.test.ts:155)). The importer derives the columns from those same files, so parity cannot detect stale cached columns anymore.

The new in-place importer test is the right replacement direction, but it neither changes nor selects nor asserts `sectionCount` ([store-import-convergence.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-convergence.test.ts:260)), despite claiming to guard all five.

Add a depth-2 node and assert `sectionCount`. Also add a post-import database invariant audit comparing every current revision’s stored five against its actual blocks/tree. That catches a writer omitting a scalar even when the shelf fallback hides the omission.

4. **Should-fix — the “no block reads” checks still admit a constant batched block read.**

`blockReads` deliberately ignores any statement containing `from articles` ([store-shelf-reads.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:268)). The generated-SQL test only rejects `html` and `fts` ([store-revision-columns.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-revision-columns.test.ts:266)).

Therefore a join, lateral subquery, or second correlated aggregate over `revision_blocks` inside the shelf query can:

- remain at exactly two statements;
- be ignored by `blockReads`;
- keep all scalar columns present;
- avoid `html` and `fts`;
- leave every test green.

Assert that `revision_blocks` occurs exactly once and only in the title subquery, or pin that subquery’s complete SQL shape.

The `2 + 2 * warnings.length` formulation itself still excludes the old `1 + 2N` implementation; that compromise retains its teeth.

5. **Should-fix — the corpus title-parity test swallows the failure it is meant to expose.**

[The catch](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:673) ignores every `loadArticle` error, not only a foreign fixture’s teardown 404. If the TypeScript title path starts failing specifically for the untitled article, that row is skipped and the test passes as long as one titled article compares successfully.

Only ignore an expected teardown 404 for explicitly identified foreign test slugs; rethrow errors for real corpus rows. The later `if (!entry) continue` at [line 711](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:711) has the same vacuity.

6. **Should-fix — avoid running the title subquery for rows that cannot use it.**

The subquery at [src/store/pg.ts:858](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:858) runs once per shelf row. The `(revision_id, ordinal)` index supports an ordered scan; the primary key does not provide the required ordinal order. It still may filter every block in a revision with no H1.

Wrap it in `CASE` so it runs only when both the stored title and the reader’s title override are null. At 500 mostly titled articles, that removes nearly all executions without changing correctness. The SQL and `headingTitleOf` otherwise agree.

7. **Note — the unaliased boolean expressions are safe today, but the type guard needs one small hardening.**

Installed Drizzle forces selected node-postgres queries into positional `rowMode: "array"` ([session.js](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-orm/node-postgres/session.js:58)) and reconstructs fields by column index ([utils.js](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-orm/utils.js:7)). Duplicate `?column?` names cannot swap the flags, including prepared queries.

Adding `.as("has_arc")` remains sensible for readable SQL and driver-upgrade resilience. Also assert that `PRESENCE_OF` aliases do not overlap schema keys: `RevisionRowFor` checks schema keys first, so a future colliding alias would receive the column type rather than `boolean`. The current five aliases do not collide.

The publication invariant otherwise holds: the artefact writer changes only a fenced draft; publication derives the scalars before moving the pointer; import updates scalars, tree, and blocks in one transaction; export/import re-derives them; and the cascade runs from revision deletion to blocks, not from block deletion to a surviving revision. The re-export is an acceptable temporary shared-tree trade, though I would remove it once the importer’s other work lands. Splitting Parts 1–7 from the route concurrency change is correct, and the route overlap test genuinely proves concurrency.

I could not independently rerun the database measurement or `EXPLAIN` because this review environment denied the local Postgres socket. The benchmark code correctly labels its byte metric as decoded-row JSON, not wire bytes or memory.

**Verdict: not ready to commit.**