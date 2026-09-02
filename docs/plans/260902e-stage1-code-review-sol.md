Keep the extraction. It is behavior-preserving and removes worthwhile duplication, but the new SQL test overstates what it proves.

## Findings

1. **Medium — the “current revision” test does not prove the query is scoped to the requested article. High confidence.**

   The assertions at [tests/store-block-reads.test.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/tests/store-block-reads.test.ts:113) merely require the tokens `current_revision_id` and `inner join`. They do not assert:

   - `articles.current_revision_id = revision_blocks.revision_id`;
   - `where articles.id = $1`;
   - that `"art-1"` is the bound parameter.

   I generated a deliberately broken query with no `WHERE` and `ON articles.current_revision_id = articles.id`; all four current test cases passed. That query would hash blocks from unrelated articles.

   Assert the complete join predicate and article predicate, plus `toSQL().params`. This is the main change I would request before calling the new guard complete.

2. **Low — the extraction adds a false historical claim in three places. High confidence.**

   [src/store/pg.ts:1033](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg.ts:1033), [tests/store-block-reads.test.ts:75](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/tests/store-block-reads.test.ts:75), and [docs/reusable/improve-the-codebase.md:100](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:100) say every old comment called itself “the third copy.” Inspection of the parent commit shows only `pg-referee-claims.ts` did. Searches called itself the Postgres half; criteria said it matched searches.

   There is also a now-stale surviving comment at [tests/store-parity-referee.test.ts:347](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/tests/store-parity-referee.test.ts:347) saying claims still contains a third copy.

3. **Low — “the same four columns” is stronger than the assertion. High confidence.**

   [tests/store-block-reads.test.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/tests/store-block-reads.test.ts:89) proves that four column names occur somewhere in the SQL and that `html`/`fts` do not. Additional selected columns would pass, so it does not prove “exactly four” or directly compare the two select lists.

   It is nevertheless useful: dropping any of the four current selected fields fails, and the negative test catches a bare `.select()`. The ordering assertion is strong and genuinely load-bearing. None of these tests is tautological.

## Answers to the six questions

1. **Type and transaction safety:** safe at the current callers. `Db` and `Tx` both provide the same `select` capability, and all three transactional paths still pass `tx` explicitly—for example [pg-searches.ts:160](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg-searches.ts:160), [pg-referee-criteria.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg-referee-criteria.ts:170), and [pg-referee-claims.ts:163](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg-referee-claims.ts:163). The helper uses that object directly at [pg.ts:1066](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg.ts:1066); there is no hidden `getDb()` call when `tx` is supplied.

   The `Pick` is structurally broader than `Db | Tx`, so a sufficiently compatible select-only adapter could now typecheck. That does not create a present bug, and the old type did not prevent someone from passing the global DB inside a transaction either. No transaction-scoped read can silently escape through this implementation.

2. **Home and cycles:** `pg.ts` is a reasonable home. All three modules already imported helpers from it, while `pg.ts` already imported `getDb`, both tables, Drizzle operators, and `hashBlocks`. Consequently the extraction adds no new module dependency edge. `npm run cycles` is clean. A narrower `pg-block-hashes.ts` might eventually improve the very large `pg.ts`, but that is unrelated refactoring, not a reason to reject this extraction.

3. **Assertions:** column-presence, heavy-column absence, and ordering are useful. The `current_revision_id`/`inner join` pair only pins text and should be replaced or supplemented with the exact `ON` and `WHERE` relationships.

4. **Lost reasoning:** nothing important is absent from the tree. The four-field rationale remains in [source-hash.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/source-hash.ts:47); ordering and narrow-read reasoning remain above `blockHashQuery`; undefined-on-no-blocks remains at [pg.ts:1061](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg.ts:1061); transaction reasoning remains at the call sites. The surviving operational docstring is accurate. Its historical “each called itself third” sentence is not.

5. **Building on `blockHashQuery`:** do not add the extra round trip. Outside the locked `begin` paths, resolving the revision and then fetching its blocks would allow publication between statements, returning the hash of a revision that is no longer current. The one-statement join at [pg.ts:1044](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/store/pg.ts:1044) is cheaper and observes the pointer and blocks under one statement snapshot. Two similar query definitions are justified here.

6. **Edges and behavior differences:** the three old bodies were equivalent. An article with no current revision and a current revision with no blocks both return `undefined`, exactly as before. Public callers still validate the article first, so a nonexistent slug remains a 404. Naming and error behavior are acceptable.

Current validation: the cycle gate passed. The scoped files produce no TypeScript error, although the current merged worktree’s full typecheck is not clean because of an unrelated error at [scripts/db-seed-dev.ts:290](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/scripts/db-seed-dev.ts:290). Vitest could not create its temporary directory under this review sandbox, so I inspected and independently exercised the generated SQL instead.