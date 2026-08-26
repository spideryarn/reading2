# GPT Sol's review of the Postgres storage migration

Run 2026-08-26 with `gpt-5.6-sol --effort high`, against the working tree at commit `351c054`.
The prompt is [postgres-storage-review-prompt.md](postgres-storage-review-prompt.md) — note that
the *first* attempt died out of credits after 170k tokens of `git log -p`, and this one succeeded
only because the prompt names the files to read instead. Keep it that way.

Its verdict was **NO-SHIP for this tranche**. What follows is Sol's answer verbatim. My verification
of each claim — including the two it got wrong and the blocker that turned out to belong to another
agent's uncommitted work — is in
[postgres-storage-implementation.md](postgres-storage-implementation.md#what-the-cross-family-review-found).

---

Verdict: **NO-SHIP for this tranche.** The most immediate blocker is schema drift: the TypeScript schema and reader use `archived_at`, `title_override`, `opens`, and `last_opened_at` (`src/db/schema.ts:148`, `src/store/pg.ts:241`), but the migration chain never creates them. A clean `db:migrate` leaves `articles` with only the original columns (`drizzle/0000_initial_schema.sql:51`). `listArticles` will therefore fail with “column does not exist” on a fresh database. The probe only checks that `revision_blocks` exists (`tests/store-parity.test.ts:115`), so a drifted local database can make all tests pass.

The workspace changed during this review—`schema.ts` grew from 775 to 840 lines—so these references describe my final read.

## 1. Is the parity test load-bearing?

Useful, yes. Load-bearing by itself, no.

Its central `wire()` claim is wrong. `JSON.stringify` makes `{a: undefined}` and `{}` identical, so it cannot detect the exact-optional distinction the comments say it catches (`tests/store-parity.test.ts:8`, `src/store/pg.ts:12`). `{a: null}` versus `{}` was already distinguishable without serialising. Keep the wire assertion, but add `toStrictEqual` or explicit key-presence assertions before it.

The test also couples the importer and reader: it imports the filesystem data using the code under test, then reads that import. Complementary mistakes can cancel out. Synthetic rows constructed independently of the importer are required.

Compared nowhere:

- `articleMetadata`, including statuses and its deliberate output-path divergence.
- `listArticles({archived: true})`, renamed titles, opens, and other non-default shelf state.
- Error messages; only some statuses are checked.
- Unknown/malformed slugs across every reader method; only `loadArticle` gets the traversal test.
- The in-process distinction between missing and `undefined`.
- Owner isolation.
- A re-import after metadata, HTML, tree, or artefacts change without block text changing.
- Concurrent import/create behavior.

The comment claiming the slug list is taken twice is also false: it is collected once at module load and reused in `beforeAll` (`tests/store-parity.test.ts:66`, `tests/store-parity.test.ts:132`).

The artefact manifest is only a tripwire. Its destination values are deliberately not checked (`tests/store-artefact-manifest.test.ts:47`); adding a filename to `HOMES` silences it without implementing storage.

## 2. `src/store/import.ts`

The UUID has adequate collision resistance, but it is not UUIDv5. UUIDv5 uses SHA-1 over a namespace UUID plus a name; this uses SHA-256 over NUL-separated strings and merely stamps the v5 bits (`src/store/import.ts:86`). Use actual v5 or label this as a project-specific deterministic UUID—preferably v8.

The more serious defect is that the revision fingerprint is much narrower than the revision. `hashBlocks` covers block identity/text, while the revision also contains metadata, HTML, structure, tree, and generated artefacts. Those can change without producing a new revision ID. The conflict branch then mutates an already-published revision (`src/store/import.ts:293`), directly contradicting “Immutable once published” (`src/db/schema.ts:162`).

Worse, the update is partial. It refreshes tree and optional artefacts but not title, byline, URLs, fetched time, raw bytes, or several other revision fields. A re-import after changing only `meta.json` leaves stale database metadata. Reader-state rows use `ON CONFLICT DO NOTHING`, so edits and deletions in files are also ignored. `revision_step_runs` are never removed, meaning an artefact removed on disk can remain reported as “done”, contrary to the comment at `src/store/import.ts:459`.

The transaction is database-atomic: the current pointer moves last, so readers do not observe half a committed revision. It is not a coherent filesystem snapshot because all files are read before the transaction and can change between reads.

Two concurrent imports with the same slug and fingerprint should serialize on the conflicting revision row. That alone is not a convincing explanation for the flake. Different fingerprints race publication: both revisions are complete, but whichever updates the article last wins, irrespective of which extraction is newer. Lock the article row and define the winner explicitly.

I would either derive the identity from the entire canonical revision and keep published revisions immutable, or introduce a separate full-source idempotency key. Then replace all revision fields as one unit and make reader-state merge policy explicit.

## 3. `pg.ts` against `api.ts`

The conditional spreads in blocks and metadata look complete. I did not find a missing nullable field there.

There are still semantic gaps:

- The filesystem returns stored `meta.slug`; Postgres always manufactures the requested/article slug (`src/api.ts:182`, `src/store/pg.ts:159`). The fixture already proves those can differ, but the fixture is excluded from Postgres.
- PostgreSQL timestamps are re-emitted with `toISOString`, so a valid but non-canonical source timestamp changes spelling.
- `articleMetadata` is untested and intentionally diverges. Its comment says the divergence is listed in the plan (`src/store/pg.ts:172`); it is not.
- No read filters on `owner_id`. This is harmless only while there is exactly one owner.

The tagged statuses in the six article-reader methods are otherwise consistent on the paths I checked. Database faults remain untagged 500s, correctly.

## 4. `pg-comments.ts` against `comments.ts`

The anchor FK is correct, and sequential retry reset, preserved `createdAt`, and patch-resistant IDs are implemented correctly.

Concurrent idempotency is broken. Two simultaneous creates carrying the same new client ID can both observe no row at `src/store/pg-comments.ts:108`; one insert wins and the other gets a uniqueness error. A transaction does not lock a row that does not exist. This should be one `INSERT … ON CONFLICT DO UPDATE`, deliberately omitting `created_at` from the update.

Minting without an input ID has the same check-then-insert race, although only an actual random collision exposes it. The PK turns corruption into an error, but retrying on that error would complete the contract.

`ORDER BY created_at, id` does not reconstruct file-array order. Equal timestamps are explicitly possible, and lexicographic ID order has no relation to insertion order (`src/store/pg-comments.ts:23`). Add an ordinal or monotonic sequence if exact order matters.

There are two quieter semantic differences:

- Filesystem `loadComments` returns `[]` for an unknown valid slug; Postgres returns a tagged 404 (`src/comments.ts:63`, `src/store/pg-comments.ts:45`).
- Filesystem patch can change `createdAt`; Postgres patch cannot. Decide which contract is intended and test it rather than calling them identical.

## 5. Remaining danger

I agree carry-forward is the largest unfinished **pipeline-publication** risk. It causes silent, paid-for user data loss and ordinary parity cannot expose it.

There are, however, current defects that rank ahead of it because they are already in supposedly finished work:

1. Missing migrations for live reader columns.
2. The exporter’s cross-article chat leak described below.
3. The importer’s partial mutation of published revisions.
4. Concurrent comment retry failure.

Before authentication, there is another architectural risk larger than glossary carry-forward: `owner.ts` says only this file changes when a second person arrives (`src/owner.ts:4`). That is false. Queries do not filter by owner, and `articles.slug` is globally unique (`src/db/schema.ts:119`). A second user would see the first user’s library and could not ingest the same URL. Auth requires query changes and probably a per-owner slug constraint.

## 6. Wrong comments and other defects

The exporter can mix conversations from different articles. Thread IDs are explicitly only article-local (`src/db/schema.ts:655`), but message export filters only by `thread_id`, not `(article_id, thread_id)` (`src/store/export.ts:212`). Two articles sharing a thread ID cause one rollback directory to receive both sets of messages. This is data corruption and potentially private-text leakage. Add the article predicate.

Exporter ordering is also undefined for comments, threads, and search runs. Current round-trip data happens to come back in insertion order. The test needs deliberately scrambled rows.

The round-trip claim is overstated. `raw.html` is omitted from `ARTEFACTS` (`tests/store-roundtrip.test.ts:39`), and stamped HTML is never compared—the test only proves that `data/<slug>/stamped.html` does not exist (`tests/store-roundtrip.test.ts:177`).

Other confidently wrong comments:

- The schema still says nothing reads it and no table is live (`src/db/schema.ts:1`).
- The importer describes its UUID as RFC UUIDv5.
- The importer says an absent artefact gets no step row, but a previous row survives re-import.
- The parity test says serialisation detects `undefined` versus absence.
- `owner.ts` says every table has `owner_id` and only that file changes for auth; neither is true.

The explicit 501 glossary refusal is correct. The configuration boundary is not: any typo in `SPIDERYARN_STORE` silently selects files (`src/store/index.ts:53`). Keep unset→files during this staged phase if required, but reject any nonempty value other than `files` or `postgres`.

Finally, `isLocalDatabaseUrl` uses a regex over the entire URL (`src/db/ssl.ts:69`). Because that same answer authorizes destructive local-only operations, parse the URL and compare its hostname; a `@localhost:` substring in userinfo must not classify a remote host as local.