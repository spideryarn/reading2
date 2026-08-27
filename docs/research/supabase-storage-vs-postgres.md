# Supabase Storage vs Postgres columns — research notes (2026-08-27)

Researched for the Postgres-migration plan ([postgres-migration.md](../plans/postgres-migration.md)):
should large pipeline artefacts (raw fetched bytes, `article.html`) live in Supabase Storage
rather than in a Postgres column? This doc is facts and trade-offs only — no recommendation for
our pipeline, that's a separate call.

## Summary (5 lines)

You can query Storage's *metadata* with plain SQL and join it to your own tables — it's a real
Postgres table (`storage.objects`), not a black box. You **cannot** read a file's actual bytes
with SQL, in a single query or otherwise; every practical path (`pg_net`, FDWs) is either
async/polling, POST-only, or built for structured formats, not "give me this blob." A Storage
write and a Postgres write are two different systems with no shared transaction — deleting a
`storage.objects` row via SQL orphans the real file instead of deleting it, and Storage is
**not** covered by Supabase's automated backups or point-in-time recovery. Files up to ~6 MB
should go through a small Vercel function; anything bigger needs Storage's own upload path
(browser talks to Supabase directly), not the function body, because Vercel caps a function's
request/response body at 4.5 MB regardless of plan.

## A. Can you query Supabase Storage with SQL?

### Metadata — yes, it's a real table

Storage's metadata lives in Postgres, in a schema called `storage`, on your own project's
database — not a separate service ([Supabase Storage docs](https://supabase.com/docs/guides/storage),
[schema design doc](https://supabase.com/docs/guides/storage/schema/design)).

`storage.buckets`:

| column | type |
|---|---|
| `id` | text, PK |
| `name` | text |
| `created_at`, `updated_at` | timestamptz |
| `public` | boolean |
| `file_size_limit` | bigint |
| `allowed_mime_types` | text[] |
| `owner_id` | text |

`storage.objects`:

| column | type |
|---|---|
| `id` | uuid, PK |
| `bucket_id` | text, FK → `storage.buckets.id` |
| `name` | text (the object's path/key) |
| `created_at`, `updated_at` | timestamptz |
| `metadata` | jsonb |
| `path_tokens` | text[] |
| `version` | text |
| `owner_id` | text |

Note: `size` and `mimetype` are **not** top-level columns — they live inside the `metadata`
jsonb blob (alongside `eTag`, `cacheControl`, `lastModified`, `contentLength`,
`httpStatusCode`), so filtering or sorting on file size means `(metadata->>'size')::bigint`
rather than a plain column. Source:
[Storage Schema doc](https://supabase.com/docs/guides/storage/schema/design).

You can `select`, `join`, and `where` against `storage.objects` exactly like any other table —
`bucket_id` and `owner_id` are the natural join keys to your own tables — and Supabase
documents this directly:
[Query with Postgres](https://supabase.com/docs/guides/storage/analytics/query-with-postgres).

**Foreign keys pointing *at* `storage.objects`**: technically possible (it's a real table with
a PK), but Supabase's own schema doc advises against it — the storage schema is managed by the
platform and migrated by Supabase's own tooling, and an external FK constraint on it risks
breaking during a platform-side schema change. Practically: store the object's `bucket_id` +
`name` (or its `id`) as plain columns on your own table, don't constrain them with a real FK.

### File contents — no, not through SQL

The `storage.objects` row is metadata only; "the actual objects are stored in a provider like
S3," so there is nothing in `storage.objects` or `storage.buckets` to `select` that gives you
bytes. We looked for every documented escape hatch:

- **`pg_net`** (Supabase's async HTTP extension) can fire an HTTP GET at a Storage URL, but it's
  fire-and-forget within a transaction: the request doesn't execute until the enclosing
  transaction commits, the response lands in `net._http_response` up to 2000ms later (default
  timeout, configurable), and you have to poll for it in a *separate* statement — there is no
  "make an HTTP call and get the body back in this query" path. Responses are kept 6 hours in an
  **unlogged** table (lost on crash). Source:
  [pg_net docs](https://supabase.com/docs/guides/database/extensions/pg_net).
- **Foreign Data Wrappers** (Supabase's Rust-based `wrappers` framework): there's a generic
  **S3 wrapper**, but it's read-only, built for structured formats (CSV/JSON/Parquet columns
  mapped to a foreign table), not "give me this object's raw bytes," and it isn't specific to
  Supabase's own Storage bucket (you'd point it at the same underlying S3-compatible endpoint
  yourself). We found no wrapper called `supabase_storage` or similar. Source:
  [S3 wrapper docs](https://supabase.com/docs/guides/database/extensions/wrappers/s3),
  [Wrappers overview](https://supabase.com/docs/guides/database/extensions/wrappers/overview).
- No `storage.download()` SQL function, no synchronous `http` extension mentioned anywhere in
  Supabase's docs for this purpose.

**Bottom line: there is no practical way to read a Storage object's contents from SQL.** You
always go through the Storage API/client (or a signed URL) for bytes.

### No shared transaction between Storage and Postgres

A row in `storage.objects` and the actual bytes in the object store are two different systems.
Concretely:

- Deleting an object should go through the Storage API. Deleting the **row** with a raw SQL
  `DELETE FROM storage.objects` does **not** delete the underlying file — it just orphans it
  (metadata gone, bytes still there, still billed, no longer reachable through the API).
  Source: [GitHub discussion #34254](https://github.com/orgs/supabase/discussions/34254),
  confirmed by the Storage service's own delete-objects docs
  ([Delete Objects](https://supabase.com/docs/guides/storage/management/delete-objects)).
- There is no documented two-phase-commit or outbox pattern from Supabase tying a Storage write
  to a Postgres transaction. A `ROLLBACK` on your Postgres transaction does **not** undo an
  object already uploaded to Storage — the upload is a separate HTTP call to a separate service,
  not a statement inside your transaction. We found no Supabase doc claiming otherwise; this is
  an absence, not a documented negative, so treat "Storage writes are transactional with
  Postgres" as false by design rather than as something Supabase explicitly warns against.
- Within the Storage service itself (not your app's transaction), Supabase's own storage server
  does wrap its *own* metadata operations in a Postgres transaction before touching the backend
  object store, and will attempt to clean up the backend object if that step fails — but that's
  internal to a single Storage API call (e.g. one `move` or `copy`), not something your
  application transaction participates in.

### RLS and the service-role key

- Storage enforces RLS by default: **no uploads/downloads/deletes are allowed on a bucket at all
  until you write RLS policies on `storage.objects`** granting the specific operations (INSERT
  for upload, SELECT for download/list, UPDATE, DELETE). Source:
  [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control).
- The **service-role key bypasses RLS entirely** — "Service keys entirely bypass RLS policies,
  granting you unrestricted access to all Storage APIs" (same doc). This is exactly the model we
  already use for signed upload URLs from the server.
- Policies are written against `bucket_id`, `name`, `owner_id`, and `metadata` on
  `storage.objects`, with Supabase-provided SQL helper functions for common patterns
  ([Storage Helper Functions](https://supabase.com/docs/guides/storage/schema/helper-functions)).

## B. Limits and pricing

### Object size and upload method

- Free plan: bucket file-size limit can't exceed **50 MB**. Pro/Team: configurable up to
  **500 GB** per bucket (raised from a previous 50 GB cap). Enterprise: custom. The global cap
  is a project-level setting; a bucket's own limit can't exceed it. Source:
  [File size limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
  [Storage: 10x Larger Uploads announcement](https://supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing).
- **Standard upload**: fine up to ~6 MB; the docs' own example ceiling before recommending TUS.
  Source: [Standard Uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
- **TUS resumable upload**: Supabase's documented recommendation for anything **> 6 MB**, "for
  better reliability." Source:
  [Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
- **S3-compatible multipart upload**: also available, aimed at S3-workflow-shaped clients.
  We did not find a documented size threshold that *requires* it over TUS — treat this as one
  more option rather than a hard tier.
- Our ceiling (32 MiB) sits comfortably inside all of the above; TUS is the documented path for
  it, matching what we already do for reader-uploaded PDFs.

### Pricing (Pro plan, $25/mo base) — [supabase.com/pricing](https://supabase.com/pricing)

| | Free | Pro |
|---|---|---|
| Database storage included | 500 MB | 8 GB |
| Database storage overage | — | $0.125/GB |
| File (Storage) storage included | 1 GB | 100 GB |
| File storage overage | — | $0.0213/GB |
| Database egress included | 5 GB | 250 GB |
| Database egress overage | — | $0.09/GB |
| Cached (CDN) egress included | 5 GB | 250 GB |
| Cached egress overage | — | $0.03/GB |

File storage is roughly **6× cheaper per GB** than database storage overage ($0.0213 vs
$0.125), and cached Storage egress is **3× cheaper** than database egress ($0.03 vs $0.09/GB).
Both meters draw from the *same* 250 GB egress allowance on Pro, so this only bites past that.

### Postgres `bytea`/`text` hard limits and TOAST

- **Hard field limit: 1 GB** (2³⁰ − 1 bytes) for any TOAST-able type (`bytea`, `text`, etc).
  TOAST steals 2 bits of the varlena length word to encode out-of-line/compressed state, which
  is where the ceiling comes from. Source:
  [Postgres docs, TOAST](https://www.postgresql.org/docs/current/storage-toast.html).
- **TOAST threshold**: a row wider than ~2 kB (`TOAST_TUPLE_THRESHOLD`) triggers TOAST, which
  compresses and/or moves large field values out-of-line until the row is back under
  ~2 kB (`TOAST_TUPLE_TARGET`), same source. So a 100 KB JSON artefact and a 30 MB HTML artefact
  are handled the same way mechanically (out-of-line storage in a hidden TOAST table) — it's a
  difference of degree, not of code path.
- **Practical costs of multi-MB values**, from the Postgres mailing list and community
  reporting rather than the reference docs (flagged as such):
  - `pg_dump`/`pg_restore` slow down noticeably on tables with large `bytea` columns, because
    the dump format hex-encodes binary data — one reported case went from ~8 hours to
    "still running after 12" on a table with ~50 GB of `bytea` after converting from
    base64-in-text. Source:
    [pgsql-general mailing list thread](https://www.postgresql.org/message-id/4D6E0151.20402@gmx.net).
    Treat this as one documented anecdote, not a benchmark — but the mechanism (hex encoding
    overhead for binary COPY) is real and applies to any bytea-heavy table.
  - Client/driver memory: a client library reading a `bytea` column typically materializes the
    whole value in memory before your code sees it (no built-in streaming read for a column
    value the way there is for a file handle) — general Postgres client behaviour, not specific
    documentation we can cite; flagged as an established but undocumented-as-such practical
    concern.
  - We found **no documented PgBouncer/Supavisor message-size limit** for large payloads through
    the connection pooler — pooling docs discuss connection counts and per-client memory
    (~2 KB/connection), not payload size ceilings. Marking this "not documented" rather than
    guessing.

### Supabase's own guidance

Supabase's own materials consistently say: put files in Storage, not the database. From their
Storage docs and marketing: "It is best practice to store files outside of your database because
of their sizes," and their architecture description frames Storage as deliberately splitting the
concerns — "Postgres for metadata and access control, an S3-compatible object store for the
actual heavy lifting of file bytes." Sources:
[Storage Quickstart](https://supabase.com/docs/guides/storage/quickstart),
[File storage feature page](https://supabase.com/features/file-storage). We did not find a
specific numeric threshold in Supabase's own docs ("under N KB, use the database"); the guidance
is qualitative, not a documented cutover point.

## C. Reading it back

- **Latency comparison (Storage signed URL vs `select` of a `bytea`)**: **not documented** by
  Supabase with numbers. We could not find a published benchmark comparing the two paths; don't
  fill this gap with a plausible-sounding figure.
- **CDN**: yes, all Storage objects sit behind a CDN by default (Cloudflare, based on the
  `cf-cache-status` response header Supabase's own docs point to). First request from a region
  goes back to the object's home region (Supabase gives a US-user-hits-Singapore-first example);
  subsequent requests from nearby are served from the edge cache. Public-bucket objects cache
  well because they need no per-request authorization; **private-bucket objects cache much less
  effectively**, because each request needs a per-user permission check even when the bytes are
  identical across users. Source:
  [Storage CDN fundamentals](https://supabase.com/docs/guides/storage/cdn/fundamentals).
- **Streaming a Storage object through a Vercel function**: possible, but costs function
  execution time (and, on non-Fluid, memory) for the whole transfer, versus a redirect to a
  signed URL which costs the function almost nothing (mint the URL, return a 302 or a JSON
  body with the URL) and lets Supabase's CDN serve the bytes directly. Concretely: **Vercel caps
  the request body AND the response body of a function at 4.5 MB**, on every plan — "The maximum
  payload size for the request body or the response body of a Vercel Function is 4.5 MB,"
  exceeding it returns `413 FUNCTION_PAYLOAD_TOO_LARGE`. Source:
  [Vercel Functions limitations](https://vercel.com/docs/functions/limitations). Vercel's own
  guidance for exceeding that is to use a **streaming function** response, which they say is not
  subject to the 4.5 MB cap — but their own bypass guide doesn't explain the mechanism, only
  states the fact and links to streaming docs. Source:
  [How do I bypass the 4.5MB body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
  For our 32 MiB ceiling, a redirect to a signed URL is the documented, low-risk path; proxying
  through a function is possible only via streaming and we could not verify the mechanism from
  primary sources, so it's the riskier of the two options to build against.
- **Signed URL expiry**: fully configurable per call, in seconds (e.g. `createSignedUrl(path,
  3600)`); no documented default if you omit it, and no documented hard ceiling — community
  reports describe successfully using ~10-year expiries, but that's not something we found stated
  as a supported maximum in Supabase's own reference docs, so treat "very long expiries work" as
  observed-but-unofficial. Source:
  [Serving assets from Storage](https://supabase.com/docs/guides/storage/serving/downloads),
  [JS `createSignedUrl` reference](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl).
- **Serving a private object without minting a URL each time**: yes — for a bucket that's
  private but the caller has an Auth JWT for, you can hit
  `https://[project].supabase.co/storage/v1/object/authenticated/[bucket]/[path]` with the
  user's `Authorization` header directly, no signed URL needed. Also notable: Storage signed URLs
  are signed with a key **separate from** your project's Auth JWT signing key, so rotating Auth
  keys doesn't invalidate outstanding signed URLs. Same source as above.

## D. Operational sharp edges

- **Orphaned objects (DB row deleted, file survives)**: confirmed above under A — deleting via
  raw SQL against `storage.objects` orphans the file rather than removing it; you must go
  through the Storage API (or the client library's remove call) for a real delete. Source:
  [GitHub discussion #34254](https://github.com/orgs/supabase/discussions/34254).
- **Orphaned objects (file deleted, DB row survives)**: not something we found explicitly
  documented as a distinct failure mode beyond the general point that the two systems aren't
  transactional — if you delete an object via the API but a later step in your own app logic
  that was meant to update a referencing row fails, you get the same class of drift in the other
  direction. This is an inference from "no shared transaction," not a specific documented
  incident.
- **`supabase db reset --linked` and orphaned local metadata**: documented gotcha —
  resetting the linked project's DB (or restoring a dump) wipes `storage.objects` metadata but
  does **not** touch the actual objects in the bucket, so you can end up with real files that no
  longer have any metadata row at all. Source:
  [supabase/cli issue #3252](https://github.com/supabase/cli/issues/3252).
- **Backups / PITR do not cover Storage — confirmed.** Supabase's automated backups and
  point-in-time recovery apply to the Postgres database only. Restoring the database to a past
  point (or from a backup) restores `storage.objects` metadata to that point in time, but the
  actual bytes in the bucket are **not** rolled back — they stay at whatever the current live
  state is. So after a PITR restore, metadata and files can point at different realities (a
  restored row referencing an object that's since been overwritten or deleted, or vice versa).
  Source: [Database Backups](https://supabase.com/docs/guides/platform/backups), and the
  community discussion confirming the gap explicitly:
  [GitHub discussion #39948](https://github.com/orgs/supabase/discussions/39948). This is
  exactly the risk you flagged, and it checks out.
- **Local dev parity**: `supabase start` does run the Storage service locally as part of the
  full stack (Postgres, Auth, Storage, etc. all in Docker). Data — including Storage objects —
  persists in a Docker volume across restarts by default; `supabase stop --backup` additionally
  snapshots via `pg_dump` for portability. We did not find a documented case where local Storage
  behaves differently from hosted Storage (same server codebase), beyond the general Docker
  volume caveats already covered in [supabase-local.md](../project/supabase-local.md). Source:
  [Local Development & CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- **Eventual consistency**: we did not find a documented consistency model (e.g. "reads are
  eventually consistent after a write") for Storage specifically. Given the CDN sits in front of
  reads, a very recent overwrite of an object at the same path could plausibly serve a stale
  cached copy briefly, but Supabase does not document a specific consistency SLA for this, so
  treat it as unverified rather than assume strong consistency.

## E. The competing option — why keep small JSON in Postgres

Briefly, and without recommending a split for our pipeline specifically: keeping small
structured artefacts (ToC, glossary, summaries) in Postgres columns rather than Storage keeps
things Storage cannot give you at all:

- **Full-text / structural search and `WHERE` clauses over the content** — a JSON column (or
  `jsonb`) can be indexed and queried (`jsonb_path_ops`, GIN indexes, `->`/`->>` operators,
  `tsvector` over extracted text). A Storage object is opaque to SQL entirely (per section A) —
  you cannot filter articles by "glossary contains term X" without pulling every glossary file
  down and parsing it outside the database.
- **Joins** — a Postgres column joins to any other table in one query; a Storage object requires
  a separate fetch (its own round trip, its own auth) that your SQL can't participate in.
- **Atomic multi-artefact writes** — several small artefacts updated together as one Postgres
  transaction either all land or none do. Storage writes have no transactional relationship to
  Postgres writes or to each other (section A) — writing five small Storage objects for one
  pipeline run is five independent HTTP calls with five independent failure points, and
  Supabase gives you no outbox/2PC pattern to paper over that.
- **Single-round-trip reads** — fetching a row (or several joined rows) is one query; each
  Storage object is a separate authenticated HTTP call (or a redirect to a signed URL, which is
  a second round trip from the client). For a page that needs several small artefacts at once,
  that's the difference between one `select` and N Storage fetches.
- **Backups/PITR** — as covered in D, Postgres data is covered by Supabase's backup and PITR
  story; Storage data is not. Small artefacts that need to travel with a point-in-time restore
  are safer in Postgres for that reason alone.

What you give up by keeping them in Postgres instead of Storage: the ~6× cheaper per-GB storage
cost and ~3× cheaper cached egress that Storage gets (section B) — immaterial at small-JSON
sizes, and the CDN edge-caching Storage gets for free (section C) — also low-value for
data this small if it's being read through your own API layer anyway rather than served as a
static asset.

## What I could not establish

- A latency comparison, with numbers, between a Storage signed-URL download and a `bytea`
  `select` — not published by Supabase anywhere we could find.
- A documented maximum expiry for a Storage signed URL (only informal reports of ~10-year
  expiries working, not a stated ceiling in the reference docs).
- The technical mechanism by which a Vercel streaming function response avoids the 4.5 MB
  response-body cap — Vercel states the fact and links to streaming docs but the page we could
  reach didn't spell out the mechanism (buffered vs backpressure-driven send). Worth confirming
  directly with a small streaming test if this path matters for us.
- Any Supabase-documented eventual-consistency model for Storage reads-after-writes, or for CDN
  cache invalidation on overwrite of an existing object path.
- A hard message-size limit for PgBouncer/Supavisor's transaction-pooling mode with large
  row payloads — pooling docs cover connection counts, not payload size.
- Whether deleting a Storage object via the proper API is synchronously immediate at the CDN
  edge, or whether a cached copy can still be served briefly after deletion — not stated in the
  docs we reviewed.
