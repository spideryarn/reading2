You are reviewing a PLAN (read-only) in this repo: docs/plans/261009e-latex-undefined-macros-leave-the-page.md.

Context: Spideryarn imports arXiv HTML (LaTeXML) papers. src/latexml.ts § prepareLatexml rewrites LaTeXML shapes before Readability (called from src/extract.ts § prepareDocument). The reported bug: LaTeXML's undefined-macro marker `<span class="ltx_ERROR undefined">\hohsettheme</span>` and its orphaned argument `<p>hohRose</p>` reached the reader. The plan adds a rule that removes the marker, plus (narrowly) a one-token argument paragraph, a citation key after a *cite* macro, and a paragraph left empty.

The arXiv HTML pages the survey used are in tmp-survey/ (all fetched pages of the sample; nine hold ltx_ERROR markers: grep -l ltx_ERROR tmp-survey/*.html; Greg's paper is tmp-survey/2609.01481v1.html). Read the module header of src/latexml.ts for its three rules, and docs/project/content-extraction.md § "The one thing this pipeline deletes". You may run `node --import tsx <script>` or one `npx vitest run tests/<one>.test.ts`; there is no network.

Please check:
1. Is the diagnosis right and is the class named well?
2. Are rules 2 and 3 narrow enough? Construct inputs where they would delete an author's real words. Is there a better discriminator in the markup (e.g. LaTeXML structure) than "one whitespace-free token" and "macro name contains cite"?
3. Should rule 1 also apply to ltx_ERROR inside other contexts (math annotations, captions, table cells, headings, the title)? Anything about ids/link targets, Readability, or stage 3 block splitting (src/blocks.ts) that the plan misses?
4. Anything simpler that gets the same result for the reader.
5. Sibling junk of the same class the plan misses (look at the pages in tmp-survey/).

The trade-offs in the plan (keeping optional-argument text like [VS], not ungluing \captionof) are my decisions as the implementing agent, not the user's. Write your findings as a numbered list, most severe first, each with a concrete example, and end with a one-line verdict.
