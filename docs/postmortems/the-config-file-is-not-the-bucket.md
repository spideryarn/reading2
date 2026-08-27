# The config file is not the bucket, and the measurement never reached it

**Found 2026-08-28**, by running `npx tsx scripts/backfill-raw-manifests.ts --write` and watching it
die on the one HTML article:

```
Error: Storage put failed (415): mime type text/html is not supported
    at fail (src/store/blobs-supabase.ts:93:10)
    at Object.putIfAbsent (src/store/blobs-supabase.ts:153:13)
    at storeRawSource (src/store/blobs.ts:321:17)
```

Two things had to be true at once for that error, and each is worth its own paragraph. The `sources`
bucket in the running container still said `{application/pdf}` a day after
[`supabase/config.toml`](../../supabase/config.toml) was edited to add `text/html`. And the comment
sitting directly above that edit — saying, as a *measurement*, that the allowlist does not stop a
service-role upload — was false, and had been false when it was written.

They are the same mistake twice: **a declaration in a file was treated as the state of a running
system.** Once when the edit was made and never applied, and once when the check that would have
caught it was run against something other than the container.

## Root cause

`supabase/config.toml` is the only place the `sources` bucket is described, and *nothing in this
repo ever applies it to a bucket that already exists*. The CLI seeds buckets that are missing;
neither `supabase start` nor `supabase seed buckets` was run after the declaration changed, and no
process, test, deploy step or boot check compares the two. So the file and the bucket are free to
drift, silently and indefinitely, and on 2026-08-27 they did.

The second half is why nobody found out. On the same day the declaration changed,
[`writeRaw`](../../src/fetch.ts) started calling `storeRawSource` on **every** fetch, which made
every HTML fetch depend on that bucket setting for the first time — and the commit that did it also
recorded a measurement saying the setting could not possibly matter. The measurement was the reason
not to check the bucket.

### What the running container actually shows

`supabase_storage_spideryarn2` (storage-api v1.69.11) was created and started 2026-08-26T18:14:09Z
and has not been restarted since, so its request log covers the whole story. In 12,306 requests:

| Fact | Evidence |
|---|---|
| Only four `/bucket` requests, ever | `GET` 08-26 18:40:02, `POST` 18:40:49, `GET` 18:40:50 — all `user-agent: curl/8.7.1` — and one `GET` at 08-26 21:40:08 from `node`. **No `PUT`, no `PATCH`.** |
| The bucket was created by hand | The curl triple above is list-create-list, 20 minutes *before* the commit that declared it in `config.toml` — the same REST call [deployment.md](../project/deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too) documents for the remote |
| Only one bucket was ever addressed | Every `/object/…` URL is under `sources` |
| `text/html` was POSTed exactly twice, both on 08-27 | 21:54:14 → HTTP 400 carrying `{"statusCode":415,"errorCode":"InvalidMimeType","message":"mime type text/html is not supported"}`, `role: service_role`; and 21:55:43 → 200, after the bucket was changed |
| `image/png` and `application/x-nonsense` were **never POSTed at all** | zero occurrences of either string in the log |

The last row is the one that matters. The measurement written into
[`src/store/blobs-supabase.ts`](../../src/store/blobs-supabase.ts),
[`supabase/config.toml`](../../supabase/config.toml) and
[raw-bytes-in-storage.md](../plans/raw-bytes-in-storage.md) claims those three content types were
stored by a service-role `putIfAbsent` against a PDF-only bucket. **No such request ever reached
this Storage container.** And the one request of that shape that did reach it, tonight, was refused
in 0.98 ms with `role: service_role` in the log line — so Storage enforces the allowlist for the
service key, exactly as the repo's *earlier* probe had already found
([pdf-upload-and-storage.md](../plans/pdf-upload-and-storage.md): *"Is the bucket's MIME allowlist
enforced at upload? **Yes** — `text/plain` into a PDF-only bucket gives `415 InvalidMimeType`"*).
The right answer was already written down, in a plan file, and the new measurement overwrote it.

### Where the probe's bytes went

Inferred, not proven, but it fits everything: `blobStore()` in
[`src/store/blobs.ts`](../../src/store/blobs.ts) returns `fsBlobs()` unless **both** `SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` are in `process.env`, and a one-off `npx tsx` probe that does not
call `loadEnvLocal()` has neither. `fsBlobs.putIfAbsent` in
[`src/store/blobs-fs.ts`](../../src/store/blobs-fs.ts) does not validate `contentType` at all — it
writes the bytes and then writes the type string to a sidecar file. Three writes of three absurd
content types would "succeed" instantly and leave nothing behind but files under `data/_blobs/`.

`data/_blobs/sha256/` exists, is empty, and has an mtime of 2026-08-27 15:01 UTC — **three minutes
before** the commit that wrote the measurement down (`a63ea6e`, 18:04:48 +0300). Files were created
and cleaned up there, at that minute, while the container saw nothing.

This is the failure mode [deployment.md](../project/deployment.md) had already tabulated the day
before, in the row that says the quiet part out loud:

> | `blobStore()` | falls back to `fsBlobs()` | **No.** … Nothing logs, nothing throws, the write returns success |

and the one [health-check-green-while-uploads-dead.md](health-check-green-while-uploads-dead.md) is
about. The probe fell into a hole this repo had documented and written a postmortem for, on the
adjacent day.

## The commits

- **[`6c9bd11`](../../supabase/config.toml)**, "Name a document after its contents, and the replay
  stops mattering", 2026-08-26 22:00 +0300, declared `[storage.buckets.sources]` with
  `allowed_mime_types = ["application/pdf"]`. It carries a careful warning that declaring a bucket
  does not create it on a *remote* project. It does not say the same thing about a *local* bucket
  that already exists — which was already the case here, since the local bucket had been created by
  curl 20 minutes earlier. That is where the drift became possible.
- **[`a63ea6e`](../../src/fetch.ts)**, "Give a revision somewhere to say which object it was made
  from", 2026-08-27 18:04 +0300, is the introducing commit. It did three things in one change: added
  `text/html` to the declaration, moved the object write into `writeRaw` so **every** fetch stores to
  the blob store, and wrote the false measurement into two source files, the plan and its own commit
  message — *"Found only by checking the live container after changing config.toml."* The container's
  own log says it was not checked.

GPT Sol reviewed exactly this claim and did not believe it. From
[raw-bytes-in-storage-review-4-sol.md](../plans/raw-bytes-in-storage-review-4-sol.md), finding 7,
confidence 95%:

> your service-role measurement contradicts current upstream behavior too, so the exact deployed
> Storage version still needs testing

The review said the measurement disagreed with upstream's source and asked for it to be tested. It
was not tested, and the finding was closed by writing the belief down more carefully instead.

## Blast radius

`storeRawSource` is called with an HTML kind from exactly two places:

- **[`writeRaw`](../../src/fetch.ts), unconditionally, on every fetch** — and `writeRaw` is the sole
  writer of a raw document, called from pipeline stage 1
  ([`src/pipeline.ts`](../../src/pipeline.ts)) and from the `npm run fetch` CLI. So on any machine
  with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set and a bucket that has not been updated,
  **fetching any web page throws**, after the bytes and before `raw.json` is written. Stage 1 fails;
  the article does not ingest.
- **[`scripts/backfill-raw-manifests.ts`](../../scripts/backfill-raw-manifests.ts)**, for any
  manifest whose `kind` is `html` — which is how this was found.

PDF ingest was unaffected throughout, which is why the pipeline looked healthy: the container log
shows PDF uploads succeeding all day on 08-27 while HTML was broken.

**It went unnoticed for about seven hours because nobody fetched an HTML page in them.** The log
contains exactly one `text/html` POST between the change landing and the backfill, and it is the 415.

**Production could not have hit this, for two independent reasons**, and one of them is verified:

1. Ingest does not run on Vercel at all — stage 1 dies at `mkdir '/var/data'`, confirmed on the live
   site 2026-08-27 ([deployment.md](../project/deployment.md#what-does-not-work-in-production-yet)).
   Verified by reading that section, not by re-running it.
2. The remote `sources` bucket was created on 2026-08-27 by the curl command in
   [deployment.md](../project/deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too), whose
   body already includes `"allowed_mime_types":["application/pdf","text/html"]` — so the remote never
   had the PDF-only value to drift from. **I could not verify this against the live project**: a
   read-only `GET /storage/v1/bucket` with the production service key returned an object rather than
   a bucket list, and the retry was refused by the sandbox. The claim rests on the documented command
   alone. It is one command to check and worth checking.

Note the asymmetry this leaves: the remote bucket's settings and `config.toml` agree today **by
coincidence of ordering**, not because anything keeps them in step. The next edit to that block
drifts on the remote for the same reason it drifted here, and the remote has no `data/_blobs/`
fallback to hide it.

## The fix that is right for the long term

The one-line `update storage.buckets set allowed_mime_types = …` that unblocks the backfill fixes
**this laptop and no part of the class**. Every other machine, the remote project, and the next edit
to that block are all still exposed, and the repair leaves no trace: `storage.buckets.updated_at` is
not bumped by a plain `UPDATE`, so the row now reads `{application/pdf,text/html}` with
`updated_at` still equal to its 2026-08-26 `created_at`. Nothing in the database records that a human
changed it.

What removes the class is a **check that compares the declaration to the running bucket** and refuses
when they differ — the shape [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) already
uses and [`scripts/check-production-gate.sh`](../../scripts/check-production-gate.sh) already argues
for:

1. A pure function — `bucketDrift(declared, running)` — that takes the parsed `[storage.buckets.*]`
   blocks and the JSON from `GET /storage/v1/bucket`, and returns a list of differences: missing
   bucket, `public`, `file_size_limit`, `allowed_mime_types` as a set. Pure so it can be **seen to
   say yes** against a fixture, which is the whole reason `deploy-checks.ts` is separated from
   `deploy.ts`.
2. Called from three places, because there are three ways to be wrong: `scripts/deploy.ts` (the
   remote drifted), a laptop-facing check alongside `npm run db:check` (this bug), and a test that
   runs it against the local container when one is up and skips honestly when it is not.
3. And it should be the thing that *provisions* as well as compares, replacing the hand-written curl
   in [deployment.md](../project/deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too), so
   "declared" and "created" stop being two separate acts a person has to remember to pair.

The declaration is worth keeping honest even though our own uploads should never depend on it: the
allowlist is a real guard on the browser's signed-grant path, and a bucket that silently disagrees
with the file describing it is a security control nobody can read off the repo.

Separately, [security.md](../project/security.md) still says the bucket is "a PDF-only MIME
allowlist … A second line under our own checks". Half of that is now right again — Storage *does*
enforce it, for the service role, measured tonight — and half is stale, since the bucket permits
HTML. Sol asked for that paragraph to be fixed in the same review that flagged the measurement.

## What would have caught it

**A test that asserts the refusal, not the acceptance.** One integration test against the real
bucket — `putIfAbsent(key, bytes, "application/x-nonsense")` must be **rejected** — would have gone
red on 2026-08-27 the moment the probe's conclusion was written into the code, because it would have
been run through the same `blobStore()` seam the server uses instead of through an ad-hoc script. It
would also go red the day somebody widens the bucket by hand without widening the file.

**And the deeper one: a measurement written into a comment is a claim about a running system at a
moment, and nothing re-runs it.** This repo's rule is *"a check you have never seen fail is not
evidence"* ([silent-success.md](../reusable/silent-success.md)). This is its mirror image — a check
that was seen to pass once, converted into prose, and then trusted for a day while the thing it
described changed underneath. Three files and a commit message repeated the claim; none of them could
notice it going stale, because prose does not run. The probe even reasoned about silent success in
its own comment, and cited `config.toml` as the check that would agree with the bug — while making
the identical mistake one level down.

The natural check and the bug shared the same assumption, twice over:

| The check that was run | The assumption it shares with the bug |
|---|---|
| `config.toml` says `text/html` | that a declaration reaches the running bucket |
| the probe returned without throwing | that `blobStore()` reached Supabase |

The measurement that would have settled both is the same one either way: **ask the far side.**
`select id, allowed_mime_types from storage.buckets`, and `select name, metadata->>'mimetype' from
storage.objects` — or read the container's own request log, which had the answer the entire time.
