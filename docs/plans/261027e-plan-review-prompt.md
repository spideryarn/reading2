You are reviewing a plan, read-only. Do not edit files.

Plan: docs/plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md. Read it in full, then the code it changes: src/pdf-figures.ts (`pairPageFigures`), src/collect-pdf-figures.ts (the whole run, `locatedRoute`, `compositeRegion`, `LOCATABLE`, `MAX_LOCATE_CALLS`), src/pdf-figure-region.ts (`inkComponents`, `withoutFurniture`, `judgeLocatedRegion`), src/pdf-figure-locate.ts (`judgeLocatedBox`), and docs/project/article-images.md § Decisions for the history of each rule.

Evidence, not in the repo (the PDF's licence is unclear): the measurement script and the replay harness are /tmp/claude-1000/-home-greg-code-spideryarn2/1ae3039e-5b97-43ea-ab29-64ab10903cc8/scratchpad/measure.ts and full.ts; the PDF is .../scratchpad/pdf/lecun.pdf, production's blocks are .../scratchpad/blocks.json. You may run them with `npx tsx <script> ...` (read the scripts first) if you want to check a number.

The product bar, Greg 2026-10-01: "I'd rather accidentally pull in a bit of extra stuff that got included within the bounding box than have no figure imported at all." What is not accepted: a wrong picture under a caption, or a region tied to the wrong caption.

Questions I most want answered:
1. Is the in-a-drawing rule (chain touching ink from the picture's visible box; refuse when the drawing's box ≥ 3× the picture's area) sound? Which real layouts would it misfire on, in either direction — e.g. a photo with callout arrows, a raster heatmap with a drawn colour bar, a figure whose frame touches the caption rule, multi-panel figures with a bitmap panel and vector panels?
2. Failing open when the layout read fails — right or wrong?
3. The 0.25 share for picture identity in composite regions: does it reopen the cross-page duplicate risk Sol's 261001q P1 closed, in a way the caption-beside-region proof does not cover? Suggest a better criterion if there is one.
4. Raising MAX_LOCATE_CALLS 8 → 16: anything it breaks (budget, looks cap, tests)?
5. Anything the plan misses about why these seven figures failed, or another place the "a picture is a whole figure" assumption lives.

Write findings ranked by severity, each with file:line evidence and a concrete suggestion. Say plainly if you agree with a part.
