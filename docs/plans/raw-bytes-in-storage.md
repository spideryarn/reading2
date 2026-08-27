# The raw document goes in Storage, and nothing else does

**Status: third draft, 2026-08-27. Not built.** Two cross-family reviews, two NO-SHIPs, and in both
of them **the direction was never the thing under attack** — the protocol was, twice, and both times
it deserved it.

- [First review](raw-bytes-in-storage-review-sol.md): three criticals. The sweeper races a commit; a
  hash is not a key; the backfill can put the wrong bytes under a hash.
- [Second review](raw-bytes-in-storage-review-2-sol.md), on the draft that answered the first: two
  more criticals, both about the same gap — **a state machine with no crash-safe transitions**. It
  also found two real bugs in code that had already shipped.

Every correction is folded in below, and § What the reviews changed lists which sentences were wrong.

Written in answer to a question from Greg:

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
3. **No, we should not put everything in it.** Raw source is 73% of every byte we hold, and every
   other artefact is small. Storage would cost the rest more than it saves.

**And it was already decided once.** This is not a new idea; it is a *deferred* one being brought
forward. [pdf-upload-and-storage.md § Appendix](pdf-upload-and-storage.md) recommends exactly this —

> The revision row holds an **object key and a checksum**, never the bytes. Every raw document —
> fetched or uploaded, HTML or PDF — is an object in the `sources` bucket. `raw_bytes` stops being
> written and is eventually dropped.

— and [database.md](../project/database.md) already tells a reader that *"the eventual design has
every raw document … as an object with the row holding a key and a checksum"*. It was held back on
purpose, as *"a follow-on to v1, not part of it"*, so that building the upload would not quietly
decide it.

So what is new here is three things: **the measurements** it was recommended without, **the
discovery that the migration makes it cheaper than the alternative rather than extra work**, and
**Greg's question**, which is the follow-on arriving. The sourced facts are in
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

## The measurements

**Where the bytes actually are.** `data/` is 24 MB. Raw source inside article directories is 18 MB of
it — **73%** — and if you count the loose PDFs sitting at the top of `data/` it is 93%. The three
largest files are all raw PDFs, up to 11.3 MB. Every other artefact:

| artefact | n | median | largest |
|---|---:|---:|---:|
| `raw.pdf` | 6 | 141 KB | **11,304 KB** |
| `raw.html` | 3 | 173 KB | 657 KB |
| `blocks.json` | 7 | 46 KB | 346 KB |
| `tree.json` | 7 | 20 KB | 137 KB |
| extracted HTML | 9 | ~20 KB | 151 KB |
| `labels.json` | 7 | 6 KB | 47 KB |
| glossary / ideas / arc / tweets / summary | 2–7 | 2–11 KB | 37 KB |

> **The 73% is a correction.** The first draft said 86%, which came from a different calculation —
> the three largest files against the directory total, one of which is a stray PDF that belongs to no
> article. Two defensible numbers, and the one published was not the one the sentence claimed. Caught
> by the review; the arithmetic is above so the next reader can check it rather than trust it.

**Round trips, 11.04 MiB, local container** (spike script reproduced in
[the review prompt](raw-bytes-in-storage-review-prompt.md), deleted after running):

| operation | time |
|---|---:|
| Storage `putIfAbsent` | 106 ms — and the run reported `stored`, so this is a real upload |
| Storage `get` | 47 ms |
| `bytea` insert | 175 ms |
| `bytea` select | 37 ms |
| **`bytea` server-side copy** | **156 ms** |

Reads are a wash. The last row is the one that matters and it is not a read at all: it is what
`beginRevision`'s `rawBytes: "carry"` costs *every time a draft is minted*
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) already flags this as an uncosted
retention problem). A hash costs nothing to carry.

> **What this evidence does and does not support.** It is one sample, on one machine, against a local
> container, with no cold/warm split and no remote measurement. It supports *"carrying bytea has a
> real cost"*. It does **not** support *"this design is faster"*, and the first draft leaned on it
> harder than it can bear. Note also the trap the review pointed at: the key is the content hash, so
> a second run of that script without deleting the object first would measure an `already-there`
> refusal and report it as an upload. The run above printed `stored`. Any repeat must check that.

**A `ROLLBACK` does not undo a Storage write.** Measured directly: open a transaction, insert a row,
upload an object, throw. The transaction rolls back; the object is still there. This is the fact the
whole design has to be built around, and it is now measured rather than assumed.

**SQL can see Storage.** `storage.objects` is a real table in your own database, with `bucket_id`,
`name`, `created_at`, and a `metadata` jsonb holding `size` and `mimetype` (they are *not* top-level
columns, so it is `(metadata->>'size')::bigint`). A join from it to one of our own columns returns the
matching row — verified in the spike. What SQL **cannot** do is read the bytes. There is no
`storage.download()` and no practical FDW; `pg_net` is asynchronous and lands its response in a table
you poll. So Greg's sense was right, with one boundary: **metadata joins, contents do not.**

## The decision

**Raw source bytes go in Storage. Everything else stays in Postgres columns.**

The line is not size — that would be arbitrary and would move every time an article got longer. The
first draft drew it at *immutability*, and the review showed that slogan mis-sorts at least one
artefact: `extractedHtml` is immutable too (stage 3 produces a *separate* `stampedHtml` kind; it is
only the *filesystem* that overwrites the path), yet it belongs in Postgres. So the line is finer,
and it is three categories rather than two:

| | where | why |
|---|---|---|
| **Raw payload bytes** | Storage | large, shared between articles, and identified by their own contents |
| **Raw provenance and the reference to those bytes** | Postgres | must be transactional, must be exact, must survive a restore |
| **Revision products** — including immutable `extractedHtml` | Postgres | they participate in revision consistency; a revision is atomic or it is nothing |

The thing that lets the payload out of the transaction is not immutability on its own. It is that
**the acquirer always still holds the bytes**. A step that is about to reference an object has just
fetched or read it, so "the object is not there" is never fatal — it re-uploads. That single property
is what makes every failure below recoverable, and it is why the protocol can be simple.

### Why not put the small artefacts there too, for consistency

Because "consistency" would buy a uniform API and pay for it in four things Storage cannot do, on the
27% of bytes that are not the problem:

- **No transaction.** Five small artefacts written together as one commit become five HTTP calls with
  five failure points, and the entire `transactional-stage-runner` plan exists to stop exactly that.
- **No backups, no point-in-time recovery.** Supabase's PITR covers the database and *not* the
  bucket; after a restore, metadata and objects can point at different realities.
- **No SQL over the contents.** The shelf sorts on `word_count` and `root_gist`; search runs `fts`
  over blocks. Those are `where` clauses over artefact content, and an object is opaque to all of it.
- **N round trips instead of one.** Reading an article is one `select` today.

What we would gain is storage at $0.0213/GB instead of $0.125/GB, on about a megabyte.

### The smaller alternative, and why not

The appendix named one: keep `raw_bytes` for HTML, use Storage for PDFs only, with a `CHECK` that
exactly one is non-null. It is honest, and it is less work in isolation.

**Under this migration it is the dearer option**, which is what changed. Two paths means the raw
product has two shapes and landing D threads both through eleven modules. And *"the seldom-used one
rots"* — the appendix's own objection — is worse here, because the seldom-used one would be the **web
fetch**, which is how almost every article arrives. Largest `raw.html` measured here is 657 KB: not
small enough to be free in a `bytea` copied on every draft mint, not large enough to justify a second
mechanism.

## The part the first draft did not have: a reference the transaction owns

> **Most of this section is superseded** by § Three things the second review left — now settled,
> which records Greg's decision that objects are never deleted. What survives is everything about the
> *reference*: the table, the composite key, the CHECK, and why a hash alone is not a pointer. What
> goes is the lifecycle — `state`, the lease, `retire_after`, and both halves of the deletion
> protocol below. It is kept rather than cut so that the reasoning is on the record if the erasure
> path is ever built, since that is when every word of it becomes load-bearing again.

The first draft said `raw_sha256` is already the pointer and nothing needs adding. **That was wrong
three times over**, and the review is right about each.

- **A hash is not a key.** `canonicalKey(sha256, kind)` needs the media kind too
  ([`src/source.ts`](../../src/source.ts)), and there is no `raw_kind` column. `raw_content_type`
  cannot stand in for it, because the stored content type is *the server's claim*, not our
  determination — [`src/fetch.ts`](../../src/fetch.ts) says so in as many words: *"A PDF served as
  `application/octet-stream` is still a PDF; a Cloudflare challenge page served as `application/pdf`
  is still HTML."*
- **`raw_sha256` is nullable and legitimately null**, for any manifest backfilled from an article
  fetched before manifests existed.
- **A bare hash carries no provenance.** `origin`, `uploadId` and `filename` live in the manifest and
  have nowhere to go, and the checked-in `source` / `source-2` fixtures are two uploads of one
  document with distinct upload identities.

So there is a table, and it is the thing the commit references. **Its columns are a state machine,
not a description** — that is the second review's correction, and the reason the second draft was
still NO-SHIP:

```
raw_sources
  sha256        text          )  primary key — the hash of the bytes AT THIS KEY
  kind          text          )  'pdf' | 'html'
  bytes         bigint
  content_type  text
  state         text          -- 'uploading' | 'present' | 'deleting'
  claimed_by    uuid          -- who is uploading, and since when: a lease, like a job's
  claimed_at    timestamptz
  retire_after  timestamptz   -- set when nothing references it; cleared by any acquisition
  verified_at   timestamptz   -- when we last confirmed the object hashes to its own key
  created_at    timestamptz
```

`article_revisions` gains `raw_source_sha256` and `raw_source_kind`, a composite foreign key onto it.
**Both columns or neither** — a `CHECK` that they are null together, because two nullable columns
forming one pointer is a half-pointer waiting to happen, and the review is right that nothing
currently stops one. A reference may also only name a row in `present`; a revision pointing at
`uploading` or `deleting` is refused at publication rather than discovered later.

`raw_sha256` **stays where it is and keeps its current meaning** — see the backfill below, where the
two stop being the same number. Provenance (`origin`, `upload_id`, `filename`) hangs off the revision,
not off the shared object, because two readers sharing one PDF do not share a filename.

**No foreign key against `storage.objects`, in either direction.** It is platform-managed, Supabase
changes it under its own migrations and advises against referencing it. `raw_sources` is *our* record
of what we believe is in the bucket; the bucket is not asked to enforce anything.

### Acquiring: the row comes first, and says it is not ready

The second draft said fetch uploads and then "registers" the object, which has no crash-safe ordering:
upload-then-insert leaks an object no row can find, insert-then-upload leaves a `present` row pointing
at nothing. And `select … for update` **locks no row that does not exist**, so two first-time
acquirers of the same document both proceed.

So the row is inserted first, in state `uploading`, with a lease:

1. `insert … values (sha, kind, …, 'uploading', me, now()) on conflict (sha256, kind) do nothing`,
   then read the row back. Exactly one caller creates it; the primary key is the mutual exclusion,
   which is the same trick `jobs_only_one_running` already uses rather than a new one.
2. The winner uploads, verifies the object hashes to its key, and moves the row to `present` —
   `verified_at` set — in one transaction.
3. A caller that lost, or found an `uploading` row whose lease has expired, may take the lease over.
   Taking over is safe here and not in deletion, because the operation is *idempotent by
   construction*: both callers are writing the same bytes to the same name.

A crash between 1 and 2 leaves an `uploading` row with a dead lease, which is a **finding**, not a
leak: the sweep can see it, and the object it may or may not have written is at a name that says what
it should contain, so verification settles it.

### Deleting: a tombstone, and nobody revives it

The second draft's three phases released the lock before removing the object, and the review's first
critical is that this has no recovery:

```
  sweeper                          an acquirer
  ──────────────────────────────   ─────────────────────────────
  marks H `deleting`, commits
  crashes
                                   sees `deleting`, re-uploads
                                   putIfAbsent → already-there   ← the object never went
                                   nothing completes the deletion
```

And letting the acquirer take over is worse, because the original sweeper may wake up and delete the
object somebody has now referenced. So **`deleting` is terminal**:

1. **Mark.** Nothing references it → `state = 'retiring'` is *not* a state; `retire_after` is set on
   the `present` row. Any acquisition clears it, in the transaction that adds the reference.
2. **Commit to deleting.** Past the grace period, and still unreferenced: `select … for update`, set
   `state = 'deleting'`, commit. From here the row is a tombstone. **An acquirer never revives it** —
   it waits for the row to disappear and then acquires from scratch, which is the ordinary path.
3. **Complete.** A retryable worker removes the object, then deletes the row. Crash anywhere and the
   row is still `deleting`, so the worker simply runs again; removing an object that is already gone
   is a no-op.

The price is that acquiring a document that is mid-deletion *blocks* rather than proceeding. That is
the right trade: it is rare, it is bounded by one Storage delete, and the alternative is a race whose
losing side is a dangling reference in a committed revision.

### An orphan is not inert, and the first draft said it was

Three ways it is not, all from the review and all conceded:

- **It is billed**, for as long as it exists, and it is invisible to anything that looks at articles.
- **It is a reader's private document.** A private bucket controls access; it does not make retained
  personal material not exist. An article deleted by the reader whose bytes stay in a bucket for ever
  is the wrong answer to *"delete this"*.
- **Global dedup means deletion is two questions, not one.** *Remove this reader's association* and
  *delete the shared object once its last reference is gone* are different operations, and only the
  second frees anything. With one reader today they look identical, which is precisely when to write
  the distinction down.

So the sweep above is not only hygiene, it is the erasure path, and it needs a stated deadline rather
than "eventually". That deadline is not set here — see § Not decided.

## The backfill can put the wrong bytes under a hash

The review's second critical, confirmed in the code, and it is the subtlest thing in this document.

[`writeRaw`](../../src/fetch.ts) hashes **the bytes off the network** — but for HTML it writes the
**decoded, UTF-8 re-encoded text** to `raw.html`. The comment says so out loud: *"`raw.html` is
therefore not raw"*. `db:import` then loads that file into `raw_bytes` while copying the manifest's
hash into `raw_sha256`. So for any page that was not already UTF-8:

```
  sha256(raw_bytes)  ≠  raw_sha256
```

A backfill that uploads `raw_bytes` under `canonicalKey(raw_sha256, …)` therefore stores bytes that
**do not hash to their own key** — breaking the one invariant this entire design rests on. Worse, it
breaks it quietly: a later `putIfAbsent` returns `already-there` without downloading or verifying
anything, so the mismatch is accepted permanently.

The fix separates two questions that were being answered with one number:

- **`raw_sources.sha256` is a hash of the bytes we actually have.** It is the object's key, and it is
  verified — the backfill computes it rather than trusting a stored value.
- **`article_revisions.raw_sha256` stays a hash of what we originally received.** Still true, still
  worth keeping, and no longer load-bearing.

For a PDF the two are equal. For UTF-8 HTML they are equal. For anything else they differ, and the
revision records that its stored bytes are a re-encoding rather than the original — a fact, stated,
rather than a discrepancy nobody can see. Every backfilled row is verified this way; a row whose
`raw_bytes` is null gets no `raw_sources` reference at all, which reads correctly as *we do not have
the source* rather than as a dangling pointer.

## Where the bytes go must be configured, not inferred

`blobStore()` picks Supabase when a service key happens to be present and the filesystem otherwise,
while `SPIDERYARN_STORE` picks the article store separately. Today that is harmless. Once a Postgres
row references an object it is a split brain: `SPIDERYARN_STORE=postgres` against a remote database
with no service key would commit a reference in Postgres and put the object under `data/_blobs/` on
one laptop, where no other process can find it. Credentials also do not prove the Storage project is
the one `DATABASE_URL` points at.

So the blob backend becomes explicit, and a startup invariant refuses the incoherent pairing rather
than discovering it on the first article. The filesystem adapter stays — it is right for tests and for
a laptop with no container — as a configuration somebody chooses, not one they fall into.

**And it cannot implement the protocol above**, which the review is right to press on: `raw_sources`
lives in Postgres and the filesystem store has no Postgres. The honest answer is that the filesystem
configuration does not get the state machine at all — it writes the object, it never sweeps, and it
says so. That is the same shape as `uploadGrants()` returning `null` rather than pretending: an
adapter that cannot do a thing should refuse it, not approximate it. What must not happen is the
*mixed* configuration — Postgres articles with filesystem blobs — and that is what the startup
invariant is for.

## What changes

1. **`fetch` puts its bytes in the blob store**, at `canonicalKey(sha256, kind)` — the same call the
   PDF path already makes — and registers them in `raw_sources`.

   > **One writer first, which landed 2026-08-27.** `npm run fetch` did not use `writeRaw`: it wrote
   > `doc.bytes` by hand and no manifest, so the CLI and the pipeline produced *different files at
   > the same path* — undecoded bytes against the decoded string, and `extract` reads that path as
   > `"utf8"`, so a page in any other encoding came out as mojibake one way and correctly the other.
   > Under this plan that divergence gets much worse than mojibake: the same page fetched two ways
   > would hash differently and become **two objects**, which is the one thing content addressing is
   > supposed to make impossible. `writeRaw` had simply never been adopted by the CLI (it arrived in
   > `b6e41b4` and `main()` was left alone). There is one writer now.
2. **`supabase/config.toml` adds `text/html`** to the `sources` bucket's MIME allowlist. Note the
   bucket must also be provisioned on the *remote* project, which config.toml does not do.
3. **`raw_bytes` stops being written**; the reference becomes the `raw_sources` pair. The column is
   dropped later, not now.
4. **`db:import` and `db:export` are rewritten** — export becomes a Storage read, which makes
   data-portability depend on credentials and object availability for the first time.
5. **`GET /api/source/:slug` becomes a redirect to a signed URL**, not a proxied body.

   > **Correction.** The first draft said this route was *"documented and not yet built"*. It is
   > built — `sendSource` in [`src/routes.ts`](../../src/routes.ts) — and that makes it worse rather
   > than better. It reads `fsLocations(slug)` **unconditionally**, so it goes to the filesystem no
   > matter what `SPIDERYARN_STORE` says, and then `res.end(bytes)` puts the whole document through
   > the function. Two consequences, both live: under Postgres it serves from a directory that is not
   > the source of truth, and on Vercel it would meet the 4.5 MB **response** cap with an 11 MB PDF.
   > Working on this laptop and failing in production is this repo's most-written-up failure shape
   > ([silent-success](../reusable/silent-success.md)), and here it is again in a route that already
   > shipped. Found by an audit of every raw-byte reader, 2026-08-27.
6. **The three-phase sweep**, above.
7. **`tests/store-roundtrip.test.ts` gains raw files and manifests — done, 2026-08-27.** It omitted
   them, under a comment reading *"every artefact a round trip should preserve"*, which meant **total
   loss of every raw document passed that test**. The review found it; it went first, and it went red
   before anything moved.

   What it caught was worse than the omission, and is fixed in the same commit. `db:export` wrote
   `revision.rawBytes` to **`raw.html` unconditionally**, so every exported PDF landed under a name
   claiming to be HTML — and the name is the only thing that tells the next `db:import` which decoder
   to use, since `readRaw` falls back to *"no manifest means assume HTML"*. Four of the seven articles
   here are PDFs. It also never wrote `raw.json` at all, so a round trip lost the content type, the
   encoding, the hash and both URLs.

   The fix sniffs the bytes (`looksLikePdf`) rather than trusting `raw_content_type`, which is the
   rule stage 1 already follows and the reason finding 3 above is real: **there is no `raw_kind`
   column**, so the body is the only honest authority until `raw_sources` exists. Both assertions were
   then checked against the broken state rather than trusted for passing — restoring the filename bug
   fails exactly the four PDF articles, and removing the `backfilled` stamp fails seven tests.

   One thing the test deliberately does *not* assert is "absent stays absent" for `raw.json`, which is
   the rule every other artefact follows. It cannot: nothing in Postgres records whether stage 1 wrote
   a manifest — `data/writes` has one and `data/constitution` does not, and both arrive as the same
   all-null columns. So the export writes a reconstruction stamped `backfilled`, a shape this repo
   already has and `readRaw` already ignores the provenance of. That is finding 3 showing up in a
   third place.

## The trap had already sprung

The audit of every raw-byte reader found that **three queries selected the revision row whole**, and
one of them runs once per article on the library page:

| query | when | reads the bytes? |
|---|---|---|
| `listArticles` | every library load, **once per article** | no |
| `currentRevision` → `loadArticle` | every article view | no |
| `publishRevision` | every publish | no |

Measured against this laptop's database, joining `articles` to their current revision, 8 articles:

| | time | across the wire |
|---|---:|---:|
| whole row, as it was | 28 ms | **23.89 MB** |
| only the columns read | 0 ms | 0.01 MB |

7.2 MB of that is `raw_bytes`; the rest is the driver rendering a `Buffer` as JSON. On a laptop it is
28 ms. From a Vercel function to Supabase it is the entire corpus, on every library load, for a page
showing titles and blurbs.

**Fixed, 2026-08-27**, ahead of the rest of this plan and independently of it: the reads take every
column *except* `raw_bytes`, derived from the table rather than listed by hand — a hand-written list
is right the day it is written and silently drops the next column somebody adds.
`tests/store-revision-columns.test.ts` asserts the difference is exactly that one column, so growing
the schema stays green and forgetting one fails.

It also asserts something the constant cannot: that **no query takes the whole row**. Getting the
constant right does not make the queries use it, and TypeScript will not catch a revert, because a
full row is assignable where the narrow one is wanted. That half reads the source text, which is
blunt and is the right instrument for a property about code rather than about a value. All three ways
of undoing this were checked against the test rather than assumed — reverting either query, or
putting the column back in the constant, each fails it.

When raw bytes leave Postgres this whole section stops being necessary. That it was necessary *now*
is the argument for the plan restated in a measurement.

## Is there a quicker v1 in the same direction?

**The first draft claimed this was strictly less work than the landing B piece 2 it replaces. That was
the overclaim**, and the review is right: piece 2 changes shape rather than disappearing. The runner
still needs a store-neutral raw product; its payload becomes a verified reference instead of inline
bytes, and it must still carry provenance, size, and evidence that the upload actually completed.

What is true, and still worth the change:

- **Nothing 32 MiB wide enters a transaction**, is held live until commit, or is serialized through
  the driver — the largest cost the earlier review listed against returning products at all.
- **The 156 ms draft copy goes away**, along with the WAL and backup weight behind it.
- **The web fetch and the upload stop being two designs**, which was the contradiction that started
  this.
- **The source route becomes buildable** at all.

Against that, honestly: a `raw_sources` table, a three-phase sweep, a verifying backfill, an explicit
blob configuration, and rewritten import/export. It is comparable work to piece 2, in a better place.

## Three things the second review left — now settled

**1. Objects are kept indefinitely. Greg's call, 2026-08-27:**

> Maybe keep them indefinitely (at least for now)?
>
> — Greg, asked for an erasure deadline

**This is the decision that removes most of this document.** Every critical across both reviews was
about deletion, or about ordering that only matters because deletion exists. With no deletion:

| the review's critical | why it stops applying |
|---|---|
| the sweeper deletes an object immediately before its reference commits | there is no sweeper |
| `deleting` has no safe completion or recovery | there is no `deleting` |
| a crash between upload and insert leaks an object no row can find | that "leak" **is** the retention policy — an object with no row is a *kept* object |
| a reference may name a row in `deleting` | there is no such state |

So `raw_sources` keeps `sha256`, `kind`, `bytes`, `content_type`, `verified_at`, `created_at` and
loses its entire lifecycle — no `state`, no lease, no `retire_after`. The protocol becomes two steps:
put the object, which is idempotent by construction and permanent; then **one transaction** that
inserts the row, the revision's reference, the artefacts, the step run and the job transition. That
last is the single fenced commit [transactional-stage-runner.md](transactional-stage-runner.md)
already requires, so this adds no transaction of its own.

Crash between the two: the object is kept, nothing references it, the retry re-uploads (getting
`already-there`) and commits. Two acquirers of one document: both write identical bytes to the same
name and one wins the insert, with nothing to disagree about. **A decision by the person who owns the
consequence, and reversible** — the erasure path is a thing we are not building yet rather than a
thing we have ruled out. § Not decided here records what taking it back would cost.

**2. The signed-URL window: fifteen minutes, not sixty seconds — and the cache is the real control.**

My first answer was 60 seconds, reasoning that the redirect is one hop. **The redirect is one hop and
the PDF session is not one request**, which is the correction. A browser viewing a PDF inline makes
Range requests, and it makes them against the *final* signed URL — it does not come back to
`/api/source/:slug` for a fresh one. Suspend the tab and resume, and the token is expired mid-document.
Sixty seconds buys a viewer that breaks.

Worse, and this is the part that would have been found in production: **with Smart CDN, token expiry
and the object's `cacheControl` are independent**, so a cached signed response can stay usable after
its token has expired — the documented default is about an hour. A "60 second" window that is
actually an hour is not a tighter promise than fifteen minutes, it is a *wrong* one, and it would have
been written into this document as a security property.

So:

- **Fifteen minutes**, which covers a realistic read of a long PDF without pretending to be
  revocation. Supabase offers TTL and nothing narrower — no single-use, no audience — and a signed URL
  cannot ordinarily be revoked before it expires. That is the honest shape of what we get.
- **`Cache-Control: no-store` on our redirect**, and the bucket's own cache policy set deliberately
  rather than left at its default, because otherwise the number above means nothing.
- The ownership check stays **before** minting, so an unauthorised caller never receives a URL at all.
  What the window governs is forwarding by someone who was authorised, which is a different and much
  smaller thing than the check it replaced.
- **Test it against the 11 MB PDF** under throttling, with delayed Range requests and a suspended tab,
  before believing any of the above.

**3. "We never had the bytes" and "we lost them" are told apart by a publication rule, not a column.**

The review's point was that a legacy import with no source and a fresh revision whose acquisition
failed both end as the same null reference. They do not, and the distinction is already in data we
keep: **a revision with successful fetch evidence in its lineage must carry a raw source reference**,
enforced in `publishRevision` beside the checks already there.

*In its lineage*, and **`status = 'done'`** rather than merely a row — both are corrections. Step runs
are copied forward by `beginDraftIn`, so a later revision legitimately inherits a `fetch` run it did
not perform; the rule is about the article's history, not about this attempt. And
`revision_step_runs.status` admits `running` and `error`, so testing for existence would accept a
revision whose fetch is recorded as having failed.

Checked rather than assumed, because the rule is only worth having if the data supports it:

- [`src/store/import.ts`](../../src/store/import.ts) records a `fetch` step run **only when the raw
  file was actually there** — `{ step: "fetch", present: Boolean(rawBytes) }` — and *withdraws* the
  row for any step that was not. So a legacy article with no source has no `fetch` run and publishes
  with a null reference, correctly.
- `beginDraftIn` copies step runs forward, which is the vacuous pass the review asked about. It is not
  one: the reference is in the `CARRY` list too, so a carried `fetch` run and a carried reference
  travel together. A re-extraction job publishes with the source the previous revision had, which is
  the truth.

No new column, and one fewer thing to keep in step.

## Two things that had to survive the simplification — both built, 2026-08-27

Greg's "keep them indefinitely" removes the lifecycle. Asked whether it removes the *protocol*, the
third review's answer was: the lifecycle columns can go, and **three non-lifecycle guarantees cannot**.
Two of them were small enough to build straight away.

**`already-there` is not verification.**
[`storeRawSource`](../../src/store/blobs.ts), tests in
[`tests/raw-source-store.test.ts`](../../tests/raw-source-store.test.ts).

`putIfAbsent` is create-only against a key that is the hash of the contents, so a dedup hit *looks*
like proof. It is not, and no deletion is required to break it: something can be at a canonical name
because a write crashed, because a backfill went wrong, or because somebody has the service key.
Committing `verified_at` on the strength of a hit records a verified reference to bytes we never read.
So a hit is now read back and hashed; only a successful *create* is trusted on its own, because there
we hashed the buffer we wrote.

A mismatch is **repaired**, not refused, and the exception to "never delete" is deliberate and narrow:
an object that does not hash to its own name is not a retained document, it is wreckage, and provably
so, because the name is a claim the contents settle. Refusing would be permanent in the wrong
direction — that article could never be ingested by anybody, ever, without a human with a service key.

The concrete crash window was in our own filesystem adapter, whose comment argued the case and got it
backwards: *"a partial write can only happen inside this call, and the caller is holding the whole
buffer"* — true, and *inside this call* includes **and then the process was killed**. `wx` created the
canonical name first and wrote the bytes second. It writes to a temp name and `link`s now — `link`
rather than `rename`, because rename overwrites and create-only is the entire contract.

**The database and the bucket must be the same project.**
`projectMismatch` in [`src/store/blobs.ts`](../../src/store/blobs.ts), refused at boot in
[`src/store/index.ts`](../../src/store/index.ts), tests in
[`tests/store-project-pair.test.ts`](../../tests/store-project-pair.test.ts).

This is **the one way the dangling reference arrives without anybody deleting anything**, and it is
pure configuration: `DATABASE_URL` picks the database, a service key picks the blob store, and nothing
compared them. Put the object in project B, commit the reference in project A, and every correctly
configured reader of A finds nothing. Hosted Supabase writes the project ref into both strings — the
pooler username is `postgres.<ref>`, the API origin is `https://<ref>.supabase.co` — so it is
answerable at boot, and it is refused there rather than discovered as a missing document weeks later.

The third guarantee is **the upload state machine, which stays**. `acquireUpload` verifies mutable
staging bytes once, hashes them, promotes them and settles the upload; none of that was
`raw_sources`'s lifecycle and none of it goes. One consequence of "never delete" belongs on the record
though: **every successful upload is kept twice** — under `staging/<id>` and under its canonical hash —
and abandoned and rejected uploads are kept for ever. Staging objects were already never deleted (a
deleted one *re-arms* any live grant over its key), so this is not new; it is now permanent by policy
rather than by accident, and worth knowing before the bucket is ever measured.

## Not decided here

- **The erasure deadline** — how long after its last reference an object may live. Needs a number and
  an owner, and it is a question for Greg rather than for this document.
- **Whether `extractedHtml` / `stampedHtml` ever move.** Largest measured: 151 KB. The three-way line
  above says no, and says why more precisely than the first draft did.
- **When `raw_bytes` is dropped.** Writing stops first; the drop waits until every environment is
  backfilled and verified, because a drop is the one migration that cannot be walked back.
- **Whether the checkpoint store** (landing B piece 3) uses Storage. It should not, by the same line:
  small, rewritten, read on every retry. A table keyed by revision and step.
- **Remote latency.** Every number here is against the local container; `.env.local` holds no remote
  Storage credentials. It does not change the decision — the rollback and backup facts do that alone —
  but it is not evidence we have.

## What the reviews changed

| first draft said | actually |
|---|---|
| an orphan is *"at a name nobody will mint again"* | content addressing means the **same** name gets minted again; the sweep races a commit |
| an orphan is *"inert"* | it is billed, it is a reader's private document, and dedup makes deletion two operations |
| `raw_sha256` is already the pointer | a key needs the media kind too, the column is nullable, and provenance has nowhere to go |
| the backfill is a copy | for non-UTF-8 HTML, `sha256(raw_bytes) ≠ raw_sha256`; it must verify and re-identify |
| landing B piece 2 dissolves | it changes shape — a verified reference is still a product to carry |
| the line is *immutability* | three categories, not two; `extractedHtml` is immutable and still belongs in Postgres |
| raw source is 86% of bytes | 73% inside article directories, 93% counting strays — two calculations, one published |
| the filesystem fallback is fine | with Postgres articles it is a split brain; the backend must be configured |

The **second** review, on the draft that answered the first:

| second draft said | actually |
|---|---|
| the three-phase sweep closes the race | it releases the lock before the object is removed; a crash mid-delete has no recovery, and `deleting` must be a terminal tombstone |
| fetch uploads and then registers the object | neither order is crash-safe, and `for update` locks no row that does not exist — the row comes first, in `uploading`, with a lease |
| the composite reference is enough | two nullable columns are a half-pointer; and nothing stopped a revision referencing a row in `deleting` |
| the filesystem fallback just needs configuring | it cannot implement the protocol at all, because `raw_sources` is in Postgres — it must refuse rather than approximate |
| `looksLikePdf` names the exported file | stage 1 accepts a PDF with junk before the header and this did not — the same bug one layer along. **Shipped and fixed the same day.** |
| the manifest test is enough | it asserted a filename and a stamp; the content type, encoding, hash and URLs could all be wrong and pass. **Fixed.** |
| the column guard proves no query takes the whole row | it is a regression check over two files and two spellings, bypassable by aliasing the table. Kept, and the claim corrected. |

One correction runs the other way. The research doc called `pg_net` *"POST-only"*; it is not — it
supports `http_get`, and there is a synchronous `http` extension besides. Neither gives a sensible
path for 11–32 MiB binary payloads, so the conclusion stands, but the fact was wrong and is fixed in
[the research doc](../research/supabase-storage-vs-postgres.md).

## See also

- [raw-bytes-in-storage-review-sol.md](raw-bytes-in-storage-review-sol.md) — the review, in full
- [supabase-storage-vs-postgres.md](../research/supabase-storage-vs-postgres.md) — the sourced facts
- [transactional-stage-runner.md](transactional-stage-runner.md) — the plan this edits
- [pdf-upload-and-storage.md](pdf-upload-and-storage.md) — the blob seam, and the appendix that
  recommended all this first
- [database.md](../project/database.md) — where the data lives
