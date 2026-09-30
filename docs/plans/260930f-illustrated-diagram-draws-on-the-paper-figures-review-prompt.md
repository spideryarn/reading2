# Review request: plan 260930f (Illustrated diagram draws on the paper's own figures)

You are reviewing a PLAN, read-only. Repo: Spideryarn (TypeScript, ESM). Read:

- docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md (the plan)
- src/illustrated.ts (brief prompt SYSTEM, renderPrompt, imagePrompt envelope, drawPlates, inputFingerprint)
- src/illustrated-plate.ts (readModelBrief, the artefact types, ILLUSTRATED_VERSION)
- src/ai-call.ts around `openRouterImage` / `outgoingImage` / `ImageReference`
- src/pipeline.ts, the `illustrated` step (search `illustrated: {`)
- src/assets.ts, src/collect-assets.ts (imagesIn, pdfFigureMarkersIn, assetIndex, imageDimensions)
- src/store/pg.ts `illustratedIsCurrent` and `loadIllustrated`
- docs/project/diagram.md § "The fifth: Illustrated" and docs/project/article-images.md

The goal (the admin's words): "For the illustrated diagrams, make sure we feed in the figures from
the paper, and perhaps it can try and sort of create or incorporate those somehow as part of the
montage." Articles with no figures must behave exactly as today.

Please find: design flaws, silent-success traps (a check that passes while doing nothing), things
that will not work as described (e.g. the lettering rule vs charts, the reference ordering, the
data-URL size, fingerprint/staleness consequences, anything about how the stored bytes or PDF
figure entries are actually addressed), simpler alternatives that get most of the value, and
anything the plan claims about the code that is false. Rank findings P0/P1/P2, each with the file
and line evidence. Be concrete. Write your findings as your final answer.
