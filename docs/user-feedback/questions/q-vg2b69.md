---
id: q-vg2b69
report: spya-w95xmq
status: open
asked: 2026-10-25
title: What should Sources show first, and should six sub-modes become three?
refs: docs/plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md · docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md · docs/user-feedback/261023_2305-sources-situate-the-piece-in-the-literature.md · docs/project/sources.md · qi-mbh8appj
---
I tried Search the literature on six real articles. On five of them it found what a careful reader in the field would point to (on the blog post it was thinner), for about $0.33 and 45 seconds an article; Reception, Cited by and Not cited mostly did not. So in every option, Sources goes from six chips to three: Where it sits, Bibliography, Links. Reception, Claims, Not cited and Investigate move inside the first one, folded, with nothing lost.

1. What should Where it sits show when you open it?
A. The Search the literature findings, made by themselves the first time you open Sources on an article. About $0.33 each time, on every article you open Sources on; sends the article to the AI without a press; at most four an hour.
B. Two short free lists first: the papers that came after it (filtered to those about its subject, for a well-cited paper) and the works it leans on most, with a Search the literature button. After you have pressed it once, the findings come first on every later visit (recommended). Nothing new is sent until you press.
C. Two chips, After and Before, each a list of papers, with the findings added to them as marks (disputes, builds on, mentions). Costs a little more per press, and a finding is no longer beside the sentence it is about.

2. Two rules that decide what the lists show:
A. Treat one paper held twice in the citation database as one, and take its citers together; and list translations and reprints of the piece under "Other editions of this piece" instead of as papers it did not cite (recommended).
B. The same, but hide translations and reprints entirely.
C. Leave both as they are: a paper held twice shows no citers, and its own translations stay in the not-cited list.

Details

What this is for. Over 22 reports since 11 September you have asked Sources for the same five things: who cited the piece and whether they agreed; whether its citations hold up; something beyond paraphrasing the article; the key themes and landmark papers; and fewer sub-modes. You answered on 25 October that before or after "depends on whether this is an old or a new article", and asked for proposals on what to show first.

What I tried. Six articles on my own machine (never production): Clark & Chalmers, The Extended Mind (1998); Dropout (2014); Evaluating AGENTS.md (February 2026); Anil Seth's essay The Mythology of Conscious AI; Scott Alexander's Heuristics That Almost Always Work; and Consciousness in AI (2023). On each I ran Search the literature, today's Reception, Cited by and Not cited.

What came back. Search the literature, on The Extended Mind: Adams & Aizawa's "coupling is not constitution" beside the sentence they attack, Rupert's rival view, the "second wave" of the debate, and Clark's own 2025 paper on AI. On Dropout: the 2017 challenge to its main explanation, the Bayesian reading, why plain dropout is weak in image networks, and why large language models stopped using it. On the 2026 AGENTS.md paper: its wording softened between versions, and its headline result rests on a borderline statistical test. On Seth's essay: the academic paper behind it and the fifty published replies to that. Reception found nothing on three of the six and one page on each of the others. Cited by found nothing for The Extended Mind (the database holds it twice) and, until I fixed it today, nothing for Consciousness in AI (the database's record carries another paper's title). Not cited listed The Extended Mind's own Spanish translation as a paper it does not cite.

What each option means in use, with sketches, is in the plan (refs). In short:

A gives you the best part straight away, but spends money and sends the article out every time you open Sources, even for a glance at the bibliography, and after four articles in an hour it stops working until the hour is up. It also hands you a verdict before you have read.

B opens on lists that cost nothing and send nothing new. For The Extended Mind, After it shows the 556 citing papers that mention "extended mind", led by Sterelny, Rupert and Gallagher, which is close to the landmark papers you asked for. Before it shows Kirsh & Maglio, Putnam, Burge and Hutchins. You press for the findings. Once you have, they are what you see first on that article. An essay or blog post with no record in the database gets only the button. About three sessions (afternoons) to build, plus one for the parts shared by every option.

C organises everything by paper. That reads well for citation lists, but the best findings often are not a citing paper at all (Adams & Aizawa came from a web search), and abstracts rarely say whether they agree, so most marks would say only "mentions". About a week.

On "who cited it and did they agree": in every option the findings read the citing papers' abstracts. For a paper with thousands of citers, they read the ones about its subject rather than the most cited, which for Dropout are image-network papers that mention it in passing. The citing sentence itself would be better still, and waits on your Semantic Scholar licence question (q-x9srvv).

Question 2 is yours because both change a rule chosen on purpose. Today, when the database holds one paper as two records, Cited by refuses to choose. Taking them together only when the title, two authors and the year all match is the change. Hiding the piece's own translations is tidier; grouping them keeps a useful edition findable.

Decided without asking: the findings will be checked in code so that "Since" only cites work dated after the piece, and a note naming a paper it has no source for is trimmed. Fixed today: Consciousness in AI's citers, so Cited by now finds its 196. Not built: any of A, B or C.
