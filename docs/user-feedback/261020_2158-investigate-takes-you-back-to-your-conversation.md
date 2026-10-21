---
reports: spya-nhwy3d
ending: shipped
---
# Investigate takes you back to your conversation

Report `spya-nhwy3d` (#666, SPIDERYARN-READING2-MZ), Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-20 21:58 UTC, from Sources › Investigate on
`rovelli-order-of-time-…-spya-r26sug`. Filed as a suggestion; it is a bug.

> I started an investigate chat about how the piece had been received, and I can see it listed in
> the chat threads, but when I go to investigate, it just shows me an empty thing. So I feel like
> any time there's, yeah, I think in the case of investigate, either there's a single investigate
> thread, in which case it always takes me back to the same one, or we allow multiple investigate
> threads, which are like a subset of all the threads in chat that are part of the investigate
> mode, whichever you think's easiest and best.

**What was wrong.** Nothing was lost: the chat was stored with the right origin. But Investigate was
only a launcher. Coming back to it showed the questions again, with your conversation listed last,
and on a cold load not listed at all until the chat list arrived.

**Shipped**, to `dev`. It uses the second of the two models: multiple Investigate conversations, a
subset of Chat's.

- **Arriving on Investigate opens your newest Investigate conversation beside Sources.** It does
  this once per visit and sends nothing. It never opens over a conversation, an unsent passage chat,
  a note or an annotation that is already open there.
- **The way back from an Investigate chat in Chat** lands on Investigate with that same
  conversation still open.
- **Your questions** sits at the top, under the box.

A single thread would have needed a new kind of conversation and a migration. Asking a new question
still opens Chat. Keeping it inside Sources is the deferred step that plan 261020n already names.

Plan, reviews and evidence:
[261021b](../plans/261021b-investigate-takes-you-back-to-your-conversation.md).
