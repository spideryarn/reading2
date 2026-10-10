---
id: q-hbg65m
report: spya-vh0z7s
status: open
asked: 2026-10-10
title: Should Reception and Claims become one sub-mode, and what should Cited by do for a piece with no DOI?
refs: SPIDERYARN-READING2-G8 · SPIDERYARN-READING2-GB · qi-wtq7c6e8 · docs/plans/261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md · docs/user-feedback/261009_2315-reception-and-claims-overlap.md · docs/user-feedback/261009_2316-reception-empty-sentence-and-the-arxiv-doi.md
---
Done, on dev, not deployed: both sentences you could not read are rewritten, and an arXiv paper now finds its DOI, so the Attention paper gets its Cited by list (about 27,000 papers). The Claims card no longer starts "What others say about", which read as a second Reception. Two questions are left.

1. Should Reception and Claims stay two sub-modes?
A. Keep two, with the clearer cards (built). Reception starts from the piece: who has written about it. Claims starts from the piece's own sentences: you pick claims and each is checked on the web. Costs nothing more.
B. Merge them into one sub-mode, Reception on top and the claims list under it. One fewer chip, and nothing to tell apart. But Reception's search is the dearest button in the app and the claims list is cheap, so one chip would have to buy one without the other, and the panel gets long.
C. Keep two, but rename Claims to say what it does, e.g. "Check claims".
Recommended: A. Try the new cards first; C is a small change if they still read as one thing.

2. A piece that really has no DOI (most web pages and blog posts): what should Cited by do?
A. Leave it: one sentence saying we have no DOI and therefore cannot list who cites it, and the Google Scholar link under it (built).
B. Let you type a DOI on the Metadata page. We would check it the way an import does, against the title and an author.
C. Ask OpenAlex by title and author when there is no DOI. Automatic, but a title search can match the wrong work more often, so the check would have to be strict.
Recommended: A for now. This closes the common arXiv gap; B or C still matter whenever an article's DOI was not found, and are worth building once you hit one you care about.

Details

What you asked, on 9 October, from Sources › Reception on Attention Is All You Need: three reports.

"I have no idea what this means": the sentence "The search found 12 pages that might respond to this piece, but none could be checked against the words it returned." It covered two different cases. Either the search returned pages but the AI put no candidate in its answer (nothing was checked at all), or it suggested some and every one failed our checks: that the page is not this piece or a copy of it, and that the words it quoted are in the text the search returned. Each case now has its own sentence, with the numbers.

"No DOI on record": you asked whether we tried. Partly. Since 4 October an import confirms an arXiv paper with arXiv's registry, but it never kept the DOI that registry gives (for this paper, 10.48550/arXiv.1706.03762), so Cited by had nothing to ask with. It is now kept, and papers imported before today are looked up by their arXiv address, so nothing in the database had to change. The sentence for a piece with no DOI now says what a DOI is and that we have none; the Google Scholar link under it is the way on without one.

On question 1. What tells the two apart is where they start. Reception: one web search for pages that respond to the piece as a whole (replies, reviews, blog posts), plus the papers that cite it. Claims: up to eight claims the piece rests on, quoted in its own words; you tick some and each gets its own small web search for support and disagreement. They overlap where a critique of the piece argues with one of its claims; that page could turn up in both. Merging (B) would also mean reworking the chip counts, the addresses and old links, and the rule that a press only buys the work of the sub-mode it lands on. Separately, you already chose to rename Referee's Claims to Promises (q-fkq30v), so Sources' Claims will soon be the only Claims.

On question 2. B is a form and its checking. C costs one OpenAlex request per article and needs care, since many papers share a title.
