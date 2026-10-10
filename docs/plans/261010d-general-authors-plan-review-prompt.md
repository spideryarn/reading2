You are reviewing a PLAN (and the spike code behind it) in the Spideryarn repo, read-only. Do not edit files.

Read first:
- docs/plans/261010d-a-general-authors-pass-for-every-web-page.md (the plan under review)
- docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md (the arXiv path this replaces, and its two reviews' findings: the swap of printed institutions, fused words, note furniture, `3M Company`)
- docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md (the title-block rewrite that stays)
- docs/project/security-map.md (a stranger's page is untrusted; a model's output is untrusted)
- docs/project/prompting-guide.md § What the model writes back

Spike code (uncommitted, in this worktree):
- src/front-matter-authors.ts (new: pageOpening, prompt, schema, parse, checkFrontMatterAnswer, reader)
- src/extract.ts (readingArm computes `opening` before Readability; runExtract takes `frontMatterAuthors`; the old `affiliations` option is still there and will be removed)
- src/models.ts (FRONT_MATTER_AUTHORS_MODEL; will become anthropic/claude-haiku-5.5 and a registered job)
- src/pdf-authors.ts (verifyAuthors, reused unchanged)
- evals/front-matter/measure.ts and compare.ts; results in evals/results/front-matter-authors-2026-10-09/ (run-3.* is the final design; run-4 is without declared names)
Run `git diff HEAD` and `git status` to see it all.

What to judge, with severity P0 (ship-blocking) / P1 / P2:
1. Is replacing the arXiv affiliations path justified by the measurement? Anything the old per-author check (each affiliation must be printed in that author's own LaTeXML creator record) caught that the new general check (refuse an affiliation printed only in records naming other authors) misses? Construct a concrete adversarial or accidental case if you can.
2. pageOpening: reading the pre-Readability document from the first h1. Failure modes: hidden text (display:none, aria-hidden, LaTeXML hover notes), a site h1 that is the site name, navigation after the h1, words fused or split at inline element boundaries, a `<br>`, huge pages, a page with no body. Does anything here let a hostile page put words in the stored author list that it did not print visibly? (Note the stored text is always the page's own characters via verifyAuthors.)
3. Running on every HTML import (not just arXiv): risk of wrong authors on blogs/news (quoted people, "Photo by", interviewees), changes to meta.byline via chooseByline/authorsForByline in src/meta-authors.ts and src/extract.ts. Is the "no declared names" branch safe enough to ship, or should v1 only add affiliations to declared names?
4. The declared-names regime: bylineText = declared names joined with ", ", pages = all records. Any way a model can attach a printed-but-wrong institution that passes?
5. Model choice (Haiku over DeepSeek) and cost: is the evidence read correctly?
6. Anything in the plan that is wrong about the existing code, the abstract/acknowledgements deferral, or a simpler option passed over.

Write your findings as a numbered list, each with severity, file:line evidence, and a concrete fix. End with a one-line verdict: "build as planned", "revise before build", or "do not build".
