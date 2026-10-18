# Plan review: 261018a front and back matter marked at import and folded by default

You are reviewing a PLAN, read-only, in the repo at the current working directory (Spideryarn, a TypeScript reading app). Nothing is built yet.

Read first:
- docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md (the plan)
- AGENTS.md (house rules), docs/project/block-ids.md (ids, range checks by index)
- docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md (the display rule this extends, and its review)
- src/web/fold.ts, src/web/front-matter.ts, src/web/FoldToggle.tsx, src/web/TableView.tsx (how rows are hidden; the front run)
- src/front-matter-authors.ts, src/models.ts, src/ai-call.ts (the Haiku pass the classifier copies)
- src/step-order.ts, src/pipeline.ts (`hashBlocks`, the labels step's stamp), src/store/pg.ts (REVISION_READ_POLICY, artefact columns), src/store/artifacts.ts
- src/block-policy.ts, src/supplement.ts, src/types.ts (Block.role / treatment)
- src/web/StructurePanel.tsx and src/web/structure.ts (Structure rows)

Questions I most want answered:
1. Is a separate `matter` jsonb column + step the right home, versus Block.role? Is my claim right that writing role after stage 3 restamps everything downstream (hashBlocks), and that putting a model call inside stage 3 is wrong?
2. Is the classifier's input/answer shape (opening window, all headings, closing window; stretches of shown ids, or a `section` by heading) sound? What checks are missing that would let it fold the article's own prose? Is "a stretch of shown blocks lies wholly in the opening or wholly in the close" too strict or too loose?
3. The stub design: the first row of a shut stretch stays on screen as a stub, rest hidden. What breaks in fold.ts's consumers (reading position, keynav, Structure focus, marginalia, `visibleFrom`, `isFoldedAway`) given 261007d's lessons? Is replacing the masthead's control right?
4. Staleness: `matter` keyed on hashBlocks — what happens on re-extraction where ids are preserved but text changed, on a draft revision copied from a published one (beginDraftIn), and on old articles with no column?
5. Anything that touches a listed defence (security-map.md) that I have missed. The model sees a stranger's text: is the output safe to render?
6. Is there a simpler version that gets most of the value?

Severity scale: P0 (would ship broken or harm readers' data), P1 (a real defect or a design error to fix before building), P2 (worth doing, not blocking), P3 (nit). Give each finding an ID (F1, F2…), a severity, the evidence (file:line), and a concrete fix. End with a verdict line: "VERDICT: build as planned" or "VERDICT: revise before build" or "VERDICT: rethink".
