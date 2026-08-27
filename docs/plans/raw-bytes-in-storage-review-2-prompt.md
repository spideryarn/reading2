# Second review: the raw-source protocol, rewritten after your NO-SHIP

You reviewed `docs/plans/raw-bytes-in-storage.md` earlier today and returned NO-SHIP with three
criticals. All of them were verified against the code and all three held. The plan has been rewritten
around them. This is a review of the **second draft**, and of the two changes that have already
landed as a result.

Be adversarial. The first review was valuable precisely because it attacked the reasoning rather than
the conclusion; do that again. Read-only.

## What you found, and what changed

| you said | what happened |
|---|---|
| the sweeper races a commit — content addressing means the same name **is** minted again | accepted; there is now a `raw_sources` table and a three-phase sweep with the row as the lock |
| `raw_sha256` is not the pointer — no `raw_kind`, nullable, no provenance | accepted and confirmed in three separate places; the table carries hash + kind + size + state |
| the backfill can put the wrong bytes under a hash (`raw.html` is decoded, `sha256` is of the network bytes) | confirmed verbatim in `src/fetch.ts`'s own comment; the backfill now verifies and re-identifies |
| an orphan is not inert | accepted; deletion is now two operations and the erasure deadline is an open question for the owner |
| the filesystem fallback is a split brain | accepted; the blob backend becomes explicit with a startup invariant |
| landing B piece 2 changes shape, it does not disappear | accepted; the overclaim is retracted in the text |
| the slogan mis-sorts `extractedHtml` | accepted; three categories, not two |
| 86% is arithmetically wrong | confirmed — 73%, and the doc now shows the arithmetic |
| the spike measures `already-there` on a second run | the run printed `stored`, but the table omitted it; both the caveat and the trap are now written down |
| `pg_net` is not POST-only | corrected in `docs/research/supabase-storage-vs-postgres.md` |

## Read these

1. `docs/plans/raw-bytes-in-storage.md` — the second draft. The thing under review.
2. `docs/plans/raw-bytes-in-storage-review-sol.md` — your first review, for what you already said.
3. `src/store/blobs.ts`, `src/store/blobs-supabase.ts`, `src/source.ts` — the existing seam.
4. `src/fetch.ts` (`writeRaw`, `RawManifest`, and `main()` — note the CLI diverges from `writeRaw`).
5. `src/store/import.ts`, `src/store/export.ts` — the two things that move raw bytes today.
6. `src/store/pg-revisions.ts` — the `CARRY` table, `beginDraftIn`, `publishRevision`.
7. `src/routes.ts`, function `sendSource` — the built `GET /api/source/:slug`.
8. `src/db/schema.ts` — `article_revisions`.

## What landed already, and should be reviewed as code

Two changes went in ahead of the plan because they are live bugs independent of it. Review them as
built code, which you have said before should be weighted higher than a plan.

**A. `db:export` wrote every article's raw bytes to `raw.html` whatever they were.**
Commit `2c5e9cf`. Four of seven articles here are PDFs, so four exported under a name claiming to be
HTML — and the name is the only thing telling the next `db:import` which decoder to use, because
`readRaw` falls back to "no manifest means assume HTML". It also never wrote `raw.json`. The fix
sniffs the bytes with `looksLikePdf` rather than trusting `raw_content_type`, and writes a manifest
stamped `backfilled`. See `src/store/export.ts` (`writeRawDocument`) and
`tests/store-roundtrip.test.ts`.

Attack specifically: is sniffing right, or does it fail on some real document? Is stamping every
exported manifest `backfilled` correct given `import.ts:194` returns null for such a manifest — does
that lose something a round trip should keep? And is the test's decision **not** to assert
"absent stays absent" for `raw.json` a genuine limit of the schema or a weakened test?

**B. Three queries selected the revision row whole, including `raw_bytes`.**
Commit `88fa46a`. `listArticles` (once per article, every library load), `currentRevision` (every
article view), `publishRevision`. Measured: 23.89 MB versus 0.01 MB for 8 articles. See
`src/store/pg.ts` (`REVISION_COLUMNS`, `RevisionRead`) and `tests/store-revision-columns.test.ts`.

Attack specifically: is deriving the column set from `getTableColumns` minus one column safe across
Drizzle versions? Does `RevisionRead` actually prevent the revert it claims to? Is the source-text
assertion in the test defensible, or is it the kind of check that rots? And is there a **fourth**
whole-row read I have missed — including in files the test does not scan?

## What to answer about the second draft

1. **Does the three-phase sweep actually close the race?** Walk it. The claim is that the
   `raw_sources` row is the lock, that an acquirer and the sweeper cannot interleave because both take
   it `for update`, and that the acquirer always still holds the bytes so losing the race is
   recoverable by re-uploading. Find the sequence where that is false. Consider especially: a crash
   between "mark `deleting`" and the actual object removal; the filesystem adapter, which has no
   transactions at all; and two acquirers racing each other rather than the sweeper.
2. **Is `raw_sources` keyed right?** `(sha256, kind)` primary key. Is the kind part of the identity or
   a property of it — can the same bytes legitimately be both? What happens when the verified hash of
   a re-encoded HTML document collides with a PDF's?
3. **Is the backfill's two-hash answer right?** `raw_sources.sha256` is a hash of the bytes we have;
   `article_revisions.raw_sha256` stays a hash of what we originally received. Is keeping both honest,
   or is it two numbers that will drift into meaning the same thing to a careless reader?
4. **`sendSource` under this design.** The plan says it becomes a redirect to a signed URL. What does
   that change about the authorisation check it currently does (`shelfStore.read(slug)` before
   reading a byte)? A signed URL outlives the check that minted it.
5. **What is still missing.** The first review's most valuable finding was in this category. Look
   especially at: the `npm run fetch` CLI, which writes true raw bytes and **no manifest**, diverging
   from `writeRaw`; whether `raw_sources` needs a row before or after the object exists; and what
   happens to an article whose bytes we never had.

Verdict SHIP or NO-SHIP, numbered findings, each with severity, a concrete reproduction, and a
confidence percentage. Markdown links must be repo-relative or plain code spans — absolute paths
break `tests/doc-links.test.ts`.
