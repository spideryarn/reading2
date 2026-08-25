# Database

This is a **stub**. Today there is no database: the store is JSON files on disk. It is written now
because [auth.md](auth.md) needed something to point at — the auth decision turns on a foreign key
into `auth.users`, which only makes sense once you know where the rest of the data is going.

## Today: files under `data/<slug>/`

One directory per article, one file per pipeline stage:

```
data/writes/
  raw.html      fetched bytes          (stage 1)
  meta.json     title, url, fetched-at
  blocks.json   the sanitised blocks   (stage 3)
  tree.json     the ToC / zoom tree    (stages 4-5)
  arc.json
  comments.json
  tweets.json
data/_jobs/
  spya-*.json   one file per ingest job
```

**Reads** all go through [`src/api.ts`](../../src/api.ts) — `loadArticle`, `loadTweets`,
`articleMetadata`, `listArticles`. [library.md](library.md) makes the same point from the other side.

**Writes do not.** This doc used to say "`src/api.ts` is the one file the store lives behind", and
that is only half true — it is the *read* seam. The write path is
`PipelineStep.outputs(ctx): string[]`, an interface that returns **file paths**, implemented across
six stage modules (`fetch`, `extract`, `blocks`, `toc`, `arc`, `tweets`). Any estimate that treats
the Postgres move as a one-file change is wrong, and this is where that mistake starts.

Why files at all: *"Prefer boring: filesystem over database, one server process"* —
[AGENTS.md](../../AGENTS.md). Each stage writes JSON and every stage stays independently runnable.
See [architecture.md](architecture.md#stage-ownership).

**Caching is not what the docs claim.** "Anything expensive is cached on a content hash" is true of
exactly one stage of six: `tweets`, via `hashBlocks` in [`src/tweets.ts`](../../src/tweets.ts) and
the optional `isDone(ctx)` hook on `PipelineStep`. `toc` and `arc` still use `stepIsDone`, an
`access()` existence check — a file exists, therefore the step is done, whatever it was generated
from. When it comes to generalising this, copy `tweets`' choice of **hash input**, not just the idea:
it hashes `id \t text` per block, deliberately *not* the bytes of `blocks.json`, because those bytes
change when an unread field is recomputed and *don't* change when two blocks swap ids.

## Next: Supabase Postgres

Planned, not built. The whole design — the schema, the reasoning, and the things that break quietly —
is in [postgres-migration.md](../plans/postgres-migration.md). The parts worth knowing before you
touch anything storage-shaped:

- **A block id is an identity; its text is a revision.** Foreign-keying comments to the current block
  rows would have broken a documented behaviour. See [block-ids.md](block-ids.md).
- **The tree stays JSONB; the blocks become rows.**
- **`owner_id uuid not null references auth.users(id)`, from day one** — populated with the session
  user, so no query above the adapter changes when a second person is let in. This is the line that
  decided [the auth choice](auth.md). `not null` on purpose: a row with no owner is not a state this
  system has.
- **Drizzle for data, Supabase for Auth alone** — over `pg`, through Supabase's transaction-mode
  pooler. Greg reversed the original `supabase-js` choice once he decided the API layer, not RLS, is
  the security boundary: without RLS, PostgREST contributes only its restrictions, and every
  transaction would have had to become a PL/pgSQL function to work around it. See
  [§ The client](../plans/postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth).
- **RLS is deferred**, so grants carry the whole weight —
  [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now). The answer is
  structural rather than careful: **don't expose the `spideryarn` schema through the Data API at
  all**, and give the runtime a dedicated least-privilege role. PostgREST then cannot see the schema
  whatever the keys are.
- **Supabase is the store and the login, never the transport.** The browser talks to `/api/*`, and
  `/api/*` talks to Postgres. The one exception is Auth, which *does* run in the browser — the rule
  that holds is "no application **data** query leaves the server", not "no Supabase call".

## Two traps recorded elsewhere, repeated here because they are expensive

- **A custom schema does not isolate migration history.** Both repos share
  `supabase_migrations.schema_migrations`. **No longer a blocker**, because Drizzle keeps its own
  migration ledger and never touches Supabase's — but a separate ledger is necessary, not sufficient:
  an unscoped `supabase db diff`, a linked `db reset`, or a `drizzle-kit push` still reaches across
  the boundary. The rules are in
  [§ Two schema authorities](../plans/postgres-migration.md#two-schema-authorities-and-the-tools-that-dont-respect-them).
- **The grant block in the Supabase custom-schemas guide opens the database.** Granting to `anon`
  plus permissive-or-absent RLS means the public key reads everything, and nothing errors.
- **Block ids are unique only *within* an article.** The primary key is `(article_id, block_id)`,
  never `block_id` alone. A global unique index starts rejecting valid inserts at around a hundred
  articles; a global *upsert* silently overwrites one article's paragraph with another's.
- **`LISTEN`/`NOTIFY` does not work through a transaction-mode pooler**, along with session advisory
  locks, `SET` outside a transaction, and temp tables expected to outlive one. This matters because
  [ingest-queue.md](ingest-queue.md#when-this-becomes-postgres) recommended `LISTEN/NOTIFY` for
  worker wakeups before we knew that. Keep polling.
- **The old project has a live trigger on `auth.users`.** It is `SECURITY DEFINER` and writes
  `public.profiles`, so every future Spideryarn signup writes a row into the *old* app — and a failure
  there fails the signup. Greg's own login won't fire it, so it will not show up in testing.

## See also

- [architecture.md](architecture.md) — the pipeline stages and what a block is
- [postgres-migration.md](../plans/postgres-migration.md) — the plan, the schema, the honest risks
- [auth.md](auth.md) — why the auth provider and the database are the same decision
- [library.md](library.md) — the homepage, and the one file a move to Postgres goes behind
- [block-ids.md](block-ids.md) — the spine every table keys on
