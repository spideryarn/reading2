# Half the corpus's source documents are in the other blob store

**2026-08-31**, found while converting stages 1 and 2 off the filesystem
([finish-the-database-move.md § Stage 2c](../plans/finish-the-database-move.md)). Nothing was
broken at the time it was found, and that is the interesting part: **nine of the eighteen raw
manifests under `data/` name an object that the process reading them cannot see**, and the reason
nobody knew is that until this week nothing ever read one back.

`storeRawSource` ([`src/store/blobs.ts`](../../src/store/blobs.ts)) has been putting raw documents
into a content-addressed bucket since 2026-08-27, and `RawManifest.storedSha256`
([`src/fetch.ts`](../../src/fetch.ts)) has been recording where. There was a writer, a name, a hash,
a verification on the way in, and **no reader at all**. That is
[silent-success.md](../reusable/silent-success.md) with a checksum on it: every check that existed
passed, because every check that existed was on the write.

## The cause, in one sentence

`blobStore()` follows the process's credentials — Supabase Storage when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are both set, `data/_blobs/` otherwise — and only some of the processes
that fetched or backfilled had called `loadEnvLocal()`. So the corpus was written across two stores,
and which one a given process sees depends on how it was started.

That is not a bug in `blobStore()`. Its comment argues the selection rule at length and the rule is
right: *"if this process has a Supabase service key, the bytes go to Supabase, because that is the
only place a browser can put them."* The bug is that a **reference** was committed against a
selection that varies per process, with nothing that could ever notice the two disagreeing.

## How to repeat the measurement

Two probes, because the two stores answer different questions and neither can see the other.

**1. What the manifests claim, and what is on disk.**

```
python3 - <<'PY'
import json, glob, os
ext = {"pdf": "pdf", "html": "html"}
miss, ok, nosha = [], [], []
for f in sorted(glob.glob("data/*/raw.json")):
    d = json.load(open(f))
    s = d.get("storedSha256")
    if not s:
        nosha.append(f); continue
    k = f"data/_blobs/sha256/{s}.{ext[d['kind']]}"
    (ok if os.path.exists(k) else miss).append((f, k))
print("no storedSha256:", nosha)
print("object on disk:", len(ok), " absent from disk:", len(miss))
for f, k in miss: print("  ", f, "->", k)
PY
```

**2. Whether the ones absent from disk are in the container's bucket.** `object/info` is a HEAD-like
endpoint, so this moves no bytes. `200` is present, `400` is absent.

```
KEY=$(grep -oE "^SUPABASE_SERVICE_ROLE_KEY=.*" .env.local | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" \
  "http://127.0.0.1:54361/storage/v1/object/info/sources/sha256/<sha>.<ext>"
```

Do **not** shortcut probe 1 with a zsh one-liner using `set -- $var`: zsh does not word-split
unquoted parameters, so the whole line lands in `$1` and every key comes out mangled. The first
version of this measurement did exactly that and reported all eighteen missing.

## What it found, 2026-08-31

| | count |
|---|---|
| directories under `data/` (excluding `_`-prefixed) | 30 |
| with a `raw.json` | 18 |
| with raw bytes but no `raw.json` | 2 — `constitution`, `noema-mythology-of-conscious-ai` |
| with neither | 10 |
| manifests missing `storedSha256` | **0** — `scripts/backfill-raw-manifests.ts` has run |
| manifests whose object is in `data/_blobs/` | 9 |
| manifests whose object is in the Supabase bucket | 9 |
| manifests whose object is in neither | 0 |

The two halves are disjoint: every key present on disk answered `400` from the bucket, and every key
absent from disk answered `200`. Four keys were spot-checked against the bucket by hand; the
disjointness is inferred from the two probes rather than from checking all eighteen both ways.

Four of the nine bucket-side manifests — `coolabah-memory`, `revistes-ub-30977`, `source`,
`source-2` — share one `storedSha256`. That is content addressing working: four slugs, one document,
one object.

## What was done about it

**Nothing, deliberately.** Reconciling the two stores is a separate piece of work and the answer is
probably "refetch", not "migrate": Greg's decision 4 for this migration is that the corpus is
expendable and refetching is free
([finish-the-database-move.md § The decisions](../plans/finish-the-database-move.md)). Migrating
would mean writing code whose only purpose is to be deleted at stage 4.

What *was* done is make the state impossible to have without knowing. `readRawBytes`
([`src/fetch.ts`](../../src/fetch.ts)) now follows the reference on every extract, and when the
object is not there it throws a sentence that names the article, the object key, the mechanism, and
the fix — including which of the two credentials this process actually has. The failing case is
common enough that "not found" would have sent whoever saw it hunting for a file nobody deleted:

> `"nagel-bat"` points at the object `"sha256/8dcd…11.html"` and nothing is there. The manifest
> asserts that object exists, so this is a fault rather than an article without a source document —
> but the likeliest cause is not that anything was deleted. `blobStore()` (src/store/blobs.ts)
> chooses between Supabase Storage and `data/_blobs/` from this process's credentials, so a document
> stored by a process configured the other way is invisible to this one. Here, `SUPABASE_URL` is set
> and `SUPABASE_SERVICE_ROLE_KEY` is set. Refetch the article rather than hunting for the object.

The message reports the two variables **as observed** and does not announce which adapter was
chosen. Restating the selection rule here would be a second copy of a decision that lives in
`blobStore()`, which is exactly the failure a comment in `src/token-budget.ts` caused when it said
`src/toc.ts` had moved to `"medium"` and two agents believed it. Whether an environment variable is
set is an observable fact; which adapter that produced is `blobStore()`'s business, and naming the
function is the answer that cannot go stale. Only whether they are set — never the values.

"Set" means what `blobStore()` means by it, which is not what reads best: it tests `url && key`, so a
whitespace-only `SUPABASE_URL` **does** select Supabase Storage. The message trimmed before deciding
until GPT Sol noticed, and called that value "not set" — sending the reader to look in `data/_blobs/`
for an object that was never going there. Where a message explains a choice, it has to follow the
rule that made the choice, not the tidier one next door (`postgresBlobStore` trims and refuses).

## What would have caught the whole class

**A reader.** Not a better test of the write. The write had a check on each of its two paths —
`putIfAbsent` is create-only, so a create needs no read-back, and `storeRawSource` re-reads a dedup
hit and compares hashes — but those are **alternatives**, one or the other, not two verifications of
every write. Every check that existed was about the moment of writing.

The rule this suggests, and it generalises past blobs: **a reference committed to durable storage
needs something that dereferences it on an ordinary path, not only on a rare one.** `readPdf` in
[`src/store/pg-source.ts`](../../src/store/pg-source.ts) does dereference these, and it is the
reason this was not worse — but it runs only when a reader clicks "view the original" on a PDF, so
it exercised a handful of articles and never an HTML one. The dereference that would have found this
in a day is the one stage 2 now does on every single ingest.

**A reader is what finds it; it is not what stops it, and that half was missing here.** GPT Sol,
reviewing the code above on 2026-08-31, made the point and the same review proved it: `main()` in
[`src/fetch.ts`](../../src/fetch.ts) never called `loadEnvLocal()`, so `npm run fetch` selected
`data/_blobs/` while the server — which loads `.env.local` — selected Supabase. The command wrote
`raw.json`, the filesystem queue counted the fetch step done and skipped it, and extraction then
dereferenced the manifest against the other store. The new reader would have reported that promptly
and in a sentence, and the article would still have been stuck, from a split created *after* the
reader existed.

So the rule has a second clause: **the selection behind a stored reference must be the same in every
process that writes or reads it.** Here that is one line — the same `loadEnvLocal()` at the top of
`main` that every paid CLI in this repo has (src/cli-ledger.ts says why it goes first) — and the
command now prints the credentials that chose its store beside the object key, because two runs that
wrote to two different stores had printed the identical line.
[`tests/stage2c-raw-bytes.test.ts`](../../tests/stage2c-raw-bytes.test.ts) runs the real command in a
child process with a deliberately wrong value inherited from the shell, and fails if the file is not
applied before the command reads its own arguments. Detection and stable selection answer different
questions: one tells you the reference is broken, the other stops it being made.

The near-miss version is worth naming too: `db:export` reads the same references
(`readRawDocument`, [`src/store/export.ts`](../../src/store/export.ts)) and throws on a dangling one.
Had anybody run a backup of the whole corpus in the last four days, it would have failed on nine
articles. A backup tool is the wrong place to discover this.

## See also

- [fetching.md § What stage 1 leaves behind](../project/fetching.md) — the current design, and the
  three refusals that replaced the old silent fallbacks
- [../reusable/silent-success.md](../reusable/silent-success.md) — the family
- [`src/store/blobs.ts`](../../src/store/blobs.ts) — `blobStore()`, and why the selection rule is
  right even though this happened
- [`tests/stage2c-raw-bytes.test.ts`](../../tests/stage2c-raw-bytes.test.ts) — the failure modes,
  each made to go red on the mutation it guards
