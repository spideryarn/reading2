You are reviewing a plan in the Spideryarn repo (this working tree). Read-only: do not edit files.

Plan: docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md (read it first).

Context to read as needed: docs/project/skim.md (§ What shipped), docs/project/structure.md, docs/project/block-ids.md, docs/project/mode.md, docs/project/url-state.md; code: src/blocks.ts (§ classify, describeBlock, CAPTION_MARKER), src/types.ts (Block, SkimDepth, SkimStop), src/web/modes/skim/SkimMode.tsx, src/web/SkimPanel.tsx (RouteHead, SkimDoor), src/web/skim-route.ts, src/web/params.ts (depthParam, stopParam), src/web/reader/Reader.tsx (skimControl, SkimDoor wiring, VisitorSkimBand gating, firstSkimArrival/armSkimOpening), src/web/StructurePanel.tsx (Row, measured copies), src/web/OutlinePanel.tsx, src/web/structure.ts, src/web/tree.ts (SummaryNode startRow/endRow), src/sanitize.ts.

Questions:
1. Is the figure classification right given how stage 3 actually produces blocks? Any figure, table or media shape it misses, or false positives (pull-quote figures, decorative images, HR, icons, LaTeXML/PDF output)? Is reading `block.html` for <img>/<table>/etc. sound given what sanitizing leaves?
2. The Skim design: two walks (route vs figures) chosen by ?depth=figures, both publishing the same SkimControl. Will this break anything in Reader (keys, door, arrival tokens, firstSkimArrival which reads ?stop=, passage lifecycle/openKey, the quote ring), in the visitor band, in the auto-run, or in back/forward? Is `?depth=figures` with ?stop=<blockId> a sound address given stopParam/locate? Is there a simpler shape?
3. Structure marks: is counting by startRow/endRow sound for both faces including Expanded and paragraph rows? Risks with the measured copies?
4. Anything the plan leaves out that will turn red (mode.md tables, tests that pin markup like tests/mode-surface-changes-no-markup.test.tsx, url-state tests, dock tests)?
Give a verdict line first (GO / GO WITH CHANGES / NO-GO), then numbered findings with severity and file:line evidence.
