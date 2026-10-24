Review this plan before it is built (read-only). Plan: docs/plans/261024s-a-glossary-underline-fades-with-each-repeat-of-its-term.md.

Relevant code: src/web/annotate.ts (termMarks, annotateHtml, Mark type), src/web/TableView.tsx (termMarksByBlock, matterStretches ~line 810), src/web/styles/annotations.css (mark.term), docs/project/glossary.md (§ The underline is always there), docs/project/front-and-back-matter.md.

Questions: Is the function a good choice for the stated goal? Is the per-entry document-order count correct given termMarks only scans blocks named by the server and blocks = article.blocks? Is skipping folded matter right? Any rendering path (other views, exports, DesignPage, chat, Skim) that draws term marks and would be inconsistent? Is CSS calc() inside a color-mix percentage OK? Anything that would silently do nothing? List findings ranked by severity, concisely.
