---
reports: spya-p4uqye, spya-ptjk63, spya-yt2v73
ending: shipped
comment: The guide now suggests before it asks, never asks about you, and answers a passage question briefly. Still waiting on you: may it start making a mode in the background without a press?
---
# The guide: plainer, no nagging, a short answer to a question about the piece

Three admin reports from Greg (`feedback-reporter.ts` exit 0 on all three, no addenda), batched as
Overseer queue item `qi-g6ryjr9y`:

> The Guide chat for a new article/user should be more easy to understand, shouldn't assume they
> have yet read the article, shouldn't nag them tooooo much for more information, perhaps should
> respond with some questions based on what they have told the Guide or said already about what
> they're reading...
>
> Try some evals yourself to try and make it more useful, less annoying, less work for the user, and
> guide the user more about how to use Spideryarn gently, while staying brief and reducing cognitive
> overload.
>
> — Greg, 2026-10-19 19:44 UTC (`spya-p4uqye`, #626, SPIDERYARN-READING2-KN)

> In the Guide chat, perhaps ask the user questions based on what they've already told you (to
> clarify their needs) if they have already told you something? Or make suggestions. Rather than
> simply asking the user to do all the work in stating their needs.
>
> But at the same time, we want to minimise cognitive load for the user, minimise
> faff/overhead/preamble to actually reading the article, and so don't spin out the conversation
> about their needs too long.
>
> — Greg, 2026-10-19 20:17 UTC (`spya-ptjk63`, #635, SPIDERYARN-READING2-M0)

> I wonder if we should allow the Guide chat to be a normal chat about substantive points about the
> paper - that's what people keep trying to use it for when they first see a chat. They ask
> questions about the paper itself. Or alternatively maybe make it really clear that it's just an
> introductory Virgil-style chat? Although I think maybe they'll just get confused/frustrated if the
> initial chat is weak/limited.
>
> And/or maybe take into account whether they're a brand-new user, and make high-level suggestions,
> e.g. try the Summary.
>
> The Guide should be allowed to initiate/generate other modes in the background that it thinks will
> be helpful for the user (so that they'll be ready when the user needs them), but it shouldn't
> actually switch to them unless the user presses a button in the Chat UI (to avoid confusing them).
>
> Also one of the available tools should be to generate a Skim-route based on what they're saying.
>
> If the Guide does offer to create a new chat for them, stay closer to their actual words.
>
> — Greg, 2026-10-19 20:21 UTC (`spya-yt2v73`, #638, SPIDERYARN-READING2-M3)

**Ending: Shipped**, to `dev`, not deployed, all but one part. Plan, with both GPT Sol reviews:
[261019p](../plans/261019p-guide-chat-plainer.md); the eval:
[261019b](../investigations/261019b-guide-plainer-blind-judged.md).

- **Shipped.** The guide gives a concrete suggestion before it asks anything. It asks about your
  reading at most once more, as a guess with buttons to tap. It never asks about you, and does not
  assume you have read the piece. A question about a passage gets two or three sentences linked to
  the passages, then *Ask in Chat*, whose words are now yours, copied exactly. *What is this piece
  about?* gets one line and Summary as a map, and is now one of the three starter buttons. The
  greeting asks why in a few words, or lets you just ask something, and no longer asks about you
  or quotes About you back. Blind, the new guide won 19 of 22 pairs; the old against itself split
  12–10.
- **Waiting on Greg: making modes in the background, and a Skim route from what they say.** It
  changes the defence that nothing the guide suggests runs until the reader presses, so it is asked,
  not built: question `q-y4p2ct`, queue item `qi-3q9z7mr6`. Skim already plans from the saved
  reason, so the route follows from the same answer.
