# NO-SHIP

## Findings

1. **HIGH — corrupt filesystem history is misclassified as a first ingest and silently re-mints every ID.**

   `readOne` converts corrupt or oversized JSON to `null` ([artifacts-fs.ts:277](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:277)). `hasEarlierBlocks` therefore returns false when `data/<slug>/blocks.json` exists but is unusable ([artifacts-fs.ts:410](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:410)).

   If stage 3’s copy is also absent, `previousBlocksFrom` returns `undefined` ([blocks.ts:1096](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1096)). The overlap guard then does nothing and `runBlocks` mints and writes a complete new identity set.

   This is exactly the forbidden branch: earlier history exists but is unusable, yet the result is “mint quietly.” A cleaned `output/` plus corrupt/oversized `data/<slug>/blocks.json` can orphan every surviving anchor without an error. File existence or another tri-state signal must distinguish this from genuine absence, with a regression test for corrupt and oversized stage-4 copies.

2. **MEDIUM — an empty extraction bypasses the overlap guard and is marked successful on the filesystem.**

   `assertIdsCarried` returns when `produced.length === 0`, even with a non-empty baseline ([blocks.ts:1126](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1126)). `runBlocks` then overwrites the HTML and blocks file with an empty result.

   Worse, `htmlCarriesItsIds` uses `every`, so an empty blocks array vacuously passes ([pipeline.ts:413](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:413)). A blocks-only run therefore reports done after retaining zero IDs. A full pipeline will probably fail at ToC construction, limiting the blast radius, but the guard should reject an empty output whenever the baseline was non-empty.

3. **MEDIUM — the source scanner still has both silent misses and false alarms.**

   It scans raw characters rather than TypeScript tokens ([blocks-baseline.test.ts:329](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/blocks-baseline.test.ts:329)). Consequently:

   - `splitIntoBlocks(html ?? "missing, retry")` is one argument, but the comma inside the string makes `hasTwoArguments` accept it.
   - `splitIntoBlocks (html)` is missed because the needle requires no whitespace.
   - Aliasing the function also bypasses it.
   - The valid two-argument call `splitIntoBlocks(")", previous)` is falsely accused because the `)` inside the string terminates the scan.

   The comment incorrectly says strings and comments only fail toward false positives. Use an AST-based check, or make the production-facing signature structurally require the baseline.

## Trace and answers

- The normal path does keep IDs: the baseline is read first, `carryOverIds` matches tag plus exact text before its unique folded pass, `runBlocks` checks overlap before writing, and Postgres `writeBlocks` preserves the returned IDs while replacing rows in ordinal order.
- Postgres implements the three branches correctly: no rows/current revision → mint; missing copied rows/current revision present → throw; query failure → propagate.
- `current_revision_id` and the filesystem stage-4 file are not equivalent. The former is durable lineage state; the latter currently means “parseable, non-empty file.” Finding 1 is the consequential mismatch.
- A wholly changed or changed single-block article refuses. An empty baseline mints. Exactly one surviving ID lets any amount of partial loss pass, as specified.
- Baseline ordering is correct on both stores: it is read before filesystem writes and before Postgres’s delete-and-reinsert.
- For ordinary unique paragraphs, I found no new wrong-ID attachment path. Exact duplicate paragraphs remain order-matched, so inserting an identical duplicate can move identity between indistinguishable occurrences; that is the documented matching policy.

Verification: 70 targeted block tests passed; four Postgres cases skipped for the known migration gap. Typechecking could not start because the read-only environment denied `tsx`’s IPC socket, not because of a TypeScript diagnostic.