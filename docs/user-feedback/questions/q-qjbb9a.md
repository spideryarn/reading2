---
id: q-qjbb9a
report: spya-xg4jyr
status: open
asked: 2026-10-09
title: arXiv papers: read affiliations with the small model, and re-import your Attention paper?
refs: qi-tfx8kg3j · SPIDERYARN-READING2-FG · docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md · docs/user-feedback/261009_0116-arxiv-html-author-list-tidied.md
---
The messy author list is fixed for new arXiv imports, without a model. Two follow-ups are yours to decide.

1. Should arXiv imports also get each author's affiliation on the masthead names (the hover tooltip), read by the same small model PDFs use?
   1A (recommended). Yes. One small model call per arXiv import (a fraction of a cent), checked against the page's own words as the PDF one is, so it cannot invent an institution. Gives the tooltip PDF imports already have.
   1B. No. The names stay plain on the masthead; the affiliations are still in the author rows under it.

2. Your "Attention Is All You Need" import (the one you reported from) still has the old messy rows, because the fix applies at import time. Shall I re-import it?
   2A (recommended). Yes, re-extract it. Every paragraph keeps its id, so your comments and highlights stay put; only the old author paragraph is replaced, so anything attached to that one paragraph would come loose. The Structure and summaries are rebuilt (cents).
   2B. No, leave it as it is.

Details

What you reported (2026-10-09): the author list on your arXiv import of Attention Is All You Need was messy, and you thought a small model was tidying authors at import.

What was going on. That small model exists, but only for PDFs. Since 2026-10-05 an arXiv link imports arXiv's HTML version instead of the PDF (it has better maths), and the HTML path never had the model. In fact you have this paper twice: a PDF import from 2026-10-05 with clean rows ("Noam Shazeer, Google Brain, noam@google.com") and the HTML one from last night with one 194-word paragraph full of "thanks:", "11footnotemark: 1" and "Affiliation:" labels.

The cause was layout, not reading. arXiv's HTML hides each author's affiliation, email and footnote in a pop-up that only appears on hover; we drop arXiv's styling, so every pop-up label became text and all eight authors ran into one paragraph. Separately, the library that finds the article on a page (Readability) quietly deleted the first author's details, because it took them for the byline.

What shipped. At import, the author block is now rewritten into one row per author (name, then affiliation and email on their own lines), with the footnotes written once underneath, numbered ("1 Equal contribution. Listing order is random…"), and each name carrying the numbers of the notes that apply to it. It is all the page's own words, moved rather than retyped, and a check refuses the rewrite if a single word would be lost. 16 of 20 recent arXiv papers get it; the other 4 have an author block in a shape it does not recognise and stay as before.

Not changed: the rows still show by default on this paper. The "fold the front matter away" feature does not fire because the very first line is Google's licence notice, which does not look like an author line.

Question 1 in more detail. The masthead already shows the names (read from arXiv's markup without a model). What it lacks is the hover tooltip with each author's institution, which PDF imports get from the model. Reading affiliations by rule was tried on 2026-10-07 and was wrong on 7 of 19 papers, silently, so a model is the way to get them. The model is not needed for the tidy rows.

Question 2 in more detail. Re-importing means running your article through the import again with the new code. It is a write to your production data, so I am asking rather than doing it.
