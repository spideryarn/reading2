The plan should not be approved as written. The checkpoint premise is conditionally correct, but the arc claim is false and a re-cut tree affects more downstream artefacts than the plan accounts for.

## Findings

1. **Blocker — the arc does not self-heal after this one-step job.**

   The pipeline documents this exact failure: `steps: ["structure"]` never reaches `arc`, and unmatched old arc ranges are silently omitted ([pipeline.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/pipeline.ts:3878), [pipeline.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/pipeline.ts:4482)). `loadArticle` nevertheless embeds the stored arc without checking it against the new tree ([pg.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/store/pg.ts:3174), [pg.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/store/pg.ts:3195)). Once embedded, `useArc` initializes it as ready and deliberately skips `/api/arc`, so the route’s correct freshness check is never consulted ([useArc.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useArc.ts:110), [useArc.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useArc.ts:174), [pg.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/store/pg.ts:4906)).

   There is already a correct precedent: Structure’s fallback retry explicitly queues an unforced arc after Structure finishes because `useArc` cannot repair this ([StructureNotice.tsx](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/StructureNotice.tsx:131)).

   **Fix:** add arc repair to the plan. The smallest durable change is for `loadArticle` to omit an arc when `arcIsStale` against the current blocks/tree/meta; then `useArc` takes its existing absent → unforced regeneration path on the next open. Add a regression test for a same-version arc whose tree ranges changed. Alternatively, share StructureNotice’s explicit post-Structure arc chaining. Delete the plan’s “arc needs nothing extra” claim.

2. **High — other tree-derived artefacts are omitted from the impact analysis.**

   The common article fingerprints include `structureHash`, covering node ranges, titles and gists ([source-hash.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/source-hash.ts:199), [source-hash.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/source-hash.ts:450)). Therefore a genuine re-cut can mark Arc, Thread, Glossary, Quotes, Ideas, FAQ, Quiz, Sketch, Reception and Bibliography stale.

   Two especially relevant consequences:

   - Cross-references hash the rendered top-level tree ([crossrefs-fingerprint.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/crossrefs-fingerprint.ts:46)). When stale, the prose silently draws no links, and the hook refreshes only after a `crossrefs` job—not after Structure ([useCrossrefs.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useCrossrefs.ts:20), [useCrossrefs.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useCrossrefs.ts:124)).
   - Skim includes the outline in its route hash and becomes stale when it moves ([skim.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/skim.ts:768)). Its automatic run is for `none`, not an existing stale route, so it does not self-heal ([useSkim.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useSkim.ts:427)).

   Explanations and Relations are normally unaffected: their tree input supplies only the fallback title when metadata is absent ([explanations.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/explanations.ts:171), [relations.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/relations.ts:159)).

   **Fix:** add an explicit downstream-artifact table to the plan and decide each outcome. At minimum, fix Arc, make stale Cross-references visible or regenerate them, and warn that other AI modes may show as out of date after a changed tree. Do not silently buy all those calls.

3. **High — unchanged inputs do not guarantee a free replay or unchanged output.**

   The checkpoint keys are correct and exact. Structure hashes the whole request/model/effort/IDs and replays a usable answer ([structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:2906), [structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:2963)). Labels similarly fingerprint each exact batch and grouping ([labels.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/labels.ts:1212), [labels.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/labels.ts:2723)).

   But an unchanged request only produces the same key. A missing, unreadable or unusable Structure checkpoint buys a fresh call ([structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:2936), [structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:3089)); checkpoint writes are deliberately best-effort ([structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:3152)). A labels read failure reruns every batch ([labels.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/labels.ts:2620)). Older articles may never have had these checkpoints.

   The proposed “Unchanged if nothing about Structure has changed” is therefore too strong. A cache miss can spend the full cost and, because generation is nondeterministic, change the tree.

   The page-wide copy is also false for Structure: it promises that the current result stays until the new run succeeds ([Metadata.tsx](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/Metadata.tsx:1847)), while Structure deliberately publishes an empty label manifest ([structure.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/structure.ts:3408)) and only then queues the labels successor ([pg-revisions.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/store/pg-revisions.ts:2681)).

   **Fix:** say something like: “Usually reuses saved Structure and label answers when the same requests are still cached; otherwise it can make a full new outline and labels. Paragraph labels are hidden after the outline lands until their follow-up finishes.” Amend the shared Metadata intro or special-case it for Structure.

4. **High — the plan’s stated test change will fail, but changing the force set would be wrong.**

   `tests/metadata-rerun-steps.test.ts` currently requires every member to belong literally to `FORCE_ONLY_WHEN_NAMED` ([metadata-rerun-steps.test.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/tests/metadata-rerun-steps.test.ts:97)). Structure deliberately does not belong there because, in a multi-step job, forcing Structure must invalidate Labels ([pipeline.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/pipeline.ts:619)).

   Runtime behavior for the proposed one-step job is safe: `cascadeForce` can return only steps present in that job, so `["structure"]` forces only Structure ([jobs.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/jobs.ts:1154)). `unrunnableStepPlan` refuses only Blocks without Structure, so Structure alone is runnable ([jobs.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/jobs.ts:1193)).

   **Fix:** change the test to assert the real property:

   `cascadeForce([step], new Set([step]))` equals `{step}`.

   Do not add Structure to `FORCE_ONLY_WHEN_NAMED`. Update `useStepJob`’s comment, which currently describes Structure as an exception belonging only to `StructureNotice` ([useStepJob.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/useStepJob.ts:89)).

5. **Medium — the generic row stops tracking the press before its labels finish.**

   Metadata’s row watches only jobs containing its named step ([Metadata.tsx](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/Metadata.tsx:2118)). The labels work is a separate successor. Once the Structure job publishes, the Structure button can return while labels are still queued or running. The command bar’s `rerunHeld` guard does not close this gap: StructureNotice does not create a rewrite hold, and the guard is keyed only to Structure ([CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/CommandBar.tsx:749), [rewrite-hold.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/rewrite-hold.ts:142)).

   **Fix:** either give Structure a dedicated row/controller that treats Structure plus its labels successor as one lifecycle, or keep the row disabled and showing progress until `navLabelStatus`/the labels job settles. This is another reason not to treat Structure as an entirely ordinary member of the generic list.

6. **Medium — several required documentation/code signposts are missing from the plan.**

   The plan names `structure.md`, but the stale operational instruction is in `structure-step.md`: it still says Structure is deliberately absent from Metadata and must be run from the CLI ([structure-step.md](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/docs/project/structure-step.md:1517)). `StructureNotice` says the same in code ([StructureNotice.tsx](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/web/StructureNotice.tsx:117)). Both must change.

   The new command row also changes the generated command catalogue; its test documents the required regeneration command ([command-pick-catalogue.test.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/tests/command-pick-catalogue.test.ts:15)). Add that generated file and test to the build checklist.

## Verified as sound

- A usable matching Structure checkpoint and all matching label-batch checkpoints do replay without model calls.
- A one-step forced Structure job neither cascades into another named step nor trips `unrunnableStepPlan`.
- Reader-owned comments, bookmarks, notes and highlights are unaffected. Structure reuses the existing blocks and IDs; those records point to permanent block identities, not revisions ([schema.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/db/schema.ts:1731), [schema.ts](/var/tmp/spideryarn-worktrees/fbgkmgdd-reimport-and-rerun-structure/src/db/schema.ts:2669)).
- The reset command’s experimental gating and aliases have no observed collision. With the proposed row present, the four command-matcher suites passed: 62 tests. The command catalogue suite also passed: 13 tests, 2 skipped.
- `mode.md` needs no change because this adds no mode or mode shape. The Explanations test should remain unchanged: Explanations is still deliberately outside `METADATA_RERUN_STEPS`.