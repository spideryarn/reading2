# Review the built Postgres artefact store — landing C of the importer's replacement

You are reviewing **built code**, not a plan. This repo weights that above a plan review, and the
last round is why: the two row conditions in `finishStepRun` looked complete on their own and were
not. Read the code in the working tree; the diff below is a guide to what changed, not a substitute
for reading the file.

Say **NO-SHIP** on anything you think is wrong, and be specific about the failing case. Check each
claim against the code rather than against my summary — several of my summaries have been wrong, and
you have caught three of them already.

## What this is

`db:import` is the only path artefacts have ever taken into Postgres, so it is being **replaced**
rather than deleted. The plan is [`docs/plans/260827aa-delete-the-importer.md`](260827aa-delete-the-importer.md); its
§ The build order for C is the item list. The seam is `ArtifactStore` in
[`src/store/artifacts.ts`](../../src/store/artifacts.ts), already implemented over the filesystem in
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts).

Your three previous rounds are [`260827ac-artifacts-pg-shape-sol.md`](260827ac-artifacts-pg-shape-sol.md),
[`260827au-c1-c2-code-review-sol.md`](260827au-c1-c2-code-review-sol.md) and, most recently,
[`260828b-artifacts-pg-has-sol.md`](260828b-artifacts-pg-has-sol.md). The last of those is the one this code was
written against — every finding in it was acted on, and I want you to check that I acted on it
*correctly* rather than plausibly.

## What was built

**C3 — the map and the read half** (`src/store/artifacts-pg.ts`). `STORAGE`, the exact counterpart
of `PATHS` in the filesystem adapter; `readArtefact`; `stampForStep`. The store binds a resolved
`JobDraftRef` and takes its executor explicitly, with no default.

**C4 — `has` and `interrupted`.** `has` is every requested kind reading back and passing the shared
shape check, plus a `revision_step_runs` row with `status = 'done'`. No `toc` case, per your last
round.

**C5 — `write`.** Takes a `Tx`, never a `Db`. Fences on the job, checks the stamp against all the
artefacts before writing any, writes each part to its site, then records the stamp on the running
step-run row. Blocks are identities-upsert → unconditional delete → insert-if-any.

**C6 (partial) — `raw`.** `RawManifest` gained `storedBytes`. `article_revisions` gained
`raw_byte_count` and `raw_filename`. `writeArtefacts` now writes the `raw_sources` row and the
reference pair, and refuses a manifest with no `storedSha256` or no `storedBytes`.

**Shared between the two adapters**, moved into `artifacts.ts` so they cannot drift: `whyUnusable`
(the shape checks), `STAMP_SOURCE`, `stampOf`, `assertStampAgrees`.

**A corpus backfill** (`scripts/backfill-raw-manifests.ts`) for the manifests that predate
`storedSha256`.

## The specific things I want attacked

1. **`readBlocks` returns `null` for zero rows**, rather than `{ blocks: [] }`. My reasoning is that
   `inputHashFor` in [`src/pipeline.ts`](../../src/pipeline.ts) does `if (!file?.blocks) return
   null`, which an empty array sails past — so every late step would be compared against
   `hashBlocks([])`. The consequence is that after `write(slug, "blocks", { blocks: [] })` — which is
   deliberately a delete-all — `has` answers **false**. Is that right, or does something depend on
   being able to read back an article of no blocks?

2. **The meta/raw column ownership split.** `META_COLUMNS` deliberately excludes `finalUrl`,
   `fetchedAt` and `rawSha256`, because `meta.json` only *copies* those from stage 1 — and
   `src/extract.ts` sets `fetchedAt` to its own `new Date()`, which the shelf then sorts on. So
   `readMeta` reports three columns that `metaColumns` does not write. Is that split right? Is there
   a path where `fetch` never runs and `extract` is now the only thing that could have supplied them
   — a re-extraction of an article whose `fetch` was carried forward, say — and does that path still
   end up with the right values?

3. **`stampForStep`'s clash rule, as built.** Your last round said a disagreement must be refused
   rather than resolved, and that the row may contribute only `implementationVersion`. Check I have
   not left a hole: in particular, is returning `null` on a clash *safe* everywhere `stampFor` is
   called, given `sameStamp(null, expected)` is `false` and therefore means "re-run the step"? Is
   there a caller for which "no usable stamp" should be louder than a re-run?

4. **`writeArtefacts`'s ordering.** The job fence, then `assertStampAgrees` for every part, then the
   writes, then `recordStamp`. `recordStamp` locks the step-run row `for update` and throws
   `StepRunNotHeld` if it is not held — but that happens **after** the artefacts have been written
   into the transaction. Is that the right order, given the whole thing rolls back? Should the
   step-run lock be taken first, with the job fence, so that a `write` with no `beginStep` does no
   work at all?

5. **`recordStamp` is two statements, not one.** Three steps declare no stamp, and an `UPDATE` with
   nothing to set is an error — so folding the fence into the update would make the fence conditional
   on the step having a stamp. It now does `SELECT … FOR UPDATE` then a conditional `UPDATE`. Is the
   lock sufficient, inside the caller's transaction, to make that as safe as one statement?

6. **`writeRawSource` upserts `raw_sources` with `onConflictDoUpdate` setting `verifiedAt`.** The row
   is **shared** — other revisions point at the same object. Is updating `verified_at` from here
   right, and is there any case where the incoming `storedBytes` or `contentType` could disagree with
   the row already there? I deliberately do **not** overwrite those. Should a disagreement be an
   error instead?

7. **The backfill script.** It computes the hash from the bytes on disk and never copies
   `manifest.sha256` — the trap in [`260827o-raw-bytes-in-storage.md`](260827o-raw-bytes-in-storage.md) § The
   backfill can put the wrong bytes under a hash. It also *stores* a manifest marked `backfilled`,
   which the first version refused. My reasoning is that `backfilled` marks the **provenance** as
   unreliable, while `storedSha256`/`storedBytes` are facts about our own bucket computed from the
   bytes in hand. Attack that.

8. **Anything in the tests that proves less than it appears to.** That is the failure mode this whole
   piece of work keeps hitting: three of my checks tonight were green against the bug they named
   (the block ids sorted the same way as the ordinals; Postgres answered from an index so a missing
   `ORDER BY` did not show; a bare `rejects.toThrow()` matched the wrong refusal). Assume there are
   more.

## Two things that are known and deliberate, so do not spend the round on them

- **The migration is not committed.** `src/db/schema.ts` and `drizzle/meta/_journal.json` are shared
  with two other sessions that have uncommitted migrations, and committing mine would need theirs.
  The two columns exist in the working tree and in the local database.
- **`raw` still loses `origin` and `uploadId` on a round trip.** `origin` is derivable from the two
  URLs being null and `uploadId` is on `jobs.upload_id`; neither has been wired up yet. Say if you
  think that is wrong, briefly.

## The diff

Three files, all under `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/cb1f6352-212a-4617-954a-5ead31cb1813/scratchpad/`:

- `landing-c.diff` — the adapter, the shared helpers, the tests, the backfill, `src/fetch.ts`
- `pg-revisions-mine.diff` — my hunks of `src/store/pg-revisions.ts` (another session's rename of
  `REVISION_COLUMN_POLICY` is filtered out of this file; ignore its absence)
- `schema-mine.diff` — the two new columns

Read them, and then read the files themselves in the working tree.

Answer as a numbered list against the questions above, plus anything else you find. NO-SHIP where I
am wrong, and say what to do instead.
