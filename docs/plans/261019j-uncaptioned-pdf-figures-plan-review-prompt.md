You are reviewing a plan, read-only, in the repository at the current directory (Spideryarn; read CLAUDE.md for conventions).

The plan: docs/plans/261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md

Background you should read:
- docs/plans/261019e-uncaptioned-pdf-figures-are-kept.md (Stage A, already on dev) and your own earlier review of it, docs/plans/261019e-uncaptioned-pdf-figures-plan-review-sol.md (you returned RETHINK on a text-only gate; this plan takes a different route).
- docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md (why the caption gate exists; the located route's origin).
- src/pdf-figure-locate.ts (the judge and the prompt), src/collect-pdf-figures.ts (held/LOCATABLE, locatedRoute, caps, budget), src/collect-assets.ts (pdfFigureMarkersIn, pdfFigureCaptionsIn, assetsInputHash, PDF_FIGURE_RECOVERY_POLICY), src/pdf-read.ts (renderHtml, neighbourContext, how continuation joins move a paragraph before a figure), src/web/rehost.ts (alt text), src/pipeline.ts around collectPdfFigures.

Evidence: on Rovelli's The Order of Time, the transcript's 27 uncaptioned figure records each sit between two prose records that point at them ("like this:", "shown below"); two-figure pages (34, 36, 37, 56, 57, 67) have distinct neighbours for each figure. Every image in that PDF is a single greyscale bitmap.

Greg's goal (quoted in the plan): never miss a figure, diagram or table even without a caption; the details are the agent's call; explain if it is really hard.

Please assess:
1. Is asking the existing locator by neighbouring prose a sound way to recover the picture, given that judgeLocatedBox checks geometry, not truth? Where will it choose the wrong picture, and is the proposed optional veto (neighbour snippet found on the chosen page's text layer ⇒ picture must lie below "before" / above "after") worth building in v1, or should it wait for the Rovelli measurement?
2. Neighbours from stored blocks vs from pdf-read raw records: your earlier finding 3 said raw records. For a prompt to a vision model (not an exact gate), is the blocks-based walk acceptable, and what does the continuation-join case do to it? Propose the cheapest correct handling.
3. Caps (8→48 calls, 24→64 looks) and the 180 s budget: risks, and whether a separate allowance for uncaptioned markers is better than raising the shared cap.
4. Freshness: the assetsInputHash optional element plus the /7 bump — correct and sufficient? Anything else that would read stale-as-current?
5. Anything that would silently do nothing (a check that cannot fail, a route that is never reached), any type/union seam that should be made compiler-checked, and any downstream consumer of a stored uncaptioned picture (Skim, Structure, Illustrated, export, rehost, lightbox) that will misbehave.
6. Is there a materially simpler design that meets Greg's goal?

Write numbered findings with severity (blocker / should-fix / nit), evidence as file:line, and a concrete fix. End with a single line: VERDICT: GO, GO WITH CHANGES, or RETHINK.
