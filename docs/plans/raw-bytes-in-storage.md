# The raw document goes in Storage, and nothing else does

**Status: proposed, 2026-08-27.** Written in answer to a question from Greg:

> Are we using Supabase Storage to store the source files (and/or anything large)? That seems
> necessary for large files (because Vercel has a 4MB upload limit), so does that mean we might as
> well do it for everything for consistency/simplicity, and also to keep the size of the database
> down? … My sense was that you could query Supabase Storage with SQL, but I'm not certain.
>
> — Greg, 2026-08-27

Short answers first, because two of the three are yes.

1. **Yes, we already use it** — but only for reader-uploaded PDFs, and the code has a *second,
   contradictory* home for the same bytes, which is the real finding here.
2. **Yes, you can query it with SQL** — the metadata, not the bytes. Measured, not read.
3. **No, we should not put everything in it.** Raw source is 86% of every byte we hold. Everything
   else is small, and Storage would cost it more than it saves.

**And it was already decided once.** This is not a new idea; it is a *deferred* one being brought
forward. [pdf-upload-and-storage.md § Appendix](pdf-upload-and-storage.md) recommends exactly this —

> The revision row holds an **object key and a checksum**, never the bytes. Every raw document —
> fetched or uploaded, HTML or PDF — is an object in the `sources` bucket. `raw_bytes` stops being
> written and is eventually dropped.

— and [database.md](../project/database.md) already tells a reader that *"the eventual design has
every raw document … as an object with the row holding a key and a checksum"*. It was held back on
purpose, as *"a follow-on to v1, not part of it"*, so that building the upload would not quietly
decide it.

So what is new here is only three things, and they are what changes the answer from *eventually* to
*now*: **the measurements** it was recommended without, **the discovery that the migration makes it
cheaper than the alternative rather than extra work**, and **Greg's question**, which is the follow-on
arriving. The research behind the facts is
[supabase-storage-vs-postgres.md](../research/supabase-storage-vs-postgres.md); the spike numbers are
from this laptop's Supabase container.

## What we already have, and the contradiction in it

[`src/store/blobs.ts`](../../src/store/blobs.ts) is a seam with two adapters — Supabase Storage
([`blobs-supabase.ts`](../../src/store/blobs-supabase.ts)) and a filesystem fallback
([`blobs-fs.ts`](../../src/store/blobs-fs.ts)). The bucket is `sources`: private, 50 MiB per object,
PDF-only MIME allowlist ([`supabase/config.toml`](../../supabase/config.toml)). Keys are the content
hash — `sha256/<digest>.pdf` — and writes are create-only, so two readers uploading the same paper
converge on one object and `already-there` is a dedup hit rather than a collision.

It has exactly one caller: `acquireUpload` in [`src/pipeline.ts`](../../src/pipeline.ts), the PDF
upload path. **Nothing else.**

Meanwhile `article_revisions` has a `raw_bytes` `bytea` column
([`src/db/schema.ts`](../../src/db/schema.ts)), which `db:import` fills and `db:export` reads. So the
bytes behind an article have **two homes that do not know about each other**, and which one you get
depends on how the article arrived. That is not a design; it is two half-built paths that have not
met yet. The migration is where they meet, so it is where this gets decided.

The column beside it is the thing that makes the fix cheap: **`raw_sha256` already exists**, and
`canonicalKey(sha256, kind)` in [`src/source.ts`](../../src/source.ts) already turns it into an
object key. The pointer is already in the schema. Nothing has to be added to use it.

## The measurements

**Where the bytes actually are.** The whole corpus is 25 MB. Raw source is 18.2 MB of it — 86% —
and the three largest files are all `raw.pdf`, up to 11.3 MB. Every other artefact:

| artefact | n | median | largest |
|---|---:|---:|---:|
| `raw.pdf` | 6 | 141 KB | **11,304 KB** |
| `raw.html` | 3 | 173 KB | 657 KB |
| `blocks.json` | 7 | 46 KB | 346 KB |
| `tree.json` | 7 | 20 KB | 137 KB |
| extracted HTML | 9 | ~20 KB | 151 KB |
| `labels.json` | 7 | 6 KB | 47 KB |
| glossary / ideas / arc / tweets | 2–7 | 2–11 KB | 14 KB |

**Round trips, 11.04 MiB, local container** (`scratch-storage-spike.mts`, deleted after running):

| operation | time |
|---|---:|
| Storage `putIfAbsent` | 106 ms |
| Storage `get` | 47 ms |
| `bytea` insert | 175 ms |
| `bytea` select | 37 ms |
| **`bytea` server-side copy** | **156 ms** |

Reads are a wash. The last row is the one that matters and it is not a read at all: it is what
`beginRevision`'s `rawBytes: "carry"` costs *every time a draft is minted*
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) already flags this as an uncosted
retention problem). A hash costs nothing to carry.

**A `ROLLBACK` does not undo a Storage write.** Measured directly: open a transaction, insert a row,
upload an object, throw. The transaction rolls back; the object is still there. This is the fact the
whole design has to be built around, and it is now measured rather than assumed.

**SQL can see Storage.** `storage.objects` is a real table in your own database, with `bucket_id`,
`name`, `created_at`, and a `metadata` jsonb holding `size` and `mimetype` (they are *not* top-level
columns, so it is `(metadata->>'size')::bigint`). A join from it to a `raw_sha256` column returns the
matching row — verified in the spike. What SQL **cannot** do is read the bytes. There is no
`storage.download()`, no practical FDW; `pg_net` is async and POST-shaped. So Greg's sense was right,
with one boundary: **metadata joins, contents do not.**

## The decision

**Raw source bytes go in Storage. Everything else stays in Postgres columns.**

And the line is not size. Drawing it at size would be arbitrary and would move every time an article
got longer. The line is:

> **Content-addressed and immutable → Storage. Revision-scoped and rewritable → Postgres.**

That is what makes it safe, and it falls straight out of the rollback measurement. A write that is
create-only at a key which *is* the hash of its own contents does not need to be in the transaction:

- Writing it twice is a no-op, so a retry is free.
- An orphan is inert — bytes nobody references, at a name nobody will mint again.
- It can never be *wrong*, only absent, because the name is a claim about the contents that the
  contents themselves settle.

None of that is true of `tree` or `glossary` or `blocks`. Those are per-revision, they get rewritten,
and two of them must be consistent with each other at the moment of publication. They belong in the
transaction, and therefore in Postgres.

### Why not put the small artefacts there too, for consistency

Because "consistency" here would buy a uniform API and pay for it in the four things Storage cannot
do, on the 14% of bytes that are not the problem:

- **No transaction.** Five small artefacts written together as one commit become five HTTP calls with
  five failure points, and the entire `transactional-stage-runner` plan exists to stop exactly that.
- **No backups, no point-in-time recovery.** Supabase's PITR covers the database and *not* the
  bucket; after a restore, metadata and objects can point at different realities. For 346 KB of JSON
  this is a bad trade at any price.
- **No SQL over the contents.** The shelf sorts on `word_count` and `root_gist`; search runs `fts`
  over blocks. Those are `where` clauses over artefact content, and an object is opaque to all of it.
- **N round trips instead of one.** Reading an article is one `select` today.

What we would gain is storage at $0.0213/GB instead of $0.125/GB. On ~1 MB of JSON per seven
articles, that is not a number.

### The smaller alternative, and why not

The appendix named one: keep `raw_bytes` for HTML, which is kilobytes and genuinely benefits from
being transactional, and use Storage for PDFs only — a `raw_object_key` column and a `CHECK` that
exactly one of the two is non-null. It is honest, because the row still says which is authoritative,
and it is less work.

**It is now the more expensive option, and that is the thing that changed.** It was cheaper when the
question was "should we move something that works"; it is dearer when the question is "what do we
build". Under this migration:

- The transactional benefit it protects is the *only* argument for it, and the rollback measurement
  says raw bytes do not need it: a hash is enough, because the name settles the contents.
- Two paths means the raw product has two shapes, and landing D has to thread both through eleven
  modules. The single-authority version threads a hash.
- *"the seldom-used one rots"* — the appendix's own objection — is worse here than it was there,
  because the seldom-used one would be the **web fetch**, which is how almost every article arrives.
  The rot would be in the common path's *sibling*, found the day somebody uploads a PDF.

Measured HTML sizes make the split look even less worth having: largest `raw.html` in this corpus is
657 KB. That is not small enough to be free in a `bytea` carried on every draft mint, and not large
enough to need a second mechanism.

### What this dissolves

Landing B piece 2 of [transactional-stage-runner.md](transactional-stage-runner.md) — *"a raw
product with the bytes in it"*, the third critical of the plan review — **goes away rather than
getting built.** It was written on the premise that the bytes have to reach `article_revisions.raw_bytes`:

> a `RawManifest` holds a *filename* and `article_revisions.raw_bytes` needs bytes. A store-neutral
> raw product carries provenance **and** payload.

If the bytes go to Storage instead, the product carries provenance and a **hash**. Nothing 32 MiB
wide ever enters a transaction, gets held live until commit, or gets serialized through the driver —
which was the largest cost the review listed against returning products at all.

## What changes

Small, and mostly already written.

1. **`fetch` puts its bytes in the blob store**, at `canonicalKey(sha256, kind)` — the same two lines
   the PDF path already runs. Today it hashes them and writes them to disk; it would hash them, write
   them to the store, and return the hash.
2. **`supabase/config.toml` adds `text/html`** to the `sources` bucket's MIME allowlist. One line, and
   it fails on the *first web fetch* rather than quietly, because the bucket enforces it.
3. **`raw_bytes` stops being written**, and `raw_sha256` becomes the pointer. The column itself gets
   dropped in a later migration, not this one — see below.
4. **`db:export` reads the bytes from the store** rather than from the column.
5. **`GET /api/source/:slug` is a redirect to a signed URL**, not a proxied body. This route is
   documented in [`src/routes.ts`](../../src/routes.ts) and not yet built; building it the other way
   would put an 11 MB body through a Vercel function, whose response cap is 4.5 MB. It would work on
   this laptop and fail in production, which is this repo's most-written-up failure shape
   ([silent-success](../reusable/silent-success.md)).
6. **A sweeper for unreferenced objects** — `storage.objects` against `raw_sha256`, older than a
   grace period. This is the one genuinely new piece of work, so it was run against the real schema
   before being claimed here:

   ```sql
   select o.name, (o.metadata->>'size')::bigint as bytes, o.created_at
   from storage.objects o
   where o.bucket_id = 'sources'
     and o.name like 'sha256/%'
     and not exists (
       select 1 from spideryarn.article_revisions r
       where o.name = 'sha256/' || r.raw_sha256 || '.pdf'
          or o.name = 'sha256/' || r.raw_sha256 || '.html')
   ```

   On this laptop it returns 1 of the bucket's 4 objects, the other three matching live revisions —
   so it is discriminating rather than merely running. **`not exists`, never `not in`**: `raw_sha256`
   is nullable, and `not in` against a column containing a NULL matches nothing at all, silently, and
   in the safe direction — a sweep that had stopped deleting anything would look exactly like a sweep
   with nothing to do. `sweepAbandonedDrafts` in [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)
   already avoids this trap and says why.

   **And no foreign key**, in either direction. `storage.objects` is platform-managed — Supabase
   changes it under its own migrations and advises against referencing it — so the relationship is a
   join on a computed key and nothing stronger. That is also why the sweep is a sweep rather than a
   cascade.

## Is there a quicker v1 in the same direction?

**This is it.** That is not a compromise: moving raw bytes to Storage is *less* work than landing B
piece 2, because piece 2 has to invent a payload-carrying product type and thread it through the
transaction, and this deletes the need for one. It also removes the 156 ms draft copy, unblocks the
source route, and puts the web-fetch path and the PDF path on the same mechanism for the first time.

The two together are the rare case where the faster route and the right route are the same route.

## What is deliberately not decided here

- **Whether `extractedHtml` / `stampedHtml` ever move.** Measured largest: 151 KB. Not now, and the
  immutability line says not ever — stamped HTML is rewritten by stage 3.
- **When `raw_bytes` is dropped.** Writing stops first; the column is dropped once every deployed
  environment has been backfilled, because a drop is the one migration that cannot be walked back.
  The backfill has somewhere to read from by definition — the column is the thing being read.
- **Whether the checkpoint store** (landing B piece 3 — `labels-progress.json`, `pdf-chunks/`) uses
  Storage. It should not, by the same line: those are small, rewritten, and read on every retry. A
  table keyed by revision and step.
- **Remote latency.** Every number above is against the local container. `.env.local` holds no remote
  Storage credentials, so the Vercel-to-Supabase round trip is unmeasured. It does not change the
  decision — the rollback and backup facts do that on their own — but it is not evidence we have.

## See also

- [supabase-storage-vs-postgres.md](../research/supabase-storage-vs-postgres.md) — the sourced facts
- [transactional-stage-runner.md](transactional-stage-runner.md) — the plan this edits
- [pdf-upload-and-storage.md](pdf-upload-and-storage.md) — the blob seam, and why it is two interfaces
- [database.md](../project/database.md) — where the data lives
