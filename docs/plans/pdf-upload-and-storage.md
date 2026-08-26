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
| `@supabase/supabase-js` or `@supabase/storage-js` | **not installed** |
| Any `put`/`get` blob seam | **does not exist** — nothing in `src/store/` |
| A file picker, `/api/upload`, multipart, `FormData` | **none** — no such string anywhere in `src/` |
| `GET /api/source/:slug` serving a stored PDF | **built**, [`src/routes.ts`](../../src/routes.ts) `sendSource` — reusable unchanged |
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
- `@supabase/storage-js` is the Storage-only package, and is what `supabase-js`'s `.storage`
  wraps. We need no auth, realtime or PostgREST client, so it is the smaller correct dependency.

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

Steps 3 and 4 need the bytes, so they happen in the worker rather than in the request if the object
is large — but they happen **before extraction**, which is the expensive irreversible part.

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

### The cross-family review has not happened, and that is not a formality

**Attempted twice on 2026-08-26 and blocked by billing, not by anything about the plan.** Both
credentials are dry: `CODEX_API_KEY` returns *"You have no credits remaining"*, and the logged-in
ChatGPT subscription returns *"Your workspace is out of credits"*. The second attempt read about
279,000 tokens of this repo, compacted its context, and then hit the wall before writing a word —
**exiting 0 with no answer file**, which is exactly the failure
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) warns is indistinguishable from a
review that found nothing.

So **the recommendation above is one model family's opinion, unreviewed**, and
[AGENTS.md](../../AGENTS.md)'s rule — every plan goes to GPT Sol before it is built — is not yet
satisfied for this file. Treat the appendix as a proposal, not a decision, and do not start step 4
of the build order on the strength of it.

The prompt is saved at
[pdf-upload-storage-review-prompt.md](pdf-upload-storage-review-prompt.md), which carries the exact
command; re-running it is one command once either account has credit. It
asks Sol to answer the bytes question first and at length — including the transactionality
argument, whether HTML should move to objects too, what the move breaks in `has`/`sameStamp`,
export/import and `tests/store-artefact-manifest.test.ts`, and the orphan lifecycle — and then to
attack the upload flow's security, the worker-side verification split, the seam's shape, and the
build order's step 4.

*Sol's verdict, and what changed as a result, belongs directly below.*

## See also

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
