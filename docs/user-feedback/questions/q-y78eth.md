---
id: q-y78eth
report: spya-e5477u
status: open
asked: 2026-10-25
title: Should the shelf show the same how-much-read pie on each article?
refs: docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md · docs/user-feedback/261025_1448-how-much-of-the-article-you-have-read-at-the-top.md · docs/project/library.md
---
The top of each article now has a small pie saying roughly how much of it you have read: started, about half, most, or finished. Should each article on your shelf show the same pie?

A. Yes, on every shelf card (recommended). You see at a glance which articles you finished and which you left halfway. Cost: the shelf has to fetch your reading time for every article on it, which is one more database query each time it loads. It is your own data and only you would see it.

B. Not now. The pie stays on the article only. Nothing changes on the shelf.

I recommend A. "Have I finished this?" is mostly a question you ask while choosing what to read next, and you choose on the shelf.

Details

On 25 October you asked, from the Learn mode of the Entropy paper, for "a quick visual indication of roughly how much of it has been read" at the top of the article: coarse, and not "97% finished" when you skipped a dull section on purpose.

That is built and on dev, not yet deployed. Right after the "~12 min" read time at the top of the article there is now a small pie in quarters: a quarter means started, half means about half, three quarters means most of it, and a full disc means finished. Below 5% read, no pie is drawn. Finished starts at 80% of the words, so skipping a dull last section or a few paragraphs still counts as finished. The card says this in words and never shows a percentage. Front and back matter that is folded away (abstract, author list, acknowledgements) and the notes do not count either way. It comes from the same reading time that draws the shaded area on the spine.

You did not ask about the shelf, so I have not built it. Doing so means the shelf works out the same figure for every article on it, on the server: one more query on each shelf load. The pie and its rules would be the same as at the top of the article.

What would decide it: whether you would use it on the shelf. If you mostly open an article first and look there, B is fine.
