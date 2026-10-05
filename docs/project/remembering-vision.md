# Remembering — where Learn mode is going

Up: [reading-view-overview.md](reading-view-overview.md) · what is built:
[remember-mode.md](remember-mode.md) (Recall, Tutorial, Explore) and [quiz.md](quiz.md) · the research:
[261002c](../research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md)

**A direction, not a spec.** Started 2026-10-02 from Greg's reports `spya-c8x66d` and `spya-j0scgz`.
What is built is in the two docs above; this is the reasoning that ties the four sub-modes together
and the ideas that are not built yet.

## The point

Spideryarn augments reading rather than replacing it (vision.md), and remembering is where that
matters most: **the act of recalling is what makes a piece stay with you**, and a model that hands
the reader a summary takes that act away from them. So every part of Learn is built so that
the reader does the remembering and the model makes it likely to succeed.

> the job is to prompt the reader … in such a way that they're continually recalling … a little bit
> more each time. And you know what, if it's clear that they are struggling, then don't make them
> suffer or feel bad or fail. In that case, maybe you do just provide more. So I guess you're being a
> bit adaptive.
>
> — Greg, `spya-c8x66d`, 2026-10-01

> my mental model is that the goal is you're sort of teaching in a sort of somewhat Socratic way. So
> you're sort of asking questions where the questions themselves are often a form of teaching because
> they get me thinking about the topic. And also they might nudge a recollection. Or at least they
> might nudge me to speculate. Hopefully in a way that I'm guessing in the right direction. Because
> you want the user to feel successful and smart. And lots of small increments is probably better
> than big, slow increments.
>
> — Greg, `spya-j0scgz`, 2026-10-01

## Four sub-modes: three directions of the same exchange, and one that faces the other way

```
            who talks first      what the model does                    the research behind it
   Recall   the reader           corrects briefly, nudges them to       retrieval practice,
                                 remember a little more, fills the      cued recall, a hint ladder
                                 gap when they are stuck
   Tutorial the reader, then     teaches a little, asks them to say it  one-to-one tutoring, self-
            turn and turn about  back or use it, comes back to earlier  explanation, Bloom's levels,
                                 points                                  spacing within a session
   Explore  the reader           starts from what they marked and       none commissioned: built
                                 discussed; one move a turn (a          from Greg's two notes of
                                 question, a case of theirs, a          2026-10-03, and his third
                                 connection, a possible problem with    of 2026-10-05
                                 the piece, what the wider world says)
   Quiz     the article          asks questions, marks the answers      the testing effect
```

Recall is closest to testing: the reader brings what they have. Tutorial is closest to teaching:
the model brings a little at a time and the reader turns it into their own words. Greg: *"it's a
sort of balance between test-driven learning and kind of conversational teaching one-to-one."* Quiz
is the article asking, with no conversation.

**Explore is the one that is about the reader's thinking rather than recall.** The other three ask
what the piece says and whether the reader has it; Explore asks what the reader makes of it. Greg,
2026-10-03: *"helping me to think, explore & spark new ideas of my own and deepen my intuitions and
apply to interesting cases of my own … and a bit less about remembering specifically what's in the
article."* And on 2026-10-05, widening it: *"it's also about exploring potential problems and
criticisms and concerns … deepening your thinking around the piece, whereas tutorial submode is more
about understanding and internalizing what the piece says"* (remember-mode.md § Explore). He renamed the mode
Learn in the same report. It sits under Learn because thinking with a piece is the other half of what
vision.md calls internalising it, and because it grew out of Tutorial: when Tutorial was turned
towards the author, the own-view turns it gave up needed somewhere to go. It is also the first
sub-mode that knows what the reader did elsewhere on the article, which the last idea in § Not built
yet asks of the others.

## What they share

The first two are about remembering, so they hold for Recall, Tutorial and Quiz. The rest hold for
Explore too.

- **Hints that make success likely, without being a gimme.** A cue reinstates where in the piece
  something was and what the author was arguing, rather than supplying the answer.
- **Never make them fail twice.** Two rungs of hinting at most, then tell — plainly, without "wrong".
- **Brief.** Each turn a paragraph or two at most, so it feels like a conversation rather than a
  lecture. A long explanation is a sign the reader wants Chat, or the passage itself.
- **Block links, always, for what the piece says.** Every reply that says what the article says
  names where to look, so the reader can go back to the words rather than take the model's. That is
  the augment-not-replace rule made concrete. An Explore turn need not be about the article's
  words; when it quotes them, the id is there.
- **Adapted to the reader.** The profile and the reason they gave for reading change the
  conversation completely: *"if I'm an expert in the topic trying to find out one particular issue,
  then the conversation should be very different than if I'm a complete novice."*
- **No praise inflation, no verdicts.** A specific acknowledgment of what they got, at most.

## Not built yet, and worth building

- **Live voice for Tutorial.** Short alternating turns are ideal spoken; Greg: *"I think this would
  be ideal for the live real time voice. But that doesn't work very well at the moment."*
  ([live-conversation.md](live-conversation.md)).
- **A way to hand off to Chat.** When a reader needs a long explanation, the model should offer to
  start a chat on that one topic, already seeded (`spya-cjquu6`). Today it can only say so in words;
  there is no tool that starts a thread ([chat-tools.md](chat-tools.md)).
- **Spacing across days, not just within a conversation.** The strongest effect in the literature is
  coming back after a delay. A Learn that knew what you recalled last week, and asked about the
  part you lost, would use it; nothing schedules that now ([cron-scheduler.md](cron-scheduler.md)).
- **Specialist interactions, sparingly.** Cloze (fill in the gap) is the one Greg is open to;
  multiple choice he is wary of, and finds both *"kind of artificial and annoying"*. Plain
  back-and-forth first.
- **Recall and Tutorial knowing about each other and about Quiz** — a Tutorial that starts from what
  the Quiz showed you missed, for instance. Explore is sent the reader's notes and a list of their
  other conversations on every turn (remember-mode.md § The notes go with every turn); the Quiz's
  results and reading time are not in that yet.
- **Live voice for Explore**, for Tutorial's reason, and with one more thing to solve first: a
  spoken turn carries no notes digest.
