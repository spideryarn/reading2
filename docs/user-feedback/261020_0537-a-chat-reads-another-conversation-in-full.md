---
reports: spya-sfpcmm
ending: shipped
comment: On dev. A chat (and Explore) reading another of the reader's conversations now gets each question and answer whole, up to 6,000 characters a turn, rather than cut to 700, and can page back through a long conversation to its first exchange.
---
# A chat reads another conversation in full

Report `spya-sfpcmm` (#640, SPIDERYARN-READING2-M6), a suggestion from Greg
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Overseer queue item
`qi-edmt2dy3`. Plan: [261020k](../plans/261020k-reading-another-conversation-in-full.md).

> In a recent Explore chat, Adrian tried to ask it to have a look at the contents of his most recent
> Recall chat because he wanted to resume from it in Explore mode.
>
> The response was that it couldn't quite read the full chat... chats should have a tool that allows
> them to get the full contents of other chats.

**The tool was already there; what it returned was cut.** `reader_notes({ thread })` has let Chat
and Explore open another of the reader's conversations on the same article since 2026-10-03, but it
showed each question and answer cut to 700 characters, only the newest 10 exchanges, and 8,000
characters in all, with no way to ask for the earlier part. On production, 79% of Chat answers and
every Explore answer are longer than 700. Adrian's case, checked from counts and lengths only: his
Explore thread opened an 8-exchange conversation twice at 20:28 UTC on 2026-10-19, and the Recall
conversation it matches has all 8 answers over 700 characters. So the model was telling the truth.

**Shipped** ([chat-tools.md § The reader's notes](../project/chat-tools.md#the-readers-notes-the-one-tool-not-every-conversation-gets)):

- each turn shown whole up to 6,000 characters (the longest stored is 4,452); a longer one says it
  was cut;
- up to 32,000 characters and 40 exchanges a call, which holds every conversation on production;
- exchanges numbered from 1, and a new `before` argument to read the part a call could not reach.
  Each page says what it left out on either side and names the exact call for the rest; a wrong
  `before` is told so, never handed the newest page again;
- Chat's and Explore's prompts tell the model that when the reader asks to read all of a
  conversation or pick up from it, it keeps calling until exchange 1.

Kept the same: still only the reader's own conversations on this article, and only Chat and
Explore have the tool (Recall and Tutorial were left without it on purpose). What an injected
page could get the model to see is larger, and the plan and chat-tools.md say so. The
`chat-other-threads` eval is unchanged at 3/3, 3/3 and 0/3.
