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

Reads all go through [`src/api.ts`](../../src/api.ts) — `loadArticle`, `loadTweets`,
`articleMetadata`, `listArticles`. That is deliberate, and it is the whole reason the move to
Postgres is tractable: **`src/api.ts` is the one file the store lives behind.**
[library.md](library.md) makes the same point from the other side.

Why files at all: *"Prefer boring: filesystem over database, one server process"* —
[AGENTS.md](../../AGENTS.md). Each stage writes JSON, anything expensive is cached on a content hash,
and every stage stays independently runnable. See
[architecture.md](architecture.md#stage-ownership).

## Next: Supabase Postgres

Planned, not built. The whole design — the schema, the reasoning, and the things that break quietly —
is in [postgres-migration.md](../plans/postgres-migration.md). The parts worth knowing before you
touch anything storage-shaped:

- **A block id is an identity; its text is a revision.** Foreign-keying comments to the current block
  rows would have broken a documented behaviour. See [block-ids.md](block-ids.md).
- **The tree stays JSONB; the blocks become rows.**
- **`owner_id uuid references auth.users(id)` on every table, from day one** — populated with the
  session user, so no query above the adapter changes when a second person is let in. This is the
  line that decided [the auth choice](auth.md).
- **RLS is deferred**, so the grants carry the whole weight —
  [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now). Grant to
  `service_role` alone; the anon key is public by design.
- **Supabase is the store and the login, never the transport.** The browser talks to `/api/*`, and
  `/api/*` talks to Supabase.

## Two traps recorded elsewhere, repeated here because they are expensive

- **A custom schema does not isolate migration history.** Both repos share
  `supabase_migrations.schema_migrations`, so exactly one repository must own `db push` —
  [§ The condition: one migration authority](../plans/postgres-migration.md#the-condition-one-migration-authority).
  This is still an open blocker.
- **The grant block in the Supabase custom-schemas guide opens the database.** Granting to `anon`
  plus permissive-or-absent RLS means the public key reads everything, and nothing errors.

## See also

- [architecture.md](architecture.md) — the pipeline stages and what a block is
- [postgres-migration.md](../plans/postgres-migration.md) — the plan, the schema, the honest risks
- [auth.md](auth.md) — why the auth provider and the database are the same decision
- [library.md](library.md) — the homepage, and the one file a move to Postgres goes behind
- [block-ids.md](block-ids.md) — the spine every table keys on
