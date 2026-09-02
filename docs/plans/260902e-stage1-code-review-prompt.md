# Code review: one extraction, and the test that now checks it

Review a small, already-implemented change in this working directory (a git worktree of the
Spideryarn repo — TypeScript, ESM, Drizzle/Postgres). The diff is at the path given below; read the
real files too, not only the diff.

**The scoped diff:** `/tmp/claude-1000/-home-greg-code-spideryarn2/145cc03c-d1c6-48c0-870a-130c9b0bb85d/scratchpad/stage1.diff`

## What was done and why

Three files — `src/store/pg-searches.ts`, `src/store/pg-referee-criteria.ts`,
`src/store/pg-referee-claims.ts` — each carried a private `sourceHashFor(articleId, db)`. The three
function bodies were byte-identical apart from one explanatory comment. Each one's own docstring
called itself "the third copy of this query" and named the two things that must not drift (the four
selected columns, and `order by ordinal`). Nothing compared them; `grep -rn sourceHashFor tests/`
returned zero.

Greping the query shape across `src/` (`asc(revisionBlocks.ordinal)` and
`treatment: revisionBlocks.treatment`) found 8 sites in 6 files. Five are a different, 14-column
"render" read and were left alone. The eighth was `blockHashQuery` in `src/store/pg.ts` — the same
four-column read without the article join, already exported and already covered by
`tests/store-block-reads.test.ts`, which asserts against the SQL Drizzle generates via `QueryBuilder`
so it needs no database.

So the three copies were moved into `src/store/pg.ts` as `sourceHashQuery` + `sourceHashFor`, beside
`blockHashQuery`, and four assertions were added to `tests/store-block-reads.test.ts`.

Result: source −46 lines, tests +52. `npm run typecheck` clean. The four new assertions were each
verified to fail against a deliberate break (order-by removed; `role` column dropped; join changed
to `articles.id`) and then the break reverted.

## What I want you to find

1. **Is the extraction behaviour-preserving?** The three call sites pass a transaction as the second
   argument in one path and nothing in the other. The parameter type changed from the local
   `Db | Tx` aliases to `Pick<ReturnType<typeof getDb>, "select">`. **Is that type change safe** —
   does it accept everything the old signature accepted, and does it now accept something it should
   not? Is there a case where a transaction-scoped read would now silently run outside the
   transaction?
2. **Is `src/store/pg.ts` the right home**, or does moving these three onto it create a coupling or
   an import-cycle risk that the previous separation was avoiding? Note `npm run check`'s `cycles`
   gate is currently clean.
3. **Are the four new assertions actually load-bearing?** They read generated SQL strings. Say
   plainly if any of them could pass over a broken query, or is a tautology. In particular the
   `current_revision_id` / `inner join` pair — is that really pinning the invariant it claims, or
   just pinning text?
4. **What did the change LOSE?** Deleting three docstrings deleted real reasoning. Is anything worth
   keeping now absent from the tree — and is the surviving docstring in `pg.ts` accurate?
5. **Should `sourceHashFor` have been built on `blockHashQuery`** (resolve article → current revision
   id, then call it) instead of repeating the four-column select with a join? That would make one
   query definition instead of two similar ones, at the cost of an extra round trip. Which is right?
6. **Anything else wrong** — naming, error handling, an edge case (an article with no current
   revision, a revision with no blocks), or a behaviour difference between the three original copies
   that I flattened without noticing.

Be concrete, cite file:line, and say which findings you are confident in versus hunching. Tell me
plainly if the change is not worth keeping.
