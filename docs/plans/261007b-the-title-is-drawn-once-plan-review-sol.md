I found no P0s, but six P1s. The PDF premise and the claim that zero-height rows “keep working” are both false.

## Findings

**F1 — P1 — The PDF diagnosis is wrong; the rule hides authored content.**  
[src/pdf-read.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/pdf-read.ts:1497) maps transcribed `heading1` records to `<h1>`. Those records alone become the article body at [src/pdf-read.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/pdf-read.ts:1958); the computed title appears only in `<head><title>` at [src/pdf-read.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/pdf-read.ts:1982). There is no synthetic PDF body heading.

Therefore the PDF h1s counted by the plan are author/model-transcribed headings. Hiding matching headings among the first three can remove a title-page heading or even the journal heading the plan found. It can also lose maths or formatting that the plain-text masthead does not preserve.

Change the plan: exclude PDFs from this compatibility rule. Treat any separate PDF deduplication as a product decision, not as removal of extraction chrome.

**F2 — P1 — “First three blocks” can also hide a web author’s own title.**  
The web wrapper emits its synthetic h1 and metadata, then appends the sanitized article content at [src/extract.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/extract.ts:145). An author-supplied h1 can therefore be block 2. Blocks retain both text and original HTML at [src/blocks.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/blocks.ts:1473), while `plainTitle` deliberately flattens inline markup such as `H<sub>2</sub>O` at [src/html.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/html.ts:169).

Rule 1 can consequently hide both the synthetic block 0 and the author’s formatted block 2, leaving only the flattened masthead title.

Change the plan: a legacy web wrapper can only be block 0, with its immediately following generated metadata block. Never infer provenance by scanning later same-title h1s.

**F3 — P1 — The owner rename rule contradicts the proposed matcher.**  
A rename overwrites only `meta.title`, retaining the rest of fetched metadata at [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/article/ArticlePage.tsx:382). `titleOriginal` remains present, and `titleOverridden` explicitly identifies the reader’s rename at [types.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/types.ts:2033).

Thus a tidied-then-renamed article still matches `meta.titleOriginal`, so its leading heading is hidden—opposite to the plan’s claim. The proposed `mastheadEcho(meta, blocks)` cannot make the promised decision because it does not receive `titleOverridden`.

Change the plan: pass the whole article or the override flag, and do not use `titleOriginal` as proof of an echo after a rename.

A related correction to the owner’s suspicion: rule 2 as written still hides block 1 after a rename because it is independent of rule 1. It does not leave `~N min read` visible. The plan should state whether that independence is intentional.

**F4 — P1 — Signed-out visitors will retain many tidied-title duplicates.**  
The generated web h1 uses the pre-tidy plain title at [extract.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/extract.ts:1315), while the public payload carries the stored tidied title at [public/dto.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/public/dto.ts:201). `titleOriginal` is deliberately owner-only at [types.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/types.ts:1657).

A visitor can therefore get masthead `The Order of Time` and block `THE ORDER OF TIME`; case normalization handles that example, but tidying that removes a site suffix, filename prefix, extension, footnote marker, or punctuation cannot match. Web markup flattening itself is not the problem—the wrapper and metadata initially share `plainTitle`—but later title tidying is.

Change the plan: add a signed-out test where tidying changes more than case. Prefer explicit server-provided provenance/echo IDs or the exact legacy wrapper shape rather than title equality across different payloads.

**F5 — P1 — Permanent zero-height rows break navigation and positioning.**  
The fold mechanism works because consumers query fold state, not because they notice zero height:

- Arrow navigation filters only `isFolded` in [keynav.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/keynav.ts:661), so hidden blocks remain dead keyboard targets.
- Reading-position sampling skips only folded section starts in [useReadingPosition.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/reader/useReadingPosition.ts:168).
- Structure focus does the same in [useColumnContext.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/useColumnContext.ts:79).
- On-screen sampling likewise knows only folds in [on-screen.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/on-screen.ts:59).
- Spine geometry retains every non-folded row in [Spine.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/Spine.tsx:252).

Change the plan: introduce one shared “hidden for layout/navigation” predicate covering fold-hidden and echo-hidden blocks, then audit those consumers. Add an assertion that one down-arrow from the top reaches the first visible prose block; an informal “arrow-key walk” is too weak.

Reading-time accumulation itself is safe because a zero-height row contributes no positive pixels.

**F6 — P1 — Jumps to hidden echoes land on nothing, not beside the masthead.**  
Arrival restoration sends `?at=` through `scrollToBlock` at [useReadingPosition.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/reader/useReadingPosition.ts:57). `scrollToBlock` measures and aligns the target row at [scroll.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/scroll.ts:989). A zero-height row at the top of the table can therefore scroll the in-flow masthead away and centre an invisible target. Search/quote jumps have the same problem, and their flash cannot paint a hidden cell at [keynav.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/keynav.ts:435).

Change the plan: give echo IDs an explicit jump policy, probably page-top/masthead. Test pasted `?at=`, Search/Quote, and comment jumps while starting mid-article.

**F7 — P1 — Hiding the whole cell also hides reader-owned state and marginalia.**  
Each table cell contains the gutter, fold control, annotated prose, quiz inserts, and marginalia at [TableView.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/TableView.tsx:1644). Marginalia includes comments, asked questions, citations, FAQ, timeline, ideas, and other artefacts at [Reader.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/reader/Reader.tsx:2260). Chat placement separately treats only folded blocks as invisible at [Reader.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/reader/Reader.tsx:1915).

Existing highlights, bookmarks, comments, questions, or chat anchors on blocks 0/1 would lose their in-prose marker and marginal note. The underlying data is retained, so I would not call this P0, but the plan’s “nothing is unreachable” statement is false.

Change the plan: count production anchors on candidate IDs and define their behavior. Either preserve rows that contain reader state, relocate their affordances to the masthead/next visible block, or explicitly support echo-hidden blocks throughout marginalia and chat placement.

**F8 — P2 — Fold exclusion is correct, but the plan omits an important state dependency.**  
Today `foldableHeadings` includes every heading with following content at [fold.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:69), and Fold all folds every such heading at [fold.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:212). Folding the leading h1 therefore hides the entire article. The plan is right to exclude a genuine synthetic echo.

However, `setFoldArticle` returns early for the same key and block-array identity at [fold.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:184). A rename can change echo membership without changing blocks, leaving foldability stale.

Change the plan: include echo membership in the fold store’s input and identity, and test rename/clear-rename transitions.

**F9 — P2 — The root-fix deferral conflates backfilling with stopping future pollution.**  
Backfilling existing articles is expensive. Preventing new web imports from acquiring these blocks is not: the forward fix is removing the body header at [extract.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/extract.ts:145) while retaining the document head and extracted article content. PDF needs no equivalent fix.

Change the plan: include the forward-only web extraction fix now and test one fresh ingest. Queue only historical rebuilding/backfill. This prevents future model prompts and artefacts from treating the wrapper as author text.

**F10 — P2 — Arrow removal is sound, but the proposed test is too isolated.**  
Both owner and visitor reading routes mount the same `Reader` at [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/article/ArticlePage.tsx:680) and [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/article/ArticlePage.tsx:768). `Reader` always mounts `Dock` at [Reader.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/reader/Reader.tsx:4382), and `DockHome` always links to `/` at [Dock.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/Dock.tsx:3201). I found no owner, visitor, or width where removing the masthead arrow strands the reader.

At narrow widths the Dock can slide away during forward scrolling, so “visible at 390” is too absolute, but the masthead arrow also scrolls away; this does not change the conclusion.

The existing home-control helper deliberately ignores ordinary home links at [dock-corner-controls.test.tsx](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/dock-corner-controls.test.tsx:323), so an isolated Masthead test could pass even if `DockHome` disappeared. Extend the owner and visitor integration cases to assert both that `DockHome[href="/"]` remains and that the masthead link is absent.

## Simpler design

The smallest rendering mechanism is a static class/data attribute on the row plus `.masthead-echo > td { display:none }`. Fold’s generated stylesheet exists for synchronous, no-rerender toggling at [fold.ts](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:20); permanent render-time state does not need that machinery. A class alone does not solve F5–F7.

The plan should also consider suppressing the masthead h1 when the prose already starts with that heading. That preserves every block, anchor, fold, jump, and spine behavior, but makes the source heading—not the reader-renamed masthead title—the visible canonical title and puts byline/facts before it. If that hierarchy is unacceptable, say so explicitly and choose:

- forward extraction cleanup for new web imports;
- a provenance-based, block-0-only compatibility rule for legacy web articles;
- no PDF hiding;
- first-class hidden-block semantics across navigation and annotations.

No files were changed.

**Verdict: build with the P0 and P1 fixes**