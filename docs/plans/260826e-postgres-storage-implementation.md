# Implementing Postgres storage

> we had been planning to shift over from JSON flat files → Postgres (using Supabase) … finish
> implementing storing in a database.
>
> — Greg, 2026-08-26

**This is the doing document.** The thinking is
[260825f-postgres-migration.md](260825f-postgres-migration.md) — the schema, the seven decisions, the traps, and why
each went the way it did. That plan ends at *"the order of work"* and was never executed past step 3.
This one executes it, and is kept updated as it goes so that a subagent dropped in anywhere can see
what is done, what is next, and what has already been decided and must not be relitigated.

Read [260825f-postgres-migration.md § The traps](260825f-postgres-migration.md#the-traps) before touching anything
here. Every one of them is a way this work fails while reporting success.

---

## The four calls Greg made on 2026-08-26

Asked before any code was written, so the plan is written *to* them.

| | Decision | What it rules out |
|---|---|---|
| **Scope** | **Full cutover.** Postgres becomes the only store — reads, writes, comments, jobs | No permanent dual-write, no "files win on conflict". The filesystem adapter and the exporter survive one release as the rollback and are then deleted |
| **`owner_id`** | **Seed one dev user; the uuid comes from env** | Not building the beta gate as part of this. Not dropping the `auth.users` FK either — the FK stays real and enforced from the first insert |
| **Remote** | **Local only.** Everything against the Docker stack | Nothing is applied to `alschkahzfagtppxspfq`. The remote path is written and typed but not run; the billing banner is still [open question 1](260825f-postgres-migration.md#open-questions) |
| **Existing data** | **Import all four articles, keep the files** | `data/` is not deleted. It stays as the belt-and-braces backup and as the input to the parity comparison |

A consequence of the first, worth saying plainly because it changes everybody's morning: **after
cutover, `npm run dev` needs Docker and `npm run db:start`.** That is the cost of the decision, it
was visible when the decision was made, and it is not a bug report.

## Progress

Legend: ✅ done · 🔵 in progress · 📐 designed, not built · ⬜ not started

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
| 9b | Shelf state — archive, rename, opens — and library-wide search | ✅ **added 2026-08-26**, both adapters. See [260826k-library-shelf-actions-and-search.md](260826k-library-shelf-actions-and-search.md) |
| 10 | Chat, searches, glossary lookups — writes | 🔵 **stores built and reviewed 2026-08-26; not yet wired into `src/routes.ts`.** All three adapters exist on both sides, with a scripted parity sequence and the two criticals from the design review applied — then [a second review of the built code](#what-the-review-found-in-the-built-step-10) found two more races and four tests that passed for bad reasons. Those are fixed. **The wiring was started 2026-08-26 evening and is uncommitted** — `src/routes.ts`, `src/store/index.ts`, `src/term-lookup.ts` and three new test files, with one unused-import typecheck error still in `routes.ts`. `deleteGlossary` stays 501 by construction. See [where this stopped](#where-this-stopped-2026-08-26-evening) |
| 11 | Pipeline writes to draft revisions (+ carry-forward) | 🔵 **half B stages 1–4 built 2026-08-26** (`39b9892`, `fa3945c`): the artefact store, the file adapter, `produces` beside `outputs` with an agreement test, and `stepIsDone` taking a store — `has()` now **parses** rather than `stat`s, which closes the truncation hazard for the five steps that had no freshness check. Then [a review of the built code](#what-the-review-of-the-built-seam-found) found three criticals; **all three are fixed** (`8d751c1`, `b541557`) — see [what was fixed and the two choices inside it](#what-was-fixed-and-the-two-choices-inside-it). The store now records the *attempt* as well as the output, `blocks` checks that the HTML really carries its ids, and the store argument is required. **Half A (carry-forward and publication) was started 2026-08-26 evening and is uncommitted** — `drizzle/0010_job_owned_draft_and_fixture.sql` (generated and applied locally), `src/store/pg-revisions.ts`, `tests/store-revision-policy.test.ts`. See [where this stopped](#where-this-stopped-2026-08-26-evening) |
| 12 | Jobs and claiming | ✅ **built 2026-08-27**, to the replacement design rather than the one below — **do not build what is below.** [260826q-job-queue-rethink.md](260826q-job-queue-rethink.md) swapped the autonomous queue for a **browser-driven advance endpoint** on Greg's *"whichever's easiest"*; [260827h-durable-queue-and-uploads.md § 8](260827h-durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27) is what was built, and two code reviews of it ([built](260827m-durable-queue-code-review-sol.md), [fixes](260827n-durable-queue-fixes-review-sol.md)) both returned NO-SHIP and are folded in. Three of the four things the old design contributed survive: the attempt token, a job-owned draft (`openOrBeginJobDraft`) and the single-running-step rule (`jobs_only_one_running`). **The fourth — the fenced *output* write — does not, and is the main thing still open**: the fence covers the job row and the artefacts sit outside it. **Ingest still does not work on Vercel**, for that reason: see item 4 above and [260827j-transactional-stage-runner.md](260827j-transactional-stage-runner.md) |
| 13 | Cutover: flip the default, delete the filesystem adapter | ⬜ Two decisions now made: the `example` fixture **goes in, marked as one** (a `fixture boolean` on `articles`, the directory staying on disk), and an unknown slug **404s** — the files side comes up to Postgres, not the reverse. Both in [260825f-postgres-migration.md § Open questions](260825f-postgres-migration.md#open-questions). The importer's reconciliation direction **reverses here**, and that is the reason this is a step rather than a flag flip |

**What step 10 still needs before it is done**, all of it in `src/routes.ts` and deliberately left
until that file settles — it is being heavily edited for the streaming work:

1. Route the chat, search and lookup calls through `src/store/index.js` instead of importing
   `src/chat.ts` and `src/searches.ts` directly. Searches have no seam at all today.
2. **Carry the attempt token.** `begin`, `retry` and `edit` return one; `finish` refuses without it.
   The `streaming` and `searching` maps become the `keep` set of a `SweepOptions`.
3. **Choose `graceMs` to be longer than any hard model-call timeout, and say so where it is set.**
   There is no heartbeat, so an attempt that outlives the grace window is buried while still
   running. The fence stops the buried answer overwriting the retry; it does not make the answer
   dead. Raised in review and not yet answered.
4. Send `expectedTailId` from the client on an edit. The guard is optional in the contract because
   the value has to come from the client, and an edit that does not send one is unguarded.
5. Move `lookUpTerm` out of `src/api.ts` — see [the design](#lookupterm-has-to-move-out-of-apits).

**The import reconciles, and the direction it reconciles in reverses at cutover.** The importer
deletes an article's reader-state rows inside its transaction before re-inserting them from the
files (`src/store/import.ts`, *"The files win, so the rows the files no
longer have must go"*), so a comment deleted on disk does not live on in Postgres. That is the right
choice while `data/` is authoritative: "import only ever runs into an empty article" would break
re-running the importer after any edit made through the files, which is the whole migration period.

**Step 13 has to turn it round.** Once the app writes reader state straight to Postgres — comments
already do, and step 10 does the rest — running the importer again would *delete* everything added
since the last export, because it still believes the files are the truth. Flagged at
`import.ts` where the delete happens, and it is the reason cutover is a
step rather than a flag flip.

> Checked on 2026-08-26 rather than assumed. `tests/store-import-convergence.test.ts` asserts the
> behaviour for **comments** only; a throwaway repro inserted stray rows into `chat_threads`,
> `chat_messages`, `search_runs` and `glossary_lookups` for one article and re-imported with those
> artefacts absent from disk — all four came back to zero rows, so the reconciling delete really does
> cover all four reader-state artefacts and not just the tested one. `block_identities` is
> deliberately exempt: it never loses a row ([block-ids.md](../project/block-ids.md)).
>
> One gap left, and it turned out to be the importer's to close after all: `importArticle` reconciles
> only the slug it is handed, so an article whose `data/` directory has vanished entirely left an
> orphan row that nothing visits. `npm run db:import -- --prune` now removes it — see
> § The importer converges.

## What happens next, in order

Written down because by 2026-08-26 evening the answer was spread across five sections and three
documents, and several agents work this tree at once.

1. ~~**Fix the three criticals in the built seam.**~~ **Done 2026-08-26**, and then reviewed again
   — see [What was fixed](#what-was-fixed-and-the-two-choices-inside-it) and [what the review of the
   fixes found](#what-the-review-of-the-fixes-found-2026-08-26-evening). The red test the item
   asked for is `tests/pipeline-artifact-store.test.ts` § *"catches a generation half-replaced by a
   run that died"*, watched red before the fix. **The second review returned NO-SHIP for concurrent
   or resumable ingest and four of its findings now sit under item 4**, which is where they belong:
   a marker the stage CLIs bypass, and a write ceiling that cannot bind while the stages still
   write their own files.
2. **Wire step 10 into `src/routes.ts`**, and move `lookUpTerm` out of `src/api.ts`. The three stores
   exist, are reviewed twice and are still unreachable — which is the most dangerous state in this
   table, because the work looks done from the file list. `deleteGlossary` stays 501 until step 11
   decides whether a published revision may be mutated.
3. **Step 11 half A** — `beginRevision` / `publishRevision` / `failRevision`, the CARRY / MINT /
   DERIVE split, and the carry-forward test that performs a **real re-extraction**. This is where the
   one schema migration lands (`draft_revision_id`, and the `fixture boolean` for step 13 may as well
   ride along). **One migration writer at a time** — it is the only genuinely conflicting file in this
   repo.
4. **Step 11 half B stage 5** — the writes leave the eight stage modules, one commit each, by each
   stage's owner. Remember the correction: the stages still **read** files too, so a stage is only
   done when its inputs arrive as values.

   **The shape of this changed on 2026-08-26 evening.** It is no longer only "move the writes"; the
   second review made it *"one shared step runner, owned by the queue and the CLIs alike — claim,
   run, validate, commit"*. Three of its findings collapse into that one change: the stage CLIs
   bypass the run marker entirely, the store's write ceiling cannot protect a pipeline that does not
   write through the store, and `assertProduced` cannot tell a freshly written artefact from an old
   readable one because the validation is not shared with the skip decision. Doing this as eight
   independent "move my writes" commits would leave all three open.

   **This now has a plan of its own —
   [260827j-transactional-stage-runner.md](260827j-transactional-stage-runner.md), written and reviewed 2026-08-27 —
   and it is bigger again than the paragraph above.** Two things that paragraph does not say and
   that plan does: no stage reads or writes through the seam *at all* today (`ArtifactStore.write()`
   has no production caller), and not every stage write is an artefact — `toc`'s
   `labels-progress.json` and the PDF chunk cache are resumable working state that must survive a
   failed step, so they need somewhere to live the moment `dir` disappears. Read that before
   starting any part of this item.
5. ~~**The advance endpoint**~~ ([260826q-job-queue-rethink.md](260826q-job-queue-rethink.md)) — **done 2026-08-27**,
   and it did **not** wait for step 3 as this line assumed. The job record moved behind `JobStore`
   with a claim, a lease and a fence
   ([260827h-durable-queue-and-uploads.md § 8](260827h-durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27)),
   which is the *precondition* for `fenceJob` rather than a consumer of it: until a job row existed
   in `spideryarn.jobs`, every fence in `pg-revisions.ts` matched zero rows. Two code reviews of it
   returned NO-SHIP and are folded in
   ([the built code](260827m-durable-queue-code-review-sol.md), [the fixes](260827n-durable-queue-fixes-review-sol.md)).

   **It does not make an ingest work on Vercel**, and the ordering above is why: item 4 is what does,
   and item 4 is not started.
6. **Step 13.** Flip the default, seed the fixture, delete the filesystem adapter — and **reverse the
   importer's reconciliation direction**, or cutover day deletes every comment, thread and lookup
   added since the last export while reporting a clean import.

**Independent of all of it, and currently misdescribed nowhere now but worth doing:** ingest does not
work on Vercel — `enqueue` starts a floating promise, there is no `waitUntil`, and the function is
capped at 300 seconds. [deployment.md](../project/deployment.md) lists it as knowingly broken; the
advance endpoint is what fixes it properly.

## Where this stopped, 2026-08-26 evening

Three agents were working this plan in parallel and all three stopped at once on a session limit,
with GPT Sol out of credits at the same time, so **none of the three reviews that should have run
did**. What follows is the honest state rather than a summary of intent.

**Committed and tested:** the three seam criticals and the six smaller findings (`8d751c1`), and the
cancel-ordering fix that stops a stopped job re-buying a model call it already paid for
(`b541557`).

**Written, not committed, not verified:**

| What | Files | What is known about it |
|---|---|---|
| Step 10 wiring | `src/routes.ts`, `src/store/index.ts`, `src/store/fs.ts`, `src/chat.ts`, `src/searches.ts`, `src/term-lookup.ts`, `tests/term-lookup.test.ts`, `tests/store-wiring.test.ts`, `tests/chat-edit-guard.test.ts` | One typecheck error left: `readerStore` declared and unused in `routes.ts`. `tests/store-not-migrated.test.ts` was rewritten because it pinned the 501 scaffolding this step deletes |
| Step 11 half A | `drizzle/0010_job_owned_draft_and_fixture.sql`, `src/db/schema.ts`, `src/store/pg-revisions.ts`, `tests/store-revision-policy.test.ts` | The migration is generated **and applied to the local stack**. It adds `articles.fixture` and `jobs.draft_revision_id` with its FK and partial unique index |

**Two things about the schema that will bite whoever picks this up.** They were reported by the
agent that hit them, not inferred:

1. **The "one migration writer at a time" rule did not hold.** Three agents touched
   `src/db/schema.ts` in the same hour. `drizzle-kit generate` diffs the *whole* schema against the
   last snapshot, so an unrelated column in flight gets swept into your migration whether you want it
   or not — leaving it out is worse, because the schema would then declare a column the database does
   not have. `search_runs.source_hash` went out as `0009`; half A's is `0010`.
2. **`articles.purpose` is declared in `schema.ts` and is not in the database.** The reader-profile
   work added the column and the `reader_profiles` table without a migration, so every
   `select … from articles` through Drizzle now fails against the local stack. That is what the
   Postgres-store test failures are, and they look like everybody's bug rather than one agent's.

**Also uncommitted, and not mine:** all three prompt versions moved in one afternoon —
`glossary/3`, `summary/3`, `tweets/2`. That turned five tests in
`tests/pipeline-artifact-store.test.ts` red for a reason unrelated to what they test, because the
fixture pinned the versions as literals. The fix is in the working tree: `tweets.ts` and
`summarise.ts` now `export` their `PROMPT_VERSION` the way `glossary.ts` already did, and the fixture
imports all three. It is deliberately **not committed**, because committing it would sweep 120 lines
of somebody else's live prompt rewrite in under this message. Whoever commits the prompt bump should
take those three files with it.

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
  parity exercise worthless. From [the order of work](260825f-postgres-migration.md#the-order-of-work), and
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

- [260825f-postgres-migration.md](260825f-postgres-migration.md) — the design, and every decision behind it
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

A full `db:import` also **lists** any article Postgres still has whose `data/` directory has gone.
It does not delete one unless you ask:

```bash
npm run db:import -- --prune     # …and remove those. Cannot be undone.
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
   [260825f-postgres-migration.md § This codebase](260825f-postgres-migration.md#this-codebase) says one; `tweets`,
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
[260826j-postgres-storage-review-sol.md](260826j-postgres-storage-review-sol.md); the prompt is in
[260826f-postgres-storage-review-prompt.md](260826f-postgres-storage-review-prompt.md). Its verdict was
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
| `on conflict do nothing` means a re-import never removes what the files dropped | **Real, and already happening** | `data/writes/comments.json` held two comments while Postgres held three. The importer now replaces reader state inside its transaction, and tests/store-import-convergence.test.ts asserts it |
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
   about load. The parity comparison is now scoped to articles that exist on disk. **The pruning gap
   itself was fixed later the same day** — see § The importer converges, below.
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

## Step 10 — chat, searches and glossary lookups (writes)

> **2026-08-26: the stopgap this plan proposes for the gap does not work, and it is worth knowing
> why before reaching for it again.** Both this document and
> [260826m-simplification-audit.md](260826m-simplification-audit.md) say the cheap mitigation for chat and search
> writes silently landing on disk in `postgres` mode is to *"extend `notMigrated` to chat and search
> writes"*. It cannot be done. `notMigrated` lives in [`src/store/index.ts`](../../src/store/index.ts)
> and can only refuse a call that comes through that file — and these do not:
> [`src/routes.ts`](../../src/routes.ts) imports `beginTurn`, `finishTurn`, `editTurn`, `retryTurn`
> and `update` straight from `src/chat.ts`, and `beginRun`, `finishRun`, `deleteRun` and `update`
> straight from `src/searches.ts`. Those modules call `node:fs/promises` directly and never read
> `STORE`. The glossary writes are refused loudly only because they *do* go through the store.
>
> There were two real options and no third: wire `pgChatStore` and `pgSearchStore` (both built, both
> reviewed, both unwired) through `src/store/index.ts` and switch those two import blocks in
> `routes.ts` — which is this step, not a stopgap — or put the refusal inside `src/chat.ts` and
> `src/searches.ts` themselves.
>
> **The refusal was taken first; the wiring that deletes it was written the same day and is still
> uncommitted** — see [where this stopped](#where-this-stopped-2026-08-26-evening). For a few
> hours `save()` in each module threw the same 501 the store's `notMigrated` throws — on `save`
> because every write in each module funnels through it, and because it fires *before* the model call
> rather than after. Then this step landed, `chatStore` and `searchStore` went into
> `src/store/index.ts`, routes.ts started calling them, and both guards came out.
>
> Two things from the interim outlived it, and one of them is the more useful half:
>
> **The flag is in a leaf module**, `src/store/live.ts`, and stays there. `index.ts` imports
> `fs.ts`, which imports `chat.ts` and `searches.ts` — so those two asking `index.ts` which store is
> live is a cycle, and `npm run check` gates on cycles. `STORE`, `storeFromEnv` and the 501 live
> there; `index.ts` re-exports them so no caller has to know.
>
> **The test was rewritten rather than deleted, and that is the transferable bit.**
> `tests/store-not-migrated.test.ts` asserted *"the write is refused"* — it pinned the scaffolding,
> so the proper fix turned it red. It was describing **how** the bug was avoided rather than that it
> was. `tests/store-writes-land-in-postgres.test.ts` replaces it with what both fixes had in common
> and what a third would also have to satisfy: the write comes back out of Postgres, **and no file
> appears under `data/<slug>/`**. The file half is not belt-and-braces — it is the half that goes red
> if somebody re-imports `src/chat.ts` directly in a route, which is exactly how this happened the
> first time. Verified by unwiring `chatStore` back to `fsChatStore` and watching it fail.
>
> The general lesson is the one worth keeping: **a guard can only be written where the call goes**,
> and "extend the guard" was proposed twice by people reading the store's own header, which said
> what it refuses without saying what never reaches it. That header now says it.

`SPIDERYARN_STORE=postgres` serves all three from Postgres. After this step the file-backed writes
left are the pipeline (step 11), jobs (step 12) — **and `deleteGlossary`, which stays 501**, so step 10
is partial by construction and its progress state should say so rather than claiming a clean sweep.

Designed 2026-08-26, then cross-reviewed by GPT Sol, **which found two critical faults**, one of them
in a choice the design had made deliberately. See
[What the review found](#what-the-review-found-in-step-10) at the end; read it before building any of
this.

### The structural move that makes the rest cheap

The parts of [`src/chat.ts`](../../src/chat.ts) and [`src/searches.ts`](../../src/searches.ts) that
carry the invariants — id minting, the discard rule, the title rule, the retry preconditions,
`titleFrom`, `MAX_RUNS` — become **pure functions over the API-shaped arrays**, and *both* adapters
call them. Only persistence differs.

Two already exist and are already exported: `withRetry` and `withEdit`. A third comes out of
`beginTurn`'s `update` callback as `withTurn` — a pure refactor with no behaviour change, which
`tests/chat.test.ts` keeps honest.

Everything else — `finishTurn`, `renameThread`, `deleteThread`, `finishRun`, `deleteRun`, `saveLookup`
— is a single SQL statement. Routing *those* through a pure function would force the Postgres store to
rewrite a whole thread to change one row, **which is the file's bug rather than its contract**.

### The four places the contract is not a copy of today's module

`contracts.ts` argues that an identical surface is what makes cutover safe. That argument is about not
*improving* shapes; these four are about a return value the caller throws away — free on a filesystem,
a whole extra query in SQL.

| Today | Contract | Why |
|---|---|---|
| `update(slug, mutate: (t[]) => t[])` | `sweepPending(slug, opts)` | **The file-shaped leak.** A mutate callback over the whole array can only be implemented in SQL as select-everything, diff, write-everything — the read-modify-write the table exists to delete. One caller, one thing it does, so the method *is* that thing |
| `finishTurn(): Promise<ChatThread[]>` | `Promise<void>` | Both call sites already discard it. Returning it costs a full read of every thread in the article **per streamed answer** |
| `finishRun(): Promise<SearchRun[]>` | `Promise<SearchRun \| undefined>` | The caller does `.find(…)` and 404s when missing. `UPDATE … RETURNING *` answers that directly: zero rows *is* "deleted while running" |
| `renameThread` / `deleteThread` / `deleteRun` → the whole list | **unchanged** | Not a habit here — the list *is* the response body |

`beginTurn` / `retryTurn` / `editTurn` keep `thread` with its `messages`, because `streamChat` builds
the model's history from `thread.messages.slice(0, -2)`. Not negotiable. Every method keeps its
`now?: () => string` injector, which is what lets a parity test drive both stores from one clock.

### Concurrency: the lock is the mutex

The file stores serialise every write for the whole process through a module-global promise chain.
Postgres replaces it with **per-article serialisation across processes** — strictly stronger, and
observably identical: every concurrent pair that both succeed today both succeed here.

> **"Per-thread (chat)" was wrong and is corrected here**, twice over. The lock has to be
> article-wide because minting scans every id in the article (below) — and it has to be taken by
> **every method that writes**, not only the three that read before writing. The built version took
> it in `begin`, `retry` and `edit` only, and `begin` upserts the *title* it read, so a concurrent
> `rename` was silently written back to the old name: a lost update the filesystem mutex makes
> impossible. Found by GPT Sol reviewing the implementation, 2026-08-26.

The design reached for `pg_advisory_xact_lock` because **`beginTurn` may have no thread row to
lock** — a thread is created by its first question, and `withTurn` can *overrule* the client's thread
id, so upserting first would create a thread the pure function would not have created.

**That rationale overlooked the parent row, and the review corrected it: lock `articles … FOR UPDATE`.**
An article row always exists. (The advisory lock would at least have been *safe* — transaction-scoped
advisory locks are fine under the transaction pooler, which is what this app connects through; it is
the *session*-scoped kind that is not.)

**And the lock must be article-wide, not per-thread.** `taken()` scans ids across every thread in the
article, while the schema permits the same message id in different threads — so two concurrent writers
on *different* threads would mint against the same stale article-wide snapshot. A same-thread
concurrency test cannot catch that, which is why the design's proposed test would have passed.

**No model call happens inside any of these transactions.** The lock is held for the two or three
statements it takes to write rows the caller already computed.

#### Where `ChatConflict` comes from

From exactly where it comes from today — `withRetry` and `withEdit`, run on the thread list read
**inside** the locked transaction. There is no version column and **adding one would be wrong**: a
`where updated_at = $expected` check would 409 a *concurrent* write, where today two concurrent writes
both succeed because the mutex orders them. That is a new failure mode invented by the storage change,
which is the one thing this migration must not do. Every `ChatConflict` in the code is a **stale
client** — a second tab, a Back button, a retry on a turn that is no longer last — and those are still
conflicts and still 409.

So: lock, read, run the pure function, write the difference, commit. The check and the act inside one
lock is the only property the module-global mutex was buying.

**Throw the `ChatConflict` out of the transaction callback directly; do not call `tx.rollback()`** —
Drizzle replaces the error with `TransactionRollbackError` and the route answers 500 instead of 409.
Pin that with a test rather than trusting the paragraph.

**Load the whole article's threads inside the transaction**, not one. `withTurn` and `withEdit` mint
ids against every thread id *and* message id in the article, including ids an edit is about to
discard. Passing one thread would let a mint collide with another thread's message id — legal under
the `(article_id, thread_id, id)` primary key, illegal on disk, so a divergence that only shows up in
an export.

### The chat statements, and what is easy to get wrong

`ordinal` is **always the index of the message in the array the pure function produced**, never
`max(ordinal) + 1` computed separately: two derivations of one position can disagree, and the unique
index then rejects a legitimate write.

- **`finishTurn`** never puts `id` or `role` in the SET, and **bumps the thread's `updated_at` even
  when the message id matched nothing** — the file does that unconditionally, and the panel sorts
  threads by it, so an `if (rowCount)` guard is a real divergence.
- **`retryTurn`** must clear `citations`, `searches`, `model`, `error`, `stopped` **and reset
  `created_at`**. `withRetry` rebuilds the reply field by field precisely so the replaced attempt's
  fields do not survive. The obvious UPDATE — `text` and `status` only — leaves the previous attempt's
  sources sitting under text that never mentions them; and a stale `created_at` makes the sweep see a
  `pending` message older than the grace window and error the retry the reader is watching arrive.
- **`editTurn`** deletes `ordinal > $k`, never `>=`, and deletes before inserting in the same
  transaction so the unique index never sees a duplicate.
- **`renameThread` deliberately does not touch `updated_at`.** The file does not, and the panel sorts
  by it — so "touch `updated_at` on every write", which is a habit rather than a decision, would jump a
  renamed thread to the top of the list.
- **`sweepPending`: `NOT IN ()` — a hazard Drizzle has already handled.** Raw SQL `not in ()` is a
  syntax error rather than "matches everything", and this was called the single most likely way to
  ship a sweep that 500s on the first read of an article with nothing streaming. **Measured on
  2026-08-26 and it is not: Drizzle compiles `notInArray(col, [])` to the literal `true`.** So no
  empty-list conditional was written — a guard against a handled hazard reads as evidence the
  hazard is live. The test for a quiet article stays regardless. Drop the file's "is anything
  stale?" pre-check: it exists to avoid rewriting the file, and in SQL an `UPDATE` matching zero
  rows is free.

The chat error string is **not logged**; keep that as it is, for the provider-echo reason
[`src/chat.ts`](../../src/chat.ts) gives at length.

### Searches, and the `MAX_RUNS` trim

`beginRun` runs in one transaction under an article lock. A `wantedId` that names an existing row is a
retry **only when the criterion matches and the status is `error`**; any other combination means the
id is taken, and it falls through to minting. All three conditions must be checked —
[`src/searches.ts`](../../src/searches.ts) carries a postmortem link for the one that was missing, and
without it a double-clicked POST resets a `done` run and throws away an answer the reader already has.

The reset does **not** touch `created_at`: it is still the same search the reader asked for, only the
attempt is new. That is the exact opposite of `retryTurn`, and both are deliberate — a chat reply's
`created_at` is the attempt's clock, a run's is the question's.

**The trim runs inside the same transaction, only on the insert branches, never on the reset branch.**
The file slices only in its append branch; trimming on a retry would silently delete a run the reader
can see. `order by created_at desc, id desc offset 30` keeps the newest thirty. Import `MAX_RUNS`;
do not write `30`.

**A `pending` run whose model call is in flight is not spared**, exactly as on disk. If it is the
oldest and thirty newer runs arrive it goes, `finishRun` then updates zero rows and returns
`undefined`, and the route answers the 404 that already exists for the reader deleting a run
mid-search.

### The one place Sol's fencing rule lands

Nothing in step 10 is fenced — `chat_messages` and `search_runs` have no `attempt_id`. But the
underlying rule, *a conditional write must name the status it expects and not only the identity*,
lands on one statement with a history: **`beginRun`'s retry-reset must carry
`and criterion = $ and status = 'error'` in the `UPDATE` itself**, not only in the TypeScript branch
that chose it, and must check `rowCount` rather than assume. The predicate is guaranteed today by a
`SELECT … FOR UPDATE` a few lines earlier — correct now, and exactly the kind of correctness that
evaporates when someone later collapses the select and the update into one statement.

### Ordering

`chat_threads` by `created_at, id`; messages by **`ordinal`**; `search_runs` by `created_at, id`;
lookups by `entry_id`. These are the clauses [`src/store/export.ts`](../../src/store/export.ts)
already uses and **they must stay identical**, or a write through the new store and a read through the
exporter disagree about array order and the round-trip test goes red for a reason that is not a bug.

**The NULLs-FIRST-under-DESC class does not apply here** — all four columns are `notNull`, checked one
by one rather than assumed. Two live hazards remain and neither is NULLs:

1. **Ties.** Two threads created in the same microsecond sort arbitrarily without the `id` tie-break,
   where the file's order is insertion order. The tie-break is what makes the stores agree
   deterministically rather than usually.
2. **Ordering messages by `created_at`** is the obvious clause, looks right, and is wrong: a user turn
   and the `pending` assistant turn answering it are written in one call with one timestamp, so they
   collide and sort arbitrarily. That is why `ordinal` exists. **A test that only ever writes one turn
   cannot catch it** — the same shape as the shelf bug, where the data we happen to have agreed by
   accident.

Neither panel depends on server order for display, so the cost of getting this wrong is the export and
the parity comparison rather than the screen — which makes it *less* likely to be noticed, not more.

### Schema audit: no drift

Every field has a column — all eleven of `ChatMessage`, all of `ChatThread`, `SearchRun` and
`GlossaryLookup`, checked field by field. Unlike `jobs.guidance` there is no defect here. Three
asymmetries worth knowing before they read as bugs:

1. **`chat_messages` has no `owner_id`** — a message's owner is its thread's. Deliberate; do not add
   one, do not filter on it.
2. **`chat_messages` has no id-format CHECK** where `chat_threads` and `search_runs` do. Nothing in
   this code can write a malformed id, but nothing *stops* one either — which is exactly how `zzzz00`
   got into `comments.json` and took an import down.
3. **No `attempt_id` on `chat_messages` or `search_runs`**, so there is **no durable equivalent of the
   in-process `streaming` / `searching` maps** and the sweep stays process-local. Two servers on one
   database will error each other's live answers.

   The design called preserving that *right for this step*. **The review disagrees, and it is
   correct:** on the filesystem two servers sharing one `data/` directory is a thing nobody does, and
   under shared Postgres multi-process access is the ordinary production case. See critical 1 below —
   this one grows a column.

### `lookUpTerm` has to move out of `api.ts`

The lookup **storage** is a plain upsert — and the row upsert is the whole point, because it deletes
the file's read-modify-write race, where a lookup landing during a `glossary` job is overwritten
wholesale and no in-process lock can help, the stale read being held across the model call.

But `src/api.ts`'s `lookUpTerm` reads `glossary.json`, `blocks.json` and `meta.json` off the disk
itself before calling `explain`. A Postgres store for the storage alone is not enough — the glossary it
looks the term up in would still come from a file. Writing a second `lookUpTerm` would mean two copies
of the 404/403/409 logic, the anchor rule and the `safeUrl` filter, which is the divergence this
migration exists to make impossible.

So it becomes a store-independent `makeLookUpTerm({ reader, lookups, assertWritable })` in a new
`src/glossary-lookup.ts`. `assertWritable` exists because the filesystem's 403 comes from `articleDir`
falling through to `example/` for any slug with no artefacts; Postgres has no fixture to fall into and
404s instead. **A stated difference with a test on each side, not something discovered.**

`notMigrated("Looking a term up")` then leaves `src/store/index.ts`.

### `deleteGlossary` is step 11's, and that leaves a hole

It nulls `article_revisions.glossary` on the **current published revision**, and that table says
*immutable once published*. The SQL is trivial; whether a published revision may be mutated at all is
the open decision step 11 carries. Until then it stays 501 — which means **the glossary panel's "start
over" does not work under `postgres`**, and that belongs in the progress table rather than being found.

### Divergences to record rather than fix

| | Files | Postgres |
|---|---|---|
| Unknown slug on `load` | `[]` — ENOENT is ordinary | **404** via `articleIdFor` |
| A slug that is not a slug | throws **untagged** → 500 | `status: 400` |
| Corrupt stored state | refuses to write | no such state exists |

The first is **already shipped for comments**, so this step inherits it rather than introducing it.
**Decided 2026-08-26 by Greg: Postgres is right — an article that does not exist should say so, and
the files side gets brought up to it** rather than the other way round. Not urgent, and not part of
this step: both clients handle an error body, an article that genuinely exists with no chat yet still
returns `[]` in both, and the divergence goes away entirely when the filesystem adapter is deleted at
cutover. The second row: Postgres is right there too, and the parity test already asserts 400 for
reads.

### The tests

Fixtures follow `tests/store-comments.test.ts`: an `articles` row with **no `current_revision_id`**, so
`listArticles` cannot see it and the parity test cannot be made flaky by it.

The assertions that matter are the ones with a way to make them red — a retry that keeps the previous
attempt's citations, an edit that deletes `>=` instead of `>`, a rename that bumps `updated_at`, a
`do nothing` upsert on a lookup, `offset 29`, a sweep emitting `not in ()`, and **`tx.rollback()`
turning a 409 into a 500**. Two concurrent `beginTurn`s on one thread must both land with ordinals 0–3;
to force the overlap, hold a transaction open by hand, because two plain concurrent calls pass either
way.

And one scripted parity sequence per store — begin, finish, begin, retry, finish, edit, finish, rename,
delete — against a fixed clock, comparing the wire form after every step. Ordering messages by
`created_at` breaks exactly that test and almost nothing else.

### What the review found in step 10

GPT Sol reviewed the design above on 2026-08-26 and returned two critical faults. It is **not safe to
implement as written**. One of them is in a choice the design made on purpose and defended, which is
the more interesting kind.

**1. The search sweep is unsafe in the deployment topology, and "preserve today's behaviour" was the
wrong instinct.** `searching` is process-local, and `sweepSearches` immediately errors every `pending`
run absent from *that process's* set. On Vercel, process A runs the POST while process B handles a GET
and marks A's live run `error`; the reader retries; A's eventual `finishRun`, fenced only by identity,
overwrites the retry. The design noticed this and called preserving it right, on the grounds that two
servers on one `data/` directory behave the same way today.

*That parallel does not hold.* Two servers sharing one `data/` directory is a thing nobody does; under
shared Postgres, multi-process is the ordinary production case. **Add `attempt_id` and
`attempt_started_at` to `search_runs`**, sweep only expired attempts, and finish with
`WHERE id = $ AND attempt_id = $ AND status = 'pending'` — the same three-part rule step 12 arrived at.
This is not queue-framework over-engineering; it closes one concrete cross-instance race.

**2. "A version check would be wrong" is too broad — a stale edit can silently delete a live turn
today.** `withEdit` checks only that its target still exists and is a user message, then discards
everything after it. So:

1. Tab A appends Q2 / A2 successfully
2. Stale tab B edits Q1 successfully, **deleting Q2 and A2**
3. A's model finishes; `finishTurn` matches no message — and the reader still sees a successful answer
4. Reload, and Q2 and its answer are gone

**The mutex orders those writes; it does not make the result correct.** Two concurrent edits of the
same question have the same fault. So the design's argument — that a version column would 409 writes
that succeed today — is right about *appends* and wrong about *destructive edits*.

*The correction, and it is deliberately narrow:* no blanket thread version. Add an **`expectedTailId`
to the destructive operations only**, compared under the lock, so the only edits rejected are those
whose advertised discard set has changed underneath them. `withRetry` already has exactly this guard,
by requiring the exact last assistant message.

#### Four smaller corrections

- **The `MAX_RUNS` trim does not match the file exactly.** The file appends and keeps the last thirty
  *array elements*; `order by created_at desc, id desc offset 30` keeps thirty in *timestamp* order.
  Those differ under a fixed clock, a clock rollback, hand-ordered imported data, or ties — and a newly
  inserted run with an older timestamp can be trimmed immediately, so its model call ends in a 404.
  Either store an insertion ordinal or adopt timestamp retention as a stated behaviour change; the
  cheap compromise is to **exclude the newly inserted id from the trim candidates**, so a successful
  `beginRun` can never delete itself.
- **The search reset and identity rules were omitted from the design and its red-test list.** A retry
  must set `hits = []`, `model = NULL` and `error = NULL` — the file rebuilds the run without them, so
  they clear — and `finishRun` must never set `id` or `criterion`. Without the first, a failed
  attempt's error survives beneath a later successful run.
- **`makeLookUpTerm` misses two dependencies.** The body also touches `explain`, the clock, `safeUrl`,
  `quoteIn` and logging. The pure helpers need not be injected, but **`explain` and `now` must be**, or
  the new orchestration still cannot be tested end to end — the existing tests deliberately avoid the
  successful model path, which is exactly the path this step moves.
- **The privacy logging contract is spelled out only for chat.** Searches forbid logging the criterion,
  the hit quote, the reasoning and the stored provider error; glossary lookups log ids, counts and
  model but never the term or the answer. All three need saying, because this is an omission with
  privacy consequences rather than a documentation nicety.

#### Four claims that survived the attack

Worth recording, so nobody re-opens them: imported chat ordinals really are dense array indices, and
edit → retry → edit stays consistent. `finishTurn` really does bump `updatedAt` when the thread exists
but the message does not. Retry really must reset the reply's `createdAt`, because the sweep reads it
as attempt age. And row-constructor `NOT IN` is valid — NULL would poison it, but both stored ids are
non-null, and `<> ALL` has the same NULL problem, so it is not the safer form. The empty-list guard is
what matters.

The unknown-slug divergence is real but not a blocker: an existing article with no chat still resolves
its row and returns `[]`, so only a genuinely unknown slug 404s, and both clients already handle an
error body. Standardise the files side eventually.

#### The single change that most reduces risk

**Durable attempt fencing on `search_runs`** — `attempt_id` plus attempt time, with both the sweep and
the finish conditional on that attempt.

### Open, and needing an answer before building

1. **Does Drizzle's `db.transaction` propagate a thrown `ChatConflict` unchanged?** Believed yes for a
   plain `throw`, not run. It decides whether a stale tab gets 409 or 500 — one assertion, written
   before the chat store is built around it.
2. ~~Is the `[]`-versus-404 divergence acceptable?~~ **Answered 2026-08-26: keep the 404, bring the
   files side up to it later.** See the divergence table above.
3. **Should `deleteGlossary` be dragged into step 10 anyway?** The SQL is trivial; leaving it 501 is a
   real hole for anyone testing `postgres` mode.

### What the review found in the built step 10

GPT Sol reviewed the implementation on 2026-08-26 (a second pass — the first reviewed the design
above). Verdict: **do not wire these into `src/routes.ts` yet.** Every finding below was checked
against the code, and all of the substantial ones were real.

**Two races the design had closed on one side and left open on the other:**

1. **Chat had the same unfenced late answer that searches had just been fixed for.** A retry keeps
   the message id — that is what makes it a retry — so `(article, thread, message)` cannot say which
   model call is reporting. Sweep buries A, reader retries into the same row, A returns, A wins.
   `chat_messages` now carries `attempt_id` / `attempt_started_at` too, `finish` **refuses a call
   with no attempt** rather than falling back to identity, and the sweep releases the fence on the
   attempt it buries.
2. **`expectedTailId` was checked one layer too high on the filesystem side** — loaded, checked,
   and *then* `editTurn` entered the mutex and read again. Two reads with a gap: a `begin` landing
   in it passes the check and is then deleted by the edit. The guard now runs inside the same
   `update` callback as `withEdit`. [tests/store-chat-tail-guard.test.ts](../../tests/store-chat-tail-guard.test.ts)
   goes red three times out of three with the old placement.

**Three smaller ones, all real:**

- The search `finish` took the attempt as optional and dropped the predicate when it was missing,
  so a caller who forgot to carry the token recreated the whole race. It throws now. It also
  accepted a patch with a non-terminal status while releasing the fence regardless, which would
  strip the lease off a run still waiting for an answer.
- `attempt_started_at` came from the process clock, read **before** the wait for the article lock.
  A write that queued for four seconds began life four seconds old. It comes from the database now,
  and from `clock_timestamp()` rather than `now()` — `now()` is the transaction's start, which is
  also before the lock wait.
- `rename` and `remove` took no lock at all, which is what made the lost update above possible.

**Four comments that claimed things the code does not do.** All corrected, and the third is the one
worth remembering:

- The chat store's header said the lock replaced serialisation for every write. It did not.
- The filesystem tail check said it read "the list they are about to edit". It read a copy.
- **The glossary-lookup rationale was simply false.** It said the file's map is read *before* the
  model call and held stale across it. `saveLookup` reads inside the mutex, *after* the call — so
  the story was scarier than the truth and pointed at the wrong mechanism. The real difference is
  that the mutex is process-local: two servers both merge their own term and one reader's answer
  disappears with both writes reporting success. That is still worth a row per term; it is not what
  was written down.
- A test comment still said an empty `notInArray` emits `not in ()`, after the source comment had
  been corrected.

**Four tests that passed for bad reasons**, all found by Sol and all now able to fail:

- The chat sweep's "spares this process's own work" asserted on a *different* message from the one
  in `keep`, so deleting `keep` handling entirely left it green.
- Both tie-break tests inserted their ids in already-sorted order, so removing the tie-break
  changed nothing. They insert in reverse now.
- The trim test only checked that each insertion survived its own transaction — which an
  implementation that deletes the previous row every time also satisfies.
- Two fixture ids contained `1`, which is **not in the id alphabet** (`i`, `l`, `o` and `1` are
  excluded so an id read aloud is unambiguous). A store handed a malformed id mints its own instead,
  correctly and silently, so those tests were testing something else. There is now an assertion that
  every literal id in the file is one the store will accept.

**One thing Sol was right to leave standing.** The `MAX_RUNS` divergence is larger than the code
claimed: with thirty future-dated rows, a backdated run is deleted by the *very next* search rather
than thirty later, and the two stores' sets can differ in twenty-nine of thirty members. The
guarantee is only **"at most thirty rows, and the run this `begin` returns survives this
transaction"**, which is what the comment now says. Closing it properly needs an insertion ordinal,
which is a column and has not been paid for.

## Step 11 — the pipeline writes revisions

Two problems in one step. **A** is publication and the carry-forward; **B** is the write seam inside
the stages. They fail differently and are tested differently. ~~Neither needs a schema migration.~~ **Wrong** — see the review at the end: nothing today relates a
job to the revision it is building, and the retry design needs that relationship stored.

Designed 2026-08-26, then cross-reviewed by GPT Sol, **which found four critical faults in the
design and one false claim about the code**. Those are in
[What the review found](#what-the-review-found-and-what-it-changes) at the end, and they change the
step's shape rather than only its size. Read them before building any of this.

**The "no schema migration" claim above is one of the things the review broke.** The retry lineage
needs a column, so it is one migration, not none.

### A. What a new revision inherits

On the filesystem, `data/<slug>/` outlives any one step: re-running `blocks` overwrites
`blocks.json` and leaves `glossary.json` beside it, `stale` is computed at read time from the
glossary's own `sourceHash`, and the panel shows the old glossary with a banner. As columns on
`article_revisions` a new revision starts NULL, so a reader's paid-for glossary becomes *"nobody has
found the terms for this one yet"* — under a green tick.

**The three-column list in this document was too short, and its shape was the worse problem.** An
allowlist is something somebody has to remember to extend, and this repo already knows how that ends:
`tests/store-artefact-manifest.test.ts` exists because five artefacts appeared under a one-day-old
schema. The rule that is actually true is the filesystem's own — *a new draft starts as a copy of the
current published revision, and each step overwrites what it owns* — written as a **denylist**, so a
new column carries by default:

| List | Columns | Why |
|---|---|---|
| **MINT** — never copied | `id`, `article_id`, `status`, `created_at` | A copied `created_at` reorders the library; a copied `status` publishes a draft |
| **DERIVE** — recomputed at publish | `word_count`, `block_count`, `part_count`, `section_count`, `root_gist` | **This is the resurrect-dead-data case.** They are derivations of `revision_blocks` and `tree`. A carried `block_count` beside changed blocks is not a stale artefact with a banner — it is a wrong number the library prints as fact, and nothing can tell |
| **CARRY** — everything else | `title`, `byline`, `site_name`, `lang`, `excerpt`, `note`, `requested_url`, `final_url`, `fetched_at`, `raw_bytes`, `raw_content_type`, `raw_encoding`, `extracted_html`, `stamped_html`, `tree`, `arc`, `tweets`, `glossary`, `summary`, `labels` | Each is owned by a step. If the step runs it overwrites; if not, the filesystem would have kept the file |

**Two more things carry, and the three-column reading missed both.** `revision_blocks`: a
`{ steps: ["extract"] }` job creates a revision and never runs `blocks`, so without the copy that
revision has no paragraphs at all. And `revision_step_runs`, copied row for row **with `input_hash`
unchanged** — that is what keeps the metadata page honest, because the row then says *tweets ran
against hash X* while the blocks hash Y, which is exactly the comparison that yields *present but not
current*. Drop the copy and the page reports a stage that never ran while the column holds a thread.

`beginRevision` builds its column list from `getTableColumns(articleRevisions)` minus MINT minus
DERIVE, so a column added to the schema is carried without anyone editing the function.

**`tree`, `labels` and `arc` carry too, and they are the uncomfortable case.** A `{ steps: ["blocks"] }`
job publishes new paragraphs under the previous tree, whose `range` pairs may name block ids that no
longer exist. On the filesystem this is invisible; in Postgres there is one copy, so the mismatch
becomes visible. The answer is not to skip the carry — a NULL tree is an unreadable article — but to
guard publication.

#### Where it happens, and why the copy is at the beginning

**There is no publication function today.** The only code that makes a revision current is the tail
of `importArticle`'s transaction, which is a migration tool. So half A is not a patch; it is writing
the path, in a new `src/store/revisions.ts`: `beginRevision`, `publishRevision`, `failRevision`.

**The copy happens at `beginRevision`, not at `publishRevision`.** Three reasons, the first
decisive:

1. **A step reads its siblings.** `generateArc` reads the tree; `generateGlossary` reads blocks, tree
   and the previous glossary, which it *appends* to. Filling NULLs at publish time means a
   `blocks`-only draft has a NULL tree all job long, and `arc` in the same job fails.
2. **Publish-time filling cannot tell "nobody produced it" from "the reader deleted it".**
   `deleteGlossary` is a real, reachable write. Copying whatever is there, NULL included, means the
   question never arises.
3. Publish-time filling is a hand-written `coalesce` per column — the allowlist again.

**Copy from the current published revision only.** Never walk back to the last revision that *had* a
glossary; that is how a deleted glossary returns weeks later. One exception, and it is forced by
step 12: on a **retry within the same job**, carry from that job's own previous draft, or a retry's
draft lacks attempt 1's finished steps, `stepIsDone` says not-done, and every expensive step re-runs.
The lookback is bounded to one job's drafts, so it still cannot resurrect what the reader deleted.

#### A new revision only when the text changes

Only `fetch`, `extract` and `blocks` mint one. `toc`, `arc`, `tweets`, `glossary` and `summary` write
their column onto the current published revision in one `UPDATE`.

This weakens *"immutable once published"* and belongs in `src/db/schema.ts` rather than arriving as a
surprise. What the property is for is stated in the schema itself — *"a failed re-extraction
overwrites a good article in place"* — and that is about the **text**. A revision per glossary
regeneration would copy every `revision_blocks` row and every `raw_bytes` blob to add one JSONB
value, and no reader could see the difference, because a single-column `UPDATE` is already atomic.
The honest name for the property is **immutable in its text**.

#### The publication guard

`publishRevision` refuses, loudly, when the draft has no blocks and no tree, or when **any block id
named in a tree node's `range` is absent from this revision's blocks**. The second turns today's
invisible tree/blocks divergence into a failed publish, which makes `{ steps: ["blocks"] }` alone
fail where today it succeeds and quietly diverges. **That is the right trade and it is a behaviour
change worth saying out loud;** the fix for anyone who hits it is to run `toc` too, which
`DEFAULT_INGEST_STEPS` and `cascadeForce` already do.

It takes `SELECT … FOR UPDATE` on the `articles` row before moving the pointer — the same race the
plan already records for two imports of one slug is a job race once the pipeline writes. And per
step 12's fence, publication is fenced on the job row **and its status**, checked for
`rowCount === 1` *before* the pointer moves, in the same transaction: without `AND status =
'running'` a rescued job's stale worker publishes a draft the queue has already given up on, and
reports success.

#### Staleness stays computable — read, not taken on trust

`TweetThread.sourceHash`, `Glossary.sourceHash`, `Summaries.sourceHash` and `LabelsFile.sourceHash`
all exist and are all produced by the one `hashBlocks` in `src/source-hash.ts`, which
`pgArticleReader` already compares against the revision's blocks. So carried columns stay
stale-computable with no change at all.

**`Arc` and `Tree` carry no `sourceHash`** — verified, and it is why `arc` stays in the force-cascade.
Neither can say whether it still describes the article, in either store. The publication guard is the
only thing that catches its worst case.

#### The bug carry-forward will expose on its first day

`pgArticleReader.articleMetadata` computes `done` from `revision_step_runs.status === 'done'` alone.
The filesystem computes *present **and** current*. They agree today only because no revision has ever
been superseded and the importer stamps every row `done`. The first carried-forward glossary makes
them disagree: files say not done, Postgres says done, and the reader is offered no "regenerate".
Fix it in this step — and note **parity cannot catch it**, for the same reason it cannot catch the
carry-forward: there is no re-extraction in between.

#### The test, and four one-line ways to make it red

`tests/store-carry-forward.test.ts` builds its own article rather than using whichever of the four
happens to have a `glossary.json` — the `ADDED_AT` lesson is that asserting a property against the
data you happen to have can pass by luck. It publishes blocks B1 with all three on-demand artefacts
stamped, then performs **an actual re-extraction** to B2 (one block's text changed, every id kept),
and asserts the artefacts survive with `stale === true`, that `articleMetadata` reports them
`done: false` in *both* stores, that `block_identities` still holds every B1 id, that `blockCount`
and `wordCount` describe B2, and that `tree` and `arc` are non-null.

- `beginRevision` inserts a bare row instead of copying → 404, "no glossary yet". The bug the step exists to prevent
- move `word_count`/`block_count` from DERIVE to CARRY → the resurrect-dead-data direction
- drop the `revision_step_runs` copy → "never ran" against a non-null column
- make `beginRevision` walk back to the last non-null glossary → put a `deleteGlossary` before the re-extraction and watch a deleted glossary return

Plus a **schema-drift guard** in the manifest test's spirit: assert that
`getTableColumns(articleRevisions)` minus MINT minus DERIVE minus CARRY is empty, so a new column
forces a decision instead of being carried or dropped by accident.

### B. The write seam

#### `outputs` is one table, not eight modules

This document said *"implemented across the stage modules; there is no single file to swap"*. **That
is wrong.** `outputs` is eight arrow functions in the `STEPS` table in `src/pipeline.ts`. What is
spread across the stage modules is the **writing** — each of `runExtract`, `runBlocks`,
`generateToc`, `generateArc`, `generateTweets`, `generateGlossary`, `generateSummaries` opens a file
itself. So the *declaration* can move today, in one commit, by the pipeline's owner, with no stage
module touched.

**Most artefacts already cross the seam as a return value** — `TocRun.tree`, `ArcRun.arc`,
`TweetsRun.thread`, `GlossaryRun.glossary`, `SummariesRun.summaries`, `BlocksRun.blocks` + `.html`.
For those the write is duplication rather than the interface.

**But "every stage already returns its artefact" is false, and so is the estimate built on it.**
`fetch` returns a progress string and discards the bytes, encoding, content type and final URL;
`extract` writes its transformed HTML and returns only metadata and a path; `toc` never exposes
`labelRun.file`. **And the stages still *read* files**: `src/arc.ts` reads `blocks.json`, `tree.json`
and `meta.json` directly, and tweets, glossary and summaries do the same. Moving the writes out while
the reads stay in does not produce a pipeline that can run against Postgres — it produces one that
still needs a disk. See the review.

Also out of date: *"all eight pipeline stages use a plain `writeFile`"*. `src/toc.ts` and
`src/labels.ts` both have a `writeAtomic` now, added after a GPT Sol review earlier the same day.
Still on plain `writeFile`: `pipeline.ts`'s own `raw.html`, `extract.ts`, `blocks.ts`, `arc.ts`,
`tweets.ts`, `glossary.ts`, `summarise.ts`. Leaving the "eight" claim standing invites somebody to
fix `toc` twice.

#### What replaces `outputs(ctx): string[]`

A step declares **what it produces**, named by what the thing is (`raw`, `meta`, `extractedHtml`,
`blocks`, `stampedHtml`, `tree`, `labels`, `arc`, `tweets`, `glossary`, `summary`) rather than where
it lands. `isDone` then splits into two questions, and **that split is what accommodates both kinds
of step**:

1. **Present** — does the store hold every kind in `produces`? The *store* answers, from the
   declaration. Never the step.
2. **Current** — was it made from this article, by this prompt, by this model? A comparison of the
   recorded stamp against the stamp the step would produce now.

`threadIsCurrent`, `glossaryIsCurrent` and `summariesAreCurrent` are already the same three
comparisons written three times — `sourceHash`, `generator !== MODEL`, version. Under the split the
comparison is `sameStamp`, once, and each stage supplies four values instead of a function. `toc` and
`arc` gain a real freshness check the day somebody writes four lines, rather than needing a whole
function; today they fall back to bare existence and the interface says so out loud.

The `ArtifactStore` interface is `has` / `read` / `write(slug, step, parts, stamp)` / `stampFor`. The
file adapter keeps a `PATHS: Record<ArtifactKind, …>` — **the one place a path is written down** —
and the Postgres adapter reads `revision_step_runs`. Same interface, so the seam lands file-backed
first and the swap really is one adapter.

It also kills a copy that already exists: `STEP_STORAGE` in `src/store/pg.ts` is a hand-maintained
per-step list of where output lives, sitting beside `outputs` and free to drift from it. Once
`produces` exists, both are rendered from it.

#### Does the seam fix the truncation hazard?

**Partly under files, completely under Postgres, and being precise about which matters more than the
fix.** `write` is one call per step for all that step's parts, and the file adapter writes each to a
temp file and renames — so "exists, will not parse, reports DONE" is gone. What files still cannot
give: `extract` writes two artefacts, and a kill between the two renames leaves one. Both are
well-formed; the *pair* is not complete. `has()` requires all of `produces`, so that state reports
not-done — correct, but by the check rather than by atomicity.

**`has()` must parse, not `stat`** — otherwise the truncation bug survives for the five steps with no
stamp. A JSON parse per skip check is a few milliseconds on a 360-block article and worth it.

In Postgres the question disappears: one `UPDATE` inside the job's transaction, so a killed process
leaves the draft unpublished and the reader on the previous revision. That is the argument *for* the
migration, not a task within it.

#### The order, and why no step needs eight stages edited at once

Steps 1–4 touch **no stage module at all**. Step 5 is one stage per commit, each with its owner, each
independently shippable, and the file adapter means nothing on disk changes.

1. `src/store/artifacts.ts` — the types only
2. `src/store/artifacts-fs.ts` — the file adapter: `PATHS`, atomic `write`, parsing `has`, `stampFor`
3. **`produces` added to `STEPS` beside `outputs`, both present**, plus the agreement test: `PATHS`
   applied to `produces` equals `outputs(ctx)` as a set. *This is the move that matters* — it checks
   the new declaration against the old one before anything depends on it
4. `stepIsDone` takes a store and uses `has` + `stampFor`; the three `isDone:` lines leave `STEPS`
   while `threadIsCurrent` and its two siblings stay exported for their CLIs. **The truncation test
   goes green here**, and `articleMetadata` on both stores starts sharing one currency rule
5. The writes move out, **one stage per commit**: `fetch` is free; `arc`, `tweets`, `glossary`,
   `summary` are one artefact each and already returned; `extract` and `blocks` return both already;
   `toc` needs `labels` added to `TocRun` and then stops writing its copy of `blocks.json` entirely,
   since under one revision row the tree and the blocks it was built from are the same record
6. `src/store/artifacts-pg.ts`, on `beginRevision` / `publishRevision`
7. Flip the selection in `src/jobs.ts` under `SPIDERYARN_STORE`, and ingest a real URL end to end

`ctx.dir` and `ctx.htmlFile` stay on `StepContext` throughout and are deleted at step 13.

#### The test that starts red

`tests/pipeline-artifact-store.test.ts`: declaration agreement per step; a round trip against the
real `data/` artefacts; **the truncation test, which starts red against today's code** — write a
valid `tweets.json`, truncate it to half its bytes, assert `stepIsDone` is `false`, where today it
returns `true`, then repeat for `arc.json`, a step with no stamp, which is what forces `has()` to
parse rather than `stat`; and a half-written `extract`, asserting the honest thing per adapter —
under files one artefact survives and the step reports not-done, under Postgres the transaction rolls
back and neither exists.

A test that goes red-to-green on the change is worth more than one that was green all along.

### What the review found, and what it changes

GPT Sol reviewed the design above on 2026-08-26 and returned four critical faults. The design is
**not safe to implement as written**. Each is kept with its correction, because the shape of the
mistake is more useful than a tidied-up answer.

**1. The seam leaves the *reads* behind, so it cannot run Postgres-only.** Half B moves the writes
out of the stages and says nothing about the reads. `src/arc.ts` reads `blocks.json`, `tree.json` and
`meta.json` off the disk; tweets, glossary and summaries do the same. Keeping `ctx.dir` until step 13
does not make those files exist after a cutover. And two stages do not return their artefact at all:
`fetch` hands back a progress string, discarding bytes, encoding, content type and final URL, and
`extract` returns metadata and a path while writing the HTML itself.

*The correction:* each stage core takes its artefacts **as values** and returns **every** artefact as
a value; the pipeline alone calls `store.read` / `store.write`. `fetch` must use the richer
`fetchDocument` rather than `fetchHtml`. A temporary filesystem workspace may bridge the migration,
but it has to be an explicit decision rather than an accident of what nobody moved.

**2. The publication guard accepts structurally wrong trees.** Checking that every `range` endpoint
exists proves only *tree ids ⊆ block ids*. The real invariant is an exact, ordered partition. Two
counterexamples that pass the proposed guard: **append a new block** keeping every old id — every old
range endpoint still resolves, and the new block has no leaf; **reorder the same ids** — membership
still passes while ranges reverse and stop partitioning.

*The correction:* the full check already exists in `src/validate-tree.ts` — root extent, singleton
leaves, exact coverage, order, child partitioning — but the file exports only `sameHeading`, so none
of it is reusable. Refactor it into a pure validator and call it from `publishRevision`. Also require
the copied `toc` stamp to match the draft's block hash, or a blocks-only text change that keeps every
id publishes old gists and nav labels **with no stale banner**. Note the asymmetry: a valid tree is
never rejected by the stronger check, so the dangerous outcome here is acceptance, not rejection.

**3. "This job's previous draft" cannot be identified.** Nothing relates a job to a revision —
neither `article_revisions` nor `jobs` carries the other's id — and Retry creates a **new job with a
new id**, while step 12's rescue marks the old one `error` without requeueing. So "carry from this
job's previous draft" has nothing to resolve, and "latest draft for this slug" would pick up another
job's draft and resurrect exactly what the copy-from-published rule exists to prevent.

*The correction:* an explicit `created_by_job_id` (or `draft_revision_id` the other way), fenced by
attempt, with rescue marking that draft failed. **This is the schema migration the section opened by
claiming it did not need.** And for a one-user first cut the boring answer wins: **re-run the
completed steps.** Paying for a few model calls on a retry is safer and far simpler than an ungrounded
draft lookback, and it can be improved once lineage exists.

**4. In-place `toc` / `arc` updates break the atomic-publication promise.** The migration's stated
guarantee is *"the previous complete revision or a complete new one, never a mixture"*. Writing `toc`
and `arc` straight onto the published revision means that during a `toc → arc` job **readers see the
new tree with the old arc for the entire model call** — and the exporter will faithfully export that
mixture. "A single-column `UPDATE` is atomic" answers the wrong question: the problem is
cross-*step* consistency, and `toc` owns tree, labels and a step-run row.

*The correction:* any job containing `fetch` / `extract` / `blocks` / `toc` writes one job-owned
draft and publishes once. Only genuinely independent on-demand artefacts may update in place, and
then transactionally with their step-run row. A `toc`-only job either mints a structural revision
with a matching arc, or clears the old arc rather than leaving it to contradict the new tree.

#### Five smaller corrections, all confirmed against the code

- **`revision_blocks.fts` is a generated column** (`generatedAlwaysAs`), so it must be *omitted* from
  the block-copy insert and left for Postgres to recompute. Copying it explicitly would fail or
  freeze a stale search vector.
- **The `created_at` reasoning is backwards.** Copying it does not reorder the library; *minting* it
  does, for any article with a null `fetched_at`, because the shelf orders on
  `coalesce(fetched_at, revision.created_at)`. Mint the revision's own timestamp, and give the shelf
  an article-level added-time to fall back on instead.
- **`root_gist` is not purely derived from tree and blocks.** `describeArticle` falls back to
  `meta.excerpt`, and the importer omits that fallback — a divergence step 11 must *resolve* rather
  than reproduce. One shared `deriveLibraryScalars({ blocks, tree, excerpt })`, tested on all five
  scalars including the fallback.
- **The claim that the reader already compares `LabelsFile.sourceHash` is false.** `pgArticleReader`
  does not read labels at all; it checks tweets, glossary and summary, and metadata trusts the
  step-run status. More importantly **one `hashBlocks` is the wrong stamp for every step**: arc,
  tweets, glossary and summaries all read the *tree*, and `src/labels.ts` already keeps a separate
  `structureHash` precisely because boundaries can move without any block changing. `input_hash` has
  to be step-specific.
- **The `PATHS` agreement test is not expressible as described.** `ArtifactKind = "blocks"` has two
  destinations today — `output/<slug>.blocks.json` from the `blocks` step and `data/<slug>/blocks.json`
  from `toc` — so a `Record<ArtifactKind, path>` cannot reproduce both output sets, and removing
  `toc`'s copy breaks the four stages that read it. Test `(step, kind) → destination` instead, and
  separate working artefacts from durable ones.

#### Two the review pushed back on, and it is right

- **Carry-by-default is the dangerous default, not the safe one.** A later `validated_at`,
  `published_at`, `based_on_revision_id`, `job_id` or `attempt_id` would be actively harmful copied:
  new content inheriting an old certification or an old worker's ownership. The drift test helps only
  if the column arrives through `schema.ts` (a SQL-only migration evades `getTableColumns`) and only
  if nobody silences it by adding the column to CARRY. Build the list from an **exhaustive policy
  map**: an unclassified column fails the test *and* is omitted at runtime.
- **Begin-time copying has a retention cost nobody costed.** The 360-block article is ~1.31 MiB of
  copied payload before overhead, and `raw_bytes` can be 32 MiB at the fetch ceiling. TOAST means
  this is not a row-size problem — it is a storage, WAL and cleanup problem, and a crashed worker
  leaves a complete copied draft that step 12's rescue never touches, because rescue only marks
  *jobs*. Accept the copying for the boring first version, but add ownership, terminal cleanup and a
  retention sweep **before** implementation, and make `beginRevision` one transaction so an in-place
  artefact update cannot land between copying the row, the blocks and the step runs.

On `has()` parsing rather than `stat`ing, the review measured the real cost and it is fine —
0.381 ms for a 354 KB `blocks.json`. But it should be a typed decoder per kind with a size limit
rather than a blanket `JSON.parse`, since raw HTML and raw bytes are not JSON at all.

#### The single change that most reduces risk

One explicit, **job-owned `draft_revision_id`** that every stage reads and writes, published only
after the tree passes the full structural validator and its step stamps match that draft. That one
change gives steps 11 and 12 a shared lifecycle, makes retry and cleanup decidable, and restores the
publication boundary the migration promised.

### What the review of the *built* seam found

Stages 1–4 shipped in `39b9892` and `fa3945c`, then GPT Sol reviewed the code rather than the plan —
the half that usually gets skipped. **Three criticals. The seam is safe enough as a filesystem queue
and is *not* yet a safe foundation for the cutover.** Fix these before the Postgres adapter.

**1. `has()` accepts a mixed generation, so the truncation fix is narrower than claimed.** `write()`
renames each output separately, and `has()` only checks that every current path parses. So if
generation A is complete and a rerun replaces *one* of generation B's outputs and dies, every path
exists and parses and the step reports **done** with A and B mixed. Two concurrent runs on one slug
do the same. **Per-file atomic renames are not atomicity across a step**, and
[ingest-queue.md](../project/ingest-queue.md) now wrongly implies a kill leaves an output absent.

*The red test to write first:* start from a complete old generation, replace exactly one output with
a valid new one, expect not-done. Then choose — a per-step manifest of content hashes committed last,
or (the boring option, and probably right) **force the interrupted step and everything downstream on
Retry**, and let the Postgres transaction supply real atomicity later.

**2. The filesystem cannot tell `extractedHtml` from `stampedHtml`, though the type says it can.**
Both map to `output/<slug>.html` and both use the same non-empty-text decoder. So after `extract`
overwrites the HTML, an old blocks JSON beside the new *unstamped* HTML makes `blocks` report done —
which is exactly the guarantee `artifacts.ts` claims to give. **And the test only asserts the two
paths are equal**, so it pins the collision without noticing it is a hole. Give them distinct paths,
or bind the blocks JSON and the stamped HTML through one generation hash.

**3. `stepIsDone` is not store-independent, so the seam cannot actually be switched.** The `store`
parameter **defaults** to the filesystem, so a future Postgres caller that forgets it compiles and
gets a confident filesystem answer — the silent-success shape this project keeps hitting. And even
when a store *is* passed, `tweets` and `summary` still call their filesystem-only `isDone(ctx)`
afterwards. Make the store **mandatory now**.

> **And the reason given for leaving stage 4 half-migrated does not hold.** The claim was that
> `tweets.ts` and `summarise.ts` keep `PROMPT_VERSION` module-private, so a stamp would need a second
> copy of that string. The review's answer: **each stage exports an `expectedStamp(blocks)` factory
> and keeps the constant private.** No copy, no drift, no public constant. That closes stage 4
> properly, and it should be done before the Postgres adapter rather than after.

#### Six more, all real

- **Absent, unreadable, corrupt and oversized are collapsed.** Any `stat` failure becomes a silent
  `null`, permissions and I/O errors included, and `artifacts.ts` documents that as intended —
  against this project's own no-swallowing rule. It also lets the metadata page fall through to the
  `example/` fixture when the real article merely could not be `stat`ed. **Catch only `ENOENT` as
  absence**; let the rest propagate, and treat parse corruption separately and visibly.
- **`assertProduced` can report success while the store says not-done.** It still checks path
  existence only, and the job is marked done straight after — so a malformed, oversized or simply
  *unchanged old* file passes, as does a forced stage that returns without writing anything. During
  the transition it should at least take the same store and use its readability rules.
- **The agreement tests permit the drift they claim to prevent.** Comparing **sets** lets two kinds
  inside one step swap destinations; the duplicate check runs on the declared side only; and the
  fixture table records a `from` path the loop never uses, so a round trip writes and reads through
  the *same possibly-wrong* mapping. Compare ordered arrays, assert uniqueness on both sides, and
  **prove it goes red by swapping `extract`'s two `PATHS` entries**.
- **The size ceiling is checked on the wrong side and racily.** `stat` then `readFile` means an
  atomic replacement in between can slip past it, and `write()` enforces no ceiling at all — yet the
  pipeline writes decoded text back as UTF-8, which can be *larger* than the bytes `fetch` capped. A
  step can therefore succeed and be permanently "not done" afterwards. Enforce on write, and read
  through one file handle so size and bytes describe the same inode. (A streaming JSON parser would
  be over-engineering; realistic per-kind ceilings are enough.)
- **`STEP_STORAGE` is still an uncovered third declaration**, hand-maintained, with a `?? []` that
  turns a missing step into silence. The "one place a path is written down" claim is false while it
  stands. Make it exhaustive over `StepName` and drop the fallback.
- **Two "object" decoders accept arrays**, so `{"nodes":[]}` passes. One `!Array.isArray` each.

#### What was fixed, and the two choices inside it

All three, plus six of the smaller findings, on 2026-08-26.

**The mixed generation is caught by recording the attempt, not by hashing the output.** The review
offered two roads: a per-step manifest of content hashes committed last, or forcing the interrupted
step and everything downstream on Retry. Neither was taken, and the reason the first one fails is
worth writing down because it looks like the obvious answer. A manifest of content hashes cannot be
kept for `extract`: `blocks` legitimately rewrites the same `output/<slug>.html` with the ids stamped
in, so `extract`'s recorded hash stops matching the moment stage 3 runs, and `extract` would report
itself *permanently unfinished* — re-fetching and re-extracting on every job, for ever. The second
road only covers the Retry button, and the case Greg actually asked about is the reader closing the
tab and coming back ([260826s-ingest-resume.md](260826s-ingest-resume.md)), which is not a retry.

So the store records the **attempt**: `beginStep` before the run, `finishStep` on the success path
only, `interrupted` asked first by `stepIsDone`. On the filesystem that is one small file under
`data/<slug>/steps/`; in Postgres it is `revision_step_runs.status = 'running'`, which the schema
already has — so this is not a file-store invention that has to be undone at cutover. A throw, a
cancel and a `kill -9` all leave the marker, and all mean the same thing.

**The HTML collision is closed by binding, not by moving the file.** Giving `extractedHtml` and
`stampedHtml` distinct paths was the review's first suggestion and would have changed the layout on
disk, the importer, the exporter and the manifest test. Instead `blocks` gained the one check that
can tell the two apart: **every id in its `blocks.json` has to be in the HTML beside it.** Verified
against the real articles before it was relied on — 360 blocks and 360 ids in `constitution`, 141
and 141 in `noema-mythology-of-conscious-ai` — so "all of them" is the actual invariant rather than
an approximation that starts failing on a long page.

Also done, from the six smaller findings:

- **`store` is required.** `stepIsDone` and `assertProduced` both take one and neither has a default.
  `src/jobs.ts` passes the pipeline's store under that name, so the day the pipeline moves to
  Postgres is one line in one file.
- **`assertProduced` asks the store**, not the filesystem, so a malformed artefact, one over the size
  ceiling, or a forced stage that returned without writing anything no longer passes a postcondition
  and gets marked done.
- **Only `ENOENT` is absence.** Every other `stat`/`open` failure propagates. A permissions error and
  a file nobody has written yet used to be one answer, which is how the metadata page fell through to
  the `example/` fixture for an article that was there all along.
- **One file handle for the size and the bytes**, so an atomic replacement between the two cannot
  slip past the ceiling — and **`write` enforces the ceiling too**, which is the side that matters:
  a step could write an artefact too big to read back and report success, and then be permanently
  not-done with no symptom but a stage that will not stay finished.
- **The agreement test compares ordered arrays**, checks uniqueness on both sides, uses the `from`
  column it used to merely record, and **proves itself red** by swapping `extract`'s two `PATHS`
  entries and asserting the disagreement is noticed.
- **Two "object" decoders no longer accept arrays.**

Left for their owners, and named here so it is not mistaken for done: **`STEP_STORAGE` in
`src/store/pg.ts`** is still a hand-maintained third declaration with a `?? []` fallback (that file
belongs to step 11 half A this week), and **`tweets` and `summary` still use `isDone` rather than
`stamp`** — the review's `expectedStamp(blocks)` factory is the right shape and belongs to those two
stages' owners.

#### What the review of the *fixes* found — 2026-08-26 evening

GPT Sol reviewed the three fixes rather than the plan for them, and returned
**NO-SHIP for resumable or concurrent ingest**. Four of its findings are fixed
(`b9b70b9`); four are real and are somebody else's step. Worth reading in that
order, because the fixed ones are all one shape: *the mechanism was right and its
edges were not*.

**Fixed.**

1. **The marker had no owner.** Six steps: two runners start, the second
   overwrites the first's marker, the first finishes and removes *the second's*,
   the second dies half-way through its writes, and the step reports done holding
   two generations with nothing left to say so. `beginStep` returns an attempt
   token now and `finishStep` will not accept another's. **It is still not a
   lock** — stopping a second runner is the queue's job, and in Postgres the
   `jobs_only_one_running` index's. Read-then-unlink is not atomic either, so a
   marker overwritten in the gap is still removed by the wrong owner; the
   Postgres adapter does it as one fenced `UPDATE … WHERE attempt_id = $attempt`.
2. **The earlier cancel fix was incomplete, and the reason is worth keeping.**
   Moving `finishStep` before the abort check fixed the *marker* — and Retry does
   not read the marker. It reads the job record, where the completed step had
   been unwound through the catch and marked `error`, so `forceForRetry` forced
   it and the model call was bought again. Fixing a symptom in the layer you were
   already editing, while the layer that actually decides sat one file away.
3. **Two comments claimed more than the code did**, which is worse than no
   comment. `htmlCarriesItsIds` is a *membership* test, not a binding — swapped
   ids, an id on an unrelated wrapper and duplicates all pass; it catches a
   re-extraction wiping every id, which is what it was built for. And
   `assertProduced` cannot tell that *this run* wrote what it reads, so a forced
   stage leaving one old output untouched passes it.
4. **`src/api.ts` had its own `exists()`** still swallowing every `stat` error, so
   a permissions error on a real article made the metadata page fall through to
   the `example/` fixture and answer 200 about somebody else's piece.

**Real, and not this step's to fix.** Each is named here so it is not rediscovered
as new:

- **Every stage CLI bypasses the marker.** `npm run toc` calls `generateToc`
  directly and publishes labels, blocks and tree as three separate renames; kill
  it between two of them and generation A's remaining files sit beside generation
  B's with no marker having ever existed. `extract` and `blocks` have the same
  window. The fix is **one shared step runner owned by the queue and the CLIs
  alike** — claim, run, validate, commit — which is half B stage 5.
- **The write ceiling does not protect the pipeline**, because `ArtifactStore.write`
  is called only by tests; the stages still write directly. An oversized write is
  caught afterwards by `assertProduced`, the marker stays, and Retry repeats a
  deterministic failure for ever. Also half B stage 5, plus a failure-kind for
  "this will never succeed".
- **`htmlCarriesItsIds` wants a generation token**, written by stage 3 into both
  `blocks.json` and the HTML. Cheap *because both files have one writer* — the
  reason a token was rejected for `extract` (a later step legitimately rewrites
  its HTML) does not apply to stage 3. Belongs to `blocks`'s owner.
- **A death between the last write and `finishStep` leaves a marker over complete
  output.** A safe false negative costing one repeat, except where the failure is
  deterministic. `toc` has the widest window: it publishes all three outputs and
  then awaits checkpoint deletion, so a cleanup that throws means `run` never
  returns.

#### What survived

`sameStamp` really does reject an empty expected stamp. The two `PATHS` anomalies are real and there
is **no third** resolved-path collision. The metadata page's two halves do agree, because `outputs`
and the store share one `ctx`. And no ordinary non-racing step is *more* permissive than before — the
change narrows the check everywhere except the interrupted-rerun case above.

### What this section corrects in the rest of this document

1. **The seam comes *out* of the stage modules, not into them.** This document recommended landing it
   *inside* each stage, still file-backed, with the stage's owner. The strategy is right; the
   direction is not. Followed literally it has an owner add a store handle to
   `generateTweets({ dir, store })` and keep writing from inside — leaving seven modules holding a
   store, seven still owning a path, and a second round of edits at cutover. It also asks for seven
   owners' time up front, when steps 1–4 need none of it
2. *"No single file to swap"* — `outputs` is one table in one file. This changes the estimate
3. *"All eight stages use a plain `writeFile`"* — `toc.ts` and `labels.ts` write atomically now
4. **The carry-forward is not three columns** — it must include `revision_blocks`,
   `revision_step_runs` and `tree`/`labels`/`arc`, and must *exclude* the five derived scalars, which
   are the real resurrect-dead-data hazard
5. *"This must land before step 11"* is not quite coherent: carry-forward has nothing to attach to
   until publication exists, and no publication function does. "Before" means writing
   `beginRevision` / `publishRevision` and their test first, **inside** this step

### Flagged, not determined

- **`labels-progress.json`** is a mid-step checkpoint written into `data/<slug>/`, and it is in
  neither `HOMES` nor `NOT_MIGRATED` in the manifest test — so that test goes red if one is left
  behind. It is scratch, not an artefact, and wants either a column on the draft or an explicit
  "stays a file". Belongs to whoever owns `toc`
- **The importer's revision-id derivation interacts with this.** It derives the id from
  `hashBlocks(blocks)`, so a `meta.json`-only change re-uses the id and mutates a published row. Once
  `beginRevision` mints a fresh uuid per extraction, the importer is the only thing still deriving
  one — decide it in the same change or the two paths disagree about what a revision id means
- **Transaction scope across a job**, and the retry shape above, both depend on step 12's rescue path,
  which this design pass did not read closely. It is the one place half A and step 12 have to agree,
  and it wants a second opinion before it is built

## Step 12 — jobs and claiming, decided before it is built

> **Superseded 2026-08-26, after this was written and reviewed.**
> [260826q-job-queue-rethink.md](260826q-job-queue-rethink.md) asked whether this design is the right shape at all,
> and the answer was no. **What gets built is a browser-driven advance endpoint**: Postgres owns the
> job, the browser asks the server to advance it one step, and the server decides which step. That
> deletes most of what follows — claiming, the claim loop, worker kicks, three-place rescue,
> `queue_state`, and the heartbeat.
>
> **What survives from this section, and must:** the attempt token and the fenced write, a job-owned
> draft revision, and the single-running-step rule. Everything below about fencing an *output* rather
> than only the job row still holds, and is still the thing most likely to be got wrong.
>
> pg-boss was reopened and **deferred with a trigger** — adopt it if a long-lived worker host ever
> exists, since a queue library gives you a queue and not durable compute. Read the rethink before
> building any of this.


Scoped, argued out and cross-reviewed on 2026-08-26 before a line was written, because this is the
step where a single-process assumption becomes a multi-process one, and hand-waving it is how the
migration breaks in production. Fable arbitrated the first pass; **GPT Sol reviewed that pass and
found three critical faults in it**, including one where this document had silently dropped a
condition [260825f-postgres-migration.md](260825f-postgres-migration.md) already had right. The reasoning is kept
because the conclusions look arbitrary without it, and because the first pass being wrong is the
most useful thing on this page.

### The premise, corrected

The first pass asserted flatly that *the heartbeat is a timer beside the work, not a checkpoint
inside it*, and concluded that lease length is therefore unrelated to step length. **That is half
true, and the half that is false is the half that sets the number.**

It holds while the worker awaits a model stream — the event loop is free, and a `setInterval`
heartbeats straight through a two-minute call. It does **not** hold across the synchronous stages:
JSDOM, Readability, DOMPurify, tree traversal, serialisation, hashing and model-output parsing all
occupy the loop, and [`fetch.ts`](../../src/fetch.ts) accepts up to 32 MB before any of them run. A
read-only benchmark during the review measured **4 MB of ordinary DOM blocking the loop for ~2.6
seconds**, and a valid 16 MB synthetic DOM exhausting a 4 GB heap after ~14.

So the honest rule, and the one to write down:

> Lease length is independent of how long an *awaited* call takes, but it must exceed the worst
> event-loop stall plus database round-trip delay.

Sixty seconds remains a plausible starting value. It is **not** a proof, and nobody should treat it
as one.

### Stop, and the latency it costs

An `AbortSignal` cannot cross a process boundary. With peers, the HTTP `Stop` lands on whatever
process the load balancer picked, which usually is not the one running the job. That process can only
record the request and return; the owning process has to *notice*. `LISTEN/NOTIFY` is ruled out under
the transaction pooler ([ingest-queue.md](../project/ingest-queue.md)), so noticing means polling —
and the heartbeat is already a poll.

So **the heartbeat carries cancellation back**: the owning process learns of it on its next beat and
calls its own local `controller.abort()`, tearing the stream down mid-call exactly as
[`cancelJob`](../../src/jobs.ts) does today. Keep the existing `signal.aborted` checks at step
boundaries too — they cost nothing and they are the belt.

**Three windows the first pass left under-specified**, each of which is a real bug if left as it is:

| Window | What must happen |
|---|---|
| Cancelled while **queued** | No owner exists to notice. Transition atomically to `cancelled`; never leave a `cancelling` flag with nobody to clear it. Today p-queue's own callback eventually clears it — Postgres provides no such callback |
| Cancelled **between claim and first beat** | Check before starting paid work, or the API key is spent on a job already cancelled |
| Cancelled, and **unwinding** | The heartbeat must go on extending the lease *throughout* the unwind. Otherwise a slow step that ignores its signal lets the lease expire, another worker starts, and the first is still writing. This is precisely why the current p-queue waits for the unwind |

### The numbers

**Heartbeat every 10s, lease 60s**, both in *database* time, deliberately decoupled: the lease is six
beats, so a false reclaim needs five consecutive misses. Do not tune the lease below 60s — Supavisor
hops, GC pauses, the event-loop stalls measured above and a laptop lid closing during local dev all
argue for slack.

Use a **single-flight self-rescheduling timer**, not a bare `setInterval`: an async beat whose
database round trip exceeds the interval will otherwise overlap with the next one.

**The lease detects a lost worker, not stuck work.** A worker can heartbeat perfectly while awaiting
a promise that will never settle, and no lease can see that by construction. Per-step deadlines stay
the defence. A distributed progress watchdog would be over-engineering for a one-user project and is
deliberately not being built — but the limitation goes in writing, because the number looks like it
covers more than it does.

### The worker lifecycle, which nothing else specifies

**`claim()` alone is not a queue.** Today `enqueue` schedules work immediately and p-queue starts the
next item once the previous settles. Step 12 as first written said who *may* claim and never said who
*does* — so a job enqueued while another holds the slot could sit queued for ever after the first
finishes.

One lifecycle, written down: **claim → start heartbeat → run → terminal transaction → claim again.**
Enqueue kicks it (through `waitUntil` on Vercel, per
[260825d-deploy-and-repo-move.md](260825d-deploy-and-repo-move.md)); boot, the jobs poll and any cron may also kick
it, and kicking an already-running worker must be safe.

### Fencing, and the condition this document had dropped

Every write a running worker makes is fenced, and the fence is **three conditions, not two**:

```sql
update spideryarn.jobs set …
 where id = $job and attempt_id = $attempt and status = 'running'
```

The first pass wrote only `id` and `attempt_id`. That is unsafe: the schema lets a terminal row keep
its token, so a rescued job already marked `error` would accept a stale worker's write and return
`rowCount === 1` — success, reported, with the wrong output. It is the exact failure the fence
exists to prevent, and it had already been got right in
[260825f-postgres-migration.md](260825f-postgres-migration.md); this document lost it. **Rescue must therefore be
atomic in one transaction:** mark terminal, rotate or clear the token and lease, clear any
cancellation request, and release the `queue_state` pointer.

`fencedUpdate` stays a ~15-line helper that throws a typed `StaleAttemptError` unless
`rowCount === 1` — the failure mode being zero-rows-reads-as-success,
[silent-success](../reusable/silent-success.md) again — with one test proving a stale `attempt_id`
throws and one proving a terminal row rejects its own former token. Keep it that small: an
assert-one-row wrapper, not a lease framework.

**But the helper is not the seam.** A generic `update(id, patch, attemptId?)` makes fencing
*optional*, and an optional fence is not a fence. The contract should expose **state transitions
rather than arbitrary patches** — `requestCancel`, `finish`, `fail`, `deleteFinished`,
`enqueueOrGet` — with every worker transition requiring an attempt token. That is a change to
[`contracts.ts`](../../src/store/contracts.ts) and it must land *before* the Postgres implementation,
not after.

`heartbeat` returns three outcomes rather than a boolean: `extended`, `cancelling` (abort locally,
**keep the slot**, unwind as cancelled), `lost` (abort locally too — a worker that no longer holds
the lease should stop spending the API key at once). Three *actions* are right; three *diagnoses* are
not, so attach a reason to `lost` — missing row, terminal row, replaced attempt, stolen lease — and
make a database or transport failure **reject**, never masquerade as `lost`.

### Rescue: three places, honestly labelled

- **Inside the claim transaction, always.** Claim already locks `queue_state` `FOR UPDATE` and
  already has to decide whether the recorded running job's lease is live. This makes the common path
  self-healing for free.
- **Piggybacked on the jobs poll, throttled.** This closes claim's gap when no new work arrives. Two
  caveats the first pass glossed: the module-level timestamp guard exists **once per process**, so N
  instances rescue N times per interval; and making a read endpoint write has caching, prefetch and
  retry consequences, so it needs `Cache-Control: no-store` and must be idempotent.
- **At boot, lease-aware.** `sweepStopped()`'s reasoning — *"this process has just started, so
  nothing on disk can have work happening against it"* — is single-process reasoning, and with peers
  a `running` row may belong to a live one. The purpose survives: rescue only rows whose lease has
  expired in database time.

**Keep the cron.** The first pass proposed deleting it; that is wrong. With no browser open there is
no poll, so removing it leaves crashed work dormant until somebody happens to make a request. Delete
it only if the product explicitly accepts that, said out loud.

**Rescue marks `error`; it never auto-requeues.** We declined pg-boss and with it retry, backoff and
dead-letter machinery, so auto-requeue without attempt counts is a crash loop that spends model
calls. This is the boring first cut and it matches today's behaviour — but note what it costs:
automatic completion does not survive a deploy. And "Retry already skips completed steps" is proven
only for *filesystem* artefacts; under the unbuilt per-attempt draft revisions it needs a red test
before it can be claimed.

### Lock order, or it deadlocks

`queue_state` points at a job, and nothing in the schema guarantees that pointer equals the one
`running` row. Two consequences: pointer drift makes claims hit `jobs_only_one_running` for ever —
safe from double execution, permanently unavailable — and claim taking `queue_state` then the job can
deadlock against finish taking the job then `queue_state`.

**Every operation touching both rows locks `queue_state` first, then the job, and changes both in one
transaction.** Treat a pointer that disagrees with the running row as a loud invariant failure rather
than something to paper over. Claim orders by `created_at, id` — `created_at` alone is not a total
order.

### Two things that must land inside step 12

**`work_key`, or de-dup silently stops working.** `sameWork()` / `activeFor()` scan the in-memory
`Map`; none of it is queryable, and `steps` is a mutating JSONB blob so it cannot be the key. Without
one, two processes each accept a duplicate "Add" click. The specification, which the older text got
incomplete: an immutable non-null hash over the canonical ordered `{step, force}` list **plus
`guidance ?? ""`** — today's identity includes normalised guidance and
[260825f-postgres-migration.md](260825f-postgres-migration.md) omits it — with a partial unique index on active rows
and `INSERT … ON CONFLICT` returning the existing job. Note also that `activeFor` returns only the
*first* active job for a slug, so it can already miss an identical job queued behind different work.

**`freeSlug`'s race, as a prerequisite with its own test.** It is check-then-use today, and
`articles.slug UNIQUE` only discovers the collision after both processes have chosen — so two
pipelines get paid for before one loses at publication. Reserve the slug transactionally before any
expensive work, retrying suffixes on conflict. Give it its own two-transaction red test rather than
entangling slug allocation with lease machinery.

## The importer converges — three fixes, 2026-08-26

All three were on the "what is not done" list below. They are one bug wearing three hats: **the
importer could add and it could update, and it could not notice a deletion.** So a second run did
not leave the database in the state a first run leaves it, which is the property the header of
`import.ts` has always claimed. Each was reproduced with a failing test
before it was touched, and each fix was then deliberately broken again to check the test could still
see it.

### 1. A revision row is now written as one unit

The revision id is `derivedUuid("revision", slug, hashBlocks(blocks))`, so a change to `meta.json`
alone hashes to the *same* revision and lands in the `on conflict do update` branch — which listed
twelve columns out of twenty-five. A corrected title, a byline that was missing, the URL after a
redirect, the raw bytes: all kept the first run's value for ever while the tree beside them updated,
and nothing said so because both halves succeeded.

**The fix is the third of the three options this document listed: replace every field as one unit.**
There is now a single `revisionValues` object and both the insert and the update use it, so it is
structurally impossible for a column to be added to one and forgotten in the other — which is
exactly how this happened.

Why not the other two:

- **Fingerprint the whole canonical revision**, so a metadata edit mints a new revision and
  published rows really are immutable. It is the tidy answer and it is the wrong shape for this
  schema. `revision_step_runs` is keyed by `revision_id` precisely so the pipeline can fill one
  revision in one step at a time; if the id moved whenever `arc.json` or `glossary.json` changed,
  every completed step would be orphaned by the next one, and each re-run would duplicate the blocks
  and the raw bytes under a new id. A revision is one **extraction**, and `slug` plus the blocks is
  exactly the identity of an extraction.
- **Refuse to touch a published revision.** Reads as the safe option; makes the tool useless.
  Re-running the importer after fixing a typo, or after re-running one late stage, is the normal
  case during a migration.

The schema's "immutable once published" still governs the **pipeline**. The importer is a migration
tool whose contract is that the files win — the same licence the reader-state delete already takes,
and the same reason cutover is a step rather than a flag flip.

One thing fell out of writing the test: `raw_content_type` and `raw_encoding` were hardcoded to
`null` even though the file's own header said a `raw.json` manifest recovers them, and
`unrecoverable` was already reporting them conditionally on that basis. The comment described
something the code had never done. They are imported from the manifest now, as is `requested_url` —
the pre-redirect URL, which `meta.json` has never held. A **backfilled** manifest is excluded: its
`encoding` describes the UTF-8 re-encoding sitting in `raw.html`, not what the server sent.

### 2. An inferred step row is withdrawn when its artefact goes

`revision_step_runs` rows are inferred from "the artefact is on disk" and were only ever added, so
deleting `arc.json` and re-importing left a `done` row and the metadata page went on reporting a
stage whose output does not exist.

The delete is **scoped to `implementation_version = 'imported'`** — the importer clears up only
after itself. The reader-state deletes are unconditional because a file really is the truth about a
reader's comment today; this table is different, because once the pipeline owns it a `done` row for
a step whose *file* is missing is correct. A migration tool must not be able to destroy that record.
`stepIsDone` being a bare existence check is still open, and still belongs to whoever moves the
pipeline onto this table.

### 3. `--prune` removes an article whose directory has gone

`importArticle` reconciles the slug it is handed and cannot know a different one has vanished, so a
deleted article kept its rows and went on being listed and served. This is the confirmed cause of
the parity suite's long-standing flaky failure.

**Opt-in, not default, and never silent either way.** Every full run lists the orphans and what each
one holds; `npm run db:import -- --prune` deletes them. Deleting takes the reader's questions,
conversations and saved searches, and there is nothing to export them back *from* — the directory
that would receive them is the thing that has gone. That asymmetry is the whole argument. `--prune`
is refused alongside named slugs, because judging what is missing needs the complete picture.

**"Gone" is two independent checks, because the dangerous failure is not pruning too little.** It is
`data/` being momentarily unreadable, or the process running from the wrong directory, and the tool
concluding that every article has been deleted.

1. `orphanSlugs(inDatabase, onDisk)` — a pure function, so the rule can be tested with no database
   and no filesystem in the way. An **empty disk throws**: returning nothing would be perfectly safe
   today and would silently stop pruning for ever the day the scan breaks
   ([silent-success](../reusable/silent-success.md) again). An empty *database* is not an error —
   that is a fresh machine.
2. `stat` on the directory, which must say `ENOENT`. Anything else — present, `EACCES`, `EIO` — is
   skipped and logged.

The two disagree often and on purpose: `importableSlugs` skips `_`-prefixed directories and skips
any article missing `blocks.json` or `tree.json`, which is a re-extraction part-way through, a stage
that failed, or another process mid-write. Every one of those is a directory that is still there.
Everything is scoped to one owner.

**It still must not run after cutover**, when the files are the stale copy — the same warning the
reader-state delete carries, and the reason both live in a tool nobody runs by accident.

### Tests

- `tests/store-import-revision.test.ts` — "replaces the
  metadata columns, keeping the same revision"; "records the content type and encoding the manifest
  recovered"; "drops the step row for an artefact that has been deleted"; "leaves a step row it did
  not infer alone".
- `tests/store-import-prune.test.ts` — three pure tests of
  the rule ("names a slug the database has and the disk does not"; "refuses to prune when the disk
  looks empty"; "says nothing when the database is empty, even with an empty disk") and three
  against the database ("does not call an article an orphan while its directory is there"; "does not
  call it an orphan when only its artefacts have gone"; "finds it, counts what it holds, and removes
  it once the directory is gone").

## What is not done

- **Two imports of the same slug can race for the pointer.** Different fingerprints produce two
  complete revisions, and whichever updates `articles.current_revision_id` last wins regardless of
  which extraction is newer. Lock the article row and say what the winner is.
- **The exporter is not a full rollback.** `raw.html` is outside the round trip's `ARTEFACTS` list,
  and the stamped HTML is only asserted to be in the right *place*, never compared. Two more, found
  while fixing the importer's convergence bugs on 2026-08-26 and left alone as out of scope:
  `exportArticle` writes the raw bytes to `raw.html` whatever they are, so a PDF article comes back
  as `raw.pdf` renamed; and it never writes `raw.json`, so the manifest — and with it the content
  type, the encoding and the pre-redirect URL that the importer now *does* recover — does not
  survive a round trip.
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
  [open question 8](260825f-postgres-migration.md#open-questions); a `fixture boolean` column on `articles`
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
