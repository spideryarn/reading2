You are reviewing a PLAN (read-only) for the Spideryarn repo, before it is built.

Read docs/plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md.
Then read the code it touches: src/latexml.ts (top and hasLatexmlSource), src/extract.ts
(readArticle, runExtract — the title and meta part), src/front-matter-authors.ts (pageOpening,
readOpening, frontMatterAuthorsReader), src/title-tidy.ts, src/title-tidy-model.ts,
src/pipeline.ts (stepTitleTidier, and where runExtract is called with titleTidier/frontMatterAuthors).

Evidence: the real arXiv page is saved at
/tmp/claude-1000/-home-greg-code-spideryarn2/3447fe13-83bf-4e54-a03c-addcb4cb42be/scratchpad/arxiv-2308.08708.html
(its <title> is "1Indicator Properties"; it has no h1.ltx_title_document; its first paragraph
under article.ltx_document is the real title).

Questions:
1. Is the detection (`no .ltx_title_document` at a LaTeXML source) right and narrow enough? Any
   arXiv page where it fires wrongly (e.g. title present under another class)?
2. Is the model-plus-verbatim-check approach the right choice over arXiv's abs-page metadata,
   given Greg's quoted preference? Over "first opening record, no model"?
3. Is the slug the right fallback, or is something better available without a model?
4. The steady-title rule: correct? Any way it keeps a wrong title for ever?
5. Anything missed: other places that read the page <title> (the job title, extractedHtml's
   <title>, ExtractResult), the PDF path, tests, security (the opening is a stranger's text going
   to a model), cost tracking for the new job.

Answer with numbered findings, each with severity (P1/P2/P3), and a one-line verdict at the end:
VERDICT: proceed | proceed with changes | rethink.
