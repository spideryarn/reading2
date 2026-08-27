# "Looking for a glossary…" when the glossary is already on screen

Greg, 2026-08-27:

> Why does "Looking for a glossary" take so long (when one already exists)?

It is not the model, and it is not the job queue. `status === "loading"` in
[`GlossaryPanel.tsx:203`](../../src/web/GlossaryPanel.tsx) lasts exactly as long as one
`GET /api/glossary/:slug`, and nothing else gates it. So the whole question is why that request
is slow for a 10 KB artefact that was written days ago — and the answer is that the request is
made twice, and each one reads most of the article out of Postgres to compute a boolean.

This is the same bug [`tests/store-revision-columns.test.ts`](../../tests/store-revision-columns.test.ts)
was written about, one step further in. That test's own header says it: *"the interesting half is
not 'rawBytes is absent' — it is 'and nothing else is'."* It stopped `raw_bytes` and froze
everything else in place.

## What actually happens, per request

On the Postgres store, which production is required to use
([`src/store/index.ts:160`](../../src/store/index.ts)), `loadGlossary`
([`src/store/pg.ts:755`](../../src/store/pg.ts)) does this:

1. **`currentRevision(slug)`** selects `revisionColumns` — every column of `article_revisions`
   except `raw_bytes`. That includes `extracted_html` and `stamped_html`, which are the whole
   article twice over, plus `tree`, `arc`, `tweets`, `summary`, `ideas` and `labels`. One of
   those columns is wanted.
2. **`blocksFor(revision.id)`** reads every block row — `text`, `html`, and `fts`, whose own
   schema comment says *"GIN, because this column is queried with `@@` and never selected"*
   ([`src/db/schema.ts:541`](../../src/db/schema.ts)). It exists here only to compute `stale`, and
   `hashBlocks` reads `id` and `text` and nothing else
   ([`src/source-hash.ts:36`](../../src/source-hash.ts)).
3. **`sanitizeStoredBlocks(blocks, undefined)`** ([`src/store/pg.ts:296`](../../src/store/pg.ts)).
   There is no sanitiser-stamp column, absent reads as stale, so it re-cleans every time: a jsdom
   parse of the whole article, to sanitise HTML that this request then throws away.
4. A `glossary_lookups` query.
5. **`withProfileChanged`** ([`src/routes.ts:2224`](../../src/routes.ts)) → `resolveProfile(slug)`.

Measured on `data/constitution` (360 blocks, 152 KB of block HTML), on Greg's laptop:

```
  sanitizeStoredBlocks, cold    184 ms
  ... warm                       76 ms
```

And the bytes, estimated from the same article's artefacts on disk:

```
  currentRevision   extracted_html ~152K + stamped_html ~152K + tree 140K
                    + labels 48K + ideas 11K + glossary 10K + arc 2K   ≈ 515 KB
  blocksFor         360 rows × (text + html + fts)                     ≈ 400-500 KB
  ------------------------------------------------------------------------------
  to return                                                               10 KB
```

Roughly 0.9 MB from Supabase to a Vercel function, plus 80–180 ms of jsdom, to answer a request
whose body is 10 KB. On the filesystem store none of this happens
([`src/api.ts:305`](../../src/api.ts) reads two files and does not sanitise), which is why it does
not reproduce locally.

**Both numbers are laptop-and-disk evidence, not wire evidence**, and Sol was right to say so.
They are the sizes of the on-disk artefacts that became those columns, and the sanitiser timed on
this machine. Nobody has measured production p50/p95 with spans per query. What they establish is
that the waste is real and roughly where; they do not establish the ordering of the costs, and
this plan does not pretend to. Sol's inferred warm ordering — sanitisation and row transfer, then
the serial query waterfall, then the small queries, then `guardDbStore`, which is only a wrapper —
is the best guess available and is not evidence either.

**And the sanitiser's cold cost does not go away.** `src/sanitize.ts:59` builds a `JSDOM("")` at
**module load**, so the import is paid on the first request to a cold function whether or not
anything calls the sanitiser. Part 2 removes the per-request parse, not the cold start.

### And it happens twice

`useGlossaryTerms` runs at `Reader` mount for **every reader of every article**, because the
underlines in the prose are a standing property of the article since 2026-08-26
([`App.tsx:727`](../../src/web/App.tsx)). It fetches the whole `GlossaryResponse` and keeps the
entries.

When the reader opens the band, `GlossaryBand` mounts `useGlossary`, which starts from
`status: "loading"` and fetches the identical URL again. Nothing is shared between them: there is
no read cache in `lib/api.ts` (the offline copy is a fallback for a failed request, not a cache
hit) and the route sets no `Cache-Control`.

So the panel says **"Looking for a glossary…"** while the list it is looking for is on screen,
underlined, in the prose behind it.

**The wait is one request long, not two.** They are concurrent, not serial — the duplication is
why a second expensive request exists at all, and it is why the panel waits when it did not have
to, but it does not double the panel's wait. The plan said otherwise until Sol corrected it.

## What to change

Three parts. The first removes the message; the second and third make the request that is left
cost what it should. All three are as revised after
[GPT Sol's review of this plan](glossary-read-latency-review-sol.md), which returned *not ready to
build* and was right on every claim I checked.

### 1. Render what we have, revalidate behind it — client

Today the split is: `useGlossaryTerms` fetches (everyone pays), `useGlossary` fetches again and
adds the job poller (only the band pays). The stated reason for the split
([`useGlossary.ts:33`](../../src/web/useGlossary.ts)) is that `useGlossary` *"also mounts
`useJobs`, which polls the job list forever"* — and that reason is still good. But it is about
`useJobs`, not about the GET, and the GET became universal when the underlines did.

So: **`Reader` owns the read, `GlossaryBand` owns the jobs and the verbs.**

- `useGlossaryRead(slug)` replaces `useGlossaryTerms`, returning the whole read state the panel
  needs — `status`, `glossary`, `stale`, `outdated`, `profiled`, `profileChanged`, `error` — plus
  the three mutations below. Same one GET on mount, no poller, still called unconditionally in
  `Reader`.
- `useGlossary(slug, read)` takes that state instead of fetching, and keeps everything else:
  `useJobs`, `job`, `find`/`more`/`reset`/`look`/`cancel`.
- `setEntries`/`onEntries` and the `pushed` ref go away with the second copy.

**"Exactly one request for the page's lifetime" is the wrong invariant**, and this is Sol's
finding that changed the design. The band fetches on *mount* today, and that mount fetch is load-
bearing: `useJobs` treats its first poll as a baseline and deliberately does not call `onFinished`
for a job that was already `done` ([`useJobs.ts:334`](../../src/web/useJobs.ts) — `if (!first)`).
So if another tab writes a new glossary while this band is closed, opening the band would show the
old list *for ever*. Verified in the code, not taken on trust.

The band therefore still revalidates when it opens — but **in the background**, behind the list it
already has. `status` never goes back to `loading` once it has been `ready` or `none`. The real
invariants are:

- the band **never** shows a loading state for a list the read already resolved;
- a request already in flight is **not** duplicated — opening the band while `Reader`'s first GET
  is outstanding makes no second request;
- a job finishing anywhere still lands, because the mount revalidate is still there.

**Three mutations, not just `reload()`.** The plan had only `reload()`, and Sol showed that cannot
carry the verbs the band already has:

- `reload()` — refetch; joins an in-flight request rather than starting a second. The band's mount.
- `refresh()` — refetch **because the list on the server has changed**: a job finished, a term was
  checked. A request already in flight may have read the database *before* that change, so it is
  not an answer — this arms a trailing fetch that runs after it. Both were `reload()` at first,
  and Sol showed what that costs: a GET reads the old list, a job writes a new one, `onFinished`
  joins the GET, it lands with the pre-job list, and `useJobs` has already announced the job, so
  the new terms never arrive.
- `clear()` — `reset()` empties the list the moment the DELETE succeeds, so the panel does not go
  on showing what the reader just threw away. It clears the error too.
- `patchEntry(id, lookup)` — `look()` merges one checked term without refetching. **The id and the
  lookup, not the entry**: `lookUpTerm` returns a snapshot taken before a thirty-second model call,
  so applying the whole entry puts a pre-job name, aliases and scores back over a regeneration.

**A generation counter, not the `pushed` ref.** `live` only guards a slug change; it does not order
two operations on one slug. Every fetch takes a generation, and a reply from an older one is
dropped. `clear()` bumps it — the list it would restore has been deleted. **`patchEntry` does
not**, and that asymmetry is deliberate: bumping there would cancel an in-flight reload, and the
commonest reason one is in flight is that a job has just finished, so a reader who checked a term
at the wrong moment would silently never see the new terms. The opposite risk — a read that
started before the lookup was stored landing after it — is repaired by the trailing fetch instead
of accepted. That is what stops a GET issued before a DELETE from landing
after it and restoring the list — the same class of bug `pushed` was added for, held against a
sequence `pushed` cannot see.

**Seeding with the entries alone would be wrong**, which is why this is a refactor and not a prop.
`stale`, `outdated` and `profileChanged` are the three sentences the panel says about a list that
no longer describes the article or the reader. A seed carrying entries but not those flags would
render a stale glossary as a fresh one — a check reporting success while the thing it checks is
unknown ([silent-success.md](../reusable/silent-success.md)).

The merged hook keeps `useGlossary`'s error handling, not `useGlossaryTerms`' swallowed one: the
panel renders the message, so it has to exist.

### 2. Don't read the article to hash it — server

`blocksFor` has **seven** call sites, not the five this plan first claimed; `listArticles` is the
one I missed. Four of them want only a hash. Split it:

- **`blockHashInputs(revisionId)`** — `select({ id: revisionBlocks.blockId, text: revisionBlocks.text })`,
  `order by ordinal`, no `html`, no `fts`, **no sanitiser**. Aliased to `id`, because `hashBlocks`
  reads `id` and `text` ([`src/source-hash.ts:36`](../../src/source-hash.ts)) and `blockId` is the
  column name — the two must be spelled to agree or the hash is over `undefined`.
- `loadTweets`, `loadGlossary`, `loadSummaries` and `loadIdeas` use it. All four already reduce
  the blocks to a hash and discard them.
- The four staleness functions take `Block[]` today and must narrow to
  `readonly Pick<Block, "id" | "text">[]` — `tweets.ts:106`, `glossary.ts:705`, `summarise.ts:776`,
  `ideas.ts:123`. Widening the row to satisfy the old signature would put `html` straight back.
- `loadArticle`, `articleMetadata` and `listArticles` keep the full `blocksFor` — the first hands
  `html` to a renderer and must stay sanitised.

**Skipping the sanitiser is safe, and the reason is written down rather than assumed.**
`sanitizeStoredBlocks` *"does not touch `text`"* ([`src/sanitize.ts:127`](../../src/sanitize.ts)),
and the implementation only ever rewrites `html` (`sanitize.ts:147`). So the hash over unsanitised
rows is byte-identical to the hash the filesystem store computes, which is what keeps the two
stores agreeing about `stale`.

And in `blocksFor` itself: **name the columns**, dropping `fts`. A bare `.select()` takes every
column including the generated tsvector, which the schema says is *"never selected"*
([`src/db/schema.ts:541`](../../src/db/schema.ts)) and which is selected on every article load.

### 3. A projection per read, and a policy that has to be exhaustive — server

`currentRevision` selects one shared set for six reads, and `REVISION_COLUMNS` is shared with two
more: `listArticles` ([`pg.ts:497`](../../src/store/pg.ts)) and `publishRevision`
([`pg-revisions.ts:1096`](../../src/store/pg-revisions.ts)). Narrowing it to "everything except
the two HTML columns" would still hand the glossary read the tree, the labels, the ideas and the
summaries. Sol's call, and it is right: **a projection per use**.

- glossary / tweets / summaries: revision `id` + that one artefact (the article's `id` comes off
  the `articles` half).
- ideas: `id` + `ideas` + `tree` — the tree, because `ideasAreStale` compares it and dropping it
  would make Postgres report current what the filesystem reports stale.
- article: the `metaFrom` scalars + `tree` + `arc`.
- metadata, library, publish: their own sets.

`extracted_html` and `stamped_html` are read by nothing that goes through here. Sol traced it
independently and agrees: carry-forward derives its own list (`pg-revisions.ts:234`), export
selects the full row on purpose (`export.ts:235`), import writes them, `pg-admin.ts` does not read
revisions at all.

**The column guard becomes a policy map, because the union test Sol was shown is a tautology.**
If the selected set is still built by object-rest from `getTableColumns`, a new schema column
enters it automatically and `selected ∪ omitted === all` stays green — proving nothing. So:
`REVISION_COLUMN_POLICY` is an exhaustive map keyed by every column of `article_revisions`, saying
which reads may take it. The test asserts the map's keys equal the table's columns exactly, and
that **each real projection equals the columns the policy assigns it**. Adding a column then fails
until somebody classifies it, which is the guarantee the old test had and the union test loses.

### 4. Stop waiting on things that could have run together — server

Inside `loadGlossary` the block read and the lookups query are serial today and are independent
once the revision is known. `Promise.all` them.

The bigger one — `withProfileChanged` starting only after `loadGlossary` returns
([`routes.ts:2936`](../../src/routes.ts)) — is **not** in this change, and the reason is error
semantics rather than effort: starting `resolveProfile` early means either swallowing its failure
(which would silently report `profileChanged: false`) or holding it to rethrow, and neither should
be decided in a change about column widths. Follow-up, named here so it is not lost.

## Deliberately not in this change

- **The sanitiser-stamp column.** [`src/store/pg.ts:291`](../../src/store/pg.ts) already specifies
  it — on `article_revisions`, not on `revision_blocks`, and says why. It would take the re-clean
  off `loadArticle` too. It needs a migration and a backfill decision, and part 2 above removes
  the sanitise from the four reads this plan is about without one. Follow-up.
- **`listArticles`.** It has both bugs and worse: `revisionColumns` whole *and* every block row,
  **once per article**, for a page that wants titles, counts and a blurb. The four `!= null`
  presence checks could be `is not null` in SQL so no JSONB crosses the wire, and `word_count` is
  already a stored column. Same shape, different page, and folding it in here would make this
  change about two things. Follow-up, and it is the bigger win of the two.
- **HTTP caching on the route.** Real, but the honest fix is to stop *waiting* on the second
  request, and part 1 does that. A cache would only hide it.
- **`reset()` in production.** It already answers **501**: deleting a glossary under `postgres`
  nulls a column on a published revision, and that table is immutable once published, so step 11
  of [postgres-storage-implementation.md](postgres-storage-implementation.md) owns the decision
  and it stays refused ([`src/store/index.ts:253`](../../src/store/index.ts)). Sol raised it, and
  the consequence for *this* change is narrow but real: **any test of `reset()` with a mocked
  successful DELETE is not describing production.** Say so in the test rather than implying the
  button works.

## How each part is checked

**A check that has never been seen fail is not evidence.** Every guard below was verified by
removing the mechanism it protects and watching it go red. Three of them passed on the broken code
the first time they were written, and each is described here with what was wrong, because that is
the more useful half.

1. **No visible wait.** `tests/glossary-one-fetch.test.tsx` mounts the two hooks the way `Reader`
   and `GlossaryBand` do, over a `fetch` whose replies are **held** until the test releases them.
   The band is opened with nothing released, so a list on screen at that moment is one it already
   had. *Seen red on `main`:* `expected 'loading:0' to be 'ready:1'` — the reported bug,
   reproduced. The first draft resolved replies immediately and passed on the broken code, because
   the flash was real and invisible.
2. **No duplicate of a request in flight.** *Seen red:* `expected 2 to be 1`. The assertion is on
   the rendered terms **by name** and on all three flags — "no loading message" also passes with
   an empty list, or with no panel at all.
3. **A job finished while the band was closed still lands.** Red when the band's mount revalidate
   is deleted.
4. **A job finished while a request was in flight still lands.** The sequence Sol found in the
   built code: a GET reads the old list, the job writes a new one, and a reload that merely
   *joins* that GET is answered with the pre-job list — for ever, because `useJobs` has already
   announced the job. Red when `onFinished` uses `reload` instead of `refresh`.
5. **A checked term survives a read that was already out.** Red when `patchEntry` does not arm the
   trailing read.
6. **A failed revalidation does not take the list away.** Red when the catch sets `error`
   unconditionally. Paired with its opposite — an opening read that fails *must* report `error` —
   so it cannot pass by never reporting anything.
7. **Races.** Slug switched mid-request, and `reset()` while a GET is outstanding. Both red
   without the generation counter — but only after two fixes to the test itself: the mock returned
   the same list for every slug, so it could not tell a dropped reply from a landed one; and
   replies were released oldest-first, so the newest landed last and won by luck. It now returns
   per-slug terms and releases **newest first**, which is the order that hurts. The `reset()` case
   carries a comment saying its DELETE is mocked successful and that production answers 501.
8. **The mock answers with the state at request time**, not at reply time. Getting this wrong made
   4 and 5 tautologies: a request issued before a change was answered with the state after it, so
   joining a stale request and running a fresh one were indistinguishable and both passed.
9. **The wiring, not just the hooks.** `tests/glossary-band-wiring.test.ts` reads `App.tsx` and
   asserts one `useGlossaryRead`, the read passed to the band, and no `onEntries`. Red when a
   second `useGlossaryRead(slug)` is added. It is a source-level test and says so: it cannot tell
   a call in dead code from one that runs. What it catches is the exact regression this change is
   about, which no behavioural test in that file can see.
10. **The queries, against the generated SQL.** `tests/store-block-reads.test.ts` builds both
    block queries through `QueryBuilder` — no database — and asserts `html` and `fts` are absent
    from the fingerprint read, `html` present and `fts` absent from the rendering read, and
    `order by ordinal` on both. A column constant can be right while the query says `.select()`,
    and a fixture array already in order proves nothing about the SQL. **Both** queries, because
    guarding one is how the other goes back to `.select()`.
11. **The hash is unaffected by what was dropped.** Same file: `hashBlocks` over two unsanitised
    columns equals `hashBlocks` over whole sanitised blocks. The fixture contains an `onclick` the
    sanitiser actually strips, and the test asserts it was stripped — an input the sanitiser
    leaves alone would prove nothing.
12. **The projections obey the policy.** `tests/store-revision-columns.test.ts`: the policy map's
    keys equal the table's columns, and each projection's keys equal what the policy grants it.
    Red when `arc` is dropped from the `article` projection. A missing policy key is caught
    earlier still — `Record<keyof $inferSelect, …>` makes it a **compile** error, which is how
    `rawSourceSha256` was found during the build.
13. **The two stores still agree.** `tests/store-parity.test.ts` compared tweets, glossary and
    summaries and **not ideas**, which this change touches; ideas is added and runs against 7 real
    articles. The tree-only case it cannot cover — nobody re-sections a fixture — is asserted as a
    property instead, in `store-block-reads.test.ts`: same blocks, two different cuts, different
    fingerprints.
14. `npm test` and `npm run typecheck` whole; `npm run lint` on the touched files.

**Not checked, and named rather than implied:**

- Nothing here measures latency or transferred bytes **in production**. The numbers in this plan
  are from disk and from this laptop. The real ordering needs spans around authentication, pool
  acquisition, each query with its row decoding, the sanitiser and serialisation, split by cold
  and warm. That is a piece of work of its own.
- The `Promise.all` in `loadGlossary` overlaps two queries **when the pool has room**.
  `DATABASE_POOL_MAX=1`, or a saturated pool, serialises them again.
- `tests/glossary-band-wiring.test.ts` is text matching, with the limits above.

## What this does not fix

If the glossary genuinely has not been written yet, the panel says so immediately (`status:
"none"`) and finding one is a model call over the whole article that takes tens of seconds. That
is the job queue working as designed and the panel already explains it. This plan is only about
the case Greg asked about: one exists, and we take a second to admit it.
