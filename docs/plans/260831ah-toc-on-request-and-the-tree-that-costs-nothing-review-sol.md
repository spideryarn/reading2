STOP. Do not build the stages as written. The core block-id premise survives inspection, but the ingest, publication, job, and reader protocols do not.

### Verified premise

The load-bearing part is true: `toc` does not change block text, IDs, order, roles, or treatments.

- [`pipeline.ts`](/home/greg/code/spideryarn2/src/pipeline.ts:1710) passes the blocks step’s artifact directly to `generateToc`.
- [`toc.ts`](/home/greg/code/spideryarn2/src/hierarchy.ts:1516) returns `blocksArtefact(blocks)`.
- [`sanitize.ts`](/home/greg/code/spideryarn2/src/sanitize.ts:147) can rewrite only `block.html`; it cannot change `text`, IDs, order, roles, or treatments.
- I re-applied `blocksArtefact` to all 21 current `output/*.blocks.json` artifacts: none changed.

The stronger “byte-identical on every path” claim is conditional. Dirty or legacy HTML can be changed by the second sanitization. Also, [`hashBlocks`](/home/greg/code/spideryarn2/src/source-hash.ts:112) ignores HTML, so the current source-hash assertion cannot prove byte identity. Stage 1 should pin exact idempotence separately, but this is not a prose-or-ID corruption blocker for current stage-3 output.

## P0 findings

1. **NO-SHIP, Stage 2: removing `toc` breaks the default filesystem ingest at `assets`.**

   [`pipeline.ts`](/home/greg/code/spideryarn2/src/pipeline.ts:867) computes the assets input hash from `(toc, blocks)`, and the assets runner reads the same artifact at line 1861. Once `toc` leaves the default steps, both return null and assets fails with “run the toc step first.”

   Postgres happens to map `(blocks, blocks)` and `(toc, blocks)` onto the same rows, but the filesystem mappings are distinct in [`artifacts-fs.ts`](/home/greg/code/spideryarn2/src/store/artifacts-fs.ts:133). The plan deliberately lands before the database flip, so this breaks the ordinary ingest immediately. Both the assets read and its freshness stamp must use the canonical block-stage artifact.

2. **NO-SHIP, Stage 2: “blocks publishes a tree” is not an implementation or publication protocol.**

   The blocks step currently owns `output/<slug>.blocks.json`; the reader requires the pair `data/<slug>/blocks.json + tree.json` ([`api.ts`](/home/greg/code/spideryarn2/src/api.ts:198)). Merely returning an extra tree is rejected by [`checkProduct`](/home/greg/code/spideryarn2/src/store/session.ts:357), because `blocks` does not declare or map that product.

   Even after adding the mapping, Postgres publication still refuses any revision without a completed real `toc` run ([`pg-revisions.ts`](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1175)). The plan needs an explicit provisional publisher that:

   - stores the tree and its exact block pair;
   - proves it is the deterministic heading tree;
   - does not manufacture a completed `toc`;
   - publishes atomically with job completion.

   Stage 2 cannot ship until that protocol exists.

3. **NO-SHIP, Stage 2: carried `toc` completion can permanently suppress the real ToC.**

   `toc` has no freshness stamp; [`stepIsDone`](/home/greg/code/spideryarn2/src/pipeline.ts:835) trusts completed outputs. New Postgres drafts copy both artifacts and completed step-run rows from the published revision ([`pg-revisions.ts`](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:668)).

   Therefore, if a blocks rerun writes a provisional tree over a draft carrying an old completed `toc`, the later unforced `{steps:["toc"]}` job can skip. If the blocks hash is unchanged, publication can even accept the provisional tree under the copied real-ToC receipt.

   The implementation must either keep provisional and real trees in distinct ownership states, invalidate the carried `toc` receipt when provisional is written, or force `toc` while proving this attempt actually ran it.

4. **NO-SHIP, Stage 2: the re-ingest requirement is internally contradictory.**

   Refresh uses the default step list and forces from `fetch` onward ([`jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:1498)). With `toc` absent:

   - Publishing the refreshed blocks requires replacing the old tree with a provisional tree, which downgrades the article.
   - Preserving the real tree leaves it describing old blocks and ranges.
   - Refusing to publish until a real ToC exists restores the 350-second refresh.

   “A re-ingest never downgrades a real tree” needs a concrete policy: retain the old published revision until a requested/background ToC finishes, or keep `toc` in changed-content refreshes. The current verification sentence cannot be satisfied by the proposed default pipeline.

5. **NO-SHIP, Stages 2–4: the paid-work gate is two stages too late.**

   [`useArc.ts`](/home/greg/code/spideryarn2/src/web/useArc.ts:126) mounts on every owner article and automatically starts `arc` whenever it is absent or stale—even in Plain mode. Publishing a provisional tree in Stage 2 therefore immediately buys an arc against that provisional tree, defeating the plan’s latency/spend premise.

   The gate must precede provisional publication. It also must coordinate `toc` before `arc`: only one different job may run per slug, and [`jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:1639) returns 409 to the loser. Otherwise an automatic arc job can block the hierarchy-triggered ToC job.

6. **NO-SHIP, Stage 3: changing AddPage’s whole-job gate creates an unreadable navigation race.**

   [`AddPage.tsx`](/home/greg/code/spideryarn2/src/web/AddPage.tsx:176) navigates on `job.status === "done"`. Once the default job no longer contains `toc`, that already produces the claimed ~27-second navigation. No change is needed.

   Navigating earlier has no atomic “readable revision published” signal. It can open a 404 or the prior revision, and the ingest job still owns the slug, so entering Hierarchy immediately gets a 409 when it tries to enqueue `toc`.

7. **NO-SHIP, Stage 3: copying `useArc` cannot refresh the article, and the reader-visible swap still races position.**

   `useStepJob` can call a completion callback, but [`useArticleAccess`](/home/greg/code/spideryarn2/src/web/App.tsx:426) has no reload seam. It fetches only when slug or reader identity changes. A ToC job can finish while the mounted reader continues showing the old provisional tree indefinitely.

   Even after adding refetch, the prior scroll P0 remains. [`useReadingPosition`](/home/greg/code/spideryarn2/src/web/App.tsx:946) restores the URL position only when `at` changes. A tree replacement changes sections and layout, immediately remeasures, and can overwrite `at` with the block now occupying the old pixel position. Request-triggering makes this more likely, because the reader has explicitly entered the tree-dependent mode.

   Snapshot the visible block, suspend the scroll spy, replace the article, restore that block after layout, and reset provisional node-ID state.

8. **NO-SHIP, Stage 2: PDFs and headingless articles cannot retain today’s default behavior.**

   Job steps are fixed at enqueue time from the static `DEFAULT_INGEST_STEPS` ([`jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:1544)), before extraction knows whether the source has headings.

   [`buildHeadingTree`](/home/greg/code/spideryarn2/src/heading-tree.ts:280) already produces a flat provisional root-plus-leaves tree when no usable headings exist. Removing `toc` globally therefore removes it for PDFs too. There is no conditional step injection matching the anti-goal. The plan must either accept the flat durable fallback or introduce an explicit post-block conditional workflow.

9. **NO-SHIP for the sibling database change: the 27-second lease claim is false.**

   An on-demand `toc` is still a job using the same claim machinery and has a measured budget of 320.4 seconds ([`jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:258)). Shrinking `LEASE_MS` on the claim that jobs now last ~27 seconds will self-abort the requested ToC.

   Post-database handoff may permit returning to a roughly one-step-sized lease, but it still must exceed `toc` plus the deadline margin. The database plan must not inherit the 27-second arithmetic.

10. **NO-SHIP, Stage 1 as scoped: public `tree: null` is neither invisible nor necessary.**

   Every published readable article is supposed to receive a provisional tree atomically. Tree-less drafts should therefore remain internal, not become a public wire state.

   Today the reader unconditionally builds geometry from `article.tree` even in Plain mode ([`App.tsx`](/home/greg/code/spideryarn2/src/web/App.tsx:1132)); provenance, stats, outline, summary, and TableView also dereference it. Both owner and public database readers explicitly reject a null tree ([`pg.ts`](/home/greg/code/spideryarn2/src/store/pg.ts:1786), [`public-reader.ts`](/home/greg/code/spideryarn2/src/store/public-reader.ts:438)).

   Making the public payload nullable either does nothing, because publication continues refusing it, or introduces a client-crashing state. Keep the public `Article.tree` non-null and model any internal draft absence at the stage-input seam. Landing broad nullability before the database flip weakens a contract the database move currently relies on.

## P1 findings

11. **The provisional marker is still being treated as authority.**

   [`tree-invariants.ts`](/home/greg/code/spideryarn2/src/tree-invariants.ts:267) exempts any JSON tree carrying `provisional` from the gist invariant. The claim that “a bug cannot accidentally produce” the marker is unenforced.

   A provisional publication gate must recompute `buildHeadingTree(storedBlocks, ...)` and compare the candidate, not merely trust the flag. Normal publication should continue requiring a real completed `toc`.

12. **The visitor hole is a broken mode, not merely a less-good tree.**

   The client does not currently branch on `tree.provisional`, despite [`public/dto.ts`](/home/greg/code/spideryarn2/src/public/dto.ts:257) claiming it does. Hierarchy renders every gistless internal node like a leaf ([`TableView.tsx`](/home/greg/code/spideryarn2/src/web/TableView.tsx:854)); Summary reports “No summary for this section” ([`SummaryPanel.tsx`](/home/greg/code/spideryarn2/src/web/SummaryPanel.tsx:437)). Visitor policy nevertheless declares Hierarchy, Outline, and Summary available ([`visitor.ts`](/home/greg/code/spideryarn2/src/web/visitor.ts:188)).

   A visitor cannot start the job, so these are permanent misleading states until the owner happens to request a ToC. Stage 3 needs an explicit public fallback/message or a policy ensuring shared articles receive a real tree.

13. **Stage 4’s freshness inventory is stale and misses a direct paid consumer.**

   There is no summary pipeline stage now; Summary reads tree gists. The actual seven article-reading stages are `arc`, `tweets`, `glossary`, `ideas`, `quotes`, `timeline`, and `sketch`, and their current fingerprints already include the tree.

   The remaining missed tree-consuming paid path is `POST /api/similar`: [`routes.ts`](/home/greg/code/spideryarn2/src/routes.ts:4344) passes the provisional tree into similarity grouping. Its server cache key includes `structureHash`, so it will not stay permanently current, but the client result remains based on the provisional grouping and the article is embedded again after replacement. This route must join the pre-publication paid-work gate.

Of the earlier six P0s, only the failure window between an early and final publication is genuinely dissolved, because a provisional article is now intended to be a successful state. The old assets-final-gate problem also disappears for a true ToC-only job. AddPage and scroll remain; provisional-vs-real completion and final publication have moved into carried step-run state; and paid-work gating is currently ordered too late.