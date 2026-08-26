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
| 10 | Chat, searches, glossary lookups — writes | ⬜ |
| 11 | Pipeline writes to draft revisions (+ carry-forward) | ⬜ **needs coordination** |
| 12 | Jobs and claiming | ⬜ |
| 13 | Cutover: flip the default, delete the filesystem adapter | ⬜ |

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

## What is not done

- **GPT Sol never reviewed this.** The Codex workspace is out of credits — confirmed on
  `gpt-5.6-luna` as well, so it is account-wide rather than model-specific. Fable arbitrated
  instead, which is a second opinion but **not** the cross-family review the house process asks for.
  Re-run `scripts/run-codex.ts` against this plan once credits are back.
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
- **One flaky failure, seen once and not reproduced.** A single test failed in a full run while the
  dev server and a browser session were both hammering the same local database; four subsequent
  runs were clean and the failure was not captured. The plausible cause is two test files calling
  `importArticle` for the same slugs concurrently. Recorded rather than declared fixed.
