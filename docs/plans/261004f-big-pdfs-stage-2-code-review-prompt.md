# Code review: 261004f stage 2, a long article's blocks are written in batches, and a heavy PDF page goes through

Repo is TypeScript/ESM, run with `tsx`, tests with vitest. This is a git worktree on branch
`worktree-fbbac46a-big-pdfs-up-to-our-limits`.

## The candidate

Committed. The stage-2 commit is the one whose subject starts `261004f stage 2`; find it with
`git log --oneline -5`. Its diff is `git show <sha>`, and the changed paths are
`git show --stat <sha>`. Start with:

- `src/db/insert-batches.ts` (new) and `src/store/artifacts-pg.ts` § `writeBlocks`
- `src/pdf-read.ts`: `READER_REQUEST_BYTES`, `maxEncodedBytesFor`, `encodedBytes`,
  `PdfReader.maxEncodedBytes`, `openRouterReader`'s new `wire` parameter, and in `runPdfExtract`
  the `place` function and the block after it that drops a context page
- `tests/pdf-chunk-size-policy.test.ts` (new), `tests/stated-limits.test.ts` (new),
  `tests/helpers/synthetic-blocks.ts` (new), `tests/store-artefacts-pg.test.ts`,
  `tests/pdf-read-failure-sentences.test.ts`
- `scripts/eval-big-imports.ts` (the stage-1 harness, changed here) and
  `evals/results/big-imports-2026-10-04/`
- `docs/project/content-extraction.md`, `docs/plans/260928b-pdf-chunk-too-big-for-one-request.md`

That list is where to start, not the limit of scope.

## What it is for

Plan: `docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md`
(read § What we already know, § The plan review, § Decisions). Your own plan review is
`docs/plans/261004f-big-pdfs-plan-review-sol.md`. Stage 1 measured, for free, where an import at
the stated limits (50 MB, 250 pages) breaks. Stage 2 fixes two deterministic failures:

1. `writeBlocks` put every block in one `INSERT`, 17 parameters a row, and failed at 3,856 blocks
   with a protocol error the reader was told to retry. It is now batched, in the same transaction.
2. Plan 260928b's A and B, which were written on 2026-09-28 and never built: the encoded-request
   allowance for a PDF chunk is 40 MiB for the current reader model (was 30 MiB for every model),
   tied to the model by type; and a chunk that is over the allowance only because of its context
   page is sent without the context page.

And one characterisation test, `tests/stated-limits.test.ts`, which pins the known gap between
the stated 250 pages and what the structure step accepts (about 178 pages of a dense paper). That
gap is NOT fixed in this stage; it is a decision for Greg. Do not fix it.

## What you may do

You have a write-capable sandbox. **Fix what is inside this stage, narrowly, red-first** (a test
that fails before your fix). **Report, do not fix, anything wider.** Do not edit `src/fetch.ts`
(a listed security defence), any prompt, any model id, `planChunks`, or the checkpoint key of an
ordinary chunk. Do not write anything as Greg's words. Do not commit.

You have no network and no Postgres. `tests/store-artefacts-pg.test.ts` needs Postgres, so you
cannot run it; I ran it, and the raw output is at the end of this file. These need nothing outside
the tree, so run them yourself:

```
npx vitest run tests/pdf-chunk-size-policy.test.ts
npx vitest run tests/stated-limits.test.ts
npx vitest run tests/pdf-read-failure-sentences.test.ts
```

## Independent pass first

Attack the change before reading my suspicions. Grade by consequence: P0 (data loss, exploitable
security, wrong charging, service unusable), P1 (user-visible wrong behaviour, or an authoritative
contract violated), P2 (design or maintainability risk, no wrong behaviour today), P3 (prose).
Refuse only on an *established* P0 or P1 (direct evidence, no unresolved inference). Number
findings from **F9** upward (F1 to F8 were your plan review), say established or reasoned for
each, give file:line, say which you fixed and which you only report, and end with one line:
`VERDICT: SHIP`, `VERDICT: SHIP WITH THE FIXES I MADE`, or `VERDICT: DO NOT SHIP`.

## My own suspicions, worth less; spend most of the run elsewhere

1. A chunk sent without its context page: is the instruction the model receives the no-context
   instruction, and is everything downstream that reads `chunk.context` (seam mending,
   `continues`, the page-coverage check, single-page recovery after a failed attempt, the
   retry path) consistent with the replaced chunk? Could single-page recovery re-attach a context
   page and hit the limit again?
2. The second checkpoint lookup: can a chunk be both in `cached` and in `bodies`, or in neither?
   Can a context-dropped reading be served to a run that planned the chunk with context?
3. `openRouterReader` skips the missing-key check when given `wire.ask`. Is there any production
   caller that could pass `ask` and so lose that check?
4. `encodedBytes(pdf.byteLength)` replaced `Buffer.from(pdf).toString("base64").length`. Equal for
   every length?
5. 40 MiB: nothing near it has been sent to the provider. If the provider refuses at, say, 36 MB,
   what does the reader see, and is that worse than the old up-front refusal?
6. `inBatches` on an empty array, on exactly one batch, and `rowsPerStatement` if a table had a
   generated column. Is the delete still unconditional? Is the whole write still one transaction?
7. `tests/stated-limits.test.ts`: does any assertion share an assumption with the code so that it
   cannot fail? The agent that wrote it listed the perturbation that turned each red; two
   assertions were not seen red on their own.
8. The harness (`scripts/eval-big-imports.ts`) writes to the shared local database. Does it clean
   up on every path, and can it queue a job another worker will claim?

## Raw output I ran for you

(appended below by me before the run)

```
$ npm run typecheck   (2026-10-04, working tree of the stage-2 commit)
✓ src/web/tsconfig.json  (502 files)
✓ tests/tsconfig.json  (2838 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (893 files)
✓ all 2981 source files are covered by some project

$ npx vitest run tests/pdf-chunk-size-policy.test.ts tests/pdf-read-failure-sentences.test.ts tests/stated-limits.test.ts tests/store-artefacts-pg.test.ts tests/pdf-read.test.ts tests/pdf-chunk-concurrency.test.ts tests/doc-links.test.ts tests/no-undeclared-spend.test.ts
 Test Files  8 passed (8)
      Tests  200 passed (200)

The 4,000-block Postgres test, before the fix (the agent that wrote it, same day):
  FAIL tests/store-artefacts-pg.test.ts > writing artefacts into a draft > writes an article of 4,000 blocks and reads every one back in order
  Caused by: error: bind message has 2464 parameter formats but 0 parameters (08P01)
After: 73 of 73 in that file pass (in the run above).

Harness, after both fixes: evals/results/big-imports-2026-10-04/results-after-batching.json and results-after-fixes-m4.json.
```
