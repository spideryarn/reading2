---
reports: spya-yyf38a
ending: shipped
---
# The FAQ starts with the big questions, under a threshold

SPIDERYARN-READING2-5D (`spya-yyf38a`), from Greg (admin), filed on
`/read/9689-full-spya-m43th2?mode=faq`. The time in the file name is when this session picked the
report up. The report text came in the brief.

> The FAQ questions seemed pretty kind of dense and low level. I wonder if we could perhaps start
> with a few that are a little bit more high level. Or actually, perhaps we could even consider
> using the same approach we use for the glossary and other places, where we give each question a
> rating for something like how difficult and how central, as well as the ordering. And that way
> then we could have a prioritized ordering by default with a threshold, and the threshold could be
> some compound of difficulty and centrality. And then it would show them in order given that
> threshold.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 5D; the next feedback sweep does the
Sentry status write.

What we did:

- The FAQ prompt now asks for up to three broad questions that press on the piece's main claim.
  Summary questions such as *"Why should we believe the main claim?"* are still ruled out.
- Every question now gets a **difficulty** and a **centrality** score from 0 to 1, the same two
  scores the Glossary uses, checked by the same code.
- The FAQ now opens in a **prioritised** order. The most central and approachable questions come
  first, and a threshold slider hides the rest. **Reading order** is one tap away. Each row shows
  its two scores as small bars.
- The compound is `centrality × (1 − difficulty)`. It is not the Glossary's
  `difficulty × centrality`, because that one ranks easy, central questions last, and those are the
  high-level ones you asked for. The same number sets both the threshold and the order, so dragging
  the slider removes questions from the bottom of the list.
- The threshold starts at 0.20, which shows about 90% of the questions. It was measured on six
  articles.
- FAQ lists made before this change have no scores. They look exactly as they did before, with no
  slider. **Your article's list is one of these.** To get the new version, re-run FAQ from its
  Metadata page.

Measured on six local articles (your article is only in production, so it was not one of them),
with a blind judge. Most of the improvement comes from the new order. The prompt change alone
scored inside the noise. It cost about $2.30. Details in the plan's § Progress.

Assumptions, for you to overturn:

- **The compound.** You left the formula open, so this is my choice (see above).
- **Two orders, not four.** The Glossary also sorts by difficulty alone and by centrality alone.
  The FAQ offers only prioritised and reading order.
- Moving the Glossary's and Citations' sliders onto the new shared slider component is left for a
  separate change.

Plan: [260929g](../plans/260929g-faq-difficulty-centrality-and-a-threshold.md).
