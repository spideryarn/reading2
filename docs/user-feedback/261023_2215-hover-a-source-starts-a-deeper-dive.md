---
reports: spya-mxk20e
ending: shipped
comment: Rest on a citation naming one work and after about 2 seconds the card starts Does it say that? and shows its answer: about 20 seconds and 17p each, capped per day. A tap does not start one; the button does. Each is a chat in Chat's list.
---
# Hovering a source starts a deeper dive: shipped

Report `spya-mxk20e` (#678), SPIDERYARN-READING2-NA, Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-23 22:15 UTC, a suggestion, filed from
`/read/effective-expressiveness-spya-z8dehh?mode=structure&thread=spya-tt3zzc&at=spya-er9psy`:

> I think any time I hover over a source, let's automatically start, you know, initiating some kind
> of deeper dive, which could be the same as initiating an ask in chat with a default input and just
> stream in the response so that I can just hover over a source or a link or whatever and find out
> more without having to click and ask for it and be taken somewhere else.

**Ending: shipped, for every reader (Greg chose C on [q-hc4y2j](questions/q-hc4y2j.md), reply
`spya-r5hb87`, 2026-10-24: "C. Make it a main rather than experimental feature").**

- Resting about 2 s on a citation that names one work, in a paragraph that cites it, starts
  *Does it say that?* and shows the answer in the card, with *Continue in Chat*. One chat per work
  and paragraph (a `cite-check` thread origin, unique in the database); a second rest reuses it.
  Keyboard focus counts as a rest; a tap does not.
- Measured: 17p median (7p to 43p), about 20 s
  ([261024d](../investigations/261024d-does-it-say-that-cost-and-latency.md)). Automatic starts
  are capped at 8 an hour and 20 a day per reader and 100 a day overall; the button is not.
- The answer arrives whole after a tool round (upstream; the card shows what the chat is doing
  meanwhile). Plan, reviews and what was left undone:
  [261024m](../plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md).
- A link's card already streamed a note
  ([links.md](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands)).
