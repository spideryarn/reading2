# Moving storage from JSON files to Supabase Postgres

> We want to switch over to using Postgres instead of JSON for storing things, in readiness for
> deploying this properly to the web.
>
> — Greg, 2026-08-25

**Nothing here has been implemented. This is the plan.** It was written after three agents read the
old app, the live Supabase project and this codebase, and after a GPT-5.6 review of the seven
decisions that actually matter. Where that review changed our minds, this document says so.

This is the work [deploy-and-repo-move.md](deploy-and-repo-move.md#what-this-plan-needs-from-the-supabase-work)
is waiting on. That plan lists four things it needs; [§ What the deploy plan asked for](#what-the-deploy-plan-asked-for)
answers each one.

---

## The four decisions Greg made

Asked on 2026-08-25. The plan is written to them, not around them. Two carry a real cost, and the
cost is stated rather than buried.

| | Decision | Standing |
|---|---|---|
| **Auth** | Design for it, don't build it — tables carry an owner column, RLS deferred, no login UI of our own | **Settled elsewhere, and compatibly.** Greg has since told the deploy plan that auth *is* in scope as [a one-email beta gate](deploy-and-repo-move.md#the-beta-gate). See [§ Auth](#auth-the-gate-is-someone-elses-plan) |
| **Project** | Reuse the old app's Supabase project, new tables alongside | **Conditional.** See [one migration authority](#the-condition-one-migration-authority) — if that condition can't be met, this decision should be reversed |
| **Scope** | Everything in Postgres, including the HTML blobs | **Fine at these sizes.** One correction: what we store today isn't raw, so don't call it that |
| **Client** | `supabase-js`, not Drizzle/Prisma/`postgres.js` | **Fine.** RPCs are the escape hatch for the four things it genuinely can't do |

## What we found

### The old app already did this, and two of its decisions were reversed

`/Users/greg/dev/spideryarn/reading` — Supabase Postgres + Auth + Storage, **34 raw-SQL CLI
migrations**, no ORM, generated types, `supabase-js` through thin per-table service classes. The
same stack we're about to adopt, which makes its regrets unusually cheap to learn from:

- It had **`document_elements`** — normalised block rows — and **dropped the table**
  (`DROP TABLE IF EXISTS document_elements CASCADE`), settling on one `html_content` blob with
  element ids living as `data-id` attributes inside it.
- It had an **`ai_models`** registry table and **dropped that too**, in favour of a model string in
  a code-level map. Two goes to arrive at "a string in a map".
- Its **`profiles` RLS recursed on itself** and was fixed in at least two separate migrations, after
  an admin bypass had to be layered onto every policy.
- Its **storage RLS was never finished in SQL** — the migration itself says access control was
  "handled through the application layer".
- It had **no queue table at all**. Job state was a p-queue and an in-memory `Map`, exactly like
  this codebase today. There is no prior art here to copy.

One idea worth taking wholesale: **`ai_calls`**, a row per model call with tokens, latency, cost,
finish reason and the raw response. [llm-plumbing.md](../project/original-version/llm-plumbing.md)
already says the field list is the part that transfers even though their table was overkill. It is
not overkill once there is a database anyway.

### The live project

`blsgjlrezruxcfdyrqpk` — "Spideryarn Reading", eu-west-2, **Postgres 15.8**, Micro compute, Healthy.

| Table | Rows | Note |
|---|---|---|
| `document_enhancements` | 811 | AI output as JSONB keyed `(document_id, type, subtype)` |
| `ai_calls` | 306 | **31 MB** — `raw_api_response` dominates the entire database |
| `documents` | 15 | 2.7 MB |
| `profiles` | 9 | Stripe fields present |
| `chat_threads` / `chat_messages` | 3 / 6 | |
| `document_users` / `document_assets` | 0 / 0 | never exercised |

**9 auth users, email provider only.** RLS enabled on all 8 tables. One private storage bucket, 41
objects. Zero Edge Functions. `pgvector`, `pgmq`, `pg_cron` and `http` are **all disabled** — which
rules out Supabase Queues today without enabling an extension first.

Two things to look at before building on it:

- The dashboard shows a **"Grace period is over"** billing banner. The project reports Healthy, but
  if it is ever restricted the new app goes down *with* the old one, for reasons that have nothing
  to do with either app's code. **This is worth resolving before the new app depends on it.**
- Postgres 15.8 means `UNIQUE NULLS NOT DISTINCT` is available. The schema below needs it.

### This codebase

`data/` is **464 KB** across two real articles. `blocks.json` runs 12–152 KB, `raw.html` 12–176 KB.
Size is not a constraint and will not be one for a long time.

Three things the docs say that the code does not do, all of which the migration should fix rather
than carry across:

1. **There is no content-hash caching.** [architecture.md § Storage](../project/architecture.md#storage)
   says `tree.json` is "keyed on `hash(blocks.json)` + prompt version + model id", and
   [AGENTS.md](../../AGENTS.md) says "anything expensive is cached on a content hash". `grep` for
   `createHash` across `src/` returns **nothing**. The real mechanism is `stepIsDone`, an
   `access()` existence check. This is the old app's own top lesson — "check the code before
   believing a doc" — reproducing itself here.
2. **`src/api.ts` is the read seam, not the storage seam.** It says in its own header that it is
   "the seam Postgres goes behind", and for reads that is true. The *write* path is
   `PipelineStep.outputs(ctx): string[]` — an interface that returns **file paths** — implemented
   across five stage modules. Any plan describing this as a one-file change is wrong.
3. **`raw.html` is not raw.** [`src/pipeline.ts:172`](../../src/pipeline.ts) calls `fetchHtml()`,
   which returns a **decoded string**, and writes it back as UTF-8. `fetchDocument()` — which keeps
   the actual bytes, the final URL, the content type and the detected encoding — exists and is
   discarded. Naming a column `raw_html` would bless that falsehood permanently.

---

## The schema

Two tables became four, for one reason: **a block id is a durable identity, but a block's text and
position belong to a particular extraction.** Separating those is what lets a re-extraction drop a
paragraph without destroying the reader's question about it.

That is not a hypothetical. [`src/web/comment-nav.ts`](../../src/web/comment-nav.ts) already handles
it, deliberately:

> A comment whose block is gone — the article was re-extracted and that paragraph did not survive —
> sorts to the end rather than being dropped. **It is still the reader's question**, and it can
> still be read and deleted.

An earlier draft of this schema had `comments` foreign-keyed to the current block rows with
`ON DELETE RESTRICT`, so that a re-extraction dropping a commented-on block would fail loudly
instead of silently deleting a question. **That was wrong** — it would have made a documented,
working behaviour impossible, and turned a supported case into an error. The identity split gives
the guarantee without the cost.

```sql
create schema if not exists spideryarn;

-- Identity. One row per article, for as long as the article exists.
create table spideryarn.articles (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid references auth.users(id),
  slug                text not null unique,          -- global: it is the URL contract
  current_revision_id uuid,                          -- FK added below, deferrable
  created_at          timestamptz not null default now()
);

-- One extraction. Immutable once published.
create table spideryarn.article_revisions (
  id            uuid primary key default gen_random_uuid(),
  article_id    uuid not null references spideryarn.articles(id) on delete cascade,
  status        text not null check (status in ('draft','published','failed')),
  -- identity of the piece, as this extraction saw it
  title text, byline text, site_name text, lang text, excerpt text,
  requested_url text, final_url text, fetched_at timestamptz,
  -- stage 1's actual output, honestly typed (see § raw.html is not raw)
  raw_bytes bytea, raw_content_type text, raw_encoding text,
  extracted_html text, stamped_html text,
  -- derived wholesale, stored wholesale
  tree jsonb, arc jsonb,
  -- the library's scalars, computed once by describeArticle()
  word_count int, block_count int, part_count int, section_count int, root_gist text,
  created_at timestamptz not null default now(),
  unique (article_id, id)
);

alter table spideryarn.articles
  add constraint articles_current_revision_fk
  foreign key (id, current_revision_id)
  references spideryarn.article_revisions(article_id, id)
  deferrable initially deferred;

-- THE SPINE. A block id, once minted, is never deleted from here.
create table spideryarn.block_identities (
  article_id    uuid not null references spideryarn.articles(id) on delete cascade,
  block_id      text not null,
  first_seen_at timestamptz not null default now(),
  primary key (article_id, block_id),           -- COMPOSITE. Never global — see § collisions
  check (block_id ~ '^spya-[a-hj-km-np-z2-9][a-hj-km-np-z0-9]{5}$')
);

-- A block's content, as one revision saw it.
create table spideryarn.revision_blocks (
  article_id uuid not null,
  revision_id uuid not null,
  block_id   text not null,
  ordinal    int not null check (ordinal >= 0),   -- document order. NEVER infer it from anything else.
  tag text not null, kind text not null, level smallint,
  text text not null, words int not null, html text not null,
  gistable boolean not null, note text,
  primary key (revision_id, block_id),
  unique (revision_id, ordinal),
  foreign key (article_id, revision_id) references spideryarn.article_revisions(article_id, id) on delete cascade,
  foreign key (article_id, block_id)   references spideryarn.block_identities(article_id, block_id)
);

-- Anchored to IDENTITY, not to the current revision's rows.
create table spideryarn.comments (
  article_id uuid not null references spideryarn.articles(id) on delete cascade,
  id         text not null,                      -- client-minted; creation is idempotent on it
  owner_id   uuid references auth.users(id),
  block_id   text not null,
  quote text not null, start int not null check (start >= 0),
  status text not null check (status in ('pending','done','error')),
  answer text, citations jsonb, searches int, model text, error text,
  attempt_id uuid, lease_expires_at timestamptz,  -- replaces the in-process `answering` Set
  created_at timestamptz not null,
  primary key (article_id, id),
  foreign key (article_id, block_id) references spideryarn.block_identities(article_id, block_id)
);
```

Plus `jobs` + `queue_state` ([§ The queue](#the-queue)), a `revision_step_runs` table
([§ A step is not done because a row exists](#a-step-is-not-done-because-a-row-exists)), and
`ai_calls` borrowed from the old app.

### Why the tree stays JSONB

The tree is generated wholesale, validated wholesale, fetched wholesale and replaced wholesale, and
**no feature owns a tree-node row**. Normalising it would mean maintaining `rootId`, parent/child
consistency, child order, inclusive contiguous ranges, and the deliberate absence of `gist` on
leaves — relational machinery with no relational query behind it. Node ids are regenerated every run
and [must never be foreign keys](../project/library.md#when-this-becomes-postgres).

`arc` stays a separate JSONB column on the same revision, because it is separately generated and
[joins by range, never by node id](../project/granularity-zoom.md#the-arc).

### Why the blocks are rows

The opposite call from the tree, and the opposite call from the old app — so it needs a reason. The
reason is not search or embeddings, though both get easier. It is that **the block id is the one
durable identity in the system**, and identities want a table with a foreign key pointing at them.
The old app's element ids lived inside an HTML blob and were never queried; ours are the join key
for every feature the product has.

The "140 inserts per article" objection disappears inside an RPC — one JSON array in, expanded with
`jsonb_array_elements(...) WITH ORDINALITY`, one request, one transaction.

---

## The traps

Each of these is silent. Together they are the reason this document is long. See
[silent-success.md](../reusable/silent-success.md) — this is that pattern, eight more times.

### Block ids are only unique *within* an article

`spya-` + 6 characters from a 32-character alphabet, first a letter: **771,751,936** ids.
[`src/blocks.ts`](../../src/blocks.ts) checks for collisions, but only within the article it is
building. Nothing checks across the library — and nothing needs to, because every id is resolved
inside one article. But that means a **global** primary key on `block_id` is wrong:

| Library | Blocks | P(≥1 collision) |
|---|---|---|
| ~5 articles | 1,000 | 0.1% |
| ~100 articles | 20,000 | **22.8%** |
| ~250 articles | 50,000 | **80.2%** |
| ~1,000 articles | 200,000 | ~100% (≈26 expected) |

A global unique index would start rejecting valid inserts at around a hundred articles. A global
*upsert* would be worse: it would silently overwrite one article's paragraph with another's. **The
primary key is `(article_id, block_id)`.** Nobody may "tidy" that into a single column later.

### The Data API silently truncates at 1,000 rows

Supabase's Data API returns **at most 1,000 rows by default**, and going over is not an error — you
get exactly 1,000 rows and a `content-range: 0-999/*` header that nothing in this codebase reads. A
long article would lose its tail and render as a shorter article that looks entirely fine.

Today's articles are ~140 blocks. The fetch cap allows far larger. **Either** read blocks through a
`load_article(slug)` RPC that aggregates them server-side, **or** paginate and assert that the
returned count equals `block_count`. Do not rely on the default being generous enough.

### Stage 3 recovers ids from `output/`, not from `data/`

[`runBlocks`](../../src/blocks.ts) carries ids forward from `output/<slug>.blocks.json` — the
working copy — not from the durable `data/<slug>/blocks.json`. The moment the pipeline stops writing
`output/`, the Postgres implementation must explicitly pass the current revision's ordered blocks
into `splitIntoBlocks`. **Miss this and every id is re-minted while the database still looks
perfectly healthy** — which is precisely the failure
[block-ids.md](../project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)
exists to prevent.

This is the single most expensive mistake available in this migration. Nothing will error.

### The Supabase docs' grant block opens the database

The [custom-schemas guide](https://supabase.com/docs/guides/api/using-custom-schemas) tells you to
run `GRANT ALL ON ALL TABLES IN SCHEMA myschema TO anon, authenticated, service_role`. **The anon
key is public by design.** Combine that grant with "RLS written but permissive" and the result is a
world-readable and world-writable database containing untrusted fetched HTML.

Grant to `service_role` only while the app is server-side. Public reads, when they come, go through
a narrow view or a read RPC — never a blanket grant.

### `SKIP LOCKED` does not give you concurrency 1

The obvious `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` claim pattern lets **two workers claim two
different queued jobs**. That is exactly the global concurrency-1 guarantee
[ingest-queue.md](../project/ingest-queue.md) chose on purpose. Claiming must lock a singleton
`queue_state` row first.

### A step is not done because a row exists

`stepIsDone` is an existence check today, and translating it to "column is non-null" carries the
bug across. This is the moment to build what the docs already claim:

```sql
revision_step_runs(revision_id, step_name, input_hash,
                   implementation_version, prompt_version, model,
                   status, finished_at)
```

A step is done only when a `done` row matches the current input hash *and* the current
implementation, prompt and model versions. Then `architecture.md`'s sentence about content hashes
becomes true instead of aspirational.

### `NULL` is not an absent property

`exactOptionalPropertyTypes` is on ([typechecking.md](../project/typechecking.md)), and
`describeArticle` deliberately omits `byline`, `gist` and the rest with conditional spreads rather
than setting them `undefined`. Rows come back with explicit `null`s. **Normalise at the adapter
boundary**, or the wire shape changes and the client's `?? ` fallbacks start behaving differently.

### Slug allocation becomes a race

[`freeSlug`](../../src/jobs.ts) stops two different URLs both called `news` from sharing artefacts.
A SELECT-then-INSERT version of that is race-prone; the suffix must be allocated under the unique
constraint, not before it.

---

## The seven decisions, settled

### Publication, not ingest, is the atomic unit

Fetching and two model calls take one to two minutes. That cannot be one transaction, and trying
would be the wrong shape anyway — `toc` and `arc` are independently re-runnable and `arc` is
optional. So the guarantee is narrower and more useful:

> **A reader sees either the previous published revision or the complete new one. Never a mixture.**

Stages build a **draft** revision, each committing its own output in a short request. One
`publish_revision(...)` RPC then validates the draft and advances `articles.current_revision_id`,
comparing against an expected value so a concurrent publish is rejected rather than silently
winning. Rolling back a bad refresh becomes a pointer change.

This is the one place the plan spends real complexity, and it is worth it: today a failed
re-extraction overwrites a good article in place.

### `supabase-js`, with RPCs for four things

`supabase-js` cannot group calls into a transaction — Supabase documents a database function as the
answer, and PostgREST runs each request in one transaction that rolls back on error. So RPCs own:
**publication**, **block expansion**, **queue claiming**, and **article reads** (to dodge the
1,000-row cap). Everything else is ordinary `.from().select()`.

Costs, stated plainly: transactional rules move into SQL migrations, JSON inputs need explicit
validation, function changes need regenerated types, and RPC errors are less pleasant than
TypeScript ones. Use `SECURITY INVOKER`; if `SECURITY DEFINER` is ever needed, pin `search_path = ''`
and schema-qualify everything. Don't overload RPC names — PostgREST resolves overloads badly.

### The queue

A plain `jobs` table plus a singleton `queue_state` row, claimed by lease
(`claim_next_job` / `heartbeat_job` / `finish_job`). **Not pg-boss** — it wants a direct Postgres
connection and its own pool, which is the second client the `supabase-js` decision exists to avoid.
**Not Supabase Queues** — `pgmq` isn't enabled, it doesn't execute workers, and we'd still need the
rich `jobs` table for the UI, cancellation, steps and errors.

This reverses [ingest-queue.md](../project/ingest-queue.md)'s "pg-boss when Postgres lands". That
doc should be updated rather than left to disagree.

Two current subtleties must survive: cancellation requests cancellation but **does not release the
global slot** until the running stage unwinds (this was fixed once already, to stop a retry starting
while a cancelled blocks stage was still writing); and de-duplication keys on owner + slug + ordered
steps + forced steps, because an arc-only job and a full refresh of the same slug are *different
work* and a blunt "one active job per slug" index would swallow one of them.

It stops being right when redelivery, multiple workers, backoff, dead-letters or scheduled work
become requirements. Then Supabase Queues is the first thing to evaluate, because it stays reachable
through `supabase-js`.

### `supabase-js` runs server-side only

The React client keeps talking to `/api/*`. Moving Supabase into the browser would delete two GET
handlers and none of the API layer — safe fetching, the Anthropic and OpenRouter keys, queue
orchestration, spend limits, publication, validation and stable wire types all still need trusted
server code. It would also couple the UI to the schema at exactly the moment we need the
filesystem/Postgres switch to stay *below* the API seam.

### The condition: one migration authority

**A custom schema does not isolate migration history.** Both repos would still share
`supabase_migrations.schema_migrations`. `supabase db push` builds the remote list from that table
and refuses when the local files diverge, telling you to run `supabase migration repair` — which
rewrites the shared ledger and can break the other repo's view of it. The old repo has **34
migrations** and a workflow that pushes on every commit to `main`.

So, before the first Spideryarn migration, **exactly one repository must own `db push`.** Either
disable `.github/workflows/deploy-production.yml` in the old repo, or have this repo apply its
migrations with its own small runner and its own history table inside the `spideryarn` schema,
never touching `supabase db push`.

The custom schema is still worth having — for naming, for privileges, and so the old app's tables
can eventually be dropped without an audit. It just solves a different problem than the one it
looked like it solved.

If neither condition can be met, **the decision to reuse the project should be reversed.** A new
project costs nothing and removes this entire section, along with the billing-banner risk.

### Auth: the gate is someone else's plan

Public site + ingest online + no login is an open proxy and an open wallet, and it is broader than
`POST /api/jobs` — `POST /api/comments/:slug` spends the OpenRouter key, `POST /api/jobs/:id/retry`
spends the Anthropic key, and cancel/forget/delete let a stranger interfere with Greg's work.

**This is already settled, and not here.** Greg's answer, and the design, are in
[deploy-and-repo-move.md § The beta gate](deploy-and-repo-move.md#the-beta-gate): a hard-coded
one-email allowlist resolved from the Supabase session in `src/auth.ts`, checked once at the top of
`handleApi`, failing closed, returning 403 and a beta notice rather than an empty shelf. That is the
smallest real gate, which is exactly the right size.

Two things follow for **this** plan, and they are the whole of its auth work:

- **`owner_id` columns exist from day one** and are populated with the session user. That is the
  "design for it, don't build it" decision doing its job — no query above the adapter has to change
  when a second person is let in.
- **RLS stays deferred, so the grants carry the whole weight.** [ingest is gated in the API layer](deploy-and-repo-move.md#rls-and-realtime-not-now),
  not in the database — which means a permissive grant is not a slow leak, it is the only thing
  standing between the anon key and the data. See
  [§ The Supabase docs' grant block](#the-supabase-docs-grant-block-opens-the-database). Grant to
  `service_role` alone.

The one thing worth flagging back to that plan: a gate that authenticates against **the old app's
Supabase project** authenticates against its **9 existing users**, on an email provider that is
already enabled. The allowlist is what makes that safe, so it must not quietly become
"any authenticated user".

---

## The order of work

One authoritative store at a time. **No permanent dual writes** — an importer for moving forward and
an exporter for moving back, both temporary.

| # | Step | Ends with |
|---|---|---|
| 1 | **Settle migration ownership and the mutation-security question.** Record the exposed-schema setting and local `config.toml` | Nothing built, the two blockers cleared |
| 2 | **Introduce storage contracts, still filesystem-backed**: `ArticleReader`, `CommentStore`, `JobStore`, `PipelineArtifactStore` | Existing tests pass unchanged |
| 3 | **Apply the schema additively** — tables, RPCs, grants, policies, `ai_calls`, generated types | No behaviour change. Nothing dropped |
| 4 | **Build the importer and the exporter.** The exporter *is* the rollback mechanism | Both idempotent, ids and ordinals preserved exactly |
| 5 | **Backfill and compare both readers** — compare the API-shaped `Article`, not SQL rows. Assert `block_count` equals the array length | Proven parity, files still authoritative |
| 6 | **Postgres reads in preview**, behind an explicit env flag | Exercised: library, article, tree, arc, comments |
| 7 | **Comments to Postgres, one cut** | `pending` still written before the model call; detached comments intact |
| 8 | **Pipeline outputs to draft revisions** | Stage 3 reads ids from the current revision. Publication advances the pointer |
| 9 | **Jobs and claiming to Postgres** | Lease-based worker, rescue cron, polling contract unchanged |
| 10 | **Cutover** — brief pause, final import, verify, switch reads and writes together | Filesystem adapter, importer, exporter and old files kept one release, then deleted |

**The smallest first step that delivers something real** is inside step 5: import one existing
article, serve it through the Postgres `loadArticle` behind a flag, and prove the API response is
byte-identical.

**Do not catch a Postgres error and fall back to files.** It would hide divergence and make the
entire comparison exercise worthless.

Rough size: step 1 is a conversation; steps 2–5 are two or three days; steps 6–10 another three or
four. Call it **a week and a half**, not the "weeks" that
[deploy-and-repo-move.md](deploy-and-repo-move.md) estimated for a full cloud-native rebuild —
because most of that estimate was the queue and the per-step functions, and this plan keeps the
single worker.

## What the deploy plan asked for

[deploy-and-repo-move.md § What this plan needs from the Supabase work](deploy-and-repo-move.md#what-this-plan-needs-from-the-supabase-work)
lists four requirements. Answering its explicit question — **it is storage, not only auth**:

1. **Article artefacts read *and written* through the seam** — steps 2, 8, 10. Yes.
2. **Job records in Postgres** — step 9. Yes, plus cross-instance claiming it didn't ask for.
3. **Auth, or a way to tell Greg from a stranger** — **shared.** The gate itself is that plan's
   ([§ The beta gate](deploy-and-repo-move.md#the-beta-gate)); this plan supplies the `owner_id`
   columns it writes to and the tight grants it depends on. See
   [§ Auth](#auth-the-gate-is-someone-elses-plan), including the note that the project it
   authenticates against already has 9 users in it.
4. **`blocks.json` stays a source artefact** — yes, and stronger: `block_identities` never deletes a
   row. But see [§ Stage 3 recovers ids from `output/`](#stage-3-recovers-ids-from-output-not-from-data),
   which is how it would silently fail anyway.

## Docs that will need updating

- [architecture.md § Storage](../project/architecture.md#storage) — the filesystem layout, and the
  content-hash sentence that isn't true yet
- [library.md § When this becomes Postgres](../project/library.md#when-this-becomes-postgres) — its
  today→then table is right in shape; the revision model is new
- [ingest-queue.md § When this becomes Postgres](../project/ingest-queue.md#when-this-becomes-postgres)
  — the pg-boss recommendation is reversed here, with reasons
- [deploy-and-repo-move.md](deploy-and-repo-move.md) — its Option 4 says "Postgres, a real queue,
  per-step functions… **Not now**". Greg has now said now. That line should be updated rather than
  left silently contradicted, the same way the Tailwind/shadcn reversal was written down
- [AGENTS.md](../../AGENTS.md) — "filesystem over database" is a stated principle. This is the
  second deliberate exception after shadcn, and should be recorded as one

## Open questions

1. **The billing banner on the Supabase project.** Resolve before the new app depends on it.
2. ~~Mutations in production: closed, or a minimal gate?~~ **Answered** by
   [the beta gate](deploy-and-repo-move.md#the-beta-gate) — a one-email allowlist. Kept here only to
   note that it authenticates against a user pool that already has 9 accounts in it.
3. **Which repo owns `db push`?** Blocks the first migration.
4. **How many revisions to keep?** Recommendation: current + previous, pruned beyond that. Full
   history is an archive nobody asked for.
5. **Does the old app's data need extracting** before that project is eventually retired? 15
   documents, 9 users, 41 storage objects.
6. **Does the `example` fixture become a seed row, or go?** It is the fresh-clone empty state today
   and the tests rely on it.

## Related docs

- [block-ids.md](../project/block-ids.md) — read before touching anything that resolves an id
- [architecture.md](../project/architecture.md) — the pipeline and the storage layout being replaced
- [ingest-queue.md](../project/ingest-queue.md) — the queue, and the recommendation this reverses
- [library.md](../project/library.md) — `LibraryEntry` as a row, and the seam
- [security.md](../project/security.md) — why raw and extracted HTML must not reach `anon`
- [deploy-and-repo-move.md](deploy-and-repo-move.md) — the plan waiting on this one
- [original-version/](../project/original-version/overview.md) — the app that already did all this once
- [silent-success.md](../reusable/silent-success.md) — the pattern behind every item in
  [§ The traps](#the-traps)
