STOP. Do not build this plan as written. The central “mostly publishing twice” claim is false: publication, job state, step freshness, navigation, and reader stability all need new protocol.

## Ranked findings

1. **P0 — Stage 2 does not get the reader in at 20 seconds.**

   The add page navigates only when the job is `done`; a provisional publication leaves it `running` ([AddPage.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AddPage.tsx:176)). `useStepJob` also announces only a whole job reaching `done`, not its `toc` step completing ([useStepJob.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:119)).

   The reader could find the article manually through the shelf, but the primary ingest flow still waits ~350 seconds. Add an atomic job-level “readable revision published” signal and navigate on it. Stages 2 and 3 must be one deployable stage; Stage 2 alone does not deliver its promised outcome.

2. **P0 — The provisional tree cannot use the existing `toc` machinery without suppressing the real ToC.**

   Publication requires a completed `toc` step-run with an input hash matching the blocks ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1142)). Meanwhile `toc` is considered done from the presence of its three outputs—tree, labels and blocks—with no freshness check ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1388)).

   Therefore:

   - Publishing the heading tree as a successful `toc` makes the 320-second ToC skip.
   - Not recording it as `toc` makes publication refuse it.
   - Writing only tree and blocks fails because copying requires every declared product ([copy-artefacts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/copy-artefacts.ts:93)).
   - A provisional `labels.json` manifest is also required, but the plan never specifies one.

   Introduce a distinct `preview-tree` step/publication gate. Never represent preview generation as a completed real `toc`.

3. **P0 — A failure between publications leaves a permanently published unfinished article.**

   The existing finalizer deliberately couples publication and terminal job settlement in one transaction ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:219)). The proposed early publication breaks that guarantee: cancellation, lease expiry, ToC failure, or asset failure leaves the provisional revision live indefinitely while the job says error.

   This needs explicit product semantics:

   - Is a provisional article a successful readable product or a failed ingest?
   - How does the shelf show “readable, upgrade failed”?
   - What does Retry upgrade?
   - May public visitors see it?
   - Should re-ingesting an existing article replace its finished revision with an inferior preview? Almost certainly not.

   Restrict preview publication to first ingests unless there is a strong contrary reason. For re-ingests, retain the existing finished revision until the replacement is finished.

4. **P0 — The “moved something” guard does not protect the second publication.**

   `copyArtefacts` copies every extant step, so `copied.length > 0` can pass because fetch, extract, blocks, or assets moved while the tree remained provisional. Carry-forward preserves the provisional tree and its successful synthetic `toc` row; the gist exemption then lets it publish again.

   “Prove it moved the tree” is also underspecified: `structureHash` is insufficient because the final carving may match the heading tree while adding gists and labels.

   The final transition must prove:

   - live revision is provisional;
   - candidate tree is non-provisional;
   - this attempt completed the real `toc`;
   - its hash matches these blocks;
   - the candidate’s complete tree content—not merely structure—differs appropriately.

   General final publication should reject provisional trees outright.

5. **P0 — Assets still gate the real tree, contrary to the plan.**

   The diagram publishes the real tree only after `assets` ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/faster-ingest-and-concurrency.md:174)). If ToC succeeds after 320 seconds and assets then fails, the reader remains on the provisional tree and the expensive result is unpublished.

   Either publish immediately after `toc` and publish assets separately, or move assets to its own follow-up job. “Assets stops being a gate” cannot coexist with the proposed second publication point.

6. **P0 — The scroll anchor does not survive “by construction.”**

   The URL-to-scroll effect depends only on `at`, not on the tree, sections, layout, or revision ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:936)). When the tree changes but `at` does not, it does not restore the block. The page-to-URL effect then immediately measures the reflowed layout and may overwrite `at` with whatever now occupies the old pixel position ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:947)).

   Snapshot the actual visible prose block before swapping, update the article, restore that block after layout, and suppress the scroll spy until restoration completes. Also reset or translate node-ID state such as open summary branches, focused outline rows, and armed spine cards.

7. **P1 — `provisional` is an informational marker, not safe authority for weakening validation.**

   Current `checkTree` already globally exempts any tree carrying that JSON field ([tree-invariants.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:266)). “The builder sets it” does not make it unforgeable: imports, stale code, a model output, a test fixture, or another writer can set it.

   Keep the marker for rendering, but move permission into a dedicated provisional publisher/checker. Strongest version: recompute the deterministic heading tree from the stored blocks and compare it, rather than trusting a flag. The ordinary publication path should reject `tree.provisional`.

   Another viable design is to keep the heading structure fixed and run a faster gist-only model pass against it. That satisfies the normal invariant and avoids geometry changing, though it gives up the pure 20-second opening.

8. **P1 — Paid-work gating is badly incomplete.**

   The plan names only Arc and Similar. Arc, Ideas, Glossary, Summary, Labels, Tweets, and Sketch all read the tree. The code itself records that several still use blocks-only freshness despite reading the tree ([ideas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:109)). Summary is the worst: it generates against tree nodes but considers itself current using only `hashBlocks` ([summarise.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:775)). A summary bought against the preview can remain falsely current forever.

   Put the refusal server-side at the job boundary for every tree-consuming step. UI gating alone is bypassable. Also hide or invalidate carried tree-dependent artefacts: revisions carry tree, labels, arc, summary, glossary, ideas and sketch, and `loadArticle` currently serves a carried Arc without checking freshness ([pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1318)).

9. **P1 — The ordering conclusion overclaims the evidence.**

   The eval measured top-level carving. It did not measure gists, deeper boundaries, nav labels, layout stability, or comprehension. Those are the actual product. A headingless preview is root-plus-leaves: every paragraph becomes a “section,” coarse zoom has no gists, and the final upgrade completely redefines navigation.

   The 320 seconds changes from time-to-first-prose into time-to-stable-reader. That is better, but it remains reader-visible latency. Medium effort and a fixed-heading gist pass should be measured before being demoted to “cost questions.” Progressive waves may remain lower priority, but “nobody is watching” is indefensible.

10. **P2 — The plan has already drifted from HEAD.**

   The marker, invariant exemption, public DTO passage, and tests are already built. `useStepJob` has six consumers, not five. `sketch` is already converted and absent from `LEGACY_UNCONVERTED_STEPS` ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:405)). Refresh the plan before treating it as a stage contract.

## Recommended recut

1. Keep Stage 1a. Finish the label root cause before committing to partial acceptance.
2. Design a first-class preview publication state: dedicated preview step, atomic `job readable` signal, strict final-publication rejection of previews, failure/retry semantics.
3. Build early navigation, final refetch, scroll restoration, provisional rendering, and all paid-work gates in the same stage.
4. Publish the real tree immediately after `toc`; decouple assets.
5. Measure medium effort or a fixed-heading gist pass before declaring the long upgrade window irrelevant.
6. Then do concurrency and the remaining storage migration.

The core idea—open on a deterministic tree—is good. The proposed boundary around it is not safe yet.