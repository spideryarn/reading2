---
reports: spya-vc6uzm
ending: awaiting
comment: The guide searches the web, and a web page can now be brought into a Chat with a button, as an @-mention. Letting the guide open pages is planned; whether an agent may build it is q-g492eq.
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

**Ending: Awaiting Greg**, now on [q-g492eq](questions/q-g492eq.md) (the guide opening pages),
with the search half and *Bring into this chat* shipped on `dev`. [q-madusw](questions/q-madusw.md)
is answered.

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

**Greg's answer, 2026-10-17** (reply `spya-eqtvhz` to q-madusw, queue item `qi-jbfehgss`): *"1A and
2A / Re guide: our approach should be that it prefers to hand off substantive work (e.g. by offering
to create new Chat threads), but that it's not hobbled by lack of tools/capability/access if it tries
to do things"*. Plan [261017e](../plans/261017e-bring-a-web-page-into-chat.md).

- **1A, shipped on `dev`**: *Bring into this chat* on each *From the web* row under a Chat answer
  and under the box for each address in the draft. It imports the page as the Add box does (free if
  it is on the shelf already) and puts it in the box as an @-mention.
- **2A, planned, asked**: the guide opening a page edits a listed defence (its tool list), so it is
  planned in 261017e § Stage 2, limited to addresses the guide was handed and one read a turn, and
  whether an unattended agent may build it is [q-g492eq](questions/q-g492eq.md).
- **The principle** is in [chat-tools.md § The guide](../project/chat-tools.md#the-guide).
