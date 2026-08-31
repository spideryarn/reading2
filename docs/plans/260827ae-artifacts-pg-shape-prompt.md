# Input on one design question: how a Postgres `ArtifactStore` is addressed and how it joins a transaction

Read-only input round, and deliberately narrow. You have just reviewed
`docs/plans/260827aa-delete-the-importer.md` (NO-SHIP, eleven findings, ten folded in). This is the landing
C it describes, and I want the **shape** settled before I write it, because getting it wrong wastes
the whole landing.

Be adversarial and concrete. Three previous rounds on this body of work each found something real.

## Read, in this order

1. `src/store/artifacts.ts` — the `ArtifactStore` interface, `ArtifactKind`, `ArtifactMap`,
   `ArtifactParts`, `StepStamp`. Note the header on why the key is `(step, kind)`.
2. `src/store/artifacts-fs.ts` — the only implementation. Note `createFsArtifactStore` and the
   `fsArtifacts` default export: it is a **factory taking a locations resolver**, which is the
   existing precedent for "the same adapter, pointed somewhere else".
3. `src/pipeline.ts` — `stepIsDone`, `assertProduced`, `inputHashFor`, `htmlCarriesItsIds`: every
   caller of the interface, and *when* each is called relative to a step running.
4. `src/store/pg-revisions.ts` — `beginDraftIn`/`beginRevision` (the `…In(tx, …)` split convention),
   `openOrBeginJobDraft`, `recordStepRun`, `storedBlocks`, `REVISION_COLUMN_POLICY`,
   `reasonsNotToPublish`.
5. `src/store/import.ts` — the working reference for writing artefacts into Postgres, especially the
   `blocks` discipline around lines 560-600.
6. `src/store/pg.ts` — `REVISION_COLUMNS`, `articleMetadata`, `isCurrent`, `STEP_STORAGE`.
7. `docs/plans/260827j-transactional-stage-runner.md` § C and § D — what the coordinator is supposed to do.
8. `docs/plans/260827aa-delete-the-importer.md` § C — the ten traps I have already written down.

## The question, in three parts

**1. How is the store addressed?**

Every method takes a `slug`. Under Postgres a slug names an article that has a published revision and
may have a draft. Writes belong to the draft; reads during a pipeline run should see the draft, but
`stepIsDone` runs before anything has been written to it.

My intent, which I want attacked: a factory, mirroring `createFsArtifactStore` —
`createPgArtifactStore(resolve)` where `resolve` yields `{ articleId, revisionId }` for the draft the
job owns, obtained from `openOrBeginJobDraft`. The slug argument then becomes a consistency check
rather than a lookup key, and a mismatch is a throw.

Is that right? Specifically: is leaving `slug` in the signature while not using it as the key a trap
of the kind this repo keeps hitting — a parameter that looks load-bearing and is not?

**2. How does it join the one transaction?**

`ArtifactStore.write(slug, step, parts, stamp)` takes no transaction handle. Landing D requires
artefacts + step-run + job transition to commit together. But `has`, `read` and `stampFor` are called
by `stepIsDone` *before* the step runs and must NOT be inside that transaction — the whole point of
the design is that the model call happens with no row lock held.

So the adapter seems to need two modes: a pooled read instance, and a write instance bound to a
caller's `Tx`. Options I can see:

- (a) Two factories: `pgArtifacts()` for reads, `pgArtifactsIn(tx, ref)` for the write inside the
  coordinator's transaction. The interface is unchanged; the coordinator constructs the second.
- (b) Add an optional `tx` parameter to `write` only.
- (c) Give the whole store a `Tx | Db` the way `recordStepRun(input, tx = getDb())` already does.

Which of these does the least damage, and is there a fourth I have not seen? Note that the repo's
existing convention for "may join a caller's transaction" is (c), and its convention for "must be one
transaction" is the private `…In(tx, opts)` split.

**3. What does `has()` honestly mean here?**

The filesystem `has` parses each artefact and returns false on the first unreadable one. In Postgres,
carry-forward is the problem: `beginDraftIn` copies carried columns, block rows **and** step-run rows
from the published revision, so a non-null `glossary` column on a fresh draft is the *previous*
generation's, not this step's output. `src/store/pg.ts:659` already learned a version of this
(`status === "done" && isCurrent(step)`).

`blocks` is the sharp case named in the runner plan: `blocks` and `toc` write the same rows, so the
rows cannot say which step produced them.

What is the correct definition of `has(slug, step, kinds)` for Postgres such that it agrees with the
filesystem adapter wherever agreement is meaningful, and is honest where it cannot? And where the two
adapters *must* differ, say so plainly — I would rather have a documented difference than a false
parity claim, which this repo produced twice yesterday (`docs/postmortems/260827d-toc-status-never-checked.md`).

## Also worth your attention

- `revision_step_runs.attempt_id` exists (`drizzle/0017`) with **no writer and no reader**. This
  adapter is its first writer, and `recordStepRun`'s upsert does `set: values` omitting it, so it
  would clobber the fence on the next call. Does `beginStep`/`finishStep` belong in `recordStepRun`
  at all, or does the fence want its own statement?
- `implementation_version = "imported"` scopes `db:import`'s withdrawal `DELETE`. Anything the
  adapter writes must avoid that string.
- Empty `blocks` array: the importer silently keeps the old rows. What should the adapter do, and is
  either choice a silent-success hazard?

## Format

Ranked findings with confidence and a concrete `file:line` or reproduction, and a clear
recommendation on each of the three parts. Say if the shape is wrong rather than patching it.

**Markdown links must be repo-relative** or plain code spans — absolute paths break
`tests/doc-links.test.ts`, which has happened in every previous round.
