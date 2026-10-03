Review the plan docs/plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md before it is built. It moves the per-block gutter of icons (`.blk-gutter`) from the left of each paragraph to the right by swapping the values of `--text-pad-l` / `--text-pad-r` and mirroring a few `left` rules.

Read the actual code the plan relies on: src/web/styles/shell.css (tokens), src/web/styles/gutter.css (all of it, especially § the gutter, the open "…" panel, the reading-time line span.blk-read), src/web/styles/prose.css (td.text, .fold-toggle), src/web/styles/narrow-window.css (every use of --text-pad-l/--text-pad-r and the masthead/controls rules), src/web/styles/footnotes.css, src/web/styles/marginalia.css, src/web/layout.ts (proseAloneMaxPx, fitMargin, fitBoth), src/web/BlockGutter.tsx, and the tests that read these (grep tests/ for text-pad, blk-gutter, prose-centred, text-alone).

Questions to answer, with file:line evidence:
1. Is any rule that reads --text-pad-l/--text-pad-r NOT symmetric in them, i.e. would silently become wrong after the swap? (masthead, controls bar padding, notes-head/note-num, figure-note, hierarchy/gist columns, opaque/callout blocks, anything else.)
2. Does anything else assume the gutter is on the left: hover cards' placement, the row-active touch rules, the comment mark, keyboard focus, `.pin-left`, the spine, the "…" panel, z-index/overlap with the next column, scroll-into-view, `scatter.ts`, `spine-marks.ts`? 
3. With Marginalia open (and with Marginalia beside a band, fitBoth), does a right-hand gutter collide with or crowd `.marg-note`, or change `--marg-reserve` arithmetic?
4. Does the heading's `.fold-toggle` really end up beside, not under, the heading's gutter, at every width including the phone and a 12px/20px root?
5. Is there a simpler or more robust mechanism than the token swap?
6. Anything missing from the plan's list of docs/tests to update.

Be concrete. Rank findings P0/P1/P2. Do not edit any files.
