# Review: stage 2a + 2b of the files→Postgres migration, as built

Review **built code, not a plan**. Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`.
This review decides whether it gets committed.

You have reviewed this migration four times and returned NO-SHIP each time. Every finding was
accepted and none disputed. Stage 1 landed as `6e3ee67` after the fourth.

**The scoped diff (against `d9a0a3b`, my starting point), with four new files appended in full at the
end:**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e9d59148-0422-4f78-824d-44c35b090da5/scratchpad/stage2ab.diff`

**The plan:** `docs/plans/finish-the-database-move.md` § Stage 2, which I updated as I went.

## Scope warning — read this before judging anything

Six sessions share this working tree and two of them landed inside my files while I worked.

- **`src/pipeline.ts` contains a whole feature removal that is not mine.** Another session deleted
  the `summary` stage on Greg's instruction (`docs/plans/gist-only-summaries.md`), taking it out of
  `STEP_ORDER`, `FORCE_ONLY_WHEN_NAMED`, the `STEPS` table and every comment that named it. Ignore
  all of it.
- **A `timeline` stage is being added by a third session** — `STEP_ORDER`, `STEPS`, `src/types.ts`,
  `src/db/schema.ts`, `drizzle/0035_timeline.sql`. Ignore that too.
- **`src/fetch.ts`, `src/extract.ts` and `src/pdf-read.ts` are excluded here** and are the subject of
  a separate review running in parallel (stage 2c). The `fetch` and `extract` *steps* in
  `src/pipeline.ts` are in that one, not this one.
- Judge only: `src/article-input.ts`, the seven article-stage modules, `src/blocks.ts`,
  `src/toc.ts`, `src/labels.ts`, the `assets`/`arc`/`tweets`/`glossary`/`ideas`/`quotes`/`sketch`/
  `blocks`/`toc` steps in `src/pipeline.ts`, one line in `src/jobs.ts`, and the tests.

## What stage 2 was asked to do

> A stage stops writing. It returns a product. A short commit afterwards writes the product, checks
> it, and finishes the step.

On the filesystem that buys nothing — there is no transaction to hold. Under Postgres it is the
difference between a step's artefacts, its postcondition and its completion committing together or
one at a time. `LEGACY_UNCONVERTED_STEPS` is the list of stages that have not moved; each conversion
deletes a name, and a step off the list must return `parts` — enforced by `checkProduct` at runtime
and by `ConvertedProduct` at compile time. **It is now empty**, so `LegacyUnconvertedStep` is `never`
and every step's `run` is required by the compiler to return a `ConvertedProduct`.

## What was built (my account — verify it, do not trust it)

### Stage 2a — the seven article-reading stages

`arc`, `tweets`, `glossary`, `ideas`, `quotes`, `sketch`, and `assets` beside them. Each opened
`blocks.json`, `tree.json` and `meta.json` out of a directory for itself; each now takes an
`Article { slug, blocks, tree, meta }`.

**The duplication was the smaller half.** Each stage's `stamp` already asked the *store* for the same
three artefacts the stage then read off the disk — so every one hashed what the store held and
generated from what the disk held. Identical on a laptop; not identical through a job-scoped `/tmp`.
`src/article-input.ts` has `readArticle` (refuses), `tryReadArticle` (answers `null`, for `stamp`,
because "we cannot tell" must mean re-run rather than fail) and `readArticleFromDir` (command lines
and eval harnesses).

**The trap I want you to check hardest.** `ideas` and `sketch` build a stub `{ title: tree.slug }`
for the *prompt* when there is no metadata, while fingerprinting the real `null`. An agent applied
the mutation — hash the stub — and **nothing went red**, because `articleWithIdsFingerprint` resolves
`fallbackHeadTitle` itself and the two hashes are identical *today*. It said so, rewrote the code
comments that claimed otherwise (they were measurably false), and wrote
`tests/meta-fallback-fingerprint.test.ts` to pin the property rather than the line. **Is that the
right call, and is the property the right one?**

`tests/stage-stamp-agreement.test.ts` runs each real generator with the model stubbed and asserts the
artefact's embedded `sourceHash` equals the `inputHash` its `stamp` computes, in both metadata
states, with `ctx.dir` pointing at a directory that does not exist. Every stage was reddened; so was
its own negative control.

### Stage 2b — `blocks` and `toc`

`runBlocks({ slug, extractedHtml, previous })` is now synchronous and returns the stamped HTML and
the blocks. `generateToc({ blocks, slug, checkpointDir? })` returns
`{ parts: { tree, labels, blocks }, inputHash, clearCheckpoint }`.

Four things I specifically want adjudicated:

1. **A `runBlocks` that returns the *input* HTML where the stamped HTML belongs compiles**, and
   until this landing nothing in the repository caught it. `blocksMatchTheirHtml` notices — but only
   at the *next* skip check, and its verdict is "not current", so the step re-runs and writes the
   same wrong pair for ever. The Postgres artefact suite passed under that mutation. Two tests at
   the seam catch it now. **Is that enough, and is there a variant they miss?**
2. **`toc`'s write order is gone.** Labels, then blocks, then tree last was called crash-safety in
   the code and in my plan; the real mechanism was that `stepIsDone` reads *file exists* as *step
   done* and `writeFile` truncates. One `parts` map removes both halves. **Is that reasoning right?**
3. **`toc` records `stamp: { inputHash: run.inputHash }` and nothing else.** `STAMP_SOURCE.toc` is
   `"labels"`, so the stamp is compared against the labels file by `assertStampAgrees`;
   `run.inputHash` *is* `labels.sourceHash`, and a `promptVersion` beside it throws (`toc/2` vs
   `labels/1`) and would fail every ingest. `toc` deliberately has no `PipelineStep.stamp` — read the
   long comment before concluding it should.
4. **`clearCheckpoint` is returned and the pipeline does not call it.** It should happen once the
   artefacts are *stored*, which is `StoreSession.commit`, after `run` returns. Calling it in `run`
   would discard the checkpoint while the write could still fail and re-buy a whole label pass.
   Leaving it costs a file the next run reuses or ignores. **Right trade?**

**What was left undone deliberately:** `CheckpointStore` has no `delete` and the label checkpoints
stay on the filesystem behind an explicit `checkpointDir`. Its header says landing D drops `runId`
and `clearCheckpoint` with the one-file-per-run format, and it keys on an `articleId` this stage is
not given. So D2's `labels.ts` item is **not** done and the plan says so.

## Two of my own mistakes, since how I was wrong may matter more than the code

1. **I wrote in the plan that this closes the production fault.** It does not. `src/jobs.ts` still
   builds `fsStoreSession({ artifacts: fsArtifacts })`, so on a deployment the store is rooted at the
   same empty `/tmp` the directory is. The reported failure changes sentence and stays. Corrected in
   the plan and in the test's own docstring. **Check I have not left the claim anywhere else.**
2. **I told the `toc` agent the input hash belonged in my wiring rather than its return value.** It
   replied with evidence that I was wrong, complied anyway, and was cut off mid-edit — leaving a
   `TocRun` whose declared `inputHash` was gone. The typechecker caught it. Had it not, `toc` would
   have carried `NO_INPUT_HASH` and `reasonsNotToPublish` would have refused **every** article, from
   runs that all reported success. I put it back where the agent argued it belonged.

## What I want from you

1. **Anything that will break at the flip**, which is the next stage: `pgStoreSession` at
   `src/jobs.ts:1048`. This stage exists to make that safe.
2. **The four adjudications above**, and the metadata-stub question.
3. **Anywhere a stamp and the bytes it describes can still disagree.** That is the fault class this
   whole stage is about and it now has more call sites, not fewer.
4. Anything in the diff that is not stage 2a/2b's business — my scoping is a whitelist, but check me.
5. Anything factually wrong in the account above.

Be specific: file, line, the concrete state that fails. Say plainly where you are uncertain.

## Test status, honestly

`npm test`: **6,993 passing, 5 failing.** Every failure is attributable to another session by name —
four to the `summary` column being removed from the store while `REVISION_CARRY_POLICY` still names
it, one to the `timeline` step having no fixture in `tests/pipeline-artifact-store.test.ts`. None is
mine, and I would rather you checked that claim than took it.
