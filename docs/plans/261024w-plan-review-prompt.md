Review the plan docs/plans/261024w-figures-and-tables-open-in-the-original-and-a-titled-arxiv-box-keeps-its-words.md before it is built. Read-only.

Context: a Feedback report from the product owner (quoted in the plan). Read the code the plan names: src/latexml.ts (§ liftBoxedPassage and the three rules at the top), tests/latexml.test.ts and tests/fixtures/latexml/boxed-passage.html, src/web/PdfFigureNote.tsx, src/web/TableView.tsx (where PdfFigureNotes is rendered), src/web/SourceLink.tsx (webSource, savedFromSource), src/blocks.ts (stampAuthorAnchors, which ids survive), src/sanitize-policy.ts, docs/project/article-images.md, docs/project/content-extraction.md.

The original page is https://arxiv.org/html/2308.08708 (Box 1 is svg#S1.SS2.p5.pic1).

Look for: wrong assumptions about which ids survive into stored block html; security (an href built from a stranger's page: the URL is the article's own fetched address, and the fragment comes from an id or text in the page); cases where the widget would be noise (inline images, maths, layout tables, icons) or missing (a publisher figure whose only id was on the block element itself); the titled-box rule admitting a diagram; text-fragment encoding; whether a visitor's payload has the url; anything simpler. Say P0/P1/P2 per finding, with file:line evidence. Write findings only.
