1. **High — [src/pdf-figure-locate.ts](/var/tmp/spideryarn-worktrees/qi-ab5x79na-uncaptioned-figures/src/pdf-figure-locate.ts:420):** an incomplete adjacent run could retain one located picture even though order was its only distinguishing evidence. Fixed by requiring every indexed member before keeping any; added a red-then-green integration regression.

2. **Medium — [src/collect-assets.ts](/var/tmp/spideryarn-worktrees/qi-ab5x79na-uncaptioned-figures/src/collect-assets.ts:499):** separate runs with identical prose were grouped under the same key, causing unrelated runs to interfere. Fixed with a marker-derived run identity, included in freshness hashing.

3. **Low — [src/collect-pdf-figures.ts](/var/tmp/spideryarn-worktrees/qi-ab5x79na-uncaptioned-figures/src/collect-pdf-figures.ts:292):** trimming the caption while constructing `LocateSubject` subtly changed the established caption prompt path. Fixed: trimming now checks eligibility only; the original caption reaches the prompt unchanged.

4. **Low — [tests/collect-pdf-figures.test.ts](/var/tmp/spideryarn-worktrees/qi-ab5x79na-uncaptioned-figures/tests/collect-pdf-figures.test.ts:1238):** the overlapping-page cache and high-page-to-low-page restart had no regression test. Fixed with deterministic coverage proving reuse, bounded eviction, and rereading after restart. Added document-edge, empty-media, repeated-prose, and incomplete-run tests too.

5. **Low — [src/models.ts](/var/tmp/spideryarn-worktrees/qi-ab5x79na-uncaptioned-figures/src/models.ts:409):** several comments still described the locator as caption-only or linked the superseded Stage B. Fixed across the affected source and project documentation.

The PDF y-up comparisons are correct. I found no unresolved manifest-completeness, cache-staleness, cap/order, alt-text, or freshness defect.

Commands:

- Red regression: 2 expected failures, proving the incomplete-run bug.
- Requested Vitest command: **6 files passed, 216 tests passed**.
- `node --import tsx scripts/typecheck.ts`: **passed all projects; 3,846 files covered**.
- Targeted Biome lint: **exit 0**; 11 advisory complexity notices remain as wider existing debt.

SHIP AFTER MY FIXES