I fixed all established P1s inside this stage. No commit was made.

### Findings

- **F20 — P1, established: equation cells could change meaning.**  
  (a) Cell TeX `a & b` or `x \\ y` became valid only after insertion into `aligned`, adding unintended columns or rows.  
  (b) Fixed: each cell must draw independently and contain no alignment controls; otherwise the group stays unchanged. This deliberately declines nested matrices rather than guessing.

- **F21 — P1, established: boxed-passage rewrite broke a cross-reference.**  
  (a) A link to the `ltx_foreignobject_content` wrapper’s ID became dangling because only its children moved.  
  (b) Fixed: a linked wrapper makes the rewrite decline.

- **F22 — P1, established: listing rewrite deleted authored text.**  
  (a) A leading `<a href="data:…">LICENSE: attribution required</a>` was deleted despite lacking `download`.  
  (b) Fixed: the exact control must carry `download`.

- **F23 — P1, established: listing whitespace could corrupt code.**  
  (a) Pretty-printing whitespace between inline spans collapsed inside the original `<div>`, but became literal indentation/newlines inside `<pre>`.  
  (b) Fixed: only LaTeXML’s measured bare edge-newline shape is accepted.

- **F24 — P1, established: `textRoundTables` could hide genuine prose loss.**  
  (a) Control `<p>A B</p>` versus treatment `<span>A</span><table>…</table><span>B</span>` incorrectly returned retained because removing every table joined unrelated document fragments.  
  (b) Fixed: table-stripped comparisons now occur only within one treatment prose element containing the table.

- **F25 — P1, established: title-block authors overrode correct metadata.**  
  (a) A single `dc.creator` or ordinary `author` meta tag was ignored, allowing `.ltx_authors` to replace Readability’s proper byline.  
  (b) Fixed: LaTeXML authors are now strictly a fallback when no supported author metadata exists.

- **F26 — P1, established: arbitrary author-separator content was silently discarded.**  
  (a) `.ltx_author_before` could contain a nested person or affiliation text and still yield an incomplete author list.  
  (b) Fixed: it may contain no elements and only whitespace or “and”.

- **F27 — P1, established: a non-LaTeXML page could trigger every rewrite.**  
  (a) An ordinary `example.test` page using `<article class="ltx_document">` and an exact listing shape was rewritten.  
  (b) Fixed: the final fetched URL must also be an arXiv or ar5iv `/html/…` source. A stranger’s markup alone can no longer opt in.

- **F28 — P2, established: boxed lifting activated fetching content.**  
  (a) An allowed YouTube iframe inside `foreignObject` survived after lifting, although the unmodified sanitizer would have removed the whole `foreignObject`. This was not a sanitizer bypass.  
  (b) Fixed: boxed passages containing active or fetching descendants are left unchanged.

- **F29 — P3, established: two re-run counts were wrong.**  
  (a) `2610.03261v1` has 11 rewrites, not 13; `2610.01988v1` has 16 rewrites plus five groups left alone, not 17.  
  (b) Fixed in the investigation.

- **F30 — P3, established: a test title retained obsolete row counts.**  
  (a) It said 42→60 while its assertions establish 40→58.  
  (b) Fixed.

- **F31 — P2, established: the strongest re-run claims lack committed evidence.**  
  (a) The results directory contains only aggregate `results.json`; it does not contain the judge outputs, before/after HTML, word diff, row-comparison output, or browser evidence supporting “five of five”, “no regression”, and several row-specific claims.  
  (b) Not changed: the smallest closure is to commit those artifacts, or narrow the prose to the aggregate evidence that is present. This is an evidence gap, not established runtime misbehaviour.

The sanitization claim checks out: preparation remains before Readability, `debugPage` sanitizes the extracted content, and stage 3 sanitizes again. Unsafe object-image schemes tested by the audit were stripped. No sanitizer or asset-pipeline file changed. The chosen byline changes the metadata block’s ID only when its visible text changes, which is consistent with the block-ID contract.

The changed ar5iv expectations do not conceal a regression: the formula, row, and provenance-count changes match the intended equation joining.

Checks passed:

- All ten permitted test files: **259 tests**
- TypeScript: all four projects, **3,231 source files covered**
- Targeted Biome lint
- `git diff --check`

Files changed:

- [src/latexml.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/latexml.ts:59)
- [src/meta-authors.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/meta-authors.ts:48)
- [src/protect.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/protect.ts:1035)
- [tests/latexml.test.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/tests/latexml.test.ts:49)
- [tests/extract-protect-list-item-tables.test.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/tests/extract-protect-list-item-tables.test.ts:71)
- [tests/extract-protect.test.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/tests/extract-protect.test.ts:419)
- [261005e investigation](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md:176)

VERDICT: ship it