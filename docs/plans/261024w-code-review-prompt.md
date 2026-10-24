Code review of commit aff7a7ba1 (the diff is docs/plans/261024w-code-review.diff), built from the plan docs/plans/261024w-figures-and-tables-open-in-the-original-and-a-titled-arxiv-box-keeps-its-words.md. Read the plan, including its "GPT Sol's plan review, and what changed" and "Found while building" sections, and your own plan review, docs/plans/261024w-plan-review-sol.md.

Two changes:

A. src/latexml.ts § liftBoxedPassage: a LaTeXML tcolorbox with a bold title bar (two foreignObjects) is lifted to HTML, and a plain <img> inside a box is no longer refused (ACTIVE_PASSAGE_CONTENT). Tests: tests/latexml.test.ts "fix 7", with fixtures tests/fixtures/latexml/titled-boxed-passage*.html (cut from arxiv.org/html/2308.08708).

B. src/web/OriginalLink.tsx and src/web/TableView.tsx: a link after each figure/table/media block of a web article to the publisher's page at that element. Tests: tests/original-link.test.tsx.

Look hard for:
- a lifted box that loses or reorders words, or admits a diagram;
- whether allowing <img> inside a lifted box opens anything that the sanitiser, stage 4.5 and the rehost path (src/sanitize-policy.ts, src/collect-assets.ts, src/web/rehost.ts) would not handle like any other article image (relative src resolution, srcset, data: URLs);
- href construction and encoding;
- the link appearing where it should not (a visitor's public payload: check src/public/dto.ts and what PublicMeta carries for url; uploads; PDFs), or missing where it should be;
- render cost in TableView (memoisation), React keys, accessibility;
- consistency with PdfFigureNote.tsx and the .figure-note CSS in src/web/styles/prose.css;
- comments that are wrong.

House workflow: FIX what you find inside this scope directly in the working tree. Do not commit, do not run git commands that discard work, and do not touch .env*, infra/, systemd or any database. After fixing, run `npx vitest run tests/latexml.test.ts tests/original-link.test.tsx` and `npm run typecheck`. Report anything wider for me to decide. Write your findings to the output file, each with P0/P1/P2, file:line evidence, and whether you fixed it.
