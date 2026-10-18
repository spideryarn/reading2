---
reports: spya-m53cdk
ending: shipped
comment: Shipped: Open in Sources centres and flashes the work, the list has more room, and each cited work gets a checked note from its abstract. Open question: a web search for the clicked work, and free API keys for more coverage.
---

# Open in Sources lands on the work and flashes it, a roomier list, and a note per cited work

Report `spya-m53cdk` (#593, `SPIDERYARN-READING2-JF`), from Greg (an admin), filed 2026-10-17,
build `614e42c5`, on `arxiv-2308-08708-spya-xax6v4`. A suggestion.

> I clicked "Go to sources" for a citation tooltip. It opened the Sources mode, but it was hard to
> actually see which source was being referred to - can we scroll to the right source (perhaps
> centred in the scrollable area), and flash it. Also, there's not much vertical real estate for the
> scrollable area with the actual sources. e.g. we can hide this ("Unless a row says otherwise, we
> have read none of these works, only the article that cites them") behind an information-tooltip,
> and anything else that's repetitive/not adding much information. And finally, the Source mode
> isn't that helpful. I know we had switched to "Ask in chat" for a deep dive on a source, but
> that's a bit heavy-weight/slow. I wonder if we should: - Whenever I click on "Go to Sources" for a
> citation, automatically run a websearch and provide a brief (couple of sentences) blurb based on
> whatever's available for each source as part of generating the Sources mode (with clear
> indication in info-tooltip that it's just a quick web search, whether or not it's based on
> finding the Abstract, or the article itself, or what other people said about it, better to say
> nothing than hallucinate if you can't find any primary/authoritative sources, etc) - How
> expensive would it be to do this for all the citations when generating Sources mode? Run some
> spikes/evals. If we can do a decent enough job of it for a few cents for all the citations for a
> standard article, it's worth doing. (And the "Ask in Chat" remains for a deep dive on any of
> them) I'm thinking we could get away with Haiku 5.5 for this brief-citation-blurb work.

**Ending: Shipped**, on `dev`. Plan
[261017h](../plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md),
design [261017h stage 3](../plans/261017h-stage-3-design-citation-blurbs.md), spike and eval
[261017c](../investigations/261017c-citation-blurbs-cost-and-quality.md).

- **Landing:** *Open in Sources* (and every band's way back to an item: Glossary, Ideas, Claims)
  centres the row in its own list and flashes it. It had put the row flush against the list's
  bottom edge with nothing to mark it.
- **Room:** the "we have read none of these works" line is in the band's (i), and the threshold's
  note is one line.
- **A note per cited work, from its abstract, not a web search.** The spike measured both. A note
  written only from the work's abstract (Crossref, DataCite) costs about 1–2 cents for a whole
  article, and on the shipped code 74 of 75 sentences were supported and none was about the wrong
  work. A web search per work cost about 30 cents an article, and 17% of its sentences said more
  than the page. So notes are made, on Haiku 5.5, whenever a Bibliography is made, each checked
  against its abstract by code and by a second call, with nothing shown when nothing authoritative
  was found. The (i) and each note's card say exactly that.
- **What is open:** coverage on Greg's paper is 40% (the coding paper 64%), and a web search for
  the one clicked work was not built. Both are question [q-ny49p3](questions/q-ny49p3.md).
