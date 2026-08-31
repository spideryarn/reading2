# Review the built code: the raw-source foundation

You have reviewed this plan twice and given input on it once, all three read-only. Since then the
owner settled the open question and **six commits of code have landed**. This is a review of *built
code*, which this repo weights above a plan review, and for the stated reason: a plan-stage review
cannot find a `PATCH` that writes one field and then rejects the request.

Be adversarial. Every previous round found something real; assume this one does too.

## What the owner decided, and what it removed

Asked for an erasure deadline, Greg said: *"Maybe keep them indefinitely (at least for now)?"* He
handed the signed-URL window and the never-had-it/lost-it distinction to me as judgement calls, and
said to proceed unless something was hard to reverse.

Your input round said the lifecycle columns could go and three guarantees could not. Two of those
three are built. The third — the upload state machine — was left alone, as you advised.

## The commits, newest first

| commit | what |
|---|---|
| (this one) | `raw_sources` table, `article_revisions.raw_source_sha256`/`_kind`, `writeRaw` stores the object, `config.toml` MIME, `db-schema` tests |
| `3aad62f` | the third draft's state machine (now largely superseded by "never delete") |
| `1e079ee` | export classifies with `sniffKind`, not `looksLikePdf`; manifest test compares fields |
| `37806f1` | `npm run fetch` uses `writeRaw` instead of its own copy |
| `88fa46a` | three queries stop selecting `raw_bytes` they never read |
| `2c5e9cf` | the round trip looks at the raw document at all |

Plus, in the same commit as this prompt's subject: `storeRawSource` and the `projectMismatch` boot
check, which are your input round's findings 2 and 1.

## Read the code, in this order

1. `src/store/blobs.ts` — `storeRawSource` and `projectMismatch`, both new.
2. `src/store/blobs-fs.ts` — `putIfAbsent`, now temp-file-then-`link`.
3. `src/store/index.ts` — where `projectMismatch` is refused at boot.
4. `src/db/schema.ts` — `rawSources`, and the two new columns plus CHECK and composite FK on
   `article_revisions`.
5. `drizzle/0018_raw_sources.sql` — the generated migration.
6. `src/store/pg-revisions.ts` — the `CARRY` entries for the two new columns.
7. `src/fetch.ts` — `writeRaw`, `storedSha256` on `RawManifest`.
8. `src/store/export.ts` — `rawFileName`, `writeRawDocument`.
9. `src/store/pg.ts` — `REVISION_COLUMNS`, `RevisionRead`.
10. `tests/raw-source-store.test.ts`, `tests/store-project-pair.test.ts`, `tests/db-schema.test.ts`,
    `tests/store-revision-columns.test.ts`, `tests/store-roundtrip.test.ts`.
11. `docs/plans/260827o-raw-bytes-in-storage.md` — the plan as it now stands.

## Attack these specifically

1. **`storeRawSource`.** It trusts a `stored` result without reading back, and verifies an
   `already-there` by downloading and hashing. On mismatch it removes and re-puts — a deliberate
   exception to "never delete", argued as *an object that does not hash to its own name is wreckage,
   not a document*. Is the exception safe? Consider two callers repairing the same key at once; a
   `remove` that succeeds followed by a `putIfAbsent` that fails; and whether `maxBytes:
   bytes.byteLength` on the read-back is right (an object *larger* than ours throws rather than
   repairing — I claim that is correct and say so in a comment; disagree if it is wrong).

2. **`projectMismatch`.** Is comparing the pooler username's `postgres.<ref>` against
   `https://<ref>.supabase.co` sound for every Supabase connection string a person might paste —
   direct connection, session pooler, transaction pooler, IPv4 add-on? Does it wrongly refuse a valid
   configuration, which would be worse than the hole it closes because it refuses at boot? Is
   "both local" the right escape hatch?

3. **`blobs-fs.ts`'s temp-then-`link`.** Does the `finally { unlink(temp) }` do the right thing on
   every path? Is there a case where the object is left absent after `putIfAbsent` returned `stored`?
   Is `link` available and correct across the filesystems this runs on, and does the `.part` name
   collide with anything `fileFor` can produce?

4. **The schema.** Is the composite FK to a table with no `on delete` a trap, given the plan promises
   `raw_sources` rows are never deleted but nothing enforces that promise? Should there be a rule
   stopping the deletion? Is `integer` right for `bytes` given the 50 MiB cap and the `int8`-as-string
   reasoning it borrows? Does the `CARRY` decision for the two new columns create the vacuous pass you
   warned about in your last round?

5. **`writeRaw` and `storedSha256`.** The object write is now inside `writeRaw`, which the `npm run
   fetch` CLI also calls — so running that CLI writes to Supabase. Is that acceptable, surprising, or
   wrong? What happens when there is no blob store configured, or when the write fails: `writeRaw`
   currently lets the error propagate, so a fetch fails if Storage is down. Should it?

6. **The MIME measurement.** I measured that the bucket's `allowed_mime_types` does not stop a
   service-role upload — PDF-only bucket, and `text/html`, `image/png` and `application/x-nonsense`
   all stored. I have written that the browser signed-grant path *plausibly* still enforces it, and
   labelled that a belief rather than a measurement. Is the belief right? Does this change what
   `docs/project/security.md` should say?

7. **What is still missing**, which has been your most valuable category every round. The remaining
   work is: `db:import` writing the `raw_sources` row and the reference (with the verifying backfill);
   `db:export` reading from the blob store; and `sendSource` becoming a redirect. Is the ordering
   right, and is there something in the *built* code that will make one of those harder than it looks?

Verdict SHIP or NO-SHIP on what has landed, numbered findings, each with severity, a concrete
reproduction and a confidence percentage. Note: `src/store/pg-uploads.ts` currently has an
uncommitted, broken in-flight edit by another agent (`guardDbStore is not defined`) which breaks most
of the test suite at import time — that is not mine and not under review.

Markdown links must be repo-relative or plain code spans. Absolute paths and root-relative paths both
break `tests/doc-links.test.ts`, which has now caught four of your reviews; use plain code spans if in
doubt.
