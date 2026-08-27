# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app: TypeScript + ESM,
React client, Node server on Vercel, Postgres via Drizzle on Supabase). Read-only review — do not
edit files. Be concrete, rank findings by how much damage they would do, and mark each
must-fix / should-fix / note. End with a one-line verdict: ready to build, or not.

## The plan

Read `docs/plans/library-read-latency.md` in full. That is the thing under review.

It is a follow-up to `docs/plans/glossary-read-latency.md`, which you reviewed twice (the plan and
the built code) — `docs/plans/glossary-read-latency-review-sol.md` and
`docs/plans/glossary-read-latency-code-review-sol.md` are your own earlier findings, and that plan's
§ "Deliberately not in this change" is where the two follow-ups now being built were parked. Your
review of the first one said `listArticles` "is the larger aggregate win"; this is it.

## Context you will need

- `src/store/pg.ts` — `REVISION_COLUMN_POLICY` (~237), `META_COLUMNS` (~308), `REVISION_PROJECTIONS`
  (~343), `currentRevisionQuery` (~404), `blocksFor` (~464), `blockHashQuery` (~543), `metaFrom`
  (~563), `onTheShelf` (~193), and `listArticles` (~747) — the function under change.
- `src/api.ts` — `describeArticle` (~738), `titleFor` (~810), `describeDir` (~830+, the filesystem
  caller). This file is the filesystem store and must not import the Postgres driver.
- `src/store/pg-revisions.ts` — `deriveLibraryScalars` (~273), the `REVISION_COLUMN_POLICY` in
  *that* file (~118, a different map with the same name — worth an opinion), `publishRevision`
  (~1140) and `reasonsNotToPublish` (~1038).
- `src/store/import.ts` (~342) — the other caller of `deriveLibraryScalars`.
- `src/db/schema.ts` — `articleRevisions` (~226, note `word_count` … `root_gist` at ~424 are
  nullable) and `revisionBlocks` (~494).
- `src/routes.ts` — `withProfileChanged` (~2365), `resolveProfile` (~2340ish), and the four call
  sites at ~3118–3162.
- `tests/store-parity.test.ts` — the two-store comparison, including `listArticles` (~238).
- `tests/store-revision-columns.test.ts`, `tests/store-block-reads.test.ts` — the guards the last
  change installed, including the `QueryBuilder` trick for asserting generated SQL.
- `tests/library.test.ts` — `describeArticle`'s own tests.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.
- `docs/project/library.md`, `docs/project/database.md`.

## What I most want you to attack

1. **Is it safe to trust the stored scalars?** The plan stops deriving `words`, `blocks`, `parts`,
   `sections` and the blurb per request and reads `word_count`, `block_count`, `part_count`,
   `section_count`, `root_gist` instead. I claim there is no path that publishes a revision without
   them, and I checked the live database (8 current revisions, zero nulls, values identical to the
   live blocks). Find the path I have not thought of: the importer, carry-forward
   (`beginRevision` copying a previous revision), a re-publish, a failed job, an admin action, a
   migration that added rows. **In particular: can `article_revisions.tree` or `revision_blocks`
   change after publish, leaving the scalars describing something that is no longer there?** I
   argue no — the only two `update(articleRevisions)` statements set `status` — but that is a grep,
   not a proof, and if I am wrong the shelf starts printing stale counts and a stale blurb, which
   is exactly the kind of wrong that looks right.
2. **The null-scalar fallback (Part 7).** Is a per-row fallback that reads blocks + tree and calls
   `deriveLibraryScalars`, plus a `warn` log, the right answer? Or is it a branch that will never be
   exercised in production and therefore rot? Would you rather it were loud-and-refuse, or a
   `not null` constraint added by migration, or nothing at all?
3. **Presence in SQL, and the policy's second axis.** `REVISION_COLUMN_POLICY` gains a
   `"value" | "presence"` distinction so the test can still assert that each query's projection
   equals what the policy grants it. Is that the right shape, or is there a simpler one that keeps
   the exhaustiveness? And: does `isNotNull(...)` inside a Drizzle `.select({})` actually produce a
   boolean column and type it as `boolean` — or will it come back as a string / need `sql<boolean>`
   with a mapper? If Drizzle's `pg` driver returns something other than a JS boolean here, four
   `has` flags silently become truthy strings and every article grows four ticks.
4. **The title fallback (Part 5).** `metaFrom` falls back to the first depth-1 heading's text when
   the revision's title is null, and that fallback is live on a real article. The plan replaces
   "scan every block in JS" with a correlated subquery. Is `where kind = 'heading' and level = 1
   order by ordinal limit 1` genuinely the same rule as
   `blocks.find(b => b.kind === "heading" && b.level === 1)`? Consider: blocks arriving unordered
   from the JS side, `level` being nullable, the sanitiser changing `text` (it does not touch
   `text` — you established that last time — but check the claim survives here), and whether the
   subquery can use an index or degrades to a scan per row. Is pinning the two spellings against
   each other with a test a real guard or a tautology?
5. **The comment count.** Today it is `select id … where article_id = ?` per article, counted in
   JS. The plan makes it one `groupBy` with `inArray`. Attack the edges: empty id list, an article
   with no comments (absent row, not zero), ownership — **does `comments` need an owner filter that
   the per-article query was getting for free from the article row?** If a comment table row can
   belong to another reader, a grouped count over article ids could leak a number across owners,
   and I would much rather hear that now.
6. **Part 8, the route concurrency.** `withProfileChanged` starts taking a promise and settles both
   with `Promise.allSettled`, rethrowing the artefact's rejection first to preserve today's error
   ordering. Is that right? Consider: unhandled rejections, whether `resolveProfile` can now run for
   a slug that does not exist and do something worse than return null, the pool (`max: 5` by
   default — does doubling concurrent queries per request make a saturated pool *slower*?), and
   whether four call sites is the right blast radius for a change justified by latency nobody has
   measured in production.
7. **The move (Part 1).** `deriveLibraryScalars` moves to a new `src/library-scalars.ts` so
   `src/api.ts` can import it without dragging drizzle in. Is a new module right, or should
   `describeArticle` move instead, or should the shared derivation live somewhere that already
   exists? Name every import site and prose reference I will have to sweep.
8. **The checks (§ How each part is checked).** Your review of the last change found one test that
   passed on broken code in **every round** — four rounds running. Do the same here, before it is
   built. For each numbered check, name the edit that should make it red, and say which of them
   would stay green anyway. I am most suspicious of check 4 (query counting), check 7 (the two
   spellings of the title rule — is comparing two implementations of the same rule worth anything
   if I wrote both?) and check 10 (proving two things overlapped in time is notoriously easy to
   fake with a mock).
9. **Scope.** Is this one change or three? Parts 1–7 are the shelf; part 8 is four unrelated
   routes. The plan defers the sanitiser-stamp column a second time, partly on merit and partly
   because a peer is holding an uncommitted `drizzle/0019` in this shared tree. Is deferring it
   still right once the shelf stops sanitising, or does that argument reverse?
10. **Anything the plan asserts that you can falsify.** The measurement at the top, the table of
    "the column that already holds it", the claim that `metaFrom`'s narrowed parameter type is what
    stops the shelf's row pretending to be the reading view's, the claim that the two skip rules
    have never fired.
