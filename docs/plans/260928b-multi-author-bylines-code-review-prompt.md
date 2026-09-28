You are the code reviewer for a small bug fix in this repository. You may edit files to fix what you
find inside this change; report anything wider rather than fixing it. Do not commit. Do not run
the full test suite (it takes ~25 minutes on this box); run
`npx vitest run tests/meta-authors.test.ts tests/extract-byline.test.ts` and `npm run typecheck`.

Read first: docs/plans/260928b-multi-author-bylines-from-citation-meta.md and your own plan
review, docs/plans/260928b-multi-author-bylines-review-sol.md (all three findings were acted on).

The change (uncommitted in this worktree; `git diff HEAD` plus the new files):
- src/meta-authors.ts (new): metaAuthors, inNaturalOrder, chooseByline, bylineFromAuthors
- src/extract.ts: readingArm reads metaAuthors before Readability; readArticle returns `authors`;
  runExtract uses chooseByline(authors, tidyMetaText(article.byline))
- tests/meta-authors.test.ts (new), tests/fixtures/bylines/*.html (trimmed real pages)
- docs/project/content-extraction.md (new section)

Saved full pages for spot checks:
/tmp/claude-1000/-home-greg-code-spideryarn2/3f69a3c5-12b4-4330-877f-3721d9896e63/scratchpad/
nature.html (Greg's page), p3 arXiv, p4 PLOS, p5 Nature AlphaFold, p7 Frontiers.
probe2.ts in that directory runs runExtract over them; its output after the fix is: Nature 25
names joined "; ", arXiv 8, PLOS 6, AlphaFold 34, Frontiers unchanged ("Tingting Wu, Xiaorong Hou, …").

Conclusion to check: the stored byline now contains every declared author on those scholarly
pages, and nothing changes for a page without citation_author / repeated dc.creator.

The finding I would least like to be wrong about: that `chooseByline`'s "Readability already
names everybody" test (surname as a folded word in Readability's byline) cannot keep a wrong
byline on a real page — e.g. a surname that is also a common word appearing in a dateline, or a
non-Latin name that folds to an empty string (then `" " + "" + " "` matches anything?). Check
fold()/surnameOf() for that empty-surname case specifically.

Also check: the other consumers of meta.byline (grep byline in src/) cope with a long "; "-joined
list; and that `readArticleWithProvenance` (evals only) not getting `authors` is acceptable.

Report: verdict, numbered findings with file:line, and what you changed.
