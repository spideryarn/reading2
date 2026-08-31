## Findings

1. **Must-fix — the lookup/regeneration race still exists in another ordering.**

   [`lookUpTerm`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/term-lookup.ts:146) captures the old entry before the model call and later returns the whole old entry plus `lookup` ([line 208](/Users/greg/Dropbox/dev/experim/spideryarn2/src/term-lookup.ts:208)).

   Race:

   1. Lookup captures entry E0.
   2. A glossary job writes E1.
   3. Its refresh completes, installing E1.
   4. The lookup returns E0 plus `lookup`.
   5. No GET is now in flight, so [`patchEntry`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:296) arms no trailing read and replaces E1 wholesale at [line 300](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:300).

   The refreshed name, aliases, prose, scores and blocks can therefore be replaced with stale values. Patch only the `lookup` field; retain the trailing read for the opposite ordering.

   The new lookup test misses this because it tests only “GET still in flight when lookup lands” and does not change the entry’s other fields.

2. **Should-fix — the revision projection test still does not inspect the queries.**

   [`store-revision-columns.test.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-revision-columns.test.ts:87) proves that projection objects match the policy. It does not prove that `currentRevision`, `listArticles`, or publication use those objects.

   Reverting [`currentRevision`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:418) to `revision: articleRevisions`, or publication’s [selection](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1155) to `.select()`, leaves this test green and still typechecks. The generated-SQL assertions cover the two block queries, not these revision queries. This is the fourth test that can pass while its named protection is broken.

3. **Should-fix — `clear()` retains an unrelated read error.**

   [`clear()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:265) resets every read field except `error`. After a failed background revalidation, a successful reset therefore continues displaying that old failure above the cleared list through [`GlossaryPanel`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/GlossaryPanel.tsx:201). A later successful GET clears it, but a failed regeneration can leave it indefinitely.

4. **Should-fix — trailing state survives the slug lifecycle and can cause an extra GET.**

   The direct slug-change reset does not clear `trailing` ([line 245](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:245)), so an old armed refresh can become an unnecessary second fetch for the new slug. Production keys `Reader` by slug, but there is also no unmount cleanup: the old instance can finish and launch a trailing GET for the article already left.

5. **Note — `refresh()` resolves before the refresh it promised completes.**

   When joining, it returns the current promise ([line 225](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:225)); the trailing request is launched without awaiting it ([line 211](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:211)). No current caller awaits `refresh`, so this is not presently observable, but the exported promise contract is misleading.

The remaining trailing logic holds: a refresh arriving during the trailing fetch arms another fetch; finite invalidations do not loop; and `clear()` discarding the old trailing refresh is correct for reset. Because lookup storage is awaited before the POST returns, a trailing GET started after that response is guaranteed to begin after the save.

Tests could not run in this read-only sandbox because Vitest needs `.vite-temp`. Direct typechecking found no errors in the scoped source; unrelated concurrent test-tree errors remain outside this diff.

**Verdict: not safe to commit.**