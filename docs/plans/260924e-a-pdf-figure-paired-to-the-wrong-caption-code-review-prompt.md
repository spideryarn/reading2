You are the code reviewer for stage 1 of docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md in the spideryarn2 repo.
You may edit files to fix what you find **inside this stage** (the files in `git diff --stat` plus their tests); report anything wider rather than
changing it. Do not commit, do not run git commands that change the index or branches, and do not touch the database.

Read first: the plan (including its "claim is deliberately narrow" paragraph), your own earlier plan review in
docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption-plan-review-sol.md, and the postmortem
docs/postmortems/260924a-a-figure-paired-on-the-transcripts-page-claim.md. Then the diff: `git diff` in this worktree.

The change: `pairPageFigures` (src/pdf-figures.ts) now requires the marker's caption, cut at its first TeX span, normalised and truncated to
CAPTION_MATCH_CHARS, to appear in the page's text layer before attaching the page's one usable raster; otherwise it refuses
`caption-not-in-page-text`. `readPdfRasters` returns `pageText`; `collectPdfFigures` makes `captions` required and passes both through;
the failure word is in both unions and the exhaustive mapping; `PDF_FIGURE_RECOVERY_POLICY` is bumped to `pdf-figures/4`.

Evidence already gathered: all 170 tests in tests/pdf-figures, collect-pdf-figures, pdf-figure-read, pdf-figure-region, assets, doc-links pass;
`npm run typecheck` passes. On the three local PDF articles, collectPdfFigures with the real markers and captions stores 8/8 and 4/4 on the two
academic papers and 0/4 on the rebuilt essay (two `caption-not-in-page-text`, one `no-raster`, one `ambiguous`), where before it stored 2 wrong pictures.

The conclusion I would least like to be wrong about: **no caller of `collectPdfFigures` or `pairPageFigures`, and nothing that reads the manifest, is
now silently refusing figures it used to recover correctly** — for example a path that passes captions keyed differently from marker refs, a
captions map built from text that differs from the figcaption (whitespace, entities, inner markup), a page-text read that returns empty for a page
the old code handled, or the scanned-page path. Check `pdfFigureCaptionsIn` (src/collect-assets.ts) against how `renderHtml` writes figcaptions
(src/pdf-read.ts), including HTML escaping of quotes and ampersands. Also check the `split(/\\[([]/)` TeX cut is right for both `\(` and `\[`.

Then run `npm run typecheck` and `npx vitest run tests/pdf-figures.test.ts tests/collect-pdf-figures.test.ts tests/pdf-figure-read.test.ts` after
any edit. Report: numbered findings with severity (P0/P1/P2), file:line evidence, and what you changed for each, plus anything wider you did not change.
