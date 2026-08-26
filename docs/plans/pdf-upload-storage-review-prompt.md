# Review prompt: PDF upload and the object store

Written 2026-08-26 for [pdf-upload-and-storage.md](pdf-upload-and-storage.md), and **not yet
answered** — both Codex credentials were out of credits on the day (the API key and the ChatGPT
workspace both). Kept here rather than in a scratch directory so the review is one command rather
than a rewrite:

```
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file docs/plans/pdf-upload-storage-review-prompt.md \
  --output docs/plans/pdf-upload-storage-review-sol.md
```

**Check the answer file actually has something in it.** The second attempt exited 0 having written
nothing at all — see [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md).

---

You are reviewing a **plan**, before any code is written, for the Spideryarn project
(repo root is the working directory). Read-only. Be specific and adversarial.

# The plan under review

`docs/plans/pdf-upload-and-storage.md` — read it in full first.

It is step 7 of `docs/plans/pdf-ingestion.md` (see its "### Upload" section and "## Build order").
Read those two sections of `pdf-ingestion.md` too, and `docs/plans/postgres-migration.md`'s schema
section plus `docs/plans/postgres-storage-implementation.md` where it discusses `raw_bytes`.

Relevant code to read (do not change anything):
- `src/fetch.ts` — `FetchedDocument`, `RawManifest`, `writeRaw`, `readRaw`
- `src/pipeline.ts` — the `fetch` and `extract` steps, `requireUrl`, `StepContext`
- `src/jobs.ts` — `EnqueueRequest`, `enqueue`, `freeSlug`
- `src/routes.ts` — `readBody`/`MAX_BODY_BYTES`, `sendSource`, the route table in the header comment
- `src/store/artifacts.ts` and `src/store/artifacts-fs.ts` — the seam this new one is modelled on
- `src/store/index.ts`, `src/store/live.ts` — how `SPIDERYARN_STORE` selects an adapter
- `src/db/schema.ts` — `rawBytes` and the revision columns
- `supabase/config.toml` — the storage section
- `docs/project/security.md`, `docs/reusable/silent-success.md`

# THE PRIORITY QUESTION — answer this one first and at length

Greg (the project owner) was asked where the raw bytes of a document should live once a document
can arrive either by URL fetch or by upload from disk. His answer was: *"We want things to be
consistent. Get input from GPT Sol. Let's get a v1 working for now, and add an appendix to the plan
doc with what we think would be best eventually."*

The tension is real and currently unresolved across two plans:
- `src/db/schema.ts` (built) has `raw_bytes bytea` on `article_revisions` — the fetched bytes in
  the database row.
- `docs/plans/pdf-ingestion.md` says an uploaded PDF's bytes live in a Supabase Storage object,
  and explicitly says "Pick one: either the revision row stores an object key plus checksum, or
  the worker copies the object into `bytea` and deletes it. Not both."

The plan's **Appendix** recommends: one authority per revision — the row holds an object key and a
checksum, never bytes; **every** raw document (fetched or uploaded, HTML or PDF) becomes an object
in the bucket; `raw_bytes` stops being written and is eventually dropped. It also sketches a smaller
alternative (bytea for HTML, Storage for PDFs, with a CHECK that exactly one is non-null).

I want your independent judgement on this, specifically:

1. Is the recommendation right? If not, what is, and why?
2. **The transactionality argument.** Moving bytes out of Postgres loses atomic write with the
   revision row. The plan's mitigation is "write the object first, then the row; treat a row whose
   object is absent as not-done." Is that sufficient? What does it get wrong? What failure
   sequences does it not cover — including a re-run, a cancelled job, and two jobs on the same
   article at once?
3. **Is "every raw document, including HTML" actually right**, or is the smaller alternative
   (bytea for HTML, objects for PDFs) the better engineering call despite being two paths? Argue
   both sides and then commit.
4. What does moving to objects break that the plan has not noticed? Consider specifically: the
   `has`/`sameStamp` freshness model in `src/store/artifacts.ts`, the export/import round-trip in
   `src/store/export.ts` and `src/store/import.ts`, and `tests/store-artefact-manifest.test.ts`
   which asserts every artefact has a home.
5. **Orphans and deletion.** Archiving/deleting an article today is a row change. With objects,
   what is the correct lifecycle, and what is the cheapest correct implementation?
6. Is there a third option neither plan has considered?

# THE REST OF THE REVIEW

Then review the plan generally. I care most about findings of the form "this will report success
while being wrong" — the project has a whole doc about that failure mode.

Please specifically stress:

a. **The security section.** The upload flow is: browser asks our API for a signed upload token →
   uploads straight to Supabase Storage with no credentials → tells our API the upload id → our API
   verifies and queues. Attack it. What can a malicious or careless client do? Is "the client never
   names a key" actually sufficient? What about: token replay, a client that uploads different
   bytes after we verified them (TOCTOU), path traversal in the key we construct, a PDF bomb, a PDF
   that is valid but enormous when rendered, an object uploaded to a path we later assign to
   somebody else, the 2-hour token lifetime, and the fact that `upsert` exists.
   Note that `docs/project/security.md` names two untrusted parties; a reader's own file is a third.

b. **The claim that the verification checks (magic bytes, checksum) can happen "in the worker
   rather than in the request".** Is that split safe? What is true between enqueue and verification?

c. **The blob-store interface** as sketched. Is it the right seam? Is `signUpload` on the same
   interface as `get`/`put` a mistake, given the filesystem adapter cannot honestly implement it?
   The plan admits this and proposes a health check; is that good enough or is the interface wrong?

d. **The build order.** Is step 4 ("the pipeline's URL assumptions") correctly placed and correctly
   scoped? The plan calls it "the big one". Is it under-estimated? What in `src/pipeline.ts`,
   `src/jobs.ts` and `src/types.ts` will actually have to change, and is anything load-bearing
   being missed — particularly around the freshness/skip logic, retry, and cancellation?

e. **The test list.** What can pass while the feature is broken? What is missing?

f. **Anything in the measured-facts table that you think is wrong or over-claimed.** These were
   measured against a local Supabase on 2026-08-26 by direct HTTP requests, not read from docs.

g. Anything else that matters.

# Output

Structure your answer as:

1. **The bytes question** — your answer to the priority question, at length, ending with a clear
   single recommendation and the strongest argument against it.
2. **Blocking problems** — things that must change before building. Each: what, why, what instead.
3. **Should-fix** — worth changing, not blocking.
4. **Where the plan is right** — briefly, so I know what not to churn.
5. **Questions the plan should be asking Greg and isn't.**

Cite code as repo-relative paths (e.g. `src/pipeline.ts:476`), never absolute.
