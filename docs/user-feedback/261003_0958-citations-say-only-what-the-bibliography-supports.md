---
reports: spya-zmdb7y
ending: shipped
---
# Citations: say nothing about a paper beyond the bibliography

Greg's suggestion from the Feedback dialog (he is admin), filed 2026-10-03 09:58 on the Entropy
article, relayed by the Overseer. Sentry: confirmed, event `57fc6776b14c4fb8836b8ce90791daae`. Not
built before (checked `git log origin/dev`, `docs/plans/`, this directory and `gjd-remote ls` on
2026-10-03).

> I'm not sure about this, but it seems as though citations mode is actually not adding much value because it's just kind of, it's extracting out the references. Okay, that's good. I think just being able to see, for a given block or whatever, okay, this is the citation, you know, because it's only got a footnote, 15 to 17. Okay, 15 corresponds to this one, 16 to this one, 17 to this one. Okay, great, and with the title and whatever in situ, that would save me jumping around. Okay, that's moderately useful. But it seems as though it's actually just giving some kind of paraphrase of what's already in the text about that piece and not adding anything. If that's the case, and I mean that kind of makes sense, that's all it can do without searching the web. That's almost no value. So I'm trying to—well, okay, it is a little bit of value, but it's not much. And we don't want to mislead the reader into thinking that that's what the paper actually says when actually there's no new information beyond what's in the text. So instead, I think citations mode should perhaps err on the side of saying, you know, nothing about a paper beyond what's available in the bibliography, but I know we have a dig deeper or something button that can then go out to the web. Great. So better to say less and allow the user to ask for more and be explicit about the limitations or whatever, or not give an indication that we've done more than we actually have. And it does mean that the user will have to click dig deeper and then there's a delay, but I think it's too expensive to do the full web search for every single citation every time. So we have to just accept that it has to be on request.

**Shipped.** The model's sentence on each work (*what the article uses it for*) is no longer shown on
the row, the hover card in the prose, or Marginalia's citation note. A row is now the title, authors
and year, the reference entry, the link, and the line saying we have not read the work. The sentence
comes back only after *Dig deeper*, beside the check that was made against it. Nothing was re-run:
lists already made are drawn the new way. A list made from now on also drops an author or year the
article never gives (one stored row in 194 had an author from the model's memory). Plan, measurement and GPT Sol's reviews:
[261003j](../plans/261003j-citations-say-only-what-the-bibliography-supports.md).

One question is left for Greg in that plan: whether the model should stop writing the sentence at
all.

## The influence bar: Greg's answer, and what was built

The other question, whether the *influence* bar still belongs on a row, Greg answered on
2026-10-03:

> Q-influence Hmmm, I'm torn. Maybe if the model is confident (e.g. because it's well-known), but if
> in doubt default to Unknown. And if we do a deeper dive on a Citation, try and populate it then.

**Shipped, with one part that works less well than hoped.** A list made from now on gives a work an
influence score only when the model is confident it knows the work; otherwise the row says
*influence unknown*, which on a long list is about half the rows or more. The threshold bar judges
such a row on its relevance alone, and the influence order puts them after the scored rows, most
relevant first. A list made earlier keeps its numbers until it is made again from the Metadata
page. *Dig deeper* now also looks for the work's influence in what its web search finds, and when a
page about the work says, the row shows it marked *from the web* with the page's words. In a probe
of 13 well-known works it found nothing for any of them, because a search for a paper returns the
paper and not a statement of how famous it is. Plan, measurements and GPT Sol's reviews:
[261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md).

Two questions are left for Greg in that plan: whether a row with a DOI should show a real citation
count from Crossref, and whether the threshold bar should go by relevance alone for every row.
