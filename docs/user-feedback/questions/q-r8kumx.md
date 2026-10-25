---
id: q-r8kumx
report: spya-hnw9xq
status: answered
asked: 2026-10-24
title: Should an executive summary be folded at import, like the abstract?
acted: spya-p6gmn7
refs: qi-j5sapfw2 · qi-mgtyaqrd · docs/plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md · feedback #698 · docs/user-feedback/261024_1705-summary-links-the-passage-that-argues-the-point.md · docs/plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md · docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md · q-f7zp3t
---
Should the import fold a paper's executive summary to a one-line stub, the way it already folds the abstract?

A. Yes, executive summaries only. The stub says "Executive summary", it stays a row in Structure, and one press opens it. About half a day: a new fold kind, its checks, and the fold eval re-run on its three sets.
B. Yes, and the other summaries an author puts at the front too: Key points, Highlights, Significance, Author summary. The same work as A, since it is one kind either way.
C. No: keep showing them, as now.

I recommend B. Your reason applies to all of them the same way: they are the author's own summary, and Summary and Structure already do that job. Folding removes nothing, so a claim that only the executive summary makes is still one press away.

Details

What you asked (24 Oct, on the Consciousness in AI report): the Fuller summary linked mostly to the executive summary. You thought the executive summary and the abstract should be folded by default, and that a re-import would now fold them.

Your guess about the re-import, checked. I ran today's fold step three times on a local copy of the same article (nothing stored). It folded the same things every time: the title and authors, the abstract, the author list, the acknowledgements and funding, the contents list and the bibliography. It did not fold the executive summary. That was on purpose. The 18 Oct plan that built folding wrote "executive summaries are not folded" under "Decided here, for Greg to overturn". The reason given was that an executive summary can say things the body never comes back to. Your report reads as you overturning that, but you said "probably", so I am asking before building it.

Your article as it is in production has no folds yet. It was imported before folding existed, and on 18 Oct you chose not to backfill old articles (q-f7zp3t, 1A). So only a re-import would fold its abstract. I have not re-imported it.

The main point of your report is being built separately, with no question needed: the summary prompt now says to link the passage where the piece sets a point out in detail, and to use the abstract or executive summary only where nothing else says it. That works whatever you choose here. Your article keeps its current links until you press Rerun on Summary in Metadata.

What would decide it: if you would sometimes rather read an executive summary than our Summary, C. If you would not, B.

Greg's answer, 2026-10-25 08:54 (reply spya-p6gmn7):

"B"

Built and on dev, not yet deployed: the import now folds an executive summary, Key points, Highlights, Significance and Author summary at the front of a piece, each its own stub named by its label, still a row in Structure. The same label in the body of a piece is left showing. Old articles fold it only when re-imported, as you chose in q-f7zp3t. Plan docs/plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md.
