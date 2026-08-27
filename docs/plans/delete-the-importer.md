# The pipeline writes to Postgres, and then the importer goes

> Do we only need import once for legacy stuff? If so, I'm tempted to ditch it. There's basically
> nothing in the current files/data/database that I care about losing. Or tell me if I'm
> misunderstanding.
>
> — Greg, 2026-08-27

> Ok, great, proceed as per your recommendation. I don't care about preserving/importing existing
> data. Let's aim for the long-term-best approach.
>
> — Greg, 2026-08-27

He is right about where this ends up and wrong about one word. `db:import` is not *legacy* — it is
the **only** way an article's content reaches Postgres today. [`src/jobs.ts:49`](../../src/jobs.ts)
hardwires `fsArtifacts` and runs every stage through it, and the only content-bearing `insert` into
`article_revisions` outside [`src/store/import.ts:559`](../../src/store/import.ts) is `beginDraftIn`,
which copies from a previous row or mints an empty draft. So the importer cannot be deleted; it has
to be **replaced**, and the replacement is [transactional-stage-runner.md](transactional-stage-runner.md)
landings B–D, which we need anyway.

What Greg's answer changes is not *whether* but *how much*. This document is the re-sequencing, and
**[GPT Sol's input round](delete-the-importer-review-sol.md) returned NO-SHIP on its first draft**
with eleven findings. Ten are folded in below and every one of them was checked against the code
before it was accepted. Two of them killed things I had just written down as answers, which is the
useful kind of review.

> **Where it stands, 2026-08-27.** This document is the sequence, not any of the work. **One thing in
> it is built**: the ToC status hole, which was a live bug rather than a new rule — `e18ac5f`, and
> § The publication gate, as a truth table. Everything else is B2's remnant, B3, C, D, the demolition
> and E, in that order and none of them started.

---

## What the decision deletes

Three pieces of designed-but-unbuilt work stop existing. A fourth thing I claimed it deleted, it does
not — see § What it costs.

**1. The verifying backfill.** [raw-bytes-in-storage.md § The backfill can put the wrong bytes under
a hash](raw-bytes-in-storage.md) is the most dangerous page in that plan, and restating why is what
makes deleting it worth so much. There are two hashes: `article_revisions.raw_sha256` is the hash of
what the network sent; `raw_sources.sha256` is the hash of what we actually stored. For any page that
was not already UTF-8 they differ, because `writeRaw` stores the decoded string. A backfill that
trusts the stored `raw_sha256` therefore uploads bytes that **do not hash to their own key**, and
content addressing is broken permanently and silently — a later `putIfAbsent` returns `already-there`
and nobody ever looks.

The safe version of that backfill has to hash what it reads rather than what the row claims, handle
null hashes, and record degraded provenance where the two disagree. All of it goes. A revision
written by the live pipeline computes its hash from the bytes it just wrote, in the same function, so
the two values cannot drift apart in the first place.

**2. Three import-only test files.** `store-import-prune`, `store-import-revision`,
`store-import-convergence` — 14 test blocks. (The first draft said four; there are three. The other
three importer users are suites that need *replacing*, not deleting, which is the distinction § What
it costs is about.)

**3. Migrating anything.** No corpus walk, no verification pass, no per-environment rollout.

## What it does not delete — and the correction that matters most

The first draft said *"existing rows keep working; deleting the importer only stops new articles
arriving."* **The first half is not true once the publication gate is on**, and this is the finding I
would least have liked to discover during the demolition.

Every revision the importer wrote has a `fetch` step row with `status = 'done'`
([`src/store/import.ts:800-837`](../../src/store/import.ts)) and a null `raw_source_sha256`, because
the importer does not write the new reference. And `beginDraftIn` copies the step-run rows **row for
row, status included** ([`src/store/pg-revisions.ts:593-611`](../../src/store/pg-revisions.ts)) while
carrying the null source pair. So the moment the gate is on, *any* later job on an existing article
— a glossary run, an ideas run, a re-ToC, anything that does not itself re-fetch — arrives at
publication with `fetch = done` and no reference, and is refused.

That is not "existing rows keep working". It is **every existing article frozen against further
work** until it is re-ingested.

Greg's answer covers the underlying loss, so the resolution is the boring one and it is stated here
as the assumption this plan runs on:

> **Assumption.** At the demolition, the existing corpus is **re-ingested** through the new path
> rather than migrated, and articles not worth re-ingesting are dropped. There are eight articles in
> the local database and eleven directories on disk; this is an afternoon, not a project.

Said out loud because "I don't care about the data" and "every article stops accepting new work" are
not obviously the same sentence, and Greg agreed to the first without being shown the second.

**One check before that afternoon:** some of those directories hold uploaded PDFs whose bytes exist
nowhere else. Re-ingesting those means having the original files to hand.

## What it costs

Forty-five test blocks call `importArticle`, across six files: `store-parity` (10),
`store-roundtrip` (10), `chat-anchor` (11), `store-import-prune` (7), `store-import-revision` (4),
`store-import-convergence` (3). A seventh, `store-export-isolation` (1), uses only the export half.
Three of the six are load-bearing:

- **[`tests/store-parity.test.ts`](../../tests/store-parity.test.ts)** — *"the test the whole
  migration rests on"*, in its own words. It compares the **wire form** of `fsArticleReader` against
  `pgArticleReader`: the `Article` shape, block order, the library listing, derived counts, and how a
  traversal slug is refused.
- **[`tests/store-roundtrip.test.ts`](../../tests/store-roundtrip.test.ts)** — files → import →
  export → files, artefact by artefact. This is the one that was quietly not checking raw documents
  at all until 2026-08-27, when total loss of every raw source passed it.
- **[`tests/chat-anchor.test.ts`](../../tests/chat-anchor.test.ts)** — not a store test at all. It
  uses import→export as a *vehicle* for the [block-id contract](../project/block-ids.md), and its own
  header says the way to watch it go red is to drop the `blockIdentities` insert from `importArticle`.

### The replacement, after two wrong answers

**Wrong answer 1.** I said the replacement was already on the list: item 2 of
[transactional-stage-runner.md § What has to be true](transactional-stage-runner.md), one set of
cases over `fsArtifacts` and the Postgres adapter. That suite is worth having and it replaces **none**
of the three. `store-parity` is a *reader* comparison, one whole layer above the artefact store; an
`ArtifactStore` suite does not reach a single one of its assertions. Sol's mutation test makes it
concrete: delete `byline` from `metaFrom`, or reverse `blocksFor`, and adapter parity stays green
while reader parity fails.

**Wrong answer 2.** I then said the adapter *itself*, used as a fixture loader, replaces all three.
Closer, and still short. `ArtifactStore` deliberately excludes the reader's own state — comments,
chat, searches, glossary lookups, shelf ([`src/store/artifacts.ts:62-65`](../../src/store/artifacts.ts))
— and `store-roundtrip` checks that `db:export` preserves all of it. Driving the adapter cannot
cover what the adapter is defined not to hold.

**What actually replaces them is three suites, not one:**

| suite | what it proves | how it gets an article into Postgres |
|---|---|---|
| **adapter parity** | `fsArtifacts` and the Postgres adapter store and return the same thing, kind by kind | writes fixtures through both |
| **reader contract** | `fsArticleReader` and `pgArticleReader` agree on the wire, including library order and optional artefacts | through each store's production coordinator/adapter, then publish |
| **export** | `db:export` still preserves reader state | production path in, live Postgres reader stores for the state, export, compare files |

Plus a fourth, standing alone, for the contract `chat-anchor` was really guarding — § The block
identity test.

The tempting shortcut — a stripped-down importer kept as a test fixture loader — stays rejected. It
would be a second implementation of files → Postgres, free to drift from the production write path,
and the drift would be invisible because tests would be the only thing exercising it. Reading a
fixture directory into `ArtifactParts` and calling the production `write` is a different thing: about
thirty lines with no Postgres knowledge in them at all.

**The sequencing rule: those suites land in C, and the importer is not deleted until they are
green.** No window of reduced coverage, which is the whole reason not to delete the importer first.

## The raw provenance has nowhere to go — and one column fixes most of it

Sol's critical, and it is right that the plan promised something the schema cannot hold.
`RawManifest` carries `origin`, `uploadId`, `filename`, the server's claimed content type, the
detected encoding and the network-byte hash. `article_revisions` gained only `raw_source_sha256` and
`raw_source_kind`; `raw_sources` holds shared object facts.

Taken field by field, the gap is smaller than three columns:

| field | where it goes |
|---|---|
| `origin` | **derivable, no column.** `requested_url` and `final_url` are both null exactly when the document was uploaded. A derived answer that cannot drift beats a column that can. |
| `uploadId` | already on `jobs.upload_id` ([`src/db/schema.ts:816`](../../src/db/schema.ts)) |
| `filename` | **genuinely homeless, and reader-facing** — it is the name an uploaded PDF should download as. One new column, `raw_filename`. |

**And the three old raw columns stay.** The first draft floated dropping `raw_content_type`,
`raw_encoding` and `raw_sha256` alongside `raw_bytes` because their names rhyme. They answer
different questions from anything in `raw_sources`: what the origin server *claimed*, what decoding
we *chose*, and what the network *sent*. Sol put it better than I would have:

> keeping two clearly typed hashes is not the trap. Using the wrong one as the object key is.

Only `raw_bytes` goes.

## The publication gate, as a truth table

The first draft reduced it to one condition — a done `fetch` and a null reference is a refusal — and
that is not a complete truth table. A revision whose fetch **failed** carries a perfectly good
inherited reference from `beginDraftIn` and passes.

The same hole was already **live** in the ToC guard — a real bug found in passing. It read the `toc`
step run, compared `input_hash`, and never looked at `status`, so a run that ended in error published
as long as the hash matched. It matched *especially* in that case: a step records its hash when it
starts.

**Fixed first and on its own, `e18ac5f`**, precisely so the source gate would not be written on top
of it. `tests/store-publish-guards.test.ts` was watched red, and checked again after the refactor by
disabling the branch — three red, four green with it back. The guards now live in
`reasonsNotToPublish`, which is where the source condition below goes.

| `fetch` run in the lineage | rule |
|---|---|
| none | no source requirement — a draft that only ever had `meta` is not refused *for this reason* (the existing no-blocks/no-tree checks still refuse it, and the test must assert that distinction rather than expect a successful publish) |
| `done` | a non-null `raw_source_sha256` is required |
| `running` or `error` | publication refused outright |

*Lineage*, not "this revision fetched", because `beginDraftIn` copies step rows and a later revision
legitimately inherits a `fetch` it did not perform — Sol's earlier round, and unchanged.

## The order

Unchanged from [transactional-stage-runner.md](transactional-stage-runner.md) except where marked.
**A is done. B piece 1 is done.**

### B2 — the raw product carries a reference, not bytes — **mostly already built**

The original piece 2 said *"a store-neutral raw product carries provenance **and** payload"*, because
`article_revisions.raw_bytes` needed bytes. It does not any more, and the consequence is bigger than
"the payload moves": **`RawManifest` is already the product.** It carries `kind`, `storedSha256`,
`contentType` and `bytes` ([`src/fetch.ts:93-149`](../../src/fetch.ts)), which is exactly the
reference, and `ArtifactMap["raw"]` is already declared as a `RawManifest`. The payload reaches the
bucket before the stage returns, because [`storeRawSource`](../../src/store/blobs.ts) is called
inside `writeRaw` rather than at its call sites. Both landed 2026-08-27, for other reasons.

What is left of piece 2 is one honest gap and one column. **`storedSha256` is optional**, and absent
means *this document is not in the bucket* — true of every manifest written before 2026-08-27. The
Postgres adapter cannot write a reference it does not have, so it must **refuse** such a manifest
rather than write a null reference beside a done `fetch`, which is exactly the state the gate exists
to catch. One refusal, at the adapter, watched red. The column is `raw_filename`, above.

This is also the runner plan's largest stated cost disappearing: *"every part is live in memory
together until the commit"* was written against a 32 MiB raw payload. Nothing 32 MiB wide now enters
the transaction.

### B3 — the checkpoint store — **a prerequisite, not an open note**

`labels-progress.json` and `pdf-chunks/` survive failed attempts on purpose, and D removes the `dir`
they live in. So D cannot start until this exists: an interface, a durable backing store, ownership
and cleanup rules, and a test that a retry on a **different store instance** does not buy a
checkpoint twice. A small Postgres table keyed by revision, step and key is the boring answer, and it
must stay **outside** the artefact/job transaction — preserving failed work is the entire point of
it.

### C — the Postgres artefact adapter, plus the three replacement suites

The `raw` kind writes a `raw_sources` row and the revision's reference columns rather than seven
columns including an 11 MiB `bytea`. The suites are part of this landing, not a follow-up: they are
what makes deleting the importer safe, so they cannot trail behind it.

**What the adapter must get right**, from a sweep of the existing write path, so none of it is
rediscovered the hard way. `import.ts` is the reference implementation for the *write* half and is
worth reading before starting, not after.

| trap | the rule |
|---|---|
| `revision_blocks.fts` is `generatedAlwaysAs` | never name it in an insert, and never bare-`select()` a row you intend to hash |
| two composite FKs need `article_id` | `revision_blocks` carries it for both `(article_id, revision_id)` and `(article_id, block_id)`, so every write resolves slug → article → draft |
| identities first, never deleted | upsert `block_identities`, then `delete` this revision's rows, then insert with `ordinal` from the array index. `revision_blocks_revision_ordinal` is unique, so delete-before-insert is required |
| carry-forward means present ≠ produced | `beginDraftIn` copies carried columns, block rows **and** step-run rows. So `has()` must consult `revision_step_runs` and compare the stamp — a non-null column reports a carried glossary as this step's output |
| `implementation_version = "imported"` is the importer's | it scopes the importer's own withdrawal `DELETE`. Nothing the adapter writes may use that string, or `db:import` deletes pipeline records |
| unstamped steps still need values | `input_hash` and `implementation_version` are NOT NULL and `fetch`/`extract`/`blocks` have no stamp. Use `NO_INPUT_HASH` and `PIPELINE_RUN`, never the draft's block hash — that claims a step ran against blocks it never saw |
| `labels` is not a step | the `revision_step_runs_step` CHECK rejects it; it is a `toc` output |
| `attempt_id` has no writer, and `recordStepRun` would clobber it | its upsert does `set: values`, which omits `attempt_id`. The adapter is the first writer, so that function has to be extended in the same commit |
| an empty blocks array | the importer silently keeps the old rows. The adapter must decide, out loud, whether empty means delete-all or no-op |
| null is a real value in a stamp | `StepStamp.profileHash` uses `null` to mean *written deliberately without a profile*, and `exactOptionalPropertyTypes` is on, so absent and null are different answers |

The transaction convention is already settled and should be copied rather than reinvented: a private
`…In(tx, opts)` with the public function opening the transaction around it, exactly as
`beginRevision`/`beginDraftIn` are split. Lock order is job row `for update` first, then article,
and must not be deviated from.

### The metadata page — **not the blocker I said it was**

The first draft called `src/api.ts` a blocker before D and proposed a new `ArtifactStore` method to
answer per-step byte weights. **Both were wrong, and the second was about to rebuild something that
exists.** `articleMetadata` is already store-specific on the `ArticleReader` contract, and the
Postgres implementation is already written ([`src/store/pg.ts:592-701`](../../src/store/pg.ts)): it
derives `done` from the step run, takes `ranAt` from `revision_step_runs.finished_at`, and returns
`bytes: null` — a loss already accepted on that side. `src/api.ts` is the *filesystem*
implementation, and it stops typechecking only when `outputs`/`dir`/`htmlFile` leave the filesystem
path.

So the answer is: logical names from `produces`, presence from the adapter, byte size and mtime kept
as a filesystem-specific inspection result. One thing does need fixing —
`STEP_STORAGE.fetch = ["article_revisions.raw_bytes"]` ([`src/store/pg.ts:336`](../../src/store/pg.ts))
would otherwise have the page advertising a dropped column.

### D — the stages, **and the source route**

Unchanged, plus one thing the first draft missed entirely. `sendSource` authorises through the
selected store and then reads `data/<slug>/raw.json` and the file beside it **unconditionally**
([`src/routes.ts:203-236`](../../src/routes.ts)). D removes those filesystem writes, so an article
ingested through the Postgres runner returns 404 from a route whose object demonstrably exists.

It moves to the reference-backed signed URL **no later than D**, keeping the filesystem fallback for
old articles through the mixed window. Note also that dropping `raw_bytes` is not what breaks this
route — it has never read that column.

### The demolition — five steps, not one commit

The first draft bundled everything into one commit on the reasoning that splitting them leaves a
state where the gate refuses what the importer writes. **The reasoning was wrong**: delete the
importer first and there is nothing left for the gate to reject. And a git commit cannot atomically
combine an application deploy with a migration, which is the part that actually matters here.

The rollback hazard is concrete. `beginDraftIn` renders `raw_bytes` into its `INSERT … SELECT` via
the carry policy ([`src/store/pg-revisions.ts:165-172`, `546-561`](../../src/store/pg-revisions.ts)).
Deploy the drop, roll the application back one commit, and every ingest fails with *column raw_bytes
does not exist* — and re-adding the column does not bring its contents back.

1. **Delete the importer**, after D and the replacement suites are green.
2. **Enable the gate** (and fix the ToC status hole first, separately, with its own red test).
3. **A compatibility release** that stops writing, copying, exporting or referencing `raw_bytes`
   while the column still exists.
4. **Rewrite the source and export paths**, and validate them.
5. **Drop the column**, in a later migration, once the release before it is known to work with the
   column absent.

Only step 5 is materially irreversible. Everything else is a git revert.

### E — the CLIs

Unchanged, and last.

## The window between now and step 1, and why it must be short

Once D can publish, **leaving `db:import` runnable is actively unsafe rather than merely redundant.**
Re-import an article that D has already published and, if the block text is unchanged, the importer
updates the current revision in place ([`src/store/import.ts:453-468`, `509-561`](../../src/store/import.ts)).
`revisionValues` rewrites `raw_bytes`, `raw_content_type`, `raw_encoding`, `raw_sha256` and both URLs
— and **omits** `rawSourceSha256` and `rawSourceKind`. The reference survives while everything around
it is replaced from files. The both-or-neither CHECK and the composite FK stay green throughout,
because the pair is still a valid pair; they cannot see that it now points at bytes from a different
acquisition.

So: **the importer refuses an article whose current revision carries a reference**, from the commit D
lands in. One condition, fails loudly, and it goes in before the window opens rather than after.

Also true in the window, and each cheap: new D-written rows have `raw_bytes = null`, so today's
`db:export` silently omits their raw document ([`src/store/export.ts:147-160`](../../src/store/export.ts));
`sendSource` fails as above; `REVISION_COLUMNS` is safe throughout because it excludes `rawBytes` and
picks the new reference up automatically, but its destructuring and
`tests/store-revision-columns.test.ts` both change at the drop.

## The block identity test

`chat-anchor` proves more than three columns: its anchor names a block **absent from the current
revision**, and import succeeds only because identities are inserted first and never deleted.
Adapter parity over a current `blocks` value does not prove that. The replacement stands alone and
needs no import or export:

1. Write and publish revision 1 through the Postgres adapter, with block `B`.
2. Begin revision 2, replace its blocks with a set that does not contain `B`, publish.
3. Assert `block_identities` still holds `B`.
4. Create an anchored chat naming `B` through `pgChatStore`, and read it back.

## `db:export` must fail closed

If export survives, it has a hole today that the rewrite would inherit. `scripts/db-export.ts`
imports [`src/store/export.js`](../../src/store/export.ts) directly, never
[`src/store/index.ts`](../../src/store/index.ts), where the credentials-and-project-pair refusal
lives. And `blobStore()` falls back to filesystem blobs when either Supabase credential is absent.
Point `DATABASE_URL` at the remote, unset `SUPABASE_SERVICE_ROLE_KEY`, and the rewritten export reads
`data/_blobs` rather than the bucket the rows refer to — omitting every source, or erroring as though
the objects were missing.

So a rewritten export requires both credentials and runs `projectMismatch` itself, or goes through a
shared "Postgres plus a matching blob store" constructor. The second is better; there is only one
such pair.

## What has to be true before this is believable

Each pinned to a way of being wrong, and each watched red first — the habit this repo keeps
relearning ([silent-success.md](../reusable/silent-success.md)).

1. **The three replacement suites are green** before the importer is deleted. Adapter parity watched
   red by breaking one adapter's round trip for one kind; reader parity watched red by Sol's own
   mutation (drop `byline` from `metaFrom`).
2. **The gate refuses a fetched revision with no source.** Build the state directly — a `done` fetch
   run and a null `raw_source_sha256` — and watch `publishRevision` throw. Watched red with the
   condition deleted. Reaching that state through the happy path proves nothing, which is the mistake
   this body of work has now made four times.
3. **The gate refuses a failed fetch**, even with a good inherited reference.
4. **The gate is silent about a draft that never fetched** — refused by the block/tree checks, and
   the reason strings say so.
5. ✅ **The ToC guard refuses an errored `toc` run** with a matching `input_hash` — done, `e18ac5f`.
   This one was a live bug, not a new rule.
6. **The importer refuses an article carrying a reference**, from the commit D lands in.
7. **The adapter refuses a manifest with no `storedSha256`** rather than writing a null reference.
8. **Block identities outlive the revision that dropped them**, through the production path.
9. **`db:export` refuses to run against Postgres without matching blob credentials.**
10. **A retry does not buy a checkpoint twice**, on a different store instance.

## Open

1. **Does `db:export` survive?** Without an importer it is a one-way dump. Its two plausible jobs are
   data portability and feeding `SPIDERYARN_STORE=files` from a Postgres corpus, and neither has been
   asked for. Recommendation: keep it, rewritten and fail-closed, because "get my data out" is the
   kind of thing whose absence is noticed at the worst possible moment — and say plainly in the docs
   that it is no longer a round trip and that nothing imports its output.
2. **Where the checkpoint table lives**, exactly — § B3 names the shape and not the schema.

## See also

- [delete-the-importer-review-sol.md](delete-the-importer-review-sol.md) — the NO-SHIP input round on
  this document's first draft, and the source of most of what is above
- [transactional-stage-runner.md](transactional-stage-runner.md) — the landings this re-sequences
- [raw-bytes-in-storage.md](raw-bytes-in-storage.md) — where `storeRawSource`, `raw_sources` and the
  project-pair check come from, and whose backfill this deletes
- [raw-bytes-in-storage-input-3-sol.md](raw-bytes-in-storage-input-3-sol.md) — the round that found
  the publication gate written but not built
- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) · [postgres-migration.md](postgres-migration.md)
- [../project/database.md](../project/database.md) · [../project/block-ids.md](../project/block-ids.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
