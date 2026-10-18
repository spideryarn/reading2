---
id: q-f7zp3t
report: spya-ftsqsn
status: answered
acted: spya-r8arjm
asked: 2026-10-18
title: Front and back matter: fold it on the articles already in your library, and for visitors on a shared link too?
refs: SPIDERYARN-READING2-JE · qi-bz4tj9df · qi-erfq52cg · qi-exhw79tc · docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md · docs/investigations/261018b-front-and-back-matter-eval.md · docs/user-feedback/261017_2012-front-and-back-matter-folded-by-default.md
---
Two questions about the new folds over an article's front and back matter. First, something to look at.

What is built (on dev, not yet deployed): when an article is imported, Spideryarn finds its title block, authors and affiliations, abstract, contents, acknowledgements, funding and declarations, and reference list, and the reading view folds each one to a single faint line: a chevron, a label such as "Authors and affiliations" or "References", a count such as "19 lines" or "84 entries", and an (i) saying what it is and that nothing has been removed. Pressing the line opens that stretch where it sits. Each stretch starts folded every time you open the article. Structure still lists every row, including Abstract, drawn faintly. Pressing a row opens its stretch and takes you there. Search, chat, exports and every mode still read every word.

To look: once it is deployed, open the consciousness paper you reported (arXiv 2308.08708), press Re-import, then open it. The re-import is yours to press; I did not write to production. It should show six folded lines: Title and authors, Abstract, Authors and affiliations, Acknowledgements, funding and declarations, Contents, and References. The masthead should read "Patrick Butlin, Robert Long, Eric Elmoznino + 16 more · arXiv · Published 2023".

1. What about the articles already in your library? Until one is re-imported, it keeps the older, narrower rule: only an author list at the very top is folded, and on most articles that rule finds nothing.
   A. Leave them. They fold the new way when someone re-imports them. Costs nothing and writes nothing to production now. You wrote that you were "not so worried about fixing old articles". (Recommended)
   B. Run the new step once over every existing article. It is one Haiku 5.5 call each, about 0.13 to 0.22 of a cent, so well under a dollar for the library. It writes only the new column; the article text, block ids, notes and comments are not touched. It is a production write, so I would run it only on your yes, and would first run it on a handful and show you the results.

2. Should visitors on a shared link get the same folds? Today they get only the older rule.
   A. Not yet. The code that decides what a visitor's browser receives is one of the listed security defences, and every change to it is reviewed on its own. The folds are only a convenience, and a visitor can still read everything. (Recommended for now)
   B. Yes. A small, separate change adds the fold positions (block ids and kinds, nothing the model wrote) to what a visitor receives, with its own review.

Details

Your report (2026-10-17) on the consciousness paper said there is a lot at the top that is not very substantive: the authors and affiliations table, acknowledgements, the abstract. You wanted it kept, marked as less interesting and folded by default, perhaps faint in Structure and the other modes, and the same for the back matter. Skipping it altogether was "toooo extreme". Your later notes asked for a small eval, screenshots, an (i) tip, the authors shown properly (with the year, perhaps collapsed), and the Abstract folded but visible in Structure. All of that is done.

How it finds the matter: a free rule that looks for exact labels such as "Abstract", "References" or "Acknowledgements", plus one cheap Haiku call that reads the article's opening, its headings and its close. Code then checks every stretch against the stored text before anything is folded. A reference must look like a reference. An abstract is at most 350 words. Contents are allowed only at the start, a reference list only near the end. The folds together must leave at least half of the article showing. Footnotes and appendices are never folded. If the call fails, the label rule's folds are stored alone.

The evidence: an eval of 52 articles in three sets, two of them held out until the code was frozen: papers, PDFs, journals, Wikipedia, essays, blogs, magazines, a thesis. None of the articles' own prose was folded. It found 67% to 96% of the matter, depending on the set. Misses stay unfolded, as today. Still missed: Wikipedia's citation lists, journal page furniture above the title, abstracts over 350 words, and some long author lists. The write-up is 261018b.

The authors: your paper's page declares no authors, so the masthead showed none. A page that declares no authors now takes them, and the year, from the arXiv or DOI record of its own id, and only when that record's title matches the page's exactly.

The Abstract is folded, as you leaned. If you would rather it showed open, that is a one-line change; say so in a reply.

Reply spya-r8arjm, Greg, 2026-10-18:

> 1A
> 2B
>
> And let's broadly try and remember these as principles. If we make a change that would affect all of the existing articles, assume that we're not going to re-import all of the existing articles unless I explicitly ask you to, because that would be somewhat expensive and probably a bit disruptive. So assume that we're just going to fix or improve things for new. And, and that, you know, if something's going to make the experience better and that it would be straightforward enough to include for shared articles, and it doesn't incur extra AI processing and it doesn't give away anything sensitive, then, you know, include it for shared articles too. And that way you don't have to ask me these questions every time. So make a minimal update to write this up as a principle in the appropriate docs.

Acted on (queue qi-8y3tx5tp, plan 261018l): 1A, existing articles are left alone and fold the new way when re-imported. 2B, visitors on a shared link now get the same folds, each stretch's two block ids and kinds and nothing else. The two principles are written into architecture.md § Conventions (no re-import by default) and security-map.md § The allowlist (shared articles get it too, on your four conditions).
