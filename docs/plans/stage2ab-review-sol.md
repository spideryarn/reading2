# NO-SHIP

The production code appears correct, but two claimed regression protections admit compiling mutations that recreate the exact stamp/bytes fault class. Under the repository’s silent-success rule, those gaps block committing.

## Blocking findings

1. **[P1] The blocks seam tests accept mismatched HTML and blocks.**

   At [blocks.ts:1528](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1528), mutate only the returned HTML’s paragraph text while preserving IDs. Both tests at [blocks-baseline.test.ts:483](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/blocks-baseline.test.ts:483) still pass: IDs exist, all three are reused, and none are minted.

   Postgres then atomically commits a pair whose blocks describe different bytes. The next `blocksMatchTheirHtml` check rejects it and the stage repeats forever.

   The test must replay the original extracted HTML with the returned blocks and require both HTML and blocks to match exactly:

   ```ts
   const replay = splitIntoBlocks(EXTRACTED, run.blocks);
   expect(replay.html).toBe(run.html);
   expect(replay.blocks).toEqual(run.blocks);
   ```

   Current implementation is sound: both values come from one `SplitResult`. The missing part is the claimed seam protection.

2. **[P1] The metadata fallback test does not prove that the hash describes the prompt.**

   At [ideas.ts:849](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:849), add `byline: "Unknown"` to the fallback stub. The prompt gains `BY: Unknown`, while the source hash and pipeline stamp still fingerprint `null`. Both new test suites remain green because they compare the same fingerprint helper and merely check that the prompt contains `TITLE: slug`.

   Therefore:

   - Hashing real `null` is correct today.
   - Hashing the present stub is also correct today; they canonicalise identically.
   - The load-bearing property is not “hash null rather than the stub.” It is “every fallback field rendered into the prompt is represented in the fingerprint.”

   Assert the complete fallback head, including the absence of additional fields, or centralise the fallback representation used by both prompt rendering and fingerprinting.

   Several claims are consequently false:

   - [finish-the-database-move.md:324](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/finish-the-database-move.md:324)
   - [stage-stamp-agreement.test.ts:16](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stage-stamp-agreement.test.ts:16)
   - [meta-fallback-fingerprint.test.ts:24](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/meta-fallback-fingerprint.test.ts:24)
   - The corresponding “test pins this” comments in `ideas.ts` and `sketch.ts`.

3. **[P2] The ToC atomicity explanation is false on the filesystem.**

   [toc.ts:1526](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:1526) says all three artefacts “land together or not at all”; [pipeline.ts:1782](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1782) repeats it. But [session.ts:402](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:402) correctly states that `fsStoreSession` has no transaction, and its write is sequential.

   The conversion is safe, but for different reasons:

   - On filesystem: the running marker makes retries rerun after a partial write.
   - On Postgres: the store transaction makes the artefacts atomic.
   - One `parts` map centralises ownership; it does not itself provide filesystem atomicity.

## Four adjudications

1. **Blocks tests:** not enough; the preserved-ID/text-corruption variant above passes.
2. **ToC write order:** removing stage-owned ordering is right, but the stated atomicity mechanism is wrong.
3. **ToC stamp:** correct. `inputHash` alone must agree with the labels artefact; adding `toc/2`’s `promptVersion` would conflict with `labels/1`. Omitting `PipelineStep.stamp` is deliberate and correct.
4. **Checkpoint cleanup:** correct trade. Calling it inside `run` is too early. Leaving the file is consistency-safe until the later checkpoint redesign.

## Hard blocker before the actual flip

A failed forced refresh currently loses completed refreshed work on retry:

1. Published R1 exists.
2. A forced job writes new fetch/extract/blocks into a draft, then fails at ToC.
3. The failed draft is discarded at [pg-session.ts:371](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-session.ts:371).
4. Retry only forces from the first unfinished step at [jobs.ts:2079](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:2079).
5. Its new draft copies published R1, so earlier steps skip and ToC runs over R1. Retry reports success while silently losing the refresh.

This is not a stage-2a/2b defect, but Stage 3’s generic “retry” bullet needs this exact case. Retry must re-force from the earliest originally forced step or safely retain the failed draft.

The already documented `slugIsSpokenFor`, exact-base verification, importer-disablement, and `openPgStoreSession` work also remain genuine pre-flip requirements. The flip is not literally just replacing a constructor with bare `pgStoreSession`.

## Other checks

- I found no current stamp/bytes disagreement in the seven article stages or ToC.
- Postgres stamp and run reads are correctly bound to the same draft revision.
- The false claim that Stage 2 closes the production outage has been removed.
- [article-input.ts:4](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-input.ts:4) still names removed `summary` and says seven stages read all three files; the actual shared-Article generators are six, while assets reads blocks only.
- No unacknowledged scope expansion found; the eval and asset caller changes are necessary API adaptations.

Relevant targeted run: **178/178 passing**. Typecheck is clean. The current shared tree did not reproduce the reported full-suite snapshot: I saw **6 failed tests plus 2 failed suites**, with timeline now passing and additional contention/timing failures. None implicated the scoped stage code, but the stated 6,993/5 result is no longer verifiable from this tree.