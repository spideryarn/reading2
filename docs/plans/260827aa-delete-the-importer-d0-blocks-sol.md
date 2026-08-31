NO-SHIP

1. **Low — verified: the new failure offers a Retry that cannot work.** `NoBlocksProduced` is a plain error ([src/blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1097)), and the pipeline does not classify it ([src/pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1034)). I confirmed `failureKindOf` returns undefined and `jobWorthRetrying` returns true. Retry skips the completed fetch/extract stages, feeds stage 3 the same empty HTML, and fails identically. This directly contradicts the error’s “re-running stage 3 … will produce nothing again.”

   Smallest correction: catch `NoBlocksProduced` at the pipeline boundary and rethrow `stageFailure("blocked", err.message)`. Add a test pinning its failure kind and absence of Retry.

Everything else checks out:

- The guard runs after pure computation and before both writes ([src/blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1252)). `splitIntoBlocks` mutates only its new DOM and local collections, not the source file or baseline.
- Guard order is correct: `assertIdsCarried` runs first. The existing empty-output/full-baseline test remains unchanged and still expects `IdsNotCarried` ([tests/blocks-baseline.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/blocks-baseline.test.ts:330)).
- The fixture is real. Running `splitIntoBlocks(SHELL)` produced `blocks: []` and `stats.total: 0`. Without the new guard, `runBlocks` reaches both writes, so the rejection test fails.
- Short prose, media blocks, and already-stamped non-empty HTML remain accepted. Empty PDF transcription is already refused upstream; importer code does not call `runBlocks`; carried draft rows make `IdsNotCarried` win. The CLI’s new failure is deliberate.
- The read-side clause is live: old filesystem artefacts containing `{"blocks":[]}` pass the store’s shallow shape check, and only [htmlCarriesItsIds](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:434) prevents them being skipped.
- The two sequential writes can still be interrupted between files, but the existing step-attempt marker keeps such a run not-done. This patch adds no half-written refusal path.

Trace: I read the supplied four-file diff, D0 plan and prior review, `vision.md`, `block-ids.md`, `silent-success.md`, the block splitter and callers, filesystem/Postgres stores, draft carry-forward, PDF extraction, importer references, runner retry/error handling, and relevant tests. I ran the shell fixture directly, the failure-kind probe, scoped Biome lint, `git diff --check`, and typechecking through `node --import tsx`; all three TypeScript projects passed, while the coverage wrapper reported two unrelated unchecked files under `output/lift*`. Vitest could not execute because the read-only sandbox denied its Vite temporary-cache writes. I changed nothing and ran no database command.