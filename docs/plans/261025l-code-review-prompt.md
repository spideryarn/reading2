# Code review: shelf cards show the how-much-read pie (plan 261025l)

You are reviewing commit `3115e8cf3` in this worktree (`git show 3115e8cf3`; the diff from
`50b3beca2`). Ignore `drizzle/meta/20261025232854_snapshot.json`, which is generated.

The plan is `docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md` — its section
"After GPT Sol's plan review" wins over earlier text — and your own plan review is
`docs/plans/261025l-plan-review-sol.md`. The masthead pie it reuses is plan
`docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md`,
`src/reading-so-far.ts`, `src/web/read-filter.ts`, `src/web/matter-view.ts`.

Greg's requirements, verbatim from the brief:

> every shelf card shows the same how-much-read pie as the top of the article. … Reuse them
> exactly, with no second copy of the buckets or thresholds. On the shelf, the figure for every
> card comes from the server in one query per shelf load, not one query per card. It is the
> owner's own data, and only the owner sees it: never a visitor, and never on the public shelf.

Look hardest at:

1. **Equivalence.** Does the shelf's band always equal what the reading view's masthead would
   draw for the same article and reading? Any input `foldedOnArrival`/`readSoFarWords` reads that
   the basis (`src/store/read-so-far-basis.ts`) misses, so a stale cache is served as fresh?
2. **Privacy.** Any path by which a visitor, the public shelf (`docs/project/public-shelf.md`),
   an admin view, an export, MCP, or the browser's kept shelf gets `readBand` or reads
   `read_so_far_words`. Is every read and the write owner-scoped?
3. **The write** in `refreshShelfWords` (`src/store/pg-reading-time.ts`): the guarded
   `INSERT … SELECT`, its race behaviour, errors in the POST handler (`src/routes.ts`) — must
   never fail the reading-time save.
4. **Query count**: `listArticles` must stay a fixed number of statements however many cards.
5. **Tests that could pass while the feature is broken** (silent success).
6. Transfer/export classification, migration correctness, docs accuracy.

Per house rules you may fix what you find inside this change (edit files in the worktree; do not
commit, do not touch `.env.local`, `infra/`, systemd, and do not run anything against
production). Run `npm run typecheck` and the touched tests
(`npx vitest run tests/read-so-far-shelf.test.ts tests/shelf-read-so-far.test.tsx
tests/read-so-far-basis.test.ts tests/store-shelf-reads.test.ts tests/public-reads.test.ts`)
after any fix. Report every finding with severity (P0–P3), file:line, the failure scenario,
and whether you fixed it; list anything wider for me to decide.
