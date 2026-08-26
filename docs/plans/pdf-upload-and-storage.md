# Uploading a PDF, and the object store under it

**Planned 2026-08-26.** Choose a PDF on your own machine and it becomes an article, the same way a
pasted URL already does. The bytes go **straight from the browser to Supabase Storage** and never
pass through our server, because on Vercel they cannot: a function refuses a request body over
4.5 MB, and two of the three PDFs in our own eval set are bigger than that.

This is **step 7 of [pdf-ingestion.md § Build order](pdf-ingestion.md#build-order)** — *"Upload
last — the store seam, then the file picker, then the pipeline's URL assumptions"* — which that
plan records as **"Still to do, and the only step that is."** Everything in
[pdf-ingestion.md § Upload](pdf-ingestion.md#upload) still stands; this file is that section
worked out to the point where somebody could build it, plus the object store it needs, which is
new. It is a separate file only because `pdf-ingestion.md` is already sixteen hundred lines and
this is a subsystem rather than a paragraph — **not** because anything in it is being re-decided.

> We're going to need Supabase storage to deal with uploading PDFs (which could be bigger than
> Vercel's 4ish megabyte upload limit).
>
> — Greg, 2026-08-26

And, from the plan this extends:

> **Upload** — build it now, behind a raw-document-store seam: one small module owning "put these
> bytes / fetch these bytes", filesystem-backed today, Supabase Storage later. The filesystem half
> is knowingly throwaway; the seam and the file-picker are not. It must be built knowing Vercel
> refuses bodies over 4.5 MB, so the real path is a direct-to-storage upload, not a POST through us.
>
> — Greg, 2026-08-26, [pdf-ingestion.md § Greg's answers](pdf-ingestion.md#gregs-answers-2026-08-26)

## What is already there, and what is not

Nothing about uploading or about object storage is built. That was checked rather than assumed —
a sweep of every plan, of the git history, and of the working tree including other agents'
uncommitted files.

| | State |
|---|---|
| `[storage] enabled = true` in [`supabase/config.toml`](../../supabase/config.toml) | **there**, 50 MiB global limit, every `[storage.buckets.*]` still commented out |
| The `supabase_storage_spideryarn2` container | **running**, and it works — see the probes below |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **in `.env.local` already** |
| `@supabase/supabase-js` | **already a direct dependency** (`^2.112.4`), and `@supabase/storage-js` is installed under it — corrected 2026-08-26 after [Sol's review](#the-cross-family-review-what-sol-said-and-what-changed); this table originally said "not installed" and was wrong |
| Any `put`/`get` blob seam | **does not exist** — nothing in `src/store/` |
| A file picker, `/api/upload`, multipart, `FormData` | **none** — no such string anywhere in `src/` |
| `GET /api/source/:slug` serving a stored PDF | **built**, [`src/routes.ts`](../../src/routes.ts) `sendSource` — but **not** reusable unchanged: it is hardwired to `fsLocations`, `readRaw` and `readFile`, so it serves only a filesystem-backed article |
| The whole URL→PDF→article pipeline | **built and measured** — which is the point: stages 3–6 already cannot tell where a PDF came from |

So the work is genuinely the front of the pipe, and only the front.

## The size problem is not hypothetical

```
  evals/pdf/easy/source.pdf          145 KB   ✓ fits through a Vercel function
  evals/pdf/much-harder/source.pdf   6.1 MB   ✗ over the 4.5 MB body limit
  evals/pdf/harder/source.pdf       11.5 MB   ✗ over it by a factor of two and a half
```

Two of the three documents this project already measures itself against **cannot be uploaded
through our own API**. Nagel, the informal probe, is 4.9 MB and also over. A multipart route to
`/api/upload` would work perfectly on this laptop and be dead on arrival in production, which is
exactly the trap `pdf-ingestion.md` warns about: *"Building the local one first is fine; mistaking
it for the shipping one is not."*

## What was measured, not read

The docs say a lot of this. It was checked against the running local stack on 2026-08-26 instead,
because "the browser uploads with no credentials" is the kind of claim that is worth watching
happen. Each row is a real request against `http://127.0.0.1:54361`.

| Question | Answer, observed |
|---|---|
| Can the server mint a one-time upload URL? | Yes. `POST /storage/v1/object/upload/sign/<bucket>/<path>` with the service-role key returns a `token` |
| **How long is that token good for?** | **Exactly 2 hours.** Its payload decodes to `{"url":…,"upsert":false,"scope":"upload","iat":…,"exp":…}` and `exp − iat` is `7200`. Not configurable |
| **Can the browser upload with no API key at all?** | **Yes** — a bare `PUT …?token=…` with no `Authorization` and no `apikey` header stored 3 MB and returned `{"Key":"…"}`. This is the whole mechanism |
| Can a *stolen* token write somewhere else? | **No.** The path is inside the signature; reusing a token against another path gives `400 InvalidSignature` |
| Can the anon key mint a token? | **No** — `403 Unauthorized: new row violates row-level security policy`. Minting is server-only by construction, not by our care |
| Is the bucket's MIME allowlist enforced at upload? | **Yes** — `text/plain` into a PDF-only bucket gives `415 InvalidMimeType` |
| Is the bucket's size limit enforced at upload? | **Yes** — 3 MB into a 1 MB bucket gives `413 EntityTooLarge` |
| Do the bytes survive intact? | **Yes** — server-side `GET /storage/v1/object/<bucket>/<path>` returned 3,000,009 bytes with a SHA-256 identical to the file that went in |
| Can a token be **replayed** while the object still exists? | **No** — `409 Duplicate`. The grant is `upsert:false` and the object is the lock |
| Can a hostile `x-upsert: true` header override that? | **No** — still `409`. The header does not beat the token's baked-in flag |
| **Can a token be replayed after the object is deleted?** | **Yes — `200`, re-uploaded.** The grant outlives the object it created. This is the one that changes the design |
| Can a caller mint an upsert-enabled grant? | **No** — `POST …/upload/sign/…` with `{"upsert":true}` returns `200` and a payload that still says `upsert:false` |

The last four were added on 2026-08-26 **because [Sol's review](#the-cross-family-review-what-sol-said-and-what-changed) pointed out that the original table
asserted "one-time" while having measured only "path-bound"** — two different properties. Measured,
they are: path-bound yes, non-upsertable yes, and **one-time only for as long as the object
survives.**

**What follows from row 3 is a rule, and it is not obvious.** A signed grant is a bearer credential
live for two hours, and deleting the object it wrote re-arms it. So **nothing may delete an object
while a grant over its key could still be live** — the orphan sweep's grace period has to exceed the
two-hour TTL, and a cancelled job must not tidy up its own object promptly. Get that wrong and the
sequence is: we verify bytes A, a sweep removes them, the still-valid token uploads bytes B to the
same key, and extraction reads B. We would have checksummed one document and spent model money on
another.

The probe bucket was deleted afterwards; nothing was left behind.

Two things follow that change the design:

1. **The browser needs no credentials.** We do not ship the anon key to do this, and we do not
   need a signed-in Supabase user. One short-lived, path-bound token is the entire grant.
2. **Three of our validations already exist in the bucket** — type, size, and where a token may
   write. That does not replace our own checks (a bucket cannot tell a PDF from a file named
   `.pdf`), but it means a bug in ours is a second line rather than the only one.

### What the docs add that the probe could not

- **Vercel's 4.5 MB is flat and cannot be raised** — same for Node functions, Edge, and Fluid
  compute; `413 FUNCTION_PAYLOAD_TOO_LARGE`. There is no plan tier and no `vercel.json` key that
  moves it, and Vercel's own guidance is to upload straight to storage. (A "2 MB / 4 MB" figure in
  search results is the Edge *bundle* size, a different limit — worth knowing so nobody
  re-litigates this from a bad hit.)
- **Supabase's free plan caps a single object at 50 MB and will not raise it.** Greg's answer on
  the cap was 50 MB, which lands exactly on that ceiling — so v1 needs no plan change, and any
  later increase needs one.
- **Above ~6 MB Supabase recommends resumable (TUS) uploads**, because a failed plain `PUT`
  restarts from nothing. Our 11.5 MB fixture is over that line. See
  [What we are deliberately not doing in v1](#what-we-are-deliberately-not-doing-in-v1).
- ~~`@supabase/storage-js` is the smaller correct dependency.~~ **Struck 2026-08-26.**
  `@supabase/supabase-js` is already in `package.json`, so `.storage` is already paid for and a
  second package would need a measured reason. Use what is there.

## The shape

```
  DEPLOYED — the real path. The function never sees the bytes.

   browser                          our API (Vercel)            Supabase Storage
      │                                   │                            │
      │ 1. POST /api/uploads              │                            │
      │    {filename, bytes, sha256}      │                            │
      │──────────────────────────────────►│                            │
      │                                   │ mint token for a path      │
      │                                   │ WE choose (never the       │
      │                                   │ client's)                  │
      │                                   │───────────────────────────►│
      │ ◄─────────────────────────────────│ {uploadId, url, token}     │
      │                                   │                            │
      │ 2. PUT the file, no credentials, straight to Supabase          │
      │───────────────────────────────────────────────────────────────►│
      │                                   │                            │
      │ 3. POST /api/jobs {uploadId}      │                            │
      │──────────────────────────────────►│  HEAD: does it exist?      │
      │                                   │  size? sha256? %PDF- ?     │
      │                                   │───────────────────────────►│
      │ ◄──────── the queued job ─────────│                            │
                                          │
                                          ▼
                            ingest: read bytes from the blob store,
                            write raw.json + raw.pdf, then extract →
                            blocks → toc → … exactly as a URL PDF does
```

Step 2 is the one that matters and the one that is easy to lose: **it does not touch our server.**
Everything our server handles is a few hundred bytes of JSON, so the 4.5 MB limit never applies to
anything on the critical path.

Locally there is no second path and no multipart route. The same three steps run against the local
Supabase container, which is already up. That is a deliberate departure from
`pdf-ingestion.md`'s "local dev only" multipart sketch, and the reason is that plan's own warning:
a local-only path that production cannot use is a thing to be tested and then thrown away. Since
the local stack speaks the same API, there is nothing to gain by writing the throwaway half.

## The pieces

### 1. The bucket

Declared in [`supabase/config.toml`](../../supabase/config.toml), so `supabase start` and
`supabase db reset` both create it and nobody has to remember a dashboard click:

```toml
[storage.buckets.sources]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["application/pdf"]
```

`sources`, not `pdfs` — it holds *the document an article was made from*, which is the same idea
`GET /api/source/:slug` already names, and PDFs are only the first kind. Private, always: these
are a reader's own documents and some of them will be things they would not put on the open web.

**This is local-only.** A bucket declared here is not created on a remote project by declaring it.
The remote needs `supabase seed buckets --project-ref <ref>` (checked against the CLI we have,
2.115.0 — *"Seed buckets declared in `[storage.buckets]`"*; a web search will tell you the flag is
`--linked`, and on this version it is not), or the equivalent insert into `storage.buckets`. That
is a deployment step and belongs in
[deployment.md](../project/deployment.md) when this lands — and it is exactly the kind of thing
that fails by *appearing to work*, since a missing bucket only shows up on the first upload.

### 2. The seam

One small module — `src/store/blobs.ts` — owning "put these bytes / get these bytes / does this
exist", with the same two-adapter shape as [`src/store/artifacts.ts`](../../src/store/artifacts.ts):

```ts
export interface BlobStore {
  /** A one-time, path-bound grant for the browser. Never takes a caller's path. */
  signUpload(key: string, contentType: string): Promise<{ url: string; token: string; expiresAt: string }>;
  /** Size and content type without moving the bytes — for the checks before enqueue. */
  head(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

Two implementations, chosen the way the artefact store already chooses:
`SPIDERYARN_STORE=postgres` → Supabase; otherwise a filesystem adapter under `data/uploads/`.

**And a warning the artefact seam did not need.** A filesystem blob store cannot implement
`signUpload` honestly — there is nothing to sign against and no second host to upload to. The
temptation is to have it return a URL pointing back at our own server and quietly accept the body,
which reintroduces the 4.5 MB path under a name that says it does not exist. So the filesystem
adapter's `signUpload` returns a URL to a **local-only** route that says so in its own name, and
`src/vercel-health.ts` gains a check that refuses to report healthy if the filesystem adapter is
live on a serverless host. A seam whose two sides differ in what they can *do* has to say so
loudly; see [silent-success.md](../reusable/silent-success.md).

**Sol's answer to that is better than the warning: split the interface.** If the filesystem adapter
cannot implement `signUpload`, `signUpload` does not belong on the same interface as `get`/`put` —
a health check cannot repair a shape that lies. So: a `RawSourceStore` (bounded read, metadata,
put-if-absent, remove), a separate `UploadGrantIssuer`, and an upload repository owning claim /
verify / expire. Two further corrections it makes, both checked: the sketch above has no streaming,
no abort signal and no way to do its own ranged read; and `head` must distinguish **absent** from
**Storage returned 503**, which [`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts)
already does and is worth copying rather than reinventing. Blob selection should also **not** hang
off `SPIDERYARN_STORE`, which selects article reads
([`src/store/live.ts`](../../src/store/live.ts)) and is a different question.

### 3. Three endpoints

- **`POST /api/uploads`** `{ filename, bytes, sha256 }` → `{ uploadId, url, token, expiresAt }`.
  Refuses anything over the cap *before* minting, so an over-large file is told so in a second
  rather than after a 50 MB transfer. The `sha256` the browser claims is recorded, not trusted.
- **`POST /api/jobs`** gains a second body shape: `{ uploadId }` alongside today's `{ url }` and
  `{ slug, steps }`. It verifies the object before enqueueing anything — see below.
- **`GET /api/uploads/:id`** (optional, and probably worth it) so a browser that lost its tab can
  find out whether its bytes arrived.

The 64 KB `MAX_BODY_BYTES` in [`src/routes.ts`](../../src/routes.ts) stays exactly as it is. That
is the point — no route grows a large-body path.

### 4. What the server checks before it queues anything

`pdf-ingestion.md` states the rule and it is the load-bearing sentence of this whole design:

> **Never accept a client-supplied object path**: issue a user-scoped random path, then verify
> ownership, size, checksum and the `%PDF-` magic before enqueueing.

Concretely, on `POST /api/jobs {uploadId}`:

1. **The path comes from our own record**, looked up by `uploadId`. The client never names a key,
   so it can never point us at somebody else's object. `uploadId` is a random id; the object key is
   `<owner>/<uploadId>.pdf`.
2. **It exists, and it is under the cap** — `head`, cheap, before any bytes move.
3. **The first bytes are `%PDF-`.** A ranged read of the first eight bytes, not the whole file. The
   bucket's MIME allowlist checks the *claimed* type; this checks the actual one, and the two are
   different questions.
4. **The SHA-256 matches what the browser said**, computed over what actually landed. A mismatch is
   a refusal, not a warning — it means the thing we are about to spend model money reading is not
   the thing the reader chose.
5. Only then is a job enqueued.

~~Steps 3 and 4 need the bytes, so they happen in the worker rather than in the request if the object
is large — but they happen **before extraction**.~~

**Corrected 2026-08-26.** That sentence and the heading above it describe two different API
contracts, which [Sol](#the-cross-family-review-what-sol-said-and-what-changed) was right to call a
blocking problem: one of them has an unverified object already in the queue. Say it honestly
instead. **The request** checks ownership, upload state, the claimed size and that the upload has
not already been claimed — all cheap, all metadata. **The job's first step is `verify-source`**, and
it does 2–4 over the bytes it downloads **once**, hashing and extracting from that same copy rather
than reading the object twice. No article, no slug and no ingest exists until it passes. That also
puts the byte-dependent work inside `beginStep`/`finishStep`, so cancellation and retry see it.

### 5. The pipeline's URL assumptions

This is the half that is not about storage at all, and the half that will take the time.
`pdf-ingestion.md` already lists it and it is worth restating because it is easy to under-estimate
from the diagram:

- **`requireUrl` in [`src/pipeline.ts`](../../src/pipeline.ts) refuses to run without a URL**, and
  an uploaded article has none. `Meta.url` is already optional
  ([`src/types.ts`](../../src/types.ts)), so the type system will not fight this.
- **Neither `Job` nor `StepContext` has a source type.** An uploaded article gets
  `source: { kind: "upload", filename, sha256 }`.
- **The `fetch` step is not in an upload's step list at all.** There is nothing to fetch; the bytes
  are already ours. The step that replaces it writes `raw.json` and `raw.pdf` from the blob store,
  so that from `extract` onwards *nothing changes* — the manifest is the seam, and it already
  exists.
- **"Refresh from source" means nothing for an upload.** The button should say so rather than fail.
  A re-run of the later stages is still meaningful; a re-fetch is not.
- **The slug cycle.** Already decided in `pdf-ingestion.md` and carried here unchanged: store under
  a provisional upload id, run pass 0, reserve the final slug atomically through the same collision
  rule `freeSlug` uses, and **never rename on a later re-read**. `freeSlug` is currently private and
  URL-only, so it needs opening up.
  **Corrected 2026-08-26:** `freeSlug` is already exported, and the problem is worse than
  "open it up" — it is keyed on `urlKey(url)` throughout, and [`src/jobs.ts:583`](../../src/jobs.ts)
  reads `request.url ? await freeSlug(...) : request.slug`, so a URL-less request **skips collision
  handling altogether**. Two uploads called `paper.pdf` would land on one slug, which is the
  opposite of what the test in this plan asserts.

### 6. The file picker

A drop zone and a "choose a file" button beside the URL field in
[`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx), and a progress bar on
[`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) — a real one, since a 50 MB upload on a domestic
connection is tens of seconds and `XMLHttpRequest`'s `upload.onprogress` is the only way to know
how it is going (`fetch` still cannot report upload progress).

`/add/<url>` cannot carry a file, so an upload starts on the shelf and the add page picks it up by
`uploadId`: `/add/upload/<uploadId>`. That keeps the property Greg asked for — one place that starts
an ingest, and it has an address you can reload.

## What we are deliberately not doing in v1

- **Resumable (TUS) uploads.** Supabase recommends them over ~6 MB and our 11.5 MB fixture is over
  that line, so this is a real gap rather than a tidy one. But it needs `tus-js-client`, a 6 MB
  chunking discipline, and a second upload path to keep working; a plain `PUT` of 50 MB over a
  working connection is fine, and the failure mode is "it failed, try again" rather than corruption.
  **Named here so it is a decision rather than an oversight**, and it is the first thing to add if
  uploads turn out to fail in practice.
- **Anything over 50 MB.** The free plan will not allow it, so it is a billing decision first.
- **Uploading anything that is not a PDF.** EPUB and DOCX are the obvious next ones and neither has
  an extractor.
- **Cleaning up abandoned objects.** A token minted and never used costs nothing; an object uploaded
  whose job never ran is a few megabytes of litter. A sweep of objects with no article after N days
  is a follow-on, and should be written down before it is forgotten.

## Tests

What is deterministic gets one; the model call does not
([testing.md](../project/testing.md)).

- **The path is ours, not theirs.** A `POST /api/jobs` naming an `uploadId` that belongs to another
  owner, or a made-up one, is refused — and the test asserts the *key* we look up rather than the
  status code, so it cannot pass by refusing for the wrong reason.
- **The magic-byte check.** A file of the right size and the right claimed type whose first bytes
  are not `%PDF-` is refused before any extraction.
- **The checksum check.** Bytes that do not match the claimed `sha256` are refused. Deliberately
  tested with a *same-length* substitution, since a length check would otherwise catch it and the
  test would pass while the hash comparison was broken.
- **The cap.** Over-cap is refused at `POST /api/uploads`, before a token is minted — not only at
  the bucket.
- **The seam, both ways.** The same suite runs against the filesystem adapter and, when a local
  Supabase is up, against the real one. Round-trip a byte sequence including a NUL and a lone
  `0xFF` — a store that quietly decodes as UTF-8 corrupts a PDF and returns success.
- **The filesystem adapter cannot pretend.** Its `signUpload` must not return a URL that would take
  a 50 MB body through our server on a serverless host — asserted, because this is the one shortcut
  that would make everything look fine locally and break only in production.
- **An upload job has no `fetch` step**, and `requireUrl` is never reached for one.
- **Slug collisions.** Two uploads both named `paper.pdf` get two articles, not one directory.
- **`GET /api/source/:slug` works for an uploaded PDF**, not only a fetched one.

An end-to-end check by hand, in a browser, with the 11.5 MB fixture — the one that proves the
4.5 MB limit is genuinely bypassed rather than merely thought about.

## Build order

> **Superseded 2026-08-26** by
> [Build order, revised after the review](#build-order-revised-after-the-review). Kept because the
> reasoning in the steps below is still good; the *order* and the scope of step 4 were both wrong.

1. The bucket in `config.toml`, and `npm run db:reset` proving it appears. Cheapest possible start,
   and it makes the rest testable.
2. `src/store/blobs.ts` with both adapters, and its tests. No routes yet.
3. `POST /api/uploads` and the verification half of `POST /api/jobs`. Testable with `curl` and no UI.
4. The pipeline's URL assumptions — `source` on `Job` and `StepContext`, the upload step list,
   `requireUrl`, `freeSlug`. **This is the big one**, and doing it after 1–3 means it is the only
   thing in flight when it lands.
5. The file picker and the progress bar.
6. The 11.5 MB fixture end to end, in a browser.
7. Docs: [ingest-queue.md](../project/ingest-queue.md), [database.md](../project/database.md),
   [supabase-local.md](../project/supabase-local.md), [deployment.md](../project/deployment.md)
   (the remote bucket step), [security.md](../project/security.md) (a third untrusted party — a
   file off a reader's disk), and a signpost line in `AGENTS.md` if a project doc is added.

## Open questions for Greg

1. **Where do the bytes finally live?** The one thing `pdf-ingestion.md` left open and marked
   "question for Greg": *"The first draft said both 'Storage object' and `raw_bytes`. Pick one."*
   Greg's answer on 2026-08-26 was to **get a v1 working now** and write down separately what would
   be best eventually — which is [the appendix](#appendix-where-the-bytes-should-eventually-live).
2. **Does an upload need a signed-in reader before the beta gate lands?** The object key is
   `<owner>/<uploadId>.pdf` and there is one owner today ([auth.md](../project/auth.md)). If that
   holds, "ownership" is trivially satisfied and the check is still worth writing, because the day
   it stops being trivial is the day it matters.
3. **Resumable uploads — wait, or not?** Recommendation: wait, and see whether a real 11.5 MB
   upload over a real connection actually fails.

## Appendix: where the bytes should eventually live

*This is the "what would be best eventually" half of Greg's answer, kept separate from v1 on
purpose so that building the v1 does not quietly decide it.*

**The problem.** Two plans currently disagree, and neither is wrong on its own terms.
[postgres-migration.md](postgres-migration.md)'s schema — and
[`src/db/schema.ts`](../../src/db/schema.ts) as built — puts the fetched bytes in a `raw_bytes`
`bytea` column on `article_revisions`. `pdf-ingestion.md` says an uploaded PDF's bytes live in a
Storage object. Do both and there are two answers to "what is this article made from", with nothing
keeping them in step — which is the failure this repo keeps writing up.

**What consistency actually requires.** The thing worth protecting is not that every byte lives in
the same technology; it is that **there is exactly one authority per revision, and the row says
which**. A URL fetch and an upload should not be two storage designs. So:

> The revision row holds an **object key and a checksum**, never the bytes. Every raw document —
> fetched or uploaded, HTML or PDF — is an object in the `sources` bucket. `raw_bytes` stops being
> written and is eventually dropped.

Why that way round rather than copying uploads into `bytea`:

- **`postgres-storage-implementation.md` already flags the cost**: `raw_bytes` at the fetch ceiling
  is 32 MiB in a row, with the TOAST and backup-size consequences that implies. A 50 MB PDF makes
  that concrete. Every backup, every replica, every `pg_dump` carries it.
- **A row you must not `SELECT *` from is a trap.** One careless query drags 50 MB per article
  across the wire, and nothing in the type system says so.
- **`GET /api/source/:slug` gets cheaper and better**: redirect to a short-lived signed URL and the
  bytes never touch our function at all — the same asymmetry that makes the upload work, applied to
  the download.
- **It keeps one code path.** The fetch step would `put` into the blob store exactly as the upload
  step does, and `raw.json` — which already exists and already names the file — becomes the record
  that points at the object. The manifest was built for precisely this
  ([fetching.md](../project/fetching.md)).

**What it costs, honestly.** Postgres gives transactional writes and object storage does not, so
"revision row written, object missing" becomes possible where today it is not. The mitigation is
the one the artefact store already uses: write the object first, then the row, and treat a row whose
object is absent as *not done* rather than as an error. There is also a real operational cost —
two systems to back up instead of one, and an orphan sweep to write.

**A defensible smaller alternative**, if the above is too much: keep `raw_bytes` for HTML (which is
kilobytes and genuinely benefits from being transactional) and use Storage for PDFs only, with a
`raw_object_key` column and a `CHECK` that exactly one of the two is non-null. That is honest — the
row still says which is authoritative — and it is less work. It is worse in one specific way: two
paths, and the seldom-used one rots.

**Recommendation: the single-authority version, as a follow-on to v1, not part of it.** v1 should
therefore be built so that it does not stand in the way — the blob store seam is what makes it a
follow-on rather than a rewrite, which is why `pdf-ingestion.md` was right to insist on the seam
before the feature.

### The cross-family review: what Sol said, and what changed

**Ran 2026-08-26** (GPT-5.6 Sol, high effort, read-only), after two earlier attempts died on billing
rather than on anything about the plan. The full answer is in
[pdf-upload-storage-review-sol.md](pdf-upload-storage-review-sol.md). Every code reference below was
checked against this repo before being acted on, as [AGENTS.md](../../AGENTS.md) requires — two of
Sol's findings corrected *this file*, and two of its security worries turned out to be already
handled, which is worth as much as the findings.

**On the bytes question it agrees with the appendix and then goes further.** One authority per
revision is right; an object key sitting directly on the revision row is not enough. Sol wants a
`raw_sources` table — owner, immutable key, **server-computed** SHA-256, length, kind, content type,
encoding — with `article_revisions.raw_source_id` pointing at it, and short-lived `uploads` rows
owning the pre-verification state. The argument is good: the same source survives retries and
revisions without copying bytes or metadata, and deletion and integrity checks get one place to
work from. Its third option, **content-addressing the canonical key by the actual SHA-256**, makes
conditional writes idempotent for free and stops revision retention multiplying blobs.

It also kills my "write the object, then the row" mitigation as *necessary but not sufficient*, and
it is right. That sequence handles the happy path and not: object written and row failed; row
committed and object later removed (**data loss for an upload, since unlike a URL it cannot be
re-acquired**); a `HEAD` returning 503 being read as absent; a re-run minting a new key and leaking
an object per attempt.

**Four findings I checked and confirmed, that change the build rather than the prose:**

1. **The 100-page cap fires far too late, and this feature is what makes that reachable.**
   `readPdf` checks `pass.pages.length > MAX_PAGES` only *after* `pass0` returns
   ([`src/pdf-read.ts:590`](../../src/pdf-read.ts)), and `pass0` has by then opened the document and
   walked **every page and every text item into memory**
   ([`src/pdf.ts:222-265`](../../src/pdf.ts)). A small, valid, ten-thousand-page PDF defeats the cap
   before it fires, and there is no parser timeout or memory bound behind it. This is pre-existing
   and today unreachable-ish, because the only way in is a URL we fetched. **An upload hands a
   stranger the parser directly.** The check belongs immediately after `getDocument`, on
   `doc.numPages`, before any page loop — and that is a prerequisite of shipping uploads, not a
   follow-on.
2. **There is no pipeline step that produces `raw` for an upload.** My "write `raw.json` + `raw.pdf`
   from the blob store" floats outside the step list, which means it bypasses `beginStep`,
   `finishStep`, cancellation, retry and `assertProduced` — the exact machinery built to make
   interrupted work visible. It has to be a real step. Sol's name for it, a common **acquisition**
   step with one `raw` output contract that both fetch and upload satisfy, is better than two.
3. **`sameWork` and slug allocation have no upload identity.** `sameWork` compares steps, guidance
   and profile only ([`src/jobs.ts:700-718`](../../src/jobs.ts)), and `freeSlug` is keyed on the URL
   and skipped entirely without one — see the correction in
   [§ 5](#5-the-pipelines-url-assumptions) above.
4. **The verification story contradicts itself.** This plan says `POST /api/jobs` verifies before
   enqueue and then says the byte-dependent checks happen in the worker. Those are two different
   API contracts. Sol's fix is to say it honestly: the request checks ownership, upload state and
   cheap metadata, and enqueues a job whose **first step is `verify-source`**, with no article, slug
   or ingest existing until it passes.

**Two worries I measured and can close.** Sol flagged that a grant might be replayable or coaxed
into upserting. Measured against the running stack: a hostile `x-upsert: true` header is ignored,
and a mint asking for `{"upsert":true}` comes back with `upsert:false` — but **a grant is replayable
once its object is deleted**, which is real and now has its own rule in
[§ What was measured](#what-was-measured-not-read).

**And one correction to Sol.** It says the interface "conflates missing with every other `head`
failure" — true of my sketch, and the fix is the one
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts) already uses, distinguishing absence
from operational failure. Worth naming because we do not have to invent it.

**What this does to the build order.** Sol's central process point is that routes cannot be built
before the invariant is settled, and I accept it: the source/upload model and the acquisition-step
contract come first, then the bucket, then the routes. The revised order is
[below](#build-order-revised-after-the-review). Step 4 was also badly under-scoped — it is not
`requireUrl` and `freeSlug`, it is `RawManifest`, `FetchedDocument`, `Job`, `EnqueueRequest`, retry,
`sameWork`, slug reservation, step stamps, source serving, import/export and their tests.

**What I am not taking.** Sol wants HTML moved into Storage too, on the grounds that the 32 MiB
fetch ceiling means "HTML is kilobytes" is not an invariant. That is correct and it is still a
follow-on: it is a migration of every existing article, and nothing about uploading a PDF is blocked
by it. It belongs in the appendix's eventual design, which is where it now is, and not in v1.

### Build order, revised after the review

0. **The source model on paper** — discriminated `SourceOrigin` (url | upload) and `RawDocument`
   (html | pdf), the `uploads` state machine, and the acquisition step's `raw` contract. Sol is
   right that `Meta.source` already means *"pdf"* and must not be overloaded to mean *"upload"*.
1. **The `numPages` cap moved before the page loop**, with a test that a many-page file is refused
   without being walked. Independently valuable, and a prerequisite.
2. The bucket in `config.toml`, and `npm run db:reset` proving it appears.
3. The source/upload store and its state machine, with both adapters and their tests. No routes.
4. `POST /api/uploads`, and `POST /api/jobs` enqueuing a job whose first step is `verify-source`.
5. The pipeline's URL assumptions — **the big one**, scoped as above.
6. The file picker and the progress bar.
7. The 11.5 MB fixture end to end, in a browser, plus the failure cases Sol lists — double and
   concurrent finalisation, cancellation mid-download, object missing, Storage 5xx, expired upload,
   a tiny PDF with a huge page count.
8. Docs.

### Greg's answers, 2026-08-26

> Assuming it's the same user. If it was previously uploaded by a different user, then reuse the
> source object, but add a new per-user article object.
>
> I was going to say that we keep forever, especially given my previous answer that we reuse
> sources across articles.
>
> — Greg, 2026-08-26, on duplicates, retention, and the beta gate (he chose *deploy it, accept the
> risk for now* on the third)

**Sources are shared; articles are not.** One content-addressed `raw_sources` row per distinct
SHA-256, referenced by any number of articles across any number of readers. An upload of bytes we
already hold does not re-upload and does not re-store — it makes a new per-reader article pointing
at the existing source. This is Sol's third option, and Greg extended it across readers as well as
across revisions.

**Kept forever.** A source is never deleted while anything references it, and retention is per
*source* rather than per revision, so every historical revision stays reproducible at no extra
storage cost — which is the property content-addressing buys and the reason "forever" is affordable
here. The sweep therefore has only one job left: **abandoned uploads** — a grant minted, maybe even
an object written, and no article ever made. It is not a general garbage collector.

**This makes the object key not owner-scoped, and that is a real change.** The plan above says the
key is `<owner>/<uploadId>.pdf`. It cannot be, if two readers share one object. The key becomes the
content hash, ownership moves onto the `raw_sources` reference rows, and **the RLS story moves with
it** — the bucket stays private and every read goes through us or through a signed URL we issue
after checking that *this* reader has an article referencing *that* source. Nothing about that is
hard, but it is not the design the section above describes, and it must not be half-changed.

#### The one cost of sharing across readers, stated plainly

Cross-reader deduplication leaks *existence*. If B uploads bytes that A already uploaded, the system
now behaves differently — it is instantly ready, having transferred nothing — and that difference is
observable. So a reader who **already holds a file** can learn whether **somebody else** has
uploaded that exact file. This is the well-known cloud-storage dedup side channel, and it is why
Dropbox stopped deduplicating across accounts.

It does not leak content, and it cannot be used to *fetch* anything: the reference rows decide what
you may read, and a hash is not a grant. The realistic worry is narrow — a document whose mere
presence is sensitive, guessed by someone who already has a copy of it.

**Not a blocker, and Greg's call stands.** With one reader today
([auth.md](../project/auth.md)) it is empty of consequence. Two cheap ways to close it later, either
of which can be added without a migration: dedupe only *within* a reader (keep the hash key, scope
the reference check to the owner, and let a second reader re-upload their own copy), or always
transfer the bytes and dedupe server-side after receipt, which removes the observable difference at
the cost of the bandwidth saving. **Recommendation: build the shared-source schema as asked, and
make the dedup decision a policy flag rather than a shape**, so closing it later is a condition and
not a migration.

#### Deploying before the gate

Greg chose to deploy with the endpoint open rather than wait for
[auth.md](../project/auth.md)'s beta gate, knowing that this is an open storage quota and an open
model-spend budget for anyone who finds the URL — and
[deployment.md](../project/deployment.md) records that two `.vercel.app` addresses exist and only
one was deleted. Recorded as a decision, not an oversight.

What partially bounds it, and should therefore actually be built rather than assumed: the 50 MB
object cap, the bucket's own size and MIME limits, and — the one that bounds *spend* rather than
storage — the page cap, **once it is moved to where it fires before the parse**. That is
[step 1](#build-order-revised-after-the-review), and this decision is a second reason for it.

Still open, and smaller than the three above: **if the same reader uploads the same PDF twice**,
Greg specified the cross-reader case and not this one. Taking his verb literally — *"add a new
per-user article object"* — it makes a second article sharing the one source. That is the
consistent reading and costs nothing to change, since offering "you already have this" is a UI
addition on top rather than a different schema.

### Questions Sol says this plan should be asking, and isn't

Sol raised twelve; these are the ones that change what gets built, and they are
**for Greg** alongside the three already [above](#open-questions-for-greg):

4. **Same PDF uploaded twice** — one article, two articles sharing one source object, or two of
   everything? Content-addressing makes "share the object" nearly free, but the product answer
   comes first.
5. **Must the beta gate land before upload-token minting is deployed?**
   [security.md](../project/security.md) records that the API is neither authenticated nor
   rate-limited. Minting grants and spending model money from an open endpoint is an open storage
   quota and an open wallet, and this feature is what makes that concrete.
6. **Retention** — are raw sources kept for every historical revision, or only the current one? And
   what does permanent deletion mean next to archive, which today is only `articles.archived_at`?
7. **The recovery promise** — once bytes are objects, a Postgres dump is no longer a whole backup.
   Database-only restore, or coordinated restore, and what data-loss window is acceptable?

## See also

- [pdf-upload-storage-review-sol.md](pdf-upload-storage-review-sol.md) — the cross-family review in
  full, and [pdf-upload-storage-review-prompt.md](pdf-upload-storage-review-prompt.md), the prompt
- [pdf-ingestion.md](pdf-ingestion.md) — the plan this is step 7 of; § Upload is its short form
- [../project/ingest-queue.md](../project/ingest-queue.md) — the queue an upload job joins
- [../project/fetching.md](../project/fetching.md) — `raw.json`, the manifest that makes the
  upload step and the fetch step interchangeable downstream
- [../project/supabase-local.md](../project/supabase-local.md) — the local stack the bucket lands in
- [../project/database.md](../project/database.md) — where article data lives
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — the `raw_bytes` cost
  note the appendix builds on
- [../project/deployment.md](../project/deployment.md) — the Vercel constraints, and the remote
  bucket step
- [../project/security.md](../project/security.md) — the untrusted parties; a reader's own file is
  a new one
- [../reusable/silent-success.md](../reusable/silent-success.md) — the shape of a filesystem
  adapter that pretends it can sign an upload
