# Verdict: NO-SHIP

Both diagnosed layers are real, but the proposed plan does not yet form a working production path. Three structural problems remain:

1. Every ingest stage still bypasses `ArtifactStore`.
2. Finishing the job does not publish the article to the Postgres-backed shelf.
3. The existing blob seam is create-only and content-addressed; it cannot safely implement mutable, retryable artifact generations.

A blob-backed store could be made to work, but doing so correctly would duplicate much of the Postgres artefact work you are trying not to pre-empt.

## Findings, ranked

### Critical 1 — Selecting the blob store would make every current stage fail

All ten pipeline stages are explicitly marked as legacy filesystem writers in [pipeline.ts:342](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:342). They return only `detail`, not artifact `parts`.

Consequently:

- The stage writes local files.
- [session.ts:281](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:281) has nothing to send to the new store.
- `assertProduced` then looks for outputs in the blob store and fails.

The default ingest is now six stages, not five: fetch, extract, blocks, toc, assets, arc ([pipeline.ts:143](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:143)). The browser comments are stale.

Concrete action: do not wire the adapter at `jobs.ts:57` until every default stage returns its artifacts through `StepProduct`. The plan already says to recut if most writes bypass the seam; that condition has been met.

### Critical 2 — A green job still would not put the article on the production shelf

Production reading uses the Postgres article store ([live.ts:61](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/live.ts:61), [index.ts:186](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/index.ts:186)). Job completion only settles the job and logs success ([jobs.ts:567](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:567), [jobs.ts:948](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:948)). It never imports or publishes an article revision.

Today, publication is a separate filesystem-reading CLI path in [import.ts:350](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:350). The unfinished Postgres adapter explicitly says it is intended to replace that importer ([artifacts-pg.ts:1](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:1)).

This is the most dangerous quiet-success case: the job can say “done” while the shelf remains unchanged.

Concrete action: define the final durable publication step before implementation. It must transactionally create/publish the owned article revision and move the current-revision pointer. A blob-only pipeline is incomplete without that bridge.

### Critical 3 — `RawSourceStore` has the wrong semantics for artifacts

The existing blob seam is intentionally content-addressed and create-only: `putIfAbsent` and canonical hash keys ([blobs.ts:58](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:58), [blobs.ts:390](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:390)).

`ArtifactStore` needs different properties:

- Forced reruns and replacement.
- Multi-output step generations.
- Attempt-owned interruption markers.
- Protection from a timed-out worker finishing after a retry has started.
- Visibility of a complete generation rather than isolated object arrival.

The artifact `write` method does not even receive the job attempt ([artifacts.ts:783](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:783)). Fixed mutable blob keys would allow an expired claimant to overwrite a newer attempt.

There are two additional incompatibilities:

- The configured `sources` bucket allows PDF, HTML and images, but not JSON ([supabase/config.toml:162](/Users/greg/Dropbox/dev/experim/spideryarn2/supabase/config.toml:162)).
- Blob selection silently falls back to filesystem storage when credentials are incomplete ([blobs.ts:251](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:251)). Production artifacts must fail closed.

Concrete action: if blobs remain the choice, introduce a separate private artifacts bucket and a new artifact-object contract. Use immutable generation keys, keyed by article/revision and attempt—not only slug—and publish a completion manifest last. The generation pointer still needs job-attempt fencing, preferably in the same Postgres transaction as job/revision publication.

That is already approaching the shape of `artifacts-pg`.

### High — The `/var/data` derivation is right, but stage 1’s proposed fix is not

For `/var/task/api-dist/vercel.js`:

```text
import.meta.dirname       = /var/task/api-dist
one ".."                  = /var/task
two ".."                  = /var
data                      = /var/data
```

So the diagnosis of [artifacts-fs.ts:55](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:55) is correct. The first failure is probably the step marker created before fetch, at [session.ts:279](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:279) and [artifacts-fs.ts:553](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:553).

The apparent disagreement with `pipeline.ts` is narrower than stated: `pipeline.ts` has a one-up root, but its actual stage paths delegate to `fsLocations` ([pipeline.ts:765](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:765)), so they also resolve under `/var/data`.

Changing two levels to one would produce `/var/task/data`, which is still unusable because Vercel’s deployed filesystem is read-only except for ephemeral `/tmp`. See [Vercel runtimes](https://vercel.com/docs/functions/runtimes).

Concrete action: inject an explicit filesystem root. Use the repository root locally and invocation-scoped `/tmp` on Vercel. Do not derive production writable storage from a bundled module’s location. Test exact roots, not merely “is not `/var`.”

## Filesystem bypass inventory

| Area | Direct filesystem behaviour | Empty invocation |
|---|---|---|
| Slug/preflight | `articleExists` and `urlForSlug` read `data/<slug>/meta.json` ([pipeline.ts:728](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:728)) | **Quiet:** all errors become “not found.” Can reuse a shelf slug or treat an old artifact generation as the new article. |
| URL fetch | Writes `raw.html`/`raw.pdf` and `raw.json` ([fetch.ts:174](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:174)) | Writes fail loudly on read-only disk. Canonical raw source blob survives if using `/tmp`. |
| PDF upload acquisition | Writes `raw.pdf` and `raw.json` after blob promotion ([pipeline.ts:858](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:858)) | Same. |
| Raw manifest | `readRaw` catches every failure and returns `null` ([fetch.ts:235](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:235)) | **Quiet fallback**, although a later payload read usually fails loudly. |
| HTML extraction | Writes `output/<slug>.html` and `meta.json` ([extract.ts:297](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:297)) | Write is loud; next invocation loses both. |
| PDF extraction | Reads/writes the pdf-chunks cache and writes HTML/meta ([pdf-read.ts:747](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:747), [pdf-read.ts:976](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:976)) | Cache miss/corruption is **quiet** and rebuying model work; final writes are loud. |
| PDF keep-original | Missing `raw.json` is caught and reconstructed ([pdf-read.ts:1049](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1049)) | **Quiet**, repeated work. |
| Blocks | Reads HTML and writes stamped HTML plus blocks ([blocks.ts:1466](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1466)) | Missing input is loud. `previousBlocksInFile` is CLI-only; production uses the store-backed source. |
| ToC | Reads blocks; writes labels, updated blocks and tree ([toc.ts:659](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:659), [toc.ts:826](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:826)) | Inputs are loud. Missing label checkpoints are **quiet** and repeat model work. |
| Assets | Blocks input uses the store, but the manifest is written directly ([collect-assets.ts:511](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:511)) | Output write is loud. Asset bytes already use blob storage. |
| Arc | Directly reads blocks/tree/meta and writes arc ([arc.ts:349](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:349)) | Blocks/tree are loud. Missing meta is **quiet** and changes the prompt/result. |
| Publication | No Postgres publication occurs | **Quiet successful no-op from the reader’s perspective.** |

`output/<slug>.html` is not expendable output: extract produces it and blocks consumes it in the next invocation.

## Latency

A sensible blob implementation is probably tolerable beside the model calls, but a naïve adapter will be unnecessarily slow.

`stepIsDone`, stamps, input loading and `assertProduced` repeatedly load the same artifacts. Some checks parse the same blocks/HTML twice before the stage even starts. With remote objects, this becomes dozens of sequential GETs across six requests.

Add invocation-scoped memoization keyed by `(article/revision, step, kind, generation)`, invalidate on write, coalesce identical reads, and parallelize independent transfers with a small concurrency bound.

The 4.5 MB Vercel body limit does not apply to Vercel-to-Supabase transfers; it matters only if artifacts are routed through the browser or `/advance` response. See [Vercel function limits](https://vercel.com/docs/functions/limitations).

Individual artifact limits fit under the current 50 MiB bucket ceiling, but JSON MIME currently does not. Supabase recommends resumable/S3 uploads above roughly 6 MB, and Storage can return `429`/`SlowDown`; use bounded retries and verify ambiguous writes. [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes).

## Atomicity and concurrency

No current consumer requires two filesystem renames to occur simultaneously. `has` requires the complete expected kind set, and the interruption marker provides a completion boundary.

A network store does, however, need generation-level visibility:

- Extract: HTML + meta.
- Blocks: blocks + stamped HTML.
- ToC: tree + labels + updated blocks.

Upload immutable objects first and make the generation visible by publishing one manifest last. Store extracted and stamped HTML under distinct semantic keys even though the filesystem adapter maps both to one path. Likewise, preserve the two step-specific block products.

The browser advance loop itself is protected by the job claim. Blob writes are not. A timed-out invocation can ignore abort, outlive its lease, and overwrite a retry. The intended Postgres publication path explicitly fences by attempt ([pg-revisions.ts:1151](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1151)); the blob proposal needs equivalent fencing.

## Stage boundaries

Stage 2 is unit-testable by itself, but only while the adapter remains unwired. It needs contract tests for absence versus outage, forced reruns, partial multi-output writes, stale writers, interrupted attempts, size validation, strict configuration and JSON bucket policy.

Stage 3 contains nearly all the actual risk and is too large. Recut around working vertical slices:

1. Exact local/Vercel scratch-root handling plus an inactive durable backend.
2. Fetch and extract through the store.
3. Blocks, including stamped HTML and stable-ID preservation.
4. ToC plus its resumable label checkpoint.
5. Assets, arc, and final fenced Postgres publication.
6. Wire production selection and smoke-test.

The production smoke test must prove more than a green job: a newly owned shelf row exists, the article opens, blocks are non-empty, the tree covers them, the PDF remains downloadable, a retry cannot publish stale output, and two imports cannot collide on a slug.

## Recommended direction

Coordinate with the existing Postgres artefact work and accelerate the smallest end-to-end slice: convert the six default stages to `StepProduct`, store them through the transactional session, fence by job attempt, and publish the revision after the final required step.

If Postgres work is absolutely unavailable, the blob bridge needs the separate bucket, immutable generations, fencing, `/tmp` materialization and a final Postgres importer. That is not the small third adapter currently described, and much of it will later be discarded.

