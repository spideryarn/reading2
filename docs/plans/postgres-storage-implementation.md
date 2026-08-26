# Implementing Postgres storage

> we had been planning to shift over from JSON flat files → Postgres (using Supabase) … finish
> implementing storing in a database.
>
> — Greg, 2026-08-26

**This is the doing document.** The thinking is
[postgres-migration.md](postgres-migration.md) — the schema, the seven decisions, the traps, and why
each went the way it did. That plan ends at *"the order of work"* and was never executed past step 3.
This one executes it, and is kept updated as it goes so that a subagent dropped in anywhere can see
what is done, what is next, and what has already been decided and must not be relitigated.

Read [postgres-migration.md § The traps](postgres-migration.md#the-traps) before touching anything
here. Every one of them is a way this work fails while reporting success.

---

## The four calls Greg made on 2026-08-26

Asked before any code was written, so the plan is written *to* them.

| | Decision | What it rules out |
|---|---|---|
| **Scope** | **Full cutover.** Postgres becomes the only store — reads, writes, comments, jobs | No permanent dual-write, no "files win on conflict". The filesystem adapter and the exporter survive one release as the rollback and are then deleted |
| **`owner_id`** | **Seed one dev user; the uuid comes from env** | Not building the beta gate as part of this. Not dropping the `auth.users` FK either — the FK stays real and enforced from the first insert |
| **Remote** | **Local only.** Everything against the Docker stack | Nothing is applied to `alschkahzfagtppxspfq`. The remote path is written and typed but not run; the billing banner is still [open question 1](postgres-migration.md#open-questions) |
| **Existing data** | **Import all four articles, keep the files** | `data/` is not deleted. It stays as the belt-and-braces backup and as the input to the parity comparison |

A consequence of the first, worth saying plainly because it changes everybody's morning: **after
cutover, `npm run dev` needs Docker and `npm run db:start`.** That is the cost of the decision, it
was visible when the decision was made, and it is not a bug report.

## Progress

Legend: ✅ done · 🔵 in progress · ⬜ not started

| # | Step | State |
|---|---|---|
| 0 | Owner seeding, shared TLS decision, runtime connection | ✅ |
| 1 | Schema caught up with the codebase (5 artefacts, 2 defects) | ✅ |
| 2 | Storage contracts, filesystem-backed | ✅ |
| 3 | Importer | ✅ |
| 4 | Postgres reader | ✅ |
| 5 | Parity test: both stores, API-shaped | ✅ |
| 6 | Exporter (the rollback), round-trip test | ✅ |
| 7 | Reads served from Postgres behind `SPIDERYARN_STORE` | ✅ |
| 8 | Artefact manifest test — the guard against the next file | ✅ |
| 9 | Comments — writes | ✅ |
| 9b | Shelf state — archive, rename, opens — and library-wide search | ✅ **added 2026-08-26**, both adapters. See [library-shelf-actions-and-search.md](library-shelf-actions-and-search.md) |
| 10 | Chat, searches, glossary lookups — writes | ⬜ |
| 11 | Pipeline writes to draft revisions (+ carry-forward) | ⬜ **needs coordination** |
| 12 | Jobs and claiming | ⬜ |
| 13 | Cutover: flip the default, delete the filesystem adapter | ⬜ |

**One thing found on 2026-08-26 that step 13 needs, and nothing currently does.** `scripts/db-import.ts`
upserts rows but never **deletes** ones that have gone from disk. A comment deleted on the filesystem
stays in Postgres for ever, so `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts` go red
on drift that is not a code bug — and, worse, cutover day would resurrect deleted comments while
reporting a clean import. The fix is a reconciling import (delete reader-state rows for an article
that the files no longer have) or an explicit "import is only ever run into an empty article", said
out loud. Not fixed here because it is squarely step 10–13's business, but it is the reason those two
tests are currently failing on this machine.

### Step 0 — done

| File | What it is |
|---|---|
| [`src/owner.ts`](../../src/owner.ts) | who owns a row, and the `OwnerId` brand. **The one file the beta gate has to change** |
| [`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts) | `npm run db:seed-owner` — creates the local dev user in `auth.users` |
| [`src/db/ssl.ts`](../../src/db/ssl.ts) | the TLS decision, as a value. Extracted from `db-migrate.ts` so the migrator and the app cannot disagree about whether the server is verified |
| [`src/db/client.ts`](../../src/db/client.ts) | the runtime pool, typed by the schema |
| [`tests/db-ssl.test.ts`](../../tests/db-ssl.test.ts) | 8 assertions, no database needed |

Two things settled here that are easy to get wrong later:

- **The dev owner's uuid is a constant**, `00000000-0000-4000-8000-000000000001`, not whatever
  GoTrue felt like minting. A random id has to be copied into `.env.local`, and then
  `npm run db:reset` throws the user away and every `owner_id` in the database points at nobody.
  A constant survives a reset and is the same on a fresh clone. GoTrue's admin API accepts an
  explicit `id` — checked, not assumed.
- **The dev owner's email is `dev@spideryarn.local`**, deliberately not a real address. Nothing logs
  in locally, so the value is never read for anything; a personal email in committed source would
  earn nothing.

## The seams

Three, and they are not the same shape, which is the thing most estimates of this work get wrong.

1. **Reads** go through [`src/api.ts`](../../src/api.ts). One file, one set of functions.
2. **Pipeline writes** go through `PipelineStep.outputs(ctx): string[]` — an interface that returns
   **file paths** — implemented across the stage modules. There is no single file to swap.
3. **Jobs and comments** have their own stores, and carry module-level in-memory state that assumes
   one server process.

All three are now behind `src/store/contracts.ts`, and `src/store/fs.ts` is seam 1 and 3 wired to
the code that already existed. Seam 2 is untouched — that is step 9, and it is the wide one.

## Rules for this work

- **Never catch a Postgres error and fall back to files.** It hides divergence and makes the whole
  parity exercise worthless. From [the order of work](postgres-migration.md#the-order-of-work), and
  it is the single most important line in it.
- **`(article_id, block_id)`, never `block_id` alone.** A global unique index starts rejecting valid
  rows at around a hundred articles; a global upsert silently overwrites one article's paragraph
  with another's.
- **A block id is an identity; its text is a revision.** `block_identities` never loses a row, so a
  re-extraction that drops a paragraph does not destroy the reader's question about it.
- **`npm run db:migrate`, never `drizzle-kit push`.** And never `supabase db reset --linked`.
- **Compare the API-shaped `Article`, not SQL rows.** Row-level comparison passes while the thing
  the client receives has changed shape.

## See also

- [postgres-migration.md](postgres-migration.md) — the design, and every decision behind it
- [database.md](../project/database.md) — where the data lives, and how to connect to the remote
- [supabase-local.md](../project/supabase-local.md) — the Docker stack this is built against
- [block-ids.md](../project/block-ids.md) — the spine every table keys on
- [silent-success.md](../reusable/silent-success.md) — the pattern behind every trap in the plan

## What the schema was missing, and how it was found

The schema was written on 2026-08-25 and the codebase moved under it within a day. Five artefacts
had no home at all, and two were outright defects:

| Artefact | Where it went | Why |
|---|---|---|
| `summary.json` | `article_revisions.summary` JSONB | pipeline output, generated and replaced wholesale |
| `labels.json` | `article_revisions.labels` JSONB | ditto — and it is a **`toc` output, not a step**, so it gets no `revision_step_runs` name |
| `chat.json` | `chat_threads` + `chat_messages` tables | a message is individually created, retried, edited and stopped: a feature owns a row |
| `searches.json` | `search_runs` table, `hits` JSONB | the run is the reader's object; its hits are one model call's wholesale output |
| `glossary-lookups.json` | `glossary_lookups` table | article-scoped reader state, and a row upsert kills the file's read-modify-write race |

**Two defects.** `jobs.guidance` was missing though the type has always carried it — a job resumed
without its steer runs the plain prompt and reports success. And `revision_step_runs`' CHECK listed
seven step names when `StepName` has eight; a `summary` step run would have been rejected.

**The rule, so the next artefact takes five minutes:** a *pipeline* artefact becomes a whole-artefact
JSONB column on the revision, plus a `revision_step_runs` CHECK entry **if it is a `StepName`**.
*Reader state* becomes its own table keyed on `(article_id, …)` with an `owner_id` — **never** on a
revision, because a revision-keyed blob is deleted by re-extraction, which is the exact failure the
identity split exists to prevent.

### Why not one generic artefacts table

It was tempting given the churn, and it is wrong: **the artefacts do not share a key.** `summary` is
revision-scoped; `glossary_lookups` is article-scoped reader state; chat is article-scoped with
per-row ownership. A `revision_artifacts(revision_id, kind, payload)` table cannot hold the reader
state *correctly* — it gets the scope wrong, not merely the constraints. The recurring decision per
artefact is precisely "which key does this hang off", and a generic table is a machine for skipping
that decision and getting it silently wrong.

## Two things caught in review

Fable reviewed the schema gap on 2026-08-26 (GPT Sol was unavailable — see § What is not done).

1. **`currentOwnerId()` contradicted its own file.** `src/owner.ts` says an unset owner "must fail
   loudly at the boundary", and the code then fell back to the development constant unconditionally.
   In production that fails as an `auth.users` foreign key violation — which reads as a database bug
   and sends you to the schema, three layers from the actual fault of one unset variable. It now
   throws when `NODE_ENV=production` or `VERCEL` is set.
2. **Entry ids became a promise and the schema comment still called them an implementation detail.**
   `glossary_lookups` is keyed by one, and `?term=` addresses one in the URL. So `dedupe` in
   `src/glossary.ts` must go on preserving ids across passes; a tidy-up that let it mint fresh ones
   would orphan every lookup silently. The comment now says so.

## The bug this work has already caused, and what it teaches

The first importer read `comments.json` as a `Comment[]`. The file is `{ "comments": [...] }`. So
the parse succeeded, the array was `undefined`, the length check concluded the file was absent, and
**a 17 KB file of the reader's questions imported as zero comments while printing a tick.** All four
reader-state files wrap their payload the same way, so that mistake was available four times over.

The fix was not to correct the shape. It was to stop reading the files at all: the importer now
goes through `loadComments`, `loadThreads`, `loadRuns` and `loadLookups` — the app's own loaders,
which already know each file's real shape and already return `[]` for a missing one. **An importer
that reads files its own way can disagree with the reader about what is on disk, and that is the one
thing an importer must never do.** See [silent-success.md](../reusable/silent-success.md).

## How to run it

```bash
npm run db:start          # Docker + the Supabase stack
npm run db:migrate        # apply drizzle/
npm run db:seed-owner     # the one auth.users row every owner_id points at
npm run db:import         # data/<slug>/ → Postgres, idempotent
SPIDERYARN_STORE=postgres npm run dev
```

And back out again, which is the point of having an exporter at all:

```bash
npm run db:export -- --out /tmp/rollback     # --out is required, no default
```

## Verified, not assumed

- **1131 tests pass**, including 19 parity assertions comparing the API-shaped `Article` from both
  stores for all three real articles, and 38 round-trip assertions comparing every artefact after
  `data/` → Postgres → `data/`.
- **Both new suites were checked by breaking them.** Dropping `ORDER BY ordinal` from the Postgres
  reader fails 10 of the 19 parity assertions; adding a `highlights.json` nobody has a home for
  fails the manifest test with a message naming the file.
- **The reading view was driven in a real browser** against `SPIDERYARN_STORE=postgres`: the library
  lists all three articles with bylines, reading times, blurbs, word counts and comment counts; the
  reading view renders prose in document order with its real block ids, tree labels and arc; the
  360-block article renders; there are no console errors. Every request across the session was 200,
  with the one deliberate 400 (traversal) and 404 (unknown slug) and **zero 5xx**.

## What three investigation subagents found that I had not

Their reports arrived late, after the reads were already committed. One of them cost me a bug.

1. **The library was ordered on `fetched_at` alone, and Postgres sorts NULLs FIRST under DESC.**
   So every article that never got a `fetched_at` went to the top of the shelf. The parity test
   passed anyway, because the one real article with a null `fetched_at` happens to be the newest —
   both stores agreed *by accident*. Fixed with `coalesce(fetched_at, created_at)`, exported as
   `ADDED_AT` so a test can exercise the real expression against three rows built to be **unlucky**:
   the null one in the middle by date. Asserting the ordering property against the articles we
   happen to have could not fail, and a test that cannot go red proves nothing.
2. **The pipeline stages do not write atomically, and everything else does.** `comments.ts`,
   `chat.ts`, `searches.ts`, `glossary-lookups.ts` and `jobs.ts` all write to a temp file and
   `rename()`; all eight pipeline stages use a plain `writeFile`. `writeFile` truncates first, so a
   process killed mid-write leaves a file that exists and will not parse — and `stepIsDone` is an
   existence check, so the step reports itself **done**. This is a real gap independent of the
   migration, and it is an argument *for* the migration rather than a task within it: a transaction
   makes it impossible.
3. **Content-hash freshness is 3 of 8 stages, not "1 of 6".**
   [postgres-migration.md § This codebase](postgres-migration.md#this-codebase) says one; `tweets`,
   `glossary` and `summary` all have a real `isDone` now, while `toc` and `arc` still fall back to
   bare existence. That paragraph should be corrected rather than left to mislead the next reader.
4. **`comments.ts`'s write mutex is module-global, not per-slug** — one queue for every article. Not
   a bug, but it means comment writes across the whole library serialise behind each other, and the
   Postgres version does not.
5. **The fixture fallback is a property of the design, not of the filesystem.** `loadArticle` falls
   through to `example/` for any slug with no artefacts, so "refused" and "here is the demo" are
   indistinguishable in the response — which is how a path traversal read as safe. Postgres has no
   directory to walk out of, and the Postgres reader deliberately 404s instead of falling through,
   so the ambiguity is gone. That is a behaviour change, and it is the right one.

## What the cross-family review found

GPT Sol reviewed the four commits on 2026-08-26 (`gpt-5.6-sol`, high effort, via
[run-codex.ts](../../scripts/run-codex.ts)). Its answer is kept verbatim in
[postgres-storage-review-sol.md](postgres-storage-review-sol.md); the prompt is in
[postgres-storage-review-prompt.md](postgres-storage-review-prompt.md). Its verdict was
**NO-SHIP for this tranche**.

> The first attempt died out of credits after 170k tokens spent crawling `git log -p`. The prompt
> that worked names the files to read and says not to walk the repo. Keep it that way.

**Every claim below was checked against the code before acting on it.** Two did not survive that,
and the one it led with turned out not to be this work at all — which is the reason to check.

| What Sol said | Verified? | What happened |
|---|---|---|
| **Blocker:** `archived_at`, `title_override`, `opens`, `last_opened_at` are in the schema and in `pg.ts` but in no migration | **Real, not mine** | Those columns arrived in the working tree *after* commit `351c054`, in another agent's uncommitted shelf work. Sol reviewed the tree, not the commits, and even noticed `schema.ts` growing under it mid-review. Passed on rather than fixed — see [Rules for this work](#rules-for-this-work) on staying inside your stage |
| The exporter filters chat messages on `thread_id` alone, so two articles sharing a thread id mix | **Real** | Fixed. Thread ids are per-article by design, so this was one reader's conversation landing under someone else's article. [tests/store-export-isolation.test.ts](../../tests/store-export-isolation.test.ts) reproduces it |
| `create()` in the comment store races: two overlapping requests both insert | **Real** | Fixed — one `insert … on conflict do update` instead of select-then-branch. The red test holds a transaction open by hand, because two concurrent calls pass either way |
| `on conflict do nothing` means a re-import never removes what the files dropped | **Real, and already happening** | `data/writes/comments.json` held two comments while Postgres held three. The importer now replaces reader state inside its transaction, and [tests/store-import-convergence.test.ts](../../tests/store-import-convergence.test.ts) asserts it |
| The exporter has no `order by`, so array order is luck | **Real** | Fixed. It broke the same afternoon: the convergence fix changed the physical row order and `searches.json` came back shuffled |
| `order by created_at, id` does not reproduce the file's array order | **Real** | `data/noema-…/comments.json` has a hand-written comment sitting out of date order. Not fixed and deliberately so: nothing reads array order — [comment-nav.ts](../../src/web/comment-nav.ts) sorts into document order first — so the round trip now says "every row, unchanged" rather than "byte-identical" |
| `isLocalDatabaseUrl` pattern-matches the whole URL, and that answer authorises destructive commands | **Real** | Fixed — parse the URL, compare the hostname, fail closed on anything unparseable |
| The parity test's `wire()` cannot see `undefined` versus absent, though its comment claims it can | **Real** | Comment corrected, and `toStrictEqual` added beside it so the claim is now true. It passed first time, which is the answer to Sol's question 3: the conditional spreads were complete |
| `schema.ts` still says "nothing reads this yet"; `owner.ts` says every table has `owner_id` and that it is the only file auth touches | **Real** | All three corrected. Six of thirteen tables carry `owner_id`; no read filters on it yet |
| The parity test says the slug list is taken twice | **Real** | It is taken once. Comment corrected |
| The importer's uuid is described as RFC-4122 v5 | **Real** | It is sha256 with the v5 bits stamped on. Not yet reworded — see below |
| The importer mutates an already-published revision, and only some of its fields | **Real** | **Not fixed.** The fingerprint is `hashBlocks` alone, so changing only `meta.json` re-uses the revision id and updates a subset. Needs a decision, not a patch — see below |
| `SPIDERYARN_STORE` typos fall back to files | Real, but documented and deliberate for the staged phase | Left. Worth tightening to reject unknown non-empty values |
| A second user would see the first one's library; `articles.slug` is globally unique | **Real** | Recorded in `owner.ts` rather than fixed. Global slug uniqueness is a recorded decision (it is the URL contract), so this is the beta gate's problem |
| The round-trip claim is overstated: `raw.html` is not in `ARTEFACTS` and stamped HTML is only asserted absent | Real | Left as a known gap |

### What the shelf columns turned out to be

Sol's lead blocker — `archived_at`, `title_override`, `opens` and `last_opened_at` in the schema
with no migration — was another agent's shelf work, uncommitted at the time Sol read the tree. It
landed properly in `f862af5` with its migration, and that commit swept up two of my edits sitting in
the same files (the `schema.ts` header and the `pg.ts` underscore filter below). That is the
expected cost of one working tree and several agents, and it is fine.

### Three more things the review indirectly turned up

None of these were in Sol's answer. All three came out of checking it, and two were found by a test
going red for a reason that was not the test's fault.

1. **The Postgres library listed `_`-prefixed slugs and the filesystem one never has.**
   [src/api.ts](../../src/api.ts) has skipped the prefix since it was written — `data/_jobs/` is the
   ingest queue's directory — and `pg.ts` had no equivalent, so the two libraries disagreed about
   any such slug. Nothing noticed until a test fixture used one. This is a direct answer to Sol's
   question 1, "what is compared nowhere at all". Fixed, with `left(slug, 1) <> '_'` rather than
   `not like '_%'` — `_` is LIKE's single-character wildcard, so the obvious spelling excludes every
   slug in the table, and did.
2. **An article deleted from `data/` leaves its row behind for ever.** `importArticle` imports one
   article and cannot know a different one has gone, and nothing prunes, so
   `npm run db:import` does **not** make Postgres match `data/`. A stale `labels-checkpoint-check`
   row from somebody's checkpoint run is what made
   [tests/store-parity.test.ts](../../tests/store-parity.test.ts) fail in full runs and pass alone —
   almost certainly the "one flaky failure" recorded at the bottom of this document, which was never
   about load. The parity comparison is now scoped to articles that exist on disk; **the pruning gap
   itself is not fixed** and is listed below.
3. **`comments.json` accepts an anchor that is not a block id, and Postgres does not.** Something
   wrote a comment on `data/writes` anchored to `zzzz00` on 2026-08-26. `block_identities` has a
   format check, so the import died on it — one malformed row out of eleven stopping ten good ones.
   The importer now skips such a comment, logs its id, and returns it in `unanchoredComments`.
   **The writer that produced it has not been found**, and the file store will never report another
   one; validating the anchor where comments are written belongs to whoever owns that stage.

Two things Sol did **not** find, both turned up while checking its work:

- **`src/store/import.ts` contained a raw NUL byte** — `parts.join("\0")` had been written with an
  actual `0x00` rather than the two-character escape. Valid JavaScript, and it did the right thing.
  It also made git call the file binary and made **`grep` silently never match anything in it**,
  which cost twenty minutes of believing a function did not exist. Fixed.
- The `toStrictEqual` added for Sol's point 3 passes on every article, which is positive evidence
  the conditional spreads in `pg.ts` are complete rather than merely untested.

## What is not done

- **The importer can mutate an already-published revision, and only some of its fields.** The
  revision id is derived from `slug + hashBlocks(blocks)`, but a revision is far more than its
  blocks: change only `meta.json` and the fingerprint is unchanged, so the import re-uses the
  revision id and takes the `on conflict do update` branch, which refreshes the tree and the
  optional artefacts and leaves title, byline, urls, `fetched_at` and the raw bytes stale.
  `article_revisions` says "immutable once published". GPT Sol found this and it is **not fixed**,
  because the fix is a choice rather than a patch: either fingerprint the whole canonical revision
  and keep published revisions genuinely immutable, or keep a separate full-source idempotency key
  and replace every field as one unit. Worth deciding before the pipeline starts writing revisions.
- **Two imports of the same slug can race for the pointer.** Different fingerprints produce two
  complete revisions, and whichever updates `articles.current_revision_id` last wins regardless of
  which extraction is newer. Lock the article row and say what the winner is. This is also the best
  candidate for the flaky failure at the bottom of this list.
- **`revision_step_runs` are inferred and never removed.** An artefact deleted from disk leaves its
  "done" row behind, so the metadata page keeps reporting a step that no longer has output. Left
  alone because the pipeline is about to own this table properly.
- **The exporter is not a full rollback.** `raw.html` is outside the round trip's `ARTEFACTS` list,
  and the stamped HTML is only asserted to be in the right *place*, never compared.
- **Nothing prunes an article whose `data/` directory has gone.** `npm run db:import` adds and
  updates and never removes, so a deleted article goes on being served from Postgres. Reader state
  within an article now converges; articles themselves do not. The fix is a bulk-import step that
  deletes rows absent from disk, and it carries the same warning as the reader-state one: it must
  not run after cutover, when the files are the stale copy.
- **`SPIDERYARN_STORE` falls back to files on a typo.** Deliberate while the cutover is staged, but
  it should reject any non-empty value that is not `files` or `postgres`.
- **The on-demand artefacts do not yet survive re-extraction, and the schema is why.** Today
  `tweets.json`, `glossary.json` and `summary.json` are files that outlive a re-run of `blocks`;
  `stale` is computed at read time and the panel shows the old artefact with a banner. As revision
  columns, a re-extraction creates a new current revision with NULL in all three, so a reader's
  paid-for glossary silently becomes "nobody has found the terms for this one yet". **Publication
  must carry those columns forward unchanged** — each carries its own `sourceHash`, so staleness
  stays computable exactly as today. This must land before step 9, and note that the parity test
  will *not* catch it, because parity is checked without a re-extraction in between.
- **The `example` fixture is not in Postgres**, so the library differs by exactly one entry. The
  parity test asserts that it is the only difference rather than excusing the gap. Deciding this is
  [open question 8](postgres-migration.md#open-questions); a `fixture boolean` column on `articles`
  plus importing `example/` is the obvious answer and was not taken unilaterally.
- **The pipeline still writes files, and moving it needs coordination rather than nerve.** This is
  the one remaining wide diff: `PipelineStep.outputs(ctx): string[]` across eight stage modules,
  which other agents are actively editing right now. [AGENTS.md](../../AGENTS.md) says to stay
  inside your stage and talk to other stages through the artefacts on disk — so rewriting all eight
  at 3am, while their owners are mid-change, is the wrong way to do it even though it would compile.
  Land the artefact-store seam inside each stage module first, still file-backed, with the stage's
  owner; then the swap is one adapter rather than eight edited stages.
- **Chat, searches and glossary lookups have tables and an importer but no Postgres store**, so in
  `postgres` mode their writes still go to files. The two glossary writes refuse loudly (501); the
  chat and search writes do not yet, and should be given the same treatment when their stores land.
- **Jobs are still a p-queue and an in-memory `Map`.** The table, the fencing columns and the
  singleton `queue_state` guard all exist and nothing uses them.
- ~~**One flaky failure, seen once and not reproduced.**~~ **Found.** It was not load and it was not
  concurrency: an orphaned `labels-checkpoint-check` row, left in Postgres by a checkpoint run whose
  `data/` directory was later deleted, made the parity test disagree about the library whenever the
  suite happened to reach it. Six consecutive full runs are clean since. The pruning gap that
  allowed the orphan is listed above.
