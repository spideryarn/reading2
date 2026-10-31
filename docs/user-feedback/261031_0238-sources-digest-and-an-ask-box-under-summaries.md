---
reports: spya-vqmfrs
ending: shipped
comment: Sources › Digest is built behind the experimental switch, with an ask box under it and under Summary's Brief and Fuller. Not yet run live (key limit); measuring it, and your choices, are queued and in question q-v03wmh.
---
# A Sources digest, and an ask box under it and under Summary

`spya-vqmfrs` (#740, suggestion), from Greg (admin; `feedback-reporter.ts` exit 0 on the production
row). Filed 2026-10-30 08:52 UTC from `/read/arxiv-2308-08708-spya-xax6v4?at=spya-q9gxst&mode=sources`,
build eee414b6. Sentry event `30e483dd55dd48aaacee2b7535c44812`. No screenshot, no diagnostics.
Addenda: none (read again 2026-10-31 before this note).

His words, in short (the whole report is long; it is quoted in the plan):

> let's do this as new submodes in sources, because I don't want to screw with what we already
> have. … a summary of all of those, I think, four points I made before: outbound, inbound, anything
> missed, and anything that doesn't quite say what the article purports them to say. … there should
> be a text. Input box underneath … and actually, there probably should be a text input box at the
> bottom of the summaries as well … they would be their own special types of chats that would also
> be listed in the list of chats. … Let's just try and make this be as valuable as possible, and
> then we'll figure out what costs the most afterwards.

**Ending: shipped**, on `dev`, not deployed. Plan, research, reviews and progress:
[261030b](../plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md);
research [261030a](../research/261030a-sources-digest-how-others-show-a-papers-citations.md).

What was built:

- **Sources › Digest**, a fourth chip behind the experimental switch. A press plans up to 16
  questions about the piece, runs their web searches (and OpenAlex's citers), gives each to a Haiku
  reader whose quotes the code checks word for word against the page, and has Opus write an
  overview and four sections: what it builds on, who has taken it up, what it may have missed, and
  citations worth checking. Sentences light while their passage is on screen and jump on a press;
  each paragraph has *More* (detail and sources with quotes) and its own *Ask in chat*; each
  section has an (i); *What was searched* is folded underneath. Owner only.
- **An ask box** under the digest and under Summary's Brief and Fuller. Its first Send starts a
  chat, listed in Chat as started from the digest or from Summary › Brief/Fuller, with a way back;
  after that the box becomes the chat's *Continue* mark. One chat per digest, paragraph and level.
- Found on the way, and fixed: *Where it sits* could start a second paid search when another tab's
  finished (postmortem
  [261030c](../postmortems/261030c-a-state-update-in-one-passive-effect-cannot-guard-a-later-effect-from-the-same-render.md)).

**What Greg is asked**, in [q-v03wmh](questions/q-v03wmh.md): the wording of his two principles
(progressive disclosure; build a version, then ask in small pieces), proposed rather than written
into principles.md, which changes only with his approval; whether the readers may search again after
reading a page (not built: a page could steer what we search and spend); and three small layout
choices, each built as option A.

**Deferred, each queued:** measure a real run once the OpenRouter key resets on 1 November
(`qi-dykn3xjh`; no live run has happened, so cost and quality are estimates: about $0.85 a run,
worst about $1.80); readers that search again (`qi-xgnn5fpb`, waits on Greg); the other layouts
(`qi-eerykqdn`, waits on Greg); an abort signal through the OpenAlex lookup (`qi-nc9rjdcv`).

Decided without asking: owner only (it is written for the owner's profile and quotes strangers'
pages), and it stays behind the switch until a live run is measured.
