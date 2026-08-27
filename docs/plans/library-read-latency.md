# The shelf reads a megabyte of article to print eight word counts

Follow-up to [glossary-read-latency.md](glossary-read-latency.md), which fixed one panel and
named two things it deliberately left alone. This is the bigger of the two, plus the small
concurrency fix that plan also parked.

Greg, 2026-08-27, on the change this follows:

> Proceed with followups.

## The measurement, first

`pgArticleReader.listArticles({ archived: false })`, against the local Supabase, six entries,
five runs, timed end to end with every `pg` result counted on the way past
([`scripts/bench-shelf-reads.ts`](../../scripts/bench-shelf-reads.ts); the numbers below are its output):

```
  entries                 6
  queries per call       13
  row JSON per call     640,893
  wall clock (median)   558 ms      (min 391, max 678)
```

Thirteen queries for six articles is `1 + 6 × 2`: the list, then **per article** a full block read
and a comment read. The 641 KB is what `pg` decoded into JavaScript; the whole shelf's block rows,
measured in the database itself, are larger still:

```
  slug                              blocks   text     html     fts
  constitution                        360   139,459  150,873  152,745
  fowler-phrenology                    72    44,234   45,994   49,386
  labels-checkpoint-check             141    53,527   73,137   59,106
  noema-mythology-of-conscious-ai     141    53,527   73,137   59,106
  revistes-ub-30977                    43    19,105   20,346   20,785
  source                               41    19,102   20,324   20,744
  source-2                             42    19,102   20,338   20,763
  writes                               19     3,183    3,834    3,357
  ---------------------------------------------------------------------
  total                                     1,145,214 bytes across 8 articles
```

Plus the revision JSONB the list projection takes for itself — `tree` 102 KB, `glossary` 16 KB,
`summary` 22 KB, `arc` 10 KB, `tweets` 4 KB — about 154 KB, all of it to answer four `!= null`
questions and count two kinds of tree node.

And **each of those block reads is sanitised through jsdom** (`blocksFor` → `sanitizeStoredBlocks`,
[`src/store/pg.ts:296`](../../src/store/pg.ts)), which is where most of the 558 ms is: the glossary
plan timed one article's sanitise at 76 ms warm and 184 ms cold, and this page does one per article.
On a laptop, against a database on the same machine. Production is a Vercel function reading
Supabase over the network.

**What the page actually wants** from all of that: a title, a byline, a date, a blurb, four word
counts and four ticks. Every one of those is already a column.

## What the blocks are read for, and where each answer already lives

`listArticles` reads all of it to feed two pure functions.

`describeArticle` ([`src/api.ts:738`](../../src/api.ts)) uses the blocks for `blocks.length` and
`sum(b.words)`, and the tree for a count of depth-1 and depth-2 nodes and the root's gist. All five
of those numbers are **already stored**, on `article_revisions`:

| Derived per request today | The column that already holds it |
|---|---|
| `blocks.reduce((n, b) => n + b.words, 0)` | `word_count` |
| `blocks.length` | `block_count` |
| depth-1 nodes in the tree | `part_count` |
| depth-2 nodes in the tree | `section_count` |
| `tree.nodes[rootId].gist ?? .summary ?? excerpt` | `root_gist` |

They are written by `deriveLibraryScalars`
([`src/store/pg-revisions.ts:273`](../../src/store/pg-revisions.ts)), from exactly the blocks and
tree being published, in the same transaction that publishes them.

**The invariant is that transaction, not immutability**, and the plan said immutability until Sol
took it apart. There are two production paths to a published revision and they behave differently:

- `publishRevision` promotes a draft. `beginRevision` deliberately leaves the derived columns null
  on the draft and publish fills them in as it flips `status`, so a draft cannot be mistaken for a
  finished article.
- The importer **updates a published revision in place** when the text has not changed — same
  revision id, `on conflict do update` over `tree` and all five scalars, then the blocks deleted and
  reinserted ([`src/store/import.ts:440`](../../src/store/import.ts) onwards). That is its stated
  licence: it is a migration tool and the files win.

So `root_gist` cannot describe a tree that is no longer there, and `word_count` cannot describe
blocks that are no longer there — but the reason is that every writer sets the scalars and the rows
they describe **together, atomically**, not that the row is frozen. If a third writer ever touches
`tree` or `revision_blocks` without recomputing the scalars beside them, the shelf starts printing
numbers and a blurb for text that has changed, and nothing will say so. This paragraph is where that
person should find out.

Checked against the live database rather than assumed:

```
  current revisions            8   (all published)
  null word/block/part/section 0
  null root_gist               0
  null tree                    0
  block_count = 0              0
  word_count vs sum(b.words)   identical for all 8
  block_count vs count(b.*)    identical for all 8
```

`metaFrom` ([`src/store/pg.ts:563`](../../src/store/pg.ts)) uses the blocks for one thing: when
`revision.title` is null, the title falls back to the first depth-1 heading's text. **That fallback
is live** — `labels-checkpoint-check` has a null title and shows "The Mythology Of Conscious AI" on
its card — so it cannot simply be dropped, and Part 5 keeps it.

## The two derivations that were already one function apart

`describeArticle` and `deriveLibraryScalars` compute the same five numbers, in two places, and both
files say so in a comment. `deriveLibraryScalars`' own header records that they had **already
diverged once**, over the `excerpt` rung of the gist fallback, and that the divergence was found in
review rather than by a test.

So this change does not merely make the shelf read columns instead of blocks. It removes the second
copy: `describeArticle` stops deriving and starts **receiving** the five scalars, and each store
supplies them the way it has them — Postgres from the columns `deriveLibraryScalars` wrote,
the filesystem by calling `deriveLibraryScalars` on the artefacts it just read. One function,
one meaning, two moments.

## What to change

### 1. One derivation, in a module both stores may import — `src/library-scalars.ts`

`deriveLibraryScalars` lives in `src/store/pg-revisions.ts`, which imports drizzle and the pool.
`src/api.ts` is the filesystem store and must not pull the Postgres driver in behind it, so the
function moves to a new leaf module with no store in it: `src/library-scalars.ts`, holding
`deriveLibraryScalars` and `LibraryScalars`, unchanged in behaviour.

**`src/store/pg-revisions.ts` re-exports it**, and that is a decision rather than a shim. Two
reasons, and the second is the honest one:

- It is part of that module's published surface — `publishRevision` returns
  `ReturnType<typeof deriveLibraryScalars>` — and `src/store/import.ts` is a store module reaching
  for its neighbour, which is a reasonable address for it to use.
- `src/store/import.ts` currently carries **+53/−39 lines of another agent's uncommitted work** in
  this shared tree. `git add` stages a file, not a hunk, so editing one import line there would put
  their half-done change under this commit — which has already happened once in this repo
  (docs/project/version-control.md). Re-exporting means this change touches no file a peer is
  mid-edit in. If that reads as the tail wagging the dog, the re-export is one line to delete once
  their work lands.

Import sites to sweep: `src/store/pg-revisions.ts` (now importing), `src/api.ts` and `src/store/pg.ts`
(new consumers), `tests/store-revision-policy.test.ts` (its unit tests move to the new address), and
the prose references in `src/store/import.ts`, `tests/chat-anchor.test.ts`,
`docs/plans/postgres-storage-implementation.md`, and the stale `describeArticle` sentence in
`docs/plans/postgres-migration.md`.

A move, so it gets the [rename-or-move](../reusable/rename-or-move.md) sweep: grep for the whole
name and for `LibraryScalars`, and decide each hit.

### 2. `describeArticle` takes the scalars instead of the blocks and the tree

```ts
export function describeArticle(input: {
  slug: string;
  meta: Meta;
  scalars: LibraryScalars;      // was: blocks: Block[]; tree: Tree
  comments: number;
  addedAt: string;
  fixture?: boolean;
  shelf?: ShelfState;
  has?: Partial<LibraryEntry["has"]>;
}): LibraryEntry
```

`words`, `blocks`, `parts`, `sections` and `gist` come straight off `scalars`. Behaviour is
identical on the filesystem side, where the caller now writes
`deriveLibraryScalars({ blocks, tree, excerpt: meta.excerpt })` at the point it used to hand the
blocks over — the same inputs through the same code.

Two production callers: `describeDir` ([`src/api.ts:918`](../../src/api.ts)) and `listArticles`
([`src/store/pg.ts:807`](../../src/store/pg.ts)).

### 3. The shelf's projection: five scalars, five booleans, no documents

`REVISION_PROJECTIONS.library` today takes `META_COLUMNS` plus `tree`, `arc`, `tweets`, `glossary`
and `summary` — five JSONB documents, four of which exist only to be compared with `null` and one
of which is only counted. It becomes `META_COLUMNS` plus the five scalars plus **presence
expressions**:

```ts
library: {
  id: articleRevisions.id,
  ...META_COLUMNS,
  wordCount: articleRevisions.wordCount,
  blockCount: articleRevisions.blockCount,
  partCount: articleRevisions.partCount,
  sectionCount: articleRevisions.sectionCount,
  rootGist: articleRevisions.rootGist,
  hasTree: sql<boolean>`${articleRevisions.tree} is not null`.as("has_tree"),
  hasArc: sql<boolean>`${articleRevisions.arc} is not null`.as("has_arc"),
  hasTweets: sql<boolean>`${articleRevisions.tweets} is not null`.as("has_tweets"),
  hasGlossary: sql<boolean>`${articleRevisions.glossary} is not null`.as("has_glossary"),
  hasSummary: sql<boolean>`${articleRevisions.summary} is not null`.as("has_summary"),
}
```

`is not null` is evaluated in Postgres, so a 37 KB tree is read off disk by the server and never
crosses the wire — which is the whole difference between this and `row.revision.tree != null`.

**`sql<boolean>` rather than `isNotNull(...)`, and the difference is a type not a value.** Drizzle
0.45.2 types `isNotNull()` as `SQL<unknown>`, so the five flags would arrive as `unknown` and the
first `if (row.revision.hasArc)` would compile on anything. The runtime is fine either way —
node-postgres parses a Postgres boolean into a JavaScript `true`/`false`, checked against the live
database, not assumed — but a type that says `unknown` is a type that stops helping. GPT Sol's
third finding.

`.as(…)` on each, and it is **not** load-bearing: Sol went and read the installed driver, which runs
selects in `rowMode: "array"` so drizzle rebuilds the row by column index — five expressions
Postgres would all name `?column?` cannot swap. It is there so a statement in a slow-query log says
which flag is which, and because "the driver happens to be positional" is a thing that could change
under us.

**`headingTitle` (Part 5) is deliberately NOT in this projection.** It is not a column of
`article_revisions`, so a policy keyed by that table's columns cannot classify it, and the test that
asserts "this projection's keys are exactly what the policy grants" would have to special-case it.
It sits beside `revision` as a top-level selection in the list query instead.

**`REVISION_COLUMN_POLICY` grows a second axis**, because "the library reads `glossary`" and "the
library asks whether `glossary` is null" are now different facts and the test must be able to tell
them apart:

```ts
type ColumnUse = "value" | "presence";
const REVISION_READ_POLICY: Record<keyof Selected, Partial<Record<RevisionReader, ColumnUse>>> = { … }
```

with the presence aliases declared once, beside it, so the test computes the expected key set rather
than guessing a naming convention — and so the row type has somewhere to look. The test also asserts
no alias **shadows a column name**: `RevisionRowFor` checks the schema keys first, so a `hasTree`
that was also a column would silently be typed `Tree | null` instead of `boolean`, and
`if (row.hasTree)` would then be true for an article that has one and for none that don't.

```ts
/** Which column each `has…` flag is the presence of. */
const PRESENCE_OF = { hasTree: "tree", hasArc: "arc", hasTweets: "tweets",
                      hasGlossary: "glossary", hasSummary: "summary" } as const;
```

`RevisionRowFor` has to learn about them too. It currently maps every projection key through
`C extends keyof Selected ? Selected[C] : never`, which types a computed alias as `never` — so
`hasArc` would be unusable and the compiler would say so in a way that invites the wrong fix. It
gains one more arm:

```ts
type RevisionRowFor<K extends RevisionReader> = {
  [C in keyof (typeof REVISION_PROJECTIONS)[K]]:
      C extends keyof Selected ? Selected[C]
    : C extends keyof typeof PRESENCE_OF ? boolean
    : never;
};
```

The trailing `never` stays, and stays load-bearing: a projection key that is neither a column nor a
declared presence flag is still a type error at every use.

**And the two maps called `REVISION_COLUMN_POLICY` get different names.** There is one in
`src/store/pg.ts` (which read may take which column) and one in `src/store/pg-revisions.ts` (which
column a new draft carries, mints or derives). They are different maps with the same name in
adjacent files, which is how a change lands in the wrong one. They become `REVISION_READ_POLICY`
and `REVISION_CARRY_POLICY`. Another rename, another sweep.

The exhaustiveness that made the last change work is unchanged: every column is still a key, still
`Record<keyof Selected, …>`, so a new schema column is still a compile error until somebody
classifies it.

### 4. The comment count: one query for the page, not one per article

Today, per article:

```ts
.select({ count: commentsTable.id }).from(commentsTable).where(eq(articleId, …))
```

— which is not a count at all. It selects **every comment row's id** and calls `rs.length`. One
grouped query over the whole page's article ids replaces all of them:

```ts
db.select({ articleId: commentsTable.articleId, n: count() })
  .from(commentsTable)
  .where(inArray(commentsTable.articleId, ids))
  .groupBy(commentsTable.articleId)
```

with the empty-shelf case short-circuited. **Not because `in ()` would be a syntax error** — that
was the plan's first reason and it is wrong: Drizzle 0.45.2 compiles `inArray(col, [])` to a literal
`false`, so the query is valid and returns nothing. It is short-circuited because a round trip to
ask a question with no possible answer is a round trip. GPT Sol checked the claim; it did not
survive.

Articles with no comments are **absent from the result**, not present with zero — that is what
`group by` means, and defaulting a missing key to anything other than 0 is the way this goes wrong.

Ownership: the ids come from the already-owner-filtered list query, and the old per-article query
also filtered on `article_id` alone, so nothing changes. `comments.owner_id` exists and the schema
does not enforce that it matches the article's owner — a real invariant worth having, unrelated to
this change, and counted the same way before and after.

### 5. The title fallback, without reading every block

`metaFrom` keeps the rule and stops taking the blocks:

```ts
function metaFrom(slug: string, revision: MetaColumns, headingTitle: string | null): Meta
```

`loadArticle` already has the blocks in hand and passes
`blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ?? null`. `listArticles` gets the
same value from a correlated subquery in the list query — one row, not the article:

```sql
case when r.title is null and a.title_override is null then
  (select b.text from spideryarn.revision_blocks b
    where b.revision_id = r.id and b.kind = 'heading' and b.level = 1
    order by b.ordinal limit 1)
end
```

**The `case` is not decoration.** The fallback is only consulted when nothing stored a title, and a
reader's rename beats both — so a row with either is asking a question whose answer it throws away,
and an article with no `<h1>` at all filters every one of its block rows to find that out. On a
shelf of mostly-titled articles that removes nearly every execution. Sol's sixth finding on the
built code.

Two spellings of one rule is exactly the divergence Part 1 is removing elsewhere, so the SQL and the
TypeScript are pinned against each other by a test that runs both over the same eight real
articles and compares (Part 9 below). The alternative — a stored `heading_title` column — needs a
migration, and a peer is holding an uncommitted `drizzle/0019` in this tree; see § Deliberately not.

Note `metaFrom`'s parameter narrows from `RevisionRead` (the whole `article` row) to just the
`META_COLUMNS` shape, because the library row no longer has `tree` or `arc` to satisfy the wider
type. That is the narrow-type mechanism the last change installed doing its job: the compiler now
refuses to let the shelf's row pretend to be the reading view's.

### 6. The two skip rules, from the scalars

`listArticles` drops a row whose revision has no tree, and one with no blocks. Both stay, and both
now read a value the query already has: `hasTree`, and `blockCount === 0`.

**The plan first said neither has ever fired. That was wrong** and Sol caught it. `publishRevision`
refuses a revision with either problem (`reasonsNotToPublish`,
[`src/store/pg-revisions.ts:1038`](../../src/store/pg-revisions.ts)) — but the **importer does not
go through it**. It requires `blocks.json` and `tree.json` to exist and parse, and then guards the
block insert with `if (blocks.length)`
([`src/store/import.ts:567`](../../src/store/import.ts)) — so a `blocks.json` holding an empty array
imports as a published revision with no blocks and `block_count = 0`, and the pointer moves to it.
The skip is reachable, it is reachable through the tool this repo is currently migrating with, and
the new spelling has to behave exactly as the old one did.

### 7. What happens if the scalars are null anyway

They are nullable columns, and this change makes the shelf depend on them.

**The trigger is the four numbers, tested with `=== null`, and `root_gist` is not part of it.**
The plan first said "when any of the five is null", which is a bug: `deriveLibraryScalars` returns
`rootGist: null` deliberately, for an article with no root gist, no root summary and no excerpt.
That is valid, correct, computed data — and under the first rule every shelf request would have read
that article's whole text, logged a warning, and done it again next time. Sol's first finding, and
the shape of it is the one this repo keeps writing postmortems about: a fallback that fires on a
legitimate value looks exactly like a fallback that never fires.

`=== null` rather than falsiness for the same reason once removed: `wordCount`, `partCount` and
`sectionCount` are all legitimately `0`.

When one of the four numbers is null, the shelf **recomputes through `deriveLibraryScalars`** — the
same function that should have written them — and says so. It is correct if it ever fires, it is
loud, and it is the one derivation rather than a second guess at it. The alternatives are both
worse: `?? 0` prints a wrong number, and skipping the row makes an article vanish from its owner's
shelf.

**One query and one line, however many rows are affected**, and the first version of this got both
wrong. Sol's second finding on the built code:

- It was two queries and a `warn` **per row**. On a shelf where many rows were affected that is
  `2 + 2M` statements and `M` log lines — and Vercel drops everything past **256 lines per
  request**, so a widespread problem would have presented as "the tail of the logs is missing".
  [logging.md](../project/logging.md) already has the rule and even the shape: *if the number of
  lines a piece of code emits grows with the data, the caller says it once instead*, as
  `{ count, first five names, of }`, with the names **ordered** so the same broken shelf accuses the
  same articles twice running.
- The blocks and the tree were two concurrent statements. Under `READ COMMITTED` each takes its own
  snapshot, so an importer committing in between could have this derive a word count from one
  version's blocks and a part count from another version's tree — a wrong number, arrived at
  atomically nowhere. They come out of one statement now (`scalarInputsQuery`, `array_agg` over the
  blocks beside the tree), which is also why it is `array_agg` rather than `sum(words)`: the sum
  belongs to `deriveLibraryScalars` and nowhere else.

A database constraint would be better than a fallback, and it is **not** a column-level `not null`:
drafts start with these columns null on purpose. It would have to be a check constraint reading
roughly "if `status` is published then the four numbers are non-null", `root_gist` staying nullable.
That is a migration, and § Deliberately not says why there is not one in this change.

The branch will not run in practice, which is exactly why it gets tests that run it — **two** hollow
articles, not one, because with one, "a line for the page" and "a line per row" produce the same
single warning and reverting the aggregation stays green. It did.

### 8. `resolveProfile` alongside the artefact read — `src/routes.ts`, and its own commit

The parked half of the last plan. Four routes do:

```ts
const found = await loadGlossary(at);
send(res, 200, await withProfileChanged<GlossaryResponse>(at, found, found.glossary));
```

so `resolveProfile` — itself two queries — starts only after the artefact read has finished. They
are independent.

**`withProfileChanged` takes a thunk, not a promise.** The plan first said promise, and Sol was
right that it is the weaker seam: a promise parameter makes concurrency a *caller convention*, so
every route could go on writing `await loadGlossary(at)` first and hand over a promise that has
already settled — and a test of the helper would still pass. A thunk moves the responsibility
inside, where it can be proved:

```ts
async function withProfileChanged<R extends { profileChanged: boolean }>(
  slug: string,
  load: () => Promise<Omit<R, "profileChanged">>,
  stampOf: (found: Omit<R, "profileChanged">) => { profileHash?: string | null },
): Promise<R>
```

**The error semantics are why this was parked, and `Promise.allSettled` is the answer.**
`Promise.all` would reject with whichever failed first, so a reader asking for an article that does
not exist could get a profile error instead of a 404 — a real change, and a confusing one. Settling
both and rethrowing the artefact's rejection first preserves today's ordering exactly, while still
letting a profile failure through rather than swallowing it into `profileChanged: false`. Attaching
the `allSettled` immediately is also what keeps the losing rejection from going unhandled.

Starting `resolveProfile` for a slug that turns out not to exist is harmless: its shelf read already
catches, and it returns null.

**This is a separate commit from Parts 1–7**, per Sol's fifth finding, and it deserves its
reservation stated rather than buried. Parts 1–7 remove work. This one only *overlaps* work, and it
raises a single request's peak concurrent queries from two to three against a pool whose default
`max` is 5 — so under enough load it can move latency from one place to another rather than remove
it. It is worth doing because a reader waiting on a panel is the case that matters and the pool is
not the bottleneck for one reader; it is worth keeping separable because nobody has measured the
loaded case. It also touches `src/routes.ts`, which carries **+194/−68 lines of another agent's
uncommitted work**, so it may have to wait for that to land regardless.

## Deliberately not in this change

- **The sanitiser stamp**, deferred a second time, and the case for it is now *weaker* rather than
  merely unbuilt. It was worth a migration when six reads re-sanitised the whole article; after the
  glossary change and Part 3 here, the only read still doing it is `loadArticle` — which wants the
  HTML. A migration for that alone is a poor trade, and there is a concrete reason to wait besides:
  a peer is holding an uncommitted `drizzle/0020_comment_body.sql` and a modified
  `drizzle/meta/_journal.json` in this shared tree, so adding `0021` now means editing a file
  somebody else is mid-edit in. (The plan said `0019` until Sol pointed out it had already moved on
  while this was being written, which is the argument in miniature.) Named here so it stays named.
- **A check constraint for the scalars.** See Part 7 — the right shape is "published implies the
  four numbers are non-null", it needs a migration, and the fallback covers the case meanwhile.
- **A `heading_title` column.** Same migration argument; the subquery is one row per article and
  costs nothing at this scale.
- **HTTP caching on `/api/library`.** Same answer as last time: it would hide the cost rather than
  remove it, and there is nothing left to hide once this lands.

## How each part is checked

Every one of these has to be **watched failing** before it counts, per
[silent-success.md](../reusable/silent-success.md) — and the last change found four tests that
passed on broken code, one per review round, four rounds running. So the bar is not "name the edit
that makes it red". It is **name the edit that makes it red, and name what would keep it green
anyway**. Sol's fourth finding rewrote most of this list; the "stays green" column is its work.

| # | What it pins | The edit that must make it red | What could keep it green — and what stops that |
|---|---|---|---|
| 1 | The two stores answer identically | Return `wordCount + 1` from the Postgres shelf | A derivation bug that hits *both* stores; the suite skipping with no database. Report the run count, and Part 2's whole point is that there is now only one derivation to be wrong. |
| 2 | The shelf's real SQL | Replace a presence expression with the bare column | **Building SQL from `REVISION_PROJECTIONS.library` instead of from the query.** That is exactly the hole Sol found in the last change. So `listArticlesQuery(db, opts)` is exported as a seam and the test builds *it*. |
| 3 | Projection ⇄ policy | Drop `hasArc` from the projection, leave its policy grant | Editing both together; and the design must have somewhere to put `headingTitle`, which is why Part 3 keeps it out of the projection entirely. |
| 4 | No per-article reads | Restore either the per-row block read or the per-row comment query | **Four ways.** The pool wrapper failing to attach (so zero queries counted); a fixture with zero articles (so `1 + 2N` = 1); one batched read of every block row (constant, and still a megabyte); "two runs agree" rather than an absolute number. So: assert the wrapper attached, assert the fixture produced exactly N shelf rows, assert the **exact** query count, and assert no captured statement mentions `revision_blocks` when the scalars are present. |
| 5 | Comment counts land on the right article | Key the map by the wrong id, or default a missing article to something other than 0 | Counts that are all equal (so a mis-join is invisible) — so the three fixtures get three different counts, and one gets none. |
| 6 | The title fallback still fires | Remove the subquery | **A fixture whose revision title is not actually null.** Assert the null in the row before asserting the card. |
| 7 | The SQL rule and the TS rule agree | Change only the SQL to `level = 2`, or to `order by block_id` | Changing both; and a corpus where no article distinguishes the two orders. This one is worth the least of the twelve — I wrote both spellings — so it runs over the real `data/` corpus and says in the file that it is a consistency check, not a correctness one. |
| 8 | The null-scalar fallback | Remove the fallback (count goes wrong), or remove the warning (silent) | A falsy-zero bug; and **a legitimately null `root_gist` triggering it**, which is Sol's first finding. So there are two tests: one that nulls `word_count` and expects the fallback, and one with `wordCount: 0`, `partCount: 0`, `sectionCount: 0`, `rootGist: null` that expects **no** fallback and **no** warning. |
| 9 | `describeArticle`'s new shape | Swap `partCount` and `sectionCount`; break one rung of the gist chain | **The `summary` rung is untested today** — `tests/library.test.ts` covers root gist and total absence only. All four outcomes get a case: gist, root summary, excerpt, null. |
| 10 | The routes overlap, and the error order | Make the profile reject first, then swap `allSettled` for `all` | A helper test passing while the routes still `await` first — which is why Part 8 takes a **thunk**, so the helper starts both and the test can prove it. |
| 11 | The measurement moved — [`scripts/bench-shelf-reads.ts`](../../scripts/bench-shelf-reads.ts), run again after | Restore the old reads | The bench fail-opening: it shrugged if it could not find the pool to wrap, and reported 0. It throws now — as it does on an empty shelf, and on zero statements counted. And its "bytes decoded" was `JSON.stringify(rows).length` — not wire bytes, not memory — so it is `rowJsonBytesPerCall` now. |
| 12 | Everything else | A type error or a failing assertion | Behavioural regressions outside these twelve. `npm test` and `npm run typecheck` whole; `npm run lint` on the touched files. |

Two more, which are about the writers rather than the readers, and which exist because Sol's second
finding showed the plan had the wrong invariant:

13. **A re-import of unchanged text updates the scalars with the tree.** Import, change `words` and
    the tree's depths and the root blurb in the files, re-import: same revision id, and the stored
    scalars match the new files. Red if the importer ever updates `tree` without `...scalars`.
14. **An empty `blocks.json` still produces no shelf entry.** It publishes today, through the
    importer, and the old code skipped it on `blocks.length`. The new code must skip it on
    `block_count`.

### What the code review changed, after all that

GPT Sol reviewed the built code and returned **not ready to commit**, with three must-fixes. Every
one was real:

1. **It did not pass the gate.** Five typecheck errors in this change's own files — because
   `npx tsc --noEmit -p tsconfig.json` had been run instead of `npm run typecheck`, and the two do
   not check the same files. A wrong command is not a passing check, and it looks exactly like one.
2. **The fallback scaled with the damage**, in queries and in log lines, and could combine two
   database snapshots. Part 7 above is the rewrite.
3. **The parity test can no longer see a stale scalar**, because it imports every article
   immediately before comparing — so the columns it checks were written from the same files, moments
   earlier, by the same function. That loss is real, and the replacement is a new check that
   recomputes every current revision's five from the blocks and tree that are there *now* and
   compares. Proven red by deriving from one block fewer: eight real articles disagreed.

And four smaller ones, all acted on: the shelf-SQL test rejected `html` and `fts` but would have
accepted a *join* over the block table at two statements (it now counts reads of that table and
requires exactly one); the corpus title test caught every error and not just a foreign fixture's
404, so it would have swallowed the failure it exists to expose; the title subquery ran for every
row (now a `case`); and the presence flags got aliases.

**And one thing the review did not find, which the mutation pass did.** With one hollow article in
the fixture, "one warning for the page" and "one warning per row" produce the same single line —
so reverting the aggregation left every assertion green. There are two hollow articles now. That is
the fifth round running in which a test in this pair of changes passed on broken code, and the
fourth distinct *shape* of it.

**Not checked, and named rather than implied:**
- Nothing here measures production. The numbers are a laptop against a local Supabase, and the
  ratio is what they are evidence for, not the milliseconds.
- Check 4 pins the *shape* of the reads, not their cost. Check 2 is what stops "constant number of
  queries, each a megabyte", and only for the revision row and the block table.
- Check 7 compares two implementations written from the same sentence. It catches drift, not a
  misreading.
- The invariant audit runs against whatever is in the local database. It is a strong check of the
  writers on this machine and says nothing about production's rows.
- Nobody has measured the loaded case for Part 8. See its own paragraph.
