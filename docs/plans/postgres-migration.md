# Moving storage from JSON files to Supabase Postgres

> We want to switch over to using Postgres instead of JSON for storing things, in readiness for
> deploying this properly to the web.
>
> — Greg, 2026-08-25

**Nothing here has been implemented. This is the plan.** It was written after three agents read the
old app, the live Supabase project and this codebase, and after **two** GPT-5.6 reviews — one of the
seven decisions that actually matter, and a second, adversarial one of the client decision after
Greg reopened it — plus a third opinion to break the one tie those two left. Where a review changed
our minds, this document says so, and where it caught us being wrong it says that too.

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
| **Project** | ~~Reuse the old app's Supabase project~~ | **Reversed by Greg, 2026-08-25**: *"Ok, let's try a new project."* Taken once the cost of reuse was visible rather than assumed — see [§ A new project](#a-new-project-and-what-that-deletes) |
| **Scope** | Everything in Postgres, including the HTML blobs | **Fine at these sizes.** One correction: what we store today isn't raw, so don't call it that |
| **Client** | ~~`supabase-js`, not Drizzle/Prisma~~ | **Reversed by Greg, 2026-08-25**, once he decided [the API layer, not RLS, is the security boundary](deploy-and-repo-move.md#rls-and-realtime-not-now). Now **Drizzle for all data, Supabase for Auth alone** — see [§ The client](#the-client-drizzle-for-data-supabase-for-auth) |

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

### The old project we inspected and did not use

**This is the project we decided against.** Kept because the inspection is what made the decision
informed, and because the old app still runs on it.

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
- Postgres 15+ means `UNIQUE NULLS NOT DISTINCT` is available **if** the job de-duplication key
  ends up needing it. An earlier draft asserted three times that the schema uses it; it does not,
  and the claim was removed rather than the feature invented to match. See
  [§ Job de-duplication](#job-de-duplication-still-unsolved).

The second bullet is moot for us now: [§ A new project](#a-new-project-and-what-that-deletes). The
first followed us to the new project, because it was never really about the project —
[§ The project we are actually using](#the-project-we-are-actually-using).

### The project we are actually using

**`alschkahzfagtppxspfq`**, created by Greg on 2026-08-25.

Empty, ours, and sharing nothing with the old app — no inherited users, no `public` tables, no
trigger on `auth.users`. Read off the dashboard on 2026-08-25: **"Spideryarn Reading 2"**,
**`eu-west-2` (London)**, **Postgres 17.6.1.165**. That last number is where local's `major_version`
comes from, and local is 17.6 — matched, not merely close.

**One thing the new project did not escape: the billing banner.**
[§ A new project](#a-new-project-and-what-that-deletes) below says the reversal deleted the old
project's *"Grace period is over"* warning. It did not. The same banner sits on this project's
dashboard, because a grace period belongs to the **organization**, not to a project, and this one
lives in the same organization. Everything else that reversal removed is genuinely gone — the shared
migration ledger, the `auth.users` trigger, the nine inherited users. This one was wishful, and it is
the only item on the list that can stop the app answering requests. **Worth resolving before
anything depends on it.**

Nothing has been applied to it yet. The schema has only ever been run against
[the local stack](../project/supabase-local.md), and the first thing to happen against the remote is
[step 1](#the-order-of-work): the roles, and confirming `spideryarn` is not in the exposed schemas.

**Local tracks this project's major version, not the CLI's default.** Local was 15 while we expected
to reuse the old project and moved to 17 when this one was created — see
[supabase-local.md § The ports, and the Postgres version](../project/supabase-local.md#the-ports-and-the-postgres-version)
for why a *lower* local version is the quieter of the two failure directions, and for the fact that
changing it is a wipe.

The migrations have been verified against **both** 15.8 and 17.6, so nothing in them depends on the
version. That was luck rather than design, and it stops being true the moment anything uses a
17-only feature.

### This codebase

`data/` is **464 KB** across two real articles. `blocks.json` runs 12–152 KB, `raw.html` 12–176 KB.
Size is not a constraint and will not be one for a long time.

Three things the docs say that the code does not do, all of which the migration should fix rather
than carry across:

1. **Content-hash caching exists in exactly one stage of six.**
   [architecture.md § Storage](../project/architecture.md#storage) says `tree.json` is "keyed on
   `hash(blocks.json)` + prompt version + model id", and [AGENTS.md](../../AGENTS.md) says "anything
   expensive is cached on a content hash". For `toc` and `arc` that is still aspirational — the real
   mechanism is `stepIsDone`, an `access()` existence check. But `tweets` landed while this plan was
   being written and does it properly, via `hashBlocks` in
   [`src/tweets.ts`](../../src/tweets.ts) and the new optional `isDone(ctx)` hook on `PipelineStep`.

   **Copy its choice of input, not just its existence.** It hashes `id \t text` per block, joined —
   deliberately *not* the bytes of `blocks.json`, because those bytes change when an unread field is
   recomputed and *don't* change when two blocks swap ids. Hashing the file would have been both
   over- and under-sensitive. `revision_step_runs.input_hash` below should be that hash, and
   `PipelineStep.isDone` is the seam it already plugs into.
2. **`src/api.ts` is the read seam, not the storage seam.** It says in its own header that it is
   "the seam Postgres goes behind", and for reads that is true. The *write* path is
   `PipelineStep.outputs(ctx): string[]` — an interface that returns **file paths** — implemented
   across six stage modules (`fetch`, `extract`, `blocks`, `toc`, `arc`, `tweets`). Any plan
   describing this as a one-file change is wrong.
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
  owner_id            uuid not null references auth.users(id),   -- see § every row has an owner
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
  references spideryarn.article_revisions(article_id, id);
  -- NOT deferrable, on purpose. See § the deferrable FK we talked ourselves out of.

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
  owner_id   uuid not null references auth.users(id),
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

The "140 inserts per article" objection was going to be answered by an RPC taking one JSON array and
expanding it with `jsonb_array_elements(...) WITH ORDINALITY`. With Drizzle it is answered more
plainly: **one multi-row `INSERT`** (chunked if an article ever gets big enough to approach the
parameter limit) inside one transaction. Same round-trip count, no JSON round-trip, no second
validator.

What must not change is that **`ordinal` is written explicitly** from the array index. It is not
inferred from insertion order, from a sequence, or from `WITH ORDINALITY` on something that might be
reordered on the way in. Document order is data.

### Every row has an owner, and the DDL now says so

An earlier draft's prose said every row carries an owner while its DDL left `owner_id` nullable —
the two disagreed, and the nullable version would have won. Both are `not null`, and the importer
assigns Greg's user id to everything it brings across. A row with no owner is not a state this system
has; a column that permits one is an invitation to produce it.

### The deferrable FK we talked ourselves out of

`articles.current_revision_id` was `deferrable initially deferred`, so that an article and its first
revision could be inserted inside one transaction that pointed each at the other. Look again and
there is no cycle to break: **`current_revision_id` is nullable**, so creation is insert the article,
insert the revision, update the pointer — no intermediate state ever violates the constraint.

It is now an ordinary foreign key. Recorded because the complexity was inherited from a first draft
rather than required by anything, and because Drizzle's foreign-key builder has no deferrability
option — so keeping it would have forced a hand-written migration for a constraint nothing needed.
Whenever a plan carries a feature only because an earlier draft of the same plan had it, that is the
moment to ask what would break without it.

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

### The Data API's 1,000-row truncation, and why the assertion stays anyway

This was the sharpest trap in the first draft: PostgREST returns **at most 1,000 rows by default**,
and going over is not an error — you get exactly 1,000 rows and a `content-range: 0-999/*` header
that nothing in this codebase reads. A long article would lose its tail and render as a shorter
article that looks entirely fine.

**Going direct to Postgres deletes this risk from the data path entirely.** It was a PostgREST
default, not a Postgres one, and nothing in the new design goes through PostgREST.

**Keep the assertion anyway.** `block_count === blocks.length`, checked where the article is
assembled, costs nothing and catches the *other* ways a block list silently loses its tail — a
`LIMIT` left in during debugging, a bad join, a partially-written draft revision, an importer that
stopped early. The specific cause is gone; the failure mode is generic. Deleting a cheap check
because one of its causes went away is how the next cause gets to be silent.

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

The client decision improves on this rather than just avoiding it: **do not expose `spideryarn`
through the Data API at all.** Leave it out of the dashboard's "Exposed schemas" setting, and never
run that grant. PostgREST then cannot see the schema whatever the keys are, which makes the anon key
irrelevant to it — a structural answer instead of a careful one.

Three separate credentials, and none of them is the project's `postgres` superuser password:

| Credential | Used by | Privileges |
|---|---|---|
| runtime role | Vercel functions, via the transaction pooler | `SELECT/INSERT/UPDATE/DELETE` on `spideryarn.*` and nothing else — **no access to the old app's `public` tables** |
| migration role | `drizzle-kit migrate`, via a direct/session connection | DDL on `spideryarn` and its migration ledger schema |
| Supabase anon/publishable key | the browser, for Auth only | no data access, because the schema isn't exposed |

**Assert the negative in a test**: the runtime role must fail when it selects from the old app's
`public.documents`. A privilege you believe you didn't grant is exactly the kind of thing that is
true right up until someone runs a convenience `GRANT` to fix an unrelated error.

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
`publishRevision(...)` helper then validates the draft and advances `articles.current_revision_id`,
comparing against an expected value so a concurrent publish is rejected rather than silently
winning. Rolling back a bad refresh becomes a pointer change.

This is the one place the plan spends real complexity, and it is worth it: today a failed
re-extraction overwrites a good article in place.

**Validate the same draft you publish.** Loading a draft, validating it in TypeScript, and then
opening a *separate* transaction to move the pointer is a race with a window in the middle — the
draft can change between the two. Either do the load-validate-publish in one transaction, or version
the draft and make the pointer update assert that version. Moving the transaction boundary out of
SQL and into TypeScript is what makes this newly easy to get wrong; the answer is not to be careful,
it is to keep the read inside the transaction that acts on it.

### The client: Drizzle for data, Supabase for Auth

**Reversed from the first draft**, after Greg reopened it:

> Ok, given my new decision that maybe I'll go with API instead of RLS, maybe that means we should
> reconsider Drizzle instead of Supabase.js? […] We are still using Supabase for authentication —
> does that tilt us towards Supabase.js over Drizzle? Or should we consider using both?
>
> — Greg, 2026-08-25

Yes to both, and the split is clean:

| | Client |
|---|---|
| sign-in, session refresh, token verification, sign-out | Supabase's auth client (browser **and** server) |
| every application table query | Drizzle, over a direct Postgres connection |

**Why the reversal follows from Greg's RLS decision.** `supabase-js` was chosen when RLS was going to
be the security boundary — PostgREST plus RLS is a coherent design, because the database enforces the
rules and the client is thin on purpose. Take RLS away and put the boundary in the API layer, and
PostgREST is left contributing only its restrictions: it cannot span a transaction, so **all four**
of the operations this plan cares about — publication, block insertion, queue claiming, article
reads — had to become PL/pgSQL functions. That is the tail wagging the dog. Every one of those
functions existed to work around the client, not to express something the database is better at.

**What that buys, concretely:**

- **The four RPCs stop being SQL.** Note what this does *not* mean: their invariants don't relax.
  `publishRevision`, `claimNextJob`, `heartbeatJob` and `finishJob` are still carefully-designed
  transactional operations with the same rules — the singleton lock, the expected-revision compare,
  the fencing token. They move from PL/pgSQL to TypeScript-plus-SQL. That is a change of language,
  not a change of difficulty, and anyone reading this as "the hard part goes away" will write a race.
- **One validator instead of two.** Tree, arc and range validation already exist in TypeScript
  ([`src/validate-tree.ts`](../../src/validate-tree.ts)). An RPC taking JSON would need its own
  checks in PL/pgSQL, and two validators for one rule drift. Keep database constraints for row-level
  facts — the block-id regex, `ordinal >= 0`, the status enums — and keep structural validation in TS.
- **The 1,000-row trap disappears** ([above](#the-data-apis-1000-row-truncation-and-why-the-assertion-stays-anyway)).
- **Types come from the checked-in schema**, with no generation step. A first draft of this argument
  overstated it — `supabase gen types --local` works against a local instance and its output can be
  committed, so "the project can't typecheck offline" was **wrong**. The real difference is smaller:
  Drizzle's types are the schema file, so they cannot be stale, where generated types are a
  build artefact somebody has to remember to regenerate.

**What it costs, and this is the honest half.** PostgREST was restrictive, but it was also hiding
work: transaction correctness, credential scope, connection pooling and migration isolation were
Supabase's problem and are now ours. Every one of the four sections that follow this one exists
because of that transfer. Drizzle is not simpler — it is more direct, and directness is what this
design needs. That is the trade, stated in the direction that makes it a trade.

**Two things Drizzle can't express**, needing one `drizzle-kit generate --custom` migration
alongside the generated ones: foreign keys into `auth.users` (declaring an Auth-owned table in the
Drizzle schema risks migration generation treating it as ours to manage), and the roles and grants
above. Everything else — composite primary and foreign keys, raw SQL `CHECK` including the block-id
regex, `UNIQUE NULLS NOT DISTINCT`, JSONB — is supported directly. **Not `bytea`**: Drizzle 0.45
has no native `bytea` column, despite a review saying it did. It is four lines of `customType`, and
the correction is here because "the review said so" is exactly how an unchecked claim becomes a
build error.

The drift this creates is real: Drizzle's snapshot doesn't know about the custom migration, so a
future generated migration that drops and recreates one of those tables can lose the `auth.users` FK
silently. **The check is a catalog assertion in the integration tests** — query `pg_constraint` and
assert the Auth FKs exist, the app tables are in
`spideryarn`, and the runtime role cannot read `public.documents`. A custom companion migration makes
the divergence visible; hand-editing a generated file hides it.

**And Drizzle does not validate JSONB.** `tree`, `arc`, `tweets`, citations and step blobs are typed
at compile time and unchecked at runtime. They still need explicit validation at the storage
boundary, along with the [`null`-to-absent normalisation](#null-is-not-an-absent-property). A type
that describes a column is not a parser.

### The queue

A plain `jobs` table plus a singleton `queue_state` row, claimed by lease
(`claimNextJob` / `heartbeatJob` / `finishJob`).

**`jobs.id` is `text`, not `uuid`.** [`src/jobs.ts:426`](../../src/jobs.ts) mints job ids with the
same `mintId()` as blocks — they are `spya-` ids. Typing the column `uuid` would break every existing
id on import. Worth noting while we're here: jobs call bare `mintId()` where blocks call
`mintUniqueId(taken)`, so a job-id collision today silently overwrites a file. A primary key makes
that loud for free — a small, real win from the migration.

**Not pg-boss.** The first draft rejected it because it needs a direct Postgres connection and its
own pool, which was the second client the `supabase-js` decision existed to avoid. **That reason is
now gone** — we have a direct connection and a pool. Reopening it honestly: pg-boss brings retries,
backoff, dead-lettering and cron, all of which we would otherwise write. We are still not adopting
it, for a different and weaker reason — our `jobs` table is unusually rich (per-step state,
cancellation that must not release the slot, forced-step de-duplication) and would have to exist
*beside* pg-boss's, leaving two sources of truth about the same work. **Revisit when redelivery or
backoff becomes a requirement rather than a nicety**, which is the point at which pg-boss's half is
the bigger half.

**Not Supabase Queues** — `pgmq` isn't enabled, it doesn't execute workers, and we'd still need the
rich `jobs` table for the UI, cancellation, steps and errors.

This reverses [ingest-queue.md](../project/ingest-queue.md)'s "pg-boss when Postgres lands". That
doc should be updated rather than left to disagree.

Two current subtleties must survive: cancellation requests cancellation but **does not release the
global slot** until the running stage unwinds (this was fixed once already, to stop a retry starting
while a cancelled blocks stage was still writing); and de-duplication keys on owner + slug + ordered
steps + forced steps, because an arc-only job and a full refresh of the same slug are *different
work* and a blunt "one active job per slug" index would swallow one of them.

**The lease only works if it fences every write.** `attempt_id` must be a condition on the update,
not a column that records what happened:

```sql
update spideryarn.jobs set ...
 where id = $job and attempt_id = $attempt and status = 'running'
```

— and the code must assert that exactly one row changed. This applies to heartbeats, completion,
error writes, step transitions and publication, and to the comment lease that replaces the in-process
`answering` Set. The case it exists for: a worker whose lease expires *during* a two-minute model
call cannot be stopped mid-call, so a second worker starts, and the first one wakes up and tries to
write. Without the fence, the stale attempt overwrites the newer one's answer, and the result looks
like a successful job with the wrong output. Give each ingest attempt its own draft revision so the
same rule covers stage output as well as job rows.

It stops being right when redelivery, multiple workers, backoff, dead-letters or scheduled work
become requirements.

### The driver underneath Drizzle: `pg`

Drizzle sits on a Postgres driver, and the two reviews disagreed. This plan's first pass said
**`postgres.js`** — Drizzle's most idiomatic driver, and the one
[Supabase's own Drizzle guide](https://supabase.com/docs/guides/database/drizzle) uses. The second
review said **`node-postgres` (`pg`)**, citing an open transaction bug and Vercel's pool helper. A
third opinion broke the tie by reading the issue rather than relaying it.

**Use `pg`** — `drizzle-orm/node-postgres`. By a modest margin, and the margin is worth stating
honestly, because the reasoning matters more than the answer:

**At this scale the choice barely matters.** Both drivers will serve one user flawlessly. Nobody
should re-open this expecting a performance difference; there isn't one to find.

What decided it was tail risk plus maintenance posture, both pointing the same way:

- **[porsager/postgres#1189](https://github.com/porsager/postgres/issues/1189) is real, open, and in
  the transaction path** — "BEGIN can reach PostgreSQL without reserving the transaction connection",
  opened 2026-08-09, no maintainer reply. It affects plain `sql.begin()`, not only `reserve()`: the
  reservation hook is skipped after BEGIN's bytes are written, so the backend sits *idle in
  transaction* and another caller's queries can land inside your transaction.
- **But the second review overstated it, and the correction is the useful part.** The deterministic
  reproduction uses non-default settings (`max_pipeline: 1`). Under defaults you would need ~100
  concurrently pipelined queries on one connection at the instant BEGIN is written, or socket
  backpressure. For a one-user beta that is essentially unreachable. **This bug would almost
  certainly never have fired here.**
- **The stronger half is maintenance.** `postgres.js`'s latest release is v3.4.9, from 2025-04-05 —
  about sixteen months old, single maintainer, and a correctness issue in the transaction path sitting
  unanswered. `pg` releases regularly and has several maintainers.
- **Vercel's pool helper.** `attachDatabasePool` from `@vercel/functions` releases idle pool
  connections before a function suspends. It is not `pg`-specific — it supports several drivers — but
  `postgres.js` is not among them, because it exposes no pg-style `Pool`. So the point stands even
  though the claim behind it was loosely worded.

So the honest summary is: **an unfixed correctness bug that probably wouldn't have bitten us, in a
library that hasn't shipped in sixteen months, versus a maintained driver that Vercel's lifecycle
helper actually manages — for a one-line difference at the call site.** Cheap insurance, bought
knowingly rather than out of fear.

Two consequences that would otherwise be found the hard way:

- **Cap the pool small: `new Pool({ max: 2 })`.** Even the blessed combination of `pg` +
  `attachDatabasePool` + Supavisor has a reported connection-growth problem on Fluid compute
  ([supabase#40671](https://github.com/orgs/supabase/discussions/40671)). At one user, a pool of one
  or two connections costs nothing and sidesteps it.
- **Never hand-roll `BEGIN`/`COMMIT` through `pool.query`.** Each `pool.query` may take a different
  connection, so a hand-written transaction would scatter its statements across connections and the
  `FOR UPDATE` lock in [the queue](#the-queue) would guard nothing — silently, since every statement
  still succeeds. Drizzle's `db.transaction()` checks out one client and is correct; the rule is
  simply never to reach past it.

One thing left unverified, flagged rather than asserted: the tie-breaker believed `pg` under Supavisor
transaction mode needs no `prepare: false` equivalent, because Drizzle's `pg` driver sends unnamed
statements — but marked that as inference rather than something it checked. **Confirm it against a
real pooled connection in step 3**, since a wrong answer here shows up as a runtime error on the
first transaction, not at connect time.

### Connections: transaction pooling, and the five things it takes away

Vercel functions reach Postgres through Supabase's **transaction-mode pooler** (Supavisor), which
hands out a backend connection for the duration of each transaction. Migrations and dumps use a
**direct or session connection** instead — Supabase recommends this explicitly, and the pooler is
also the IPv4 path where direct connections are IPv6-only.

The good news for this design: transaction mode is per-transaction, so `db.transaction(...)` is one
real Postgres transaction and ordinary row locks behave normally. **The lease-based queue works
unchanged**, provided claiming is shaped as one short transaction — lock `queue_state` `FOR UPDATE`,
expire the recorded lease using *database* time, select and mark one job, store a fresh `attempt_id`
and expiry, commit — with the long fetch-and-model work happening strictly after the commit, and
heartbeats and completion as their own short transactions.

**Named prepared statements must not be used.** With `postgres.js` this is the explicit
`prepare: false` that Supabase's guide sets; with `pg` it is believed to need no setting at all
(see the caveat [above](#the-driver-underneath-drizzle-pg)). Either way the cost is only server-side
reuse of parsed and planned statements — queries stay parameterised and safe, and at this traffic it
is immaterial.

**What transaction pooling silently takes away.** None of these error at connect time — they fail, or
quietly do nothing, at the moment you rely on them:

- `LISTEN`/`NOTIFY` — **already recommended by [ingest-queue.md](../project/ingest-queue.md) for
  worker wakeups.** Delete that line; keep polling.
- session advisory locks (`pg_advisory_lock`). The transaction-scoped
  `pg_advisory_xact_lock` is fine.
- `SET` outside a transaction — `SET LOCAL` inside one is fine.
- temporary tables expected to outlive a transaction.
- session-held cursors, and anything else pinned to a session.

`LISTEN/NOTIFY` is the dangerous one here, because it is written down as a future improvement in a
doc an agent would reasonably follow.

### **Data** runs server-side only — Auth runs in both

The first draft's heading said "`supabase-js` runs server-side only". That is wrong once Supabase is
the login: signing in, refreshing a session and signing out all happen in the browser. The rule that
actually holds is narrower and clearer — **no application data query ever leaves the server.**

Which is easy to state as a lint-able boundary: the module that owns the Supabase client exports
auth calls and nothing else. No `.from()`, no `.rpc()`, no `.schema("spideryarn")`, anywhere. Since
the schema isn't exposed through the Data API at all, those calls would fail — but failing at runtime
in production is not as good as not existing.

The React client keeps talking to `/api/*` for everything else. Moving data into the browser would
delete two GET handlers and none of the API layer — safe fetching, the Anthropic and OpenRouter keys, queue
orchestration, spend limits, publication, validation and stable wire types all still need trusted
server code. It would also couple the UI to the schema at exactly the moment we need the
filesystem/Postgres switch to stay *below* the API seam.

### A new project, and what that deletes

Greg's first answer was to reuse the old app's project. Two costs surfaced *after* that decision,
and once both were written down he reversed it:

> Ok, let's try a new project.
>
> — Greg, 2026-08-25

**This is the single largest simplification in the plan**, and it is worth recording what it removed
rather than quietly enjoying it. Both problems were real, and only one of them could be managed:

- **A shared migration ledger.** An earlier draft claimed a custom schema isolates migration
  history. It does not — both repos would have shared `supabase_migrations.schema_migrations`, and
  `supabase migration repair` rewrites it for everyone. Drizzle's own ledger removed that specific
  collision, but not the wider hazard: an unscoped `supabase db diff` in the old repo defaults to
  *all* schemas and could have adopted our tables into its history, and `supabase db reset --linked`
  would have dropped `spideryarn` with no way to recreate it. Manageable, but only by a discipline
  kept in a repository nobody is actively working in.
- **A trigger that scoping could not reach.** The old project has a live `SECURITY DEFINER` trigger
  on `auth.users` that inserts into `public.profiles`. Every future Spideryarn signup would have
  written a row into the old app — and a failure there would have failed the signup. Greg's own
  login would not have fired it, so it would not have appeared in testing.

A new project costs nothing and deletes both. It does **not** delete the "Grace period is over"
billing banner — an earlier version of this sentence said it did, and that was checked afterwards and
found to be wrong. The warning is organization-level and appears on the new project too:
[§ The project we are actually using](#the-project-we-are-actually-using).

**It also moves the target to Postgres 17.** The new project reports **17.6.1.165**, where the old
one is 15.8, so the local stack was re-pinned to match — 17.6 as of 2026-08-25. The rule written down
with it is that the local major version tracks *the remote*, never the CLI default, and that
changing it is a wipe rather than an edit:
[supabase-local.md § The ports, and the Postgres version](../project/supabase-local.md#the-ports-and-the-postgres-version).
Nothing in the schema moves with it — `UNIQUE NULLS NOT DISTINCT` above arrived in 15, and it is the
newest thing this design asks for.

Two things still worth carrying across, because they are good practice rather than workarounds:

- **The Drizzle ledger is still explicitly named** (`spideryarn_migrations.__drizzle_migrations`)
  and still sits outside `schemaFilter`. Not because another app might share it now, but because a
  `push` that sees its own bookkeeping table as an undeclared object will offer to drop it.
- **`drizzle-kit push` is still banned against anything that matters**, and `schemaFilter` is still
  pinned to `spideryarn`. A new project still contains Supabase's own `auth` and `storage` schemas,
  and Drizzle's default scope has already changed once between major versions.

**What this does not change**: everything about the schema, the block-id rules, the queue, the
publication protocol and the client decision is identical either way. The reuse question was always
about blast radius, never about design.

**What it costs**: the old project's 15 documents, 9 users and 41 storage objects stay where they
are, so the two apps no longer share a login. That is a real consequence and nobody has asked for
those accounts — but it means the beta gate authenticates against an empty user pool, which is
strictly safer than the alternative it replaces.

### Auth: the gate is someone else's plan

Public site + ingest online + no login is an open proxy and an open wallet, and it is broader than
`POST /api/jobs` — `POST /api/comments/:slug` spends the OpenRouter key, `POST /api/jobs/:id/retry`
spends the Anthropic key, and cancel/forget/delete let a stranger interfere with Greg's work.

**This is already settled, and not here.** The provider choice is in
[auth.md](../project/auth.md) — and note that `owner_id` below is *why* it was not a free choice, since
Supabase's RLS only accepts externally-issued JWTs from five named providers
([auth-options.md](../research/auth-options.md)). Greg's answer, and the design, are in
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

The one thing worth flagging back to that plan **has been fixed by the new-project decision**: a
gate authenticating against the old app's project would have been authenticating against its 9
existing users, on an email provider already enabled, with only the allowlist making that safe. A new
project starts with no users at all. The allowlist still must not quietly become "any authenticated
user" — but it is now a second lock rather than the only one.

### Job de-duplication: still unsolved

`src/jobs.ts` de-duplicates on owner + slug + ordered steps + forced steps, because an arc-only job
and a full refresh of the same slug are *different work* and a blunt "one active job per slug" index
would swallow one of them.

**The schema does not carry that yet, and `steps` cannot be the key.** It is a JSONB column that
mutates as statuses and timestamps change, so any constraint over it stops matching the moment the
job starts running. What is needed is an immutable `work_key` — a canonical string derived from the
ordered step names and force flags, written once at enqueue — with a partial unique index on
`(owner_id, slug, work_key)` restricted to `queued` and `running` rows. That is where
`UNIQUE NULLS NOT DISTINCT` may earn its place.

Not built, because the queue is step 9 and building the key without the claim protocol beside it
would be guessing. Recorded here so it is not rediscovered as a bug.

Related and also unsolved: `freeSlug`. `articles.slug UNIQUE` *detects* the race but does not
allocate the loser a safe suffix, and if the article row is not inserted until publication, two jobs
can still pick the same free slug and both work on it. Enqueue has to reserve the row under the
unique constraint **before** the expensive work, reuse it when the URL matches, and retry the next
candidate when it does not.

### What the third review caught

The schema was reviewed by GPT-5.6 after being written, and returned **NO-SHIP** with six real
defects. All were either fixed or written down; the ones fixed:

| Found | Status |
|---|---|
| `queue_state` can be **deleted**, and then every claimant locks nothing and believes it holds the queue | Fixed — seeded in `0001`, and a `BEFORE DELETE` trigger refuses |
| Nothing stopped **two `running` jobs** | Fixed — unique partial index on a constant where `status = 'running'` |
| A `running` job could have a NULL `attempt_id`, fencing nothing while looking fenced | Fixed — CHECK requires token and lease |
| `tweets` stored as `Tweet[]` loses `sourceHash` — **the staleness feature breaks** | Fixed — stores the whole `TweetThread`. `arc` likewise |
| `Meta.note` had no column, and a real article carries one | Fixed |
| `revision_blocks (revision_id, ordinal)` index duplicated the one `UNIQUE` already creates | Fixed — removed, after checking `pg_indexes` rather than believing it |

And one it missed, found while checking its report: **the block-id CHECK was hand-copied and
wrong.** It accepted a leading digit and accepted `1`, neither of which `mintId()` can produce. A
CHECK that is too permissive passes every test written against real ids and admits garbage from
everywhere else. It is now `ID_PATTERN.source` — the same regex the minter uses, not a second copy
of it.

Still open, deliberately, because they belong to steps not yet started:

- **Publication is not enforced by the schema and cannot be.** A foreign key cannot see the other
  row's `status`, so nothing stops `current_revision_id` pointing at a *draft*. The check has to
  live in `publishRevision`, in the same transaction that moves the pointer.
- **Reading blocks needs an explicit `ORDER BY ordinal`.** An index is not an ordering guarantee. A
  loader that omits it will look correct until a query plan changes.
- **`comments.owner_id` and `jobs.owner_id` are independent of the article's owner**, so with a
  second user the schema permits one person's comment on another's article. Fine while there is one
  user; it must become a composite key or an explicit adapter invariant before there are two.
- **A `done` step run can coexist with a missing artefact.** The row and the output have to be
  committed together, and the adapter has to compare every field — null-safely, since `prompt_version`
  and `model` are nullable.

---

## The order of work

One authoritative store at a time. **No permanent dual writes** — an importer for moving forward and
an exporter for moving back, both temporary.

| # | Step | Ends with |
|---|---|---|
| 1 | **Create the new Supabase project**, then the runtime and migration roles. Confirm `spideryarn` is not in the exposed schemas | A project, three credentials, and the superuser password nowhere near Vercel |
| 2 | **Introduce storage contracts, still filesystem-backed**: `ArticleReader`, `CommentStore`, `JobStore`, `PipelineArtifactStore` | Existing tests pass unchanged |
| 3 | **Apply the schema additively** — Drizzle schema in TS, `drizzle-kit generate`, a `--custom` migration for the `auth.users` FKs and the roles/grants, `ai_calls` | No behaviour change. Nothing dropped. Catalog assertions pass |
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
  — the pg-boss recommendation is reversed here, with reasons. **Also delete its `LISTEN/NOTIFY`
  wakeup suggestion** (line 324): `LISTEN/NOTIFY` is session-scoped and does not work through a
  transaction-mode pooler. The polling contract the doc already describes is the right one, and this
  is a good example of a "when Postgres lands" note that would have been implemented and quietly not
  worked
- [deploy-and-repo-move.md](deploy-and-repo-move.md) — its Option 4 says "Postgres, a real queue,
  per-step functions… **Not now**". Greg has now said now. That line should be updated rather than
  left silently contradicted, the same way the Tailwind/shadcn reversal was written down
- [AGENTS.md](../../AGENTS.md) — "filesystem over database" is a stated principle. This is the
  second deliberate exception after shadcn, and should be recorded as one

## Open questions

1. ~~The billing banner on the Supabase project.~~ **Gone** with the new-project decision. The old
   project's billing state can no longer take the new app down.
2. ~~Mutations in production: closed, or a minimal gate?~~ **Answered** by
   [the beta gate](deploy-and-repo-move.md#the-beta-gate) — a one-email allowlist, now against an
   empty user pool rather than 9 inherited accounts.
3. ~~Which repo owns `db push`?~~ **Gone entirely** — the repos no longer share a database. What
   survives is one rule that is about Supabase's own schemas rather than the old app's: never
   `drizzle-kit push` against anything that matters, and keep `schemaFilter` pinned.
4. **How many revisions to keep?** Recommendation: current + previous, pruned beyond that. Full
   history is an archive nobody asked for.
5. **Does the old app's data need extracting** before that project is eventually retired? 15
   documents, 9 users, 41 storage objects. **Less urgent now** — the new project does not depend on
   the old one, so retiring it is a decision on its own timetable rather than a prerequisite.
6. ~~The `on_auth_user_created` trigger.~~ **Not our problem any more.** It stays in the old project,
   affecting only the old app.
7. **How many pipeline artefacts does `tweets` add to the schema?** It arrived after this plan was
   drafted, with a `tweets.json` per article and a real content hash. It should be a JSONB column on
   the revision plus a `revision_step_runs` row, like `tree` and `arc` — but confirm before writing
   the DDL rather than after.
8. **Does the `example` fixture become a seed row, or go?** It is the fresh-clone empty state today
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
