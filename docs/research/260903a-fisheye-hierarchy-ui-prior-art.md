# Fisheye + hierarchy UI — prior art

**Status:** research, 2026-09-03. Nothing here is decided.

## What this is for

Greg wants to merge Hierarchy (one fisheye column per tree level) and Outline (one column, a
ladder of rungs) into a single mode: at one column it's Outline; at two or more, column 1 becomes a
wide, flat fisheye over the whole document and column 2 a narrower, more curved fisheye over the
current section's siblings/children, with a Sankey-like ribbon between columns showing the active
row in column 1 fanning out into column 2. He suspects nobody has built this over LLM-generated
semantic structure specifically, and wants to know what exists for the *interaction* regardless.
This survey feeds the not-yet-written
[260903b-one-structure-mode-hierarchy-and-outline-merged.md](../plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md).

## 1. Degree-of-interest fisheye trees

**Furnas, "Generalized Fisheye Views," CHI 1986.** [ACM](https://dl.acm.org/doi/10.1145/22627.22342).
`DOI(x | y) = API(x) − D(x, y)`: a point's interest, given focus `y`, is its context-free a priori
importance minus distance from the focus; a screen shows the `k` highest-DOI points for a budget `k`.
The founding formalism for "show it all, bias detail toward here."
**Take:** the formula's shape is what Outline's rung ladder already approximates by hand — one
function instead of five thresholds. **Doesn't do:** layout — it says *what* to show, not *where* to
draw it or how two views connect.

**Card & Nation, "Degree-of-Interest Trees," AVI 2002.**
[PDF](https://courses.ischool.berkeley.edu/i247/f05/readings/Card_DOITrees_AVI02.pdf). Applies DOI to
node-link trees under a fixed pixel budget: expand/collapse and font size follow DOI, so the tree
self-adjusts to an "attention-reactive" panel. **Take:** DOI-driven expand/collapse under a fixed
height is close to our column-2 fisheye. **Doesn't do:** multiple connected panels — one tree.

**Heer & Card, "DOITrees Revisited," AVI 2004.** [PDF](http://jheer.org/publications/2004-DOITree-AVI.pdf).
Scales DOITrees to ~1M nodes with a multi-focal "TreeBlock" layout and cues for elided structure.
**Take:** the "more hidden here" cue suits a collapsed part in column 1. **Doesn't do:** connect
resolutions across columns.

**SpaceTree — Plaisant, Grosjean & Bederson, InfoVis 2002.**
[PDF](https://apps.dtic.mil/sti/tr/pdf/ADA440723.pdf). Rescales unopened branches to fit the screen
and shows a triangular preview summarizing a branch it can't expand. **Take:** the triangle preview
answers "how much is hidden" compactly. **Doesn't do:** multi-column fisheye; it's explicitly
contrasted with hyperbolic trees (whole tree distorted into a fixed circle), not with columns.

**Fisheye menus — Bederson, UIST 2000.** [PDF](https://dl.acm.org/doi/pdf/10.1145/354401.354782).
DOI on a flat menu: items near the cursor grow, far ones shrink, none disappear. A later study
(Hornbæk & Hertzum) found them slower than plain cascading menus for selection —
[PDF](https://www.kasperhornbaek.dk/papers/TOCHI2007_FisheyeMenus.pdf). **Take:** the caution — more
visible context isn't free; check our rungs make placing yourself *faster*, not just denser.
**Doesn't do:** nesting — a flat list only.

**Fisheye text editor for relaxed-WYSIWIS groupware — Greenberg, CHI 1994 companion.**
[ACM](https://dl.acm.org/doi/10.1145/257089.257285). Fisheyes a shared document so each collaborator
sees their own area in full, everyone else's compressed. The closest match found to "fisheye over
real text" rather than abstract nodes; no DOI-driven outliner (Workflowy-style) turned up.
**Take:** confirms the pattern predates LLMs by decades — never applied to a generated hierarchy.
**Doesn't do:** nest levels or connect columns; one document, one pane.

## 2. Miller columns

Independently invented by Mark S. Miller in 1980 at Yale, related to the earlier Smalltalk-80
browser; used at Project Xanadu and Datapoint, then NeXTSTEP's File Viewer (1986), ancestor of
macOS Finder's column view and iTunes' "Browser" —
[Wikipedia](https://en.wikipedia.org/wiki/Miller_columns).
**Take:** the base mechanic our Hierarchy view already runs — one column per level, selection in
column *n* sets the content of *n+1*. **Doesn't do:** every variant found (GOV.UK's
[miller-columns-element](https://github.com/alphagov/miller-columns-element), assorted JS libraries)
fills a column with a plain scrolling list — never a fisheye, never a drawn connector between
columns. Nothing replaces the list with a context-filling column or a visual link beyond adjacency
and a highlighted parent — the gap Greg's Sankey-ribbon idea would fill.

## 3. Visual links between hierarchy levels

**Table Lens — Rao & Card, CHI 1994.** [ACM](https://dl.acm.org/citation.cfm?id=191776). Focus+context
spreadsheet: rows shrink to single-pixel bar-graph lines away from focus, full detail near it, ~100x
the data of a plain spreadsheet in the same space. **Take:** proof a fisheye can hold a whole large
table legibly — the case for column 1 holding the whole part-list. **Doesn't do:** single-resolution,
single panel — no link to a second panel.

**Icicle plots / flame graphs / d3 partition layout.**
[Observable](https://observablehq.com/@d3/zoomable-icicle) ·
[Gregg](https://www.brendangregg.com/flamegraphs.html). Adjacent rectangles sized by subtree extent,
stacked by depth; clicking one zooms it to full width and reveals its children — used for real
navigation (profiler call-stack drilldown), not just quantity. **Take:** click-to-zoom-reveal-children
is close to our column-1-to-2 handoff; depth-as-position is a cheap way to encode level. **Doesn't
do:** the "connector" is implicit adjacency, not a drawn ribbon.

**Parallel Sets — Kosara, Bendix & Hauser, 2006.**
[ResearchGate](https://www.researchgate.net/publication/4187800_Parallel_sets_Visual_analysis_of_categorical_data).
Ribbons between axes, width = frequency of each category combination — the first parallel-coordinates
variant to draw subset-ribbons rather than lines. **Parallel Hierarchies** extends this with
icicle-plot axes for hierarchical categories —
[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0097849318301080). Both encode
quantity, for statistical exploration, not "navigate to this node." **Take:** the ribbon-fan shape
itself is exactly Greg's mental picture, even though its usual job is proportions. **Doesn't do:** no
case found of such a ribbon used purely for navigation (constant width, no count) between tree
panels; sunburst breadcrumbs solve orientation with a stacked list, not a ribbon.

## 4. Semantic zoom and LLM-era hierarchical readers

**Pad++ — Bederson & Hollan, UIST 1994**, building on Perlin & Fox's Pad (1993).
[PDF](https://www.cs.umd.edu/~bederson/images/pubs_pdfs/p23-bederson.pdf). Coined *semantic zoom*:
what an object shows changes qualitatively with scale, not just its size. **Take:** zoom should change
representation, not just magnification — already our whole granularity system's design. **Doesn't
do:** continuous 2D pan/zoom, not columns; predates any generated hierarchy.

**Sensecape — Suh et al., UIST 2023.** [arXiv](https://arxiv.org/abs/2305.11483). A canvas for
chatting with an LLM where generated content is organized into user-*arranged* levels of abstraction,
for foraging and sensemaking. **Take:** the abstraction-levels idea. **Doesn't do:** the hierarchy is
built by the user from chat output, not auto-laid-out from one generated tree.

**Graphologue — Jiang et al., CHI 2023** and **Luminate — Suh et al., CHI 2024.**
[Graphologue](https://www.researchgate.net/publication/375062700_Graphologue_Exploring_Large_Language_Model_Responses_with_Interactive_Diagrams) ·
[Luminate](https://arxiv.org/pdf/2310.12953). Turn LLM chat responses into node-edge diagrams
(Graphologue) or a structured design space (Luminate). **Take:** confirms CHI's appetite for making
LLM output navigable, but neither reads one long document — they structure a chat reply. **Doesn't
do:** not a document reader; no fisheye, no columns.

**TreeReader — 2025.** [arXiv](https://arxiv.org/abs/2507.18945). An academic-paper reader with the
paper's real section tree in a left navigation column, each node showing an LLM-generated summary
with full text revealed on demand. **Take:** the closest match to "nested list, LLM summary per node,
expand for detail" — close to our Outline mode. **Doesn't do:** the hierarchy is the paper's *actual*
structure, not LLM-proposed boundaries over unstructured prose (our pipeline's usual case, per
[granularity-zoom.md § Where the tree comes from](../project/granularity-zoom.md)); one column, no
fisheye, no second panel, no connector.

**Readwise Reader (Ghostreader) and Adobe Acrobat AI Assistant.**
[Readwise](https://docs.readwise.io/reader/guides/ghostreader/overview) ·
[Adobe](https://helpx.adobe.com/acrobat/using/ai-generated-summaries.html). Both generate an outline
(headings plus a per-section summary) that a click navigates to; Acrobat highlights the source
passage. Neither goes past one level of generated structure, no fisheye, no second-column drilldown.
**Take:** nothing structurally new — confirms this product class stops at a one-level TOC, short of
even our existing Hierarchy view.

**Summary of a Haystack — Laban et al., EMNLP 2024.** [arXiv](https://arxiv.org/abs/2407.01370). A
benchmark, not a UI, scoring whether a system's summary of ~100 documents covers the right insights
with correct citations. Noted only to rule it out — no interface at all.

**What nobody seems to have done, stated explicitly:** no source found in this pass renders an
LLM-*generated* semantic hierarchy (titles + one-sentence gists invented by a model over otherwise
unstructured prose) as more than one simultaneously-visible, differently-scaled column, and none
draws a Sankey/ribbon connector between such columns for navigation rather than for quantity. That
matches what Greg believed going in.

## 5. Adaptive depth — how much hierarchy to generate

**Wu et al., "Recursively Summarizing Books with Human Feedback," 2021.**
[arXiv](https://arxiv.org/abs/2109.10862). Summarizes a book by recursively summarizing fixed-size
chunks, then summarizing the summaries, bottom-up — the same shape as our own
[Generation](../project/granularity-zoom.md#generation) pipeline. It fixes chunk size and lets tree
*depth* fall out of document length, rather than fixing depth and varying branching factor. **Take:**
confirms bottom-up recursion is the standard shape; the chunk-size-first framing is the alternative to
our branching-factor-first one, worth naming as the option we didn't take. **Doesn't do:** no UI, and
no discussion of how many levels a reader should see.

**Branching factor / TOC-depth conventions.** No citable rule for "how many heading levels for a text
of length N" was found in book-indexing or style-guide sources (Chicago Manual of Style's indexing
chapter recommends restraint — fewer sub-levels — as a readability preference, not a formula);
Wikipedia's [branching factor](https://en.wikipedia.org/wiki/Branching_factor) article is the generic
computing/game-tree sense, no TOC content. Our own "~5–9 children per node" target in
[granularity-zoom.md](../project/granularity-zoom.md#where-the-tree-comes-from) reads as an in-house
heuristic, not one lifted from an external convention.

## What nobody seems to have done

DOI fisheye trees (§1) are one panel; Miller columns (§2) are multiple panels but each a plain list;
ribbon/Sankey connectors (§3) encode quantity, not navigation, and never sit between two *fisheye*
panels; every LLM-era hierarchical reader found (§4) tops out at one navigable column with plain
expand/collapse. Nothing combines: (a) an LLM-generated hierarchy over unstructured prose, (b) two or
more columns simultaneously fisheyed at different curvature, and (c) a drawn connector between them
used for wayfinding rather than counting. Greg's instinct that this combination is unbuilt held up.

## Sources

- Furnas, "Generalized Fisheye Views," CHI 1986 — [ACM](https://dl.acm.org/doi/10.1145/22627.22342), [PDF](https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf)
- Card & Nation, "Degree-of-Interest Trees," AVI 2002 — [PDF](https://courses.ischool.berkeley.edu/i247/f05/readings/Card_DOITrees_AVI02.pdf)
- Heer & Card, "DOITrees Revisited," AVI 2004 — [PDF](http://jheer.org/publications/2004-DOITree-AVI.pdf), [project page](https://idl.uw.edu/papers/doitrees-revisited)
- Plaisant, Grosjean & Bederson, "SpaceTree," InfoVis 2002 — [project page](http://www.cs.umd.edu/projects/hcil/spacetree/), [PDF](https://apps.dtic.mil/sti/tr/pdf/ADA440723.pdf)
- Bederson, "Fisheye Menus," UIST 2000 — [PDF](https://dl.acm.org/doi/pdf/10.1145/354401.354782); Hornbæk & Hertzum usability study — [PDF](https://www.kasperhornbaek.dk/papers/TOCHI2007_FisheyeMenus.pdf)
- Greenberg, "A fisheye text editor for relaxed-WYSIWIS groupware," CHI 1994 companion — [ACM](https://dl.acm.org/doi/10.1145/257089.257285)
- "Miller columns" — [Wikipedia](https://en.wikipedia.org/wiki/Miller_columns); GOV.UK element — [GitHub](https://github.com/alphagov/miller-columns-element)
- Rao & Card, "The Table Lens," CHI 1994 — [ACM](https://dl.acm.org/citation.cfm?id=191776)
- Zoomable icicle (d3/Observable) — [Observable](https://observablehq.com/@d3/zoomable-icicle); Gregg, flame graphs — [brendangregg.com](https://www.brendangregg.com/flamegraphs.html)
- Kosara, Bendix & Hauser, "Parallel Sets," 2006 — [ResearchGate](https://www.researchgate.net/publication/4187800_Parallel_sets_Visual_analysis_of_categorical_data); "Parallel Hierarchies" — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0097849318301080)
- Bederson & Hollan, "Pad++," UIST 1994 — [PDF](https://www.cs.umd.edu/~bederson/images/pubs_pdfs/p23-bederson.pdf)
- Suh et al., "Sensecape," UIST 2023 — [arXiv](https://arxiv.org/abs/2305.11483)
- Jiang et al., "Graphologue," CHI 2023 — [ResearchGate](https://www.researchgate.net/publication/375062700_Graphologue_Exploring_Large_Language_Model_Responses_with_Interactive_Diagrams); Suh et al., "Luminate," CHI 2024 — [PDF](https://arxiv.org/pdf/2310.12953)
- "TreeReader," 2025 — [arXiv](https://arxiv.org/abs/2507.18945)
- Readwise Reader Ghostreader — [docs](https://docs.readwise.io/reader/guides/ghostreader/overview); Adobe Acrobat AI-generated summaries — [Adobe](https://helpx.adobe.com/acrobat/using/ai-generated-summaries.html)
- Laban et al., "Summary of a Haystack," EMNLP 2024 — [arXiv](https://arxiv.org/abs/2407.01370)
- Wu et al., "Recursively Summarizing Books with Human Feedback," 2021 — [arXiv](https://arxiv.org/abs/2109.10862)
- "Branching factor" — [Wikipedia](https://en.wikipedia.org/wiki/Branching_factor)
