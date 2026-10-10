---
reports: spya-h5aypq
ending: shipped
comment: Researched what a peer reviewer needs and drew the line between Sources and Referee; the guide offers Referee to referees. You answered q-fkq30v: Promises and starter criteria are queued first.
---
# Peer review for someone writing a review: the research, the line between Sources and Referee, and a Referee offer from the guide

`spya-h5aypq` (#519), filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-09 12:37 UTC, from Chat on `arxiv-1706-03762-spya-wyt7j0`. Sentry
`SPIDERYARN-READING2-FZ`. Overseer queue item `qi-8g2tr5bt`, session
`fbh5aypq-peer-review-research`. This session has no Sentry sign-in and did not write the Sentry
status; the next feedback sweep does.

> So conversations with friends and potential users, especially the scientists and academics, peer
> review is a real opportunity. So we've already suggested a whole bunch of stuff around gathering
> together citations and debate into one. I think we called it peer review as the mode, with the
> citations becoming being renamed as bibliography. I think that's a previous feedback report. Okay,
> so let's go beyond that. I think let's start with a Sonnet web search that really tries to
> understand what are the challenges and goals and likely tasks that peer reviewers might need. And
> I guess there are different personas. So the main one I'm focusing on is someone who's been asked
> to do a peer review. Another would be a journal editor who's got to find candidates. I think
> probably that's quite a niche case, and they can do that with just a standard chat agent. So let's
> focus more on, you know, someone who's got to write a review. And again, remember the vision. The
> vision is not to write the review for them. The vision is to enable them to notice stuff. And so
> let's think about how to do that. I think some of the stuff that we had in the referee mode is
> already about this. So I guess referee and peer review are kind of related, and now I need to
> think about how they're the same or different. I guess referee is specifically about being a, you
> know, reviewer for a journal or whatever, and peer review is now, well. I thought it was a really
> good name a minute ago, but, you know, it's more about understanding this paper and where it's
> situated both in terms of inbound and outbound citations. Yeah, and referee is more like making a
> decision on the paper itself. Obviously, that still requires you to look at where it's situated
> in terms of peer review, but referee is more about making a decision and therefore sort of having
> information highlighted suggests that perhaps the reader evaluates.
>
> P.S. I mean, if the reader says in their Guide chat or their Why You're Reading This that they are
> a referee, that should obviously present tools for the Referee mode etc.

**Shipped**, to `dev`, not deployed.

- **The research.** A Sonnet web pass
  ([261009b-peer-reviewer-web-pass-sonnet.md](../research/261009b-peer-reviewer-web-pass-sonnet.md))
  on top of the August pass that Referee was built from. The write-up is
  [261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md):
  the reviewer's job in six steps against the modes we have, where the two modes divide, why
  confidentiality decides whether a referee can use any of this, and seven ideas not built.
- **The line.** Your lean, and what is already built, agree almost row for row. Sources (Peer
  review's new name, your answer to q-xf2xvb, being done under queue item `qi-m9tmnpy3`) asks *where does this
  piece sit?* and is for anyone. Referee asks *what do I have to judge, and have I looked at it?*
  and never gives the verdict. Written into
  [referee-mode.md § Referee and Sources](../project/referee-mode.md#referee-and-sources-since-2026-10-09).
- **The P.S., built.** A reader who tells the guide, or writes in *Why you're reading this*, that they
  are refereeing is offered Referee and its sub-modes as buttons, even with experimental features
  off. The guide never opens Referee for them. Each offer says the text was already sent to an AI
  provider when the article was added, and that Referee's Notices say what journals' rules are on
  that. Before: the guide never mentioned Referee, and sent referees to *Peer review › Claims*.
  After: 14/14, and the magazine reviewer, the reading group and a planted paragraph got no offer
  ([261009d](../investigations/261009d-the-guide-offers-referee-to-referees-measured.md)). Plan
  [261009x](../plans/261009x-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md),
  GPT Sol on the plan (eight findings, all taken) and on the code.
- **Referee's button card** now says *"Refereeing it? What to weigh before you decide: your criteria,
  its claims, and a second look at your notes"*, and its second paragraph points to the other mode
  for where the piece sits.

**For Greg:** [q-fkq30v](questions/q-fkq30v.md). It asks four things: the two sub-modes both called
Claims, whether Candidates (the editor's job) stays, whether Referee leaves the experimental
switch, and which of the seven ideas comes first.

**Seen in passing, not this report's:** one eval answer in fourteen was written twice. That is
postmortem 261009j's class coming back, and it is queued for the Overseer.
