---
reports: spya-vc6uzm
ending: awaiting
comment: The guide now searches the web through a small helper that hands back links with a sentence each. Keeping a page or search result in a Chat for later questions is a question for you (q-madusw), as is letting the guide open pages.
---
# Web search through a subagent, and results loaded into a Chat

`spya-vc6uzm` (#579, Sentry SPIDERYARN-READING2-HY), a suggestion from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row), filed 2026-10-12 10:07 UTC from
`/read/cf58f84d46a4a76bf5a5b039ac695fba6b80041c-spya-y4kxvy?margin=1&mode=search`. Taken
together with his reply `spya-q2z37j` to [q-w26r6u](questions/q-w26r6u.md), queue item
`qi-ht2wtjg8`. This session had no Sentry sign-in and did not write the Sentry status; the next
feedback sweep does. Plan, reviews and measurements:
[261012g](../plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md); spikes:
[261012b](../investigations/261012b-web-search-subagent-spikes.md).

> In a previous Feedback report, I suggested being able to @-mention another article from my shelf
> in a Chat. We'd equally like to be able to drop in urls or request web searches (perhaps these
> would be carried out by a smaller (e.g. Haiku) subagent), and then one or more of the results
> could be loaded into the Chat's context, so that I could ask stuff like 'where is this article
> situated in the wider literature?' etc.

**Ending: Awaiting Greg**, on [q-madusw](questions/q-madusw.md), with the search half shipped on
`dev` and not deployed.

What we did:

- **Spikes.** OpenRouter has no search API of its own; search exists only inside a model call. A
  small model running one forced-search call through Exa and writing five lines, each a link and a sentence,
  took about 9 s and $0.007, with five results every time. Luna wrote no wrong link in 28; Haiku
  mistyped 1 in 30, so every link is now checked against what the search returned.
- **`search_web`**, the subagent, as a tool the guide can call. Its results come back as an
  ordinary tool result, which is what makes guide search work at last (the old failure was the
  results vanishing when the guide pressed its next-steps buttons first). Two helper calls a turn at
  most.
- **Chat** keeps its own search. In the comparison the helper searched in the same places and cost
  about 15% less, but every searching answer took 11 seconds longer and lost its source chips.

Still open:

- **[q-madusw](questions/q-madusw.md)**: how a page or search result stays in a Chat for later
  questions (recommended: add it to the shelf and bring it in through the @-mention that
  `spya-a63vmt` built), and whether the guide may open pages.
