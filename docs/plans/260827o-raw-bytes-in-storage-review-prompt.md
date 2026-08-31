# Review: should the raw document live in Supabase Storage rather than a Postgres column?

You are reviewing a **design decision and its evidence**, before any of it is built. Repository:
`spideryarn2`, an AI-assisted reading app. Read-only review. Be adversarial: the author wants to
know where this is wrong, not that it is plausible.

## Context you need

We are migrating article storage from local files to Supabase Postgres, because Vercel has no
writable disk. The plan for the write path is `docs/plans/260827j-transactional-stage-runner.md`, which you
reviewed twice already (`docs/plans/260827j-transactional-stage-runner-review-sol.md`,
`docs/plans/260827m-durable-queue-code-review-sol.md`). Your third critical finding in the first of those was:

> **`raw` still has no bytes.** … `RawManifest` contains a filename and byte count, not the bytes …
> Define a store-neutral raw product containing both provenance and payload bytes/decoded text.

The new proposal **rejects that remedy** and claims the requirement dissolves: the bytes go to
Supabase Storage keyed by their own hash, and only the hash enters the transaction. That claim is the
main thing to attack.

## Read these, in this order

1. `docs/plans/260827o-raw-bytes-in-storage.md` — the proposal. This is the thing under review.
2. `docs/research/260827c-supabase-storage-vs-postgres.md` — the sourced facts behind it.
3. `docs/plans/260827j-transactional-stage-runner.md` — the plan it edits, especially landings B and C.
4. `src/store/blobs.ts`, `src/store/blobs-supabase.ts` — the existing seam and the Supabase adapter.
5. `src/source.ts` — `stagingKey`, `canonicalKey`, `isStagingKey`, the sweep constants.
6. `src/pipeline.ts`, function `acquireUpload` — the one existing caller of the blob store.
7. `src/fetch.ts` — `RawManifest`, and what stage 1 does with the bytes today.
8. `src/db/schema.ts` — `article_revisions`, especially `raw_bytes`, `raw_sha256`,
   `raw_content_type`, `raw_encoding`.
9. `src/store/pg-revisions.ts` — the `CARRY` table (`rawBytes: "carry"`), `beginRevision`,
   `publishRevision`, `sweepAbandonedDrafts`.
10. `src/store/import.ts` and `src/store/export.ts` — the two things that read and write `raw_bytes`.
11. `supabase/config.toml` — the `sources` bucket.

## The measurements, so you can attack the experiment as well as the conclusion

Run against the local Supabase container on 2026-08-27, with an 11.04 MiB real PDF
(`data/ball-lightning/raw.pdf`). The spike script has been deleted; it is reproduced verbatim in the
appendix below so you can check what it actually measured.

| operation | time |
|---|---:|
| Storage `putIfAbsent` | 106 ms |
| Storage `get` | 47 ms |
| `bytea` insert | 175 ms |
| `bytea` select | 37 ms |
| `bytea` server-side copy (what `rawBytes: "carry"` costs) | 156 ms |

Also measured: a Postgres `ROLLBACK` does **not** remove an object uploaded to Storage inside that
transaction's lifetime — the object survives as an orphan. And a SQL join from `storage.objects` to
a `raw_sha256` column returns the matching row.

Corpus sizes, measured over `data/`: 25 MB total, of which raw source is 18.2 MB (86%); largest
non-raw artefact ever produced here is a 346 KB `blocks.json`, median 46 KB.

## What to answer

**1. Is the central claim sound?** The claim is that a create-only write to a content-addressed key
is safe *outside* the transaction, because writing twice is a no-op and an orphan is inert — so the
bytes never need to be in the atomic set. Attack this. Specifically:

- Is there a sequence where a committed revision references a `raw_sha256` whose object is **not**
  there? Consider: the write failing after the hash is computed; a crash between the two; the
  sweeper; `putIfAbsent` returning `already-there` for an object another process is mid-way through
  deleting; a failed job whose draft is swept while a sibling revision still references the same hash.
- Does content-addressing actually give idempotency here, or does the *sweeper* break it — two
  articles sharing one PDF, one of them deleted?
- The proposal says an orphan is "inert". Is it? Consider billing, the reader's privacy (a deleted
  article's PDF still sitting in a bucket), and GDPR-shaped deletion requests.

**2. Is the ordering right?** The proposal claims this is both the quicker v1 *and* the right
long-term answer, and that it is *less* work than the landing B piece 2 it replaces. Is that true, or
is there hidden work — in `import`/`export`, in the fixture/test corpus, in `db:import` for the 34
existing articles, in local development without a Supabase container?

**3. The fallback path.** `blobStore()` returns a filesystem adapter when there is no service key.
That means on a laptop with no container, raw bytes go under `data/_blobs/` while everything else
goes to Postgres. Is that a coherent configuration or a trap? Note `SPIDERYARN_STORE` chooses the
article store separately and deliberately does not select the blob store.

**4. The line itself.** "Content-addressed and immutable → Storage; revision-scoped and rewritable →
Postgres." Does that line hold for all twelve `ArtifactKind`s, or is there one it mis-sorts? Pay
attention to `extractedHtml` and `stampedHtml` — same path on disk, two kinds, one rewritten by
stage 3.

**5. What the proposal does not mention at all.** The most valuable finding is usually here. Look
especially for: whether `publishRevision`'s validation needs the bytes; whether anything reads
`raw_bytes` that the author has not listed; the `PATCH`-shaped mistake — a code path that writes one
of `raw_sha256`/`raw_content_type`/`raw_encoding` without the others; and whether dropping the
column later is actually safe given `db:export` is how articles leave this system.

**6. Have I got the Supabase facts wrong?** The research doc is in `docs/research/`. Check its claims
about transactionality, PITR coverage, and the `storage.objects` schema against what you know. Say so
if any of them are wrong or out of date — a wrong fact here changes the decision.

Give a verdict of SHIP or NO-SHIP with numbered findings, each with a severity, a concrete
reproduction, and a confidence percentage. Markdown links must be repo-relative or plain code spans —
absolute filesystem paths break this repo's `tests/doc-links.test.ts`.

## Appendix: the spike script, verbatim

```ts
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./src/db/client.js";
import { blobStore } from "./src/store/blobs.js";

const db = getDb();
const blobs = blobStore();
const ms = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6;

const bytes = new Uint8Array(await readFile("data/ball-lightning/raw.pdf"));
const sha = createHash("sha256").update(bytes).digest("hex");

const key = `sha256/${sha}.pdf`;
let t = process.hrtime.bigint();
const put = await blobs.putIfAbsent(key, bytes, "application/pdf");
console.log(`storage put   ${ms(t).toFixed(0)} ms  (${put})`);
t = process.hrtime.bigint();
const got = await blobs.get(key);
console.log(`storage get   ${ms(t).toFixed(0)} ms  (${got?.byteLength} bytes)`);

await db.execute(sql`create table if not exists spike_bytea (id uuid primary key, b bytea)`);
const rowId = randomUUID();
t = process.hrtime.bigint();
await db.execute(sql`insert into spike_bytea (id, b) values (${rowId}, ${Buffer.from(bytes)})`);
console.log(`bytea insert  ${ms(t).toFixed(0)} ms`);
t = process.hrtime.bigint();
const back = await db.execute(sql`select b from spike_bytea where id = ${rowId}`);
console.log(`bytea select  ${ms(t).toFixed(0)} ms`);
t = process.hrtime.bigint();
await db.execute(sql`insert into spike_bytea (id, b) select ${randomUUID()}::uuid, b from spike_bytea where id = ${rowId}`);
console.log(`bytea copy    ${ms(t).toFixed(0)} ms`);

// Does ROLLBACK undo a Storage write?
const txKey = `sha256/${randomUUID()}.pdf`;
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into spike_bytea (id, b) values (${randomUUID()}, ${Buffer.from([1,2,3])})`);
    await blobs.putIfAbsent(txKey, bytes.slice(0, 1024), "application/pdf");
    throw new Error("deliberate rollback");
  });
} catch { /* expected */ }
const survived = await blobs.head(txKey);
console.log(`after rollback: ${survived ? "STILL THERE" : "gone"}`);
```
