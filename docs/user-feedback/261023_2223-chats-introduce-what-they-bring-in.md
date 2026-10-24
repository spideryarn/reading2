---
reports: spya-bq9wv5
ending: shipped
comment: Chats now introduce each person or work they bring in, where they name it: about half as many unexplained names for a general reader. Experts saw no change yet; that half is queued.
---
# Chats introduce what they bring in

Admin report from Greg (`feedback-reporter.ts` exit 0, event matched, no addenda), #679, Sentry
event `6b5ba8403e4c468cac2abff2a7a403c5`, filed from Explore on *Effective expressiveness*
(`effective-expressiveness-spya-z8dehh`, thread `spya-pdsm3y`):

> Have a look at my explore chat and the recall chat that it came from. The response from the LLM to
> my question about what other people have thought is pretty dense. I'm not sure I honestly followed
> it. So I wonder if there's a very minimal tweak we could make to the prompt that really tries to
> ensure that the LLM's responses don't assume that the reader has read everything the LLM has. Like
> a good teacher tries to sort of anticipate what the reader may or may not know and doesn't assume
> that the reader has read everything that's being referred to. For what it's worth, I think this is
> a larger problem of chats with LLM, and so maybe this could be a minimal update or emphasis that we
> add to the system prompt, that the LLM tries to put itself in the shoes of a reader who has not read
> everything that the LLM has, or maybe they have, but not recently, and take into account the
> reader's sort of user profile and why they're reading it. But even then, even if I'm a
> neuroscientist reading an article about neuroscience, I may not have read all the references or
> whatever recently, so I might be rusty, or I may not have read them at all. So even then, I don't
> think it does any harm to reiterate background that will make it then easier to understand the
> point being made.
>
> — Greg, 2026-10-23 22:23 UTC (`spya-bq9wv5`)

**Ending: shipped**, on `dev`. One clause on the shared `CHAT_PRINCIPLES` (Chat, Recall, Explore,
the guide): do not assume the reader knows or remembers a person, work, study or term you bring in;
introduce each where you name it, in a few words, and say why it matters here. Explore's "say what
you found in a sentence or two" now carries that background inside the sentence or two. Plan
[261024d](../plans/261024d-chats-give-the-background-for-what-they-bring-in.md), measurement
[261024a](../investigations/261024a-chats-give-the-background-measured.md), which replayed Greg's
own Explore turn.

What it does not do yet: for a reader whose profile says they are an expert, the replies still name
theories by acronym, and the measurement saw no change there. The likely cause is `PROFILE_RULES`
("Assume the background they claim…"), which is more specific and wins. Greg asked for experts too,
so that half is queued as its own Overseer item, `qi-jq3tckr5` (a proposal awaiting his
authorisation): a narrow carve-out there, or a rule in the sections that report outside findings,
re-measured on the same eval.
