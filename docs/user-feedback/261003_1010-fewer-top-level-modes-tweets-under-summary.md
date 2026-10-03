---
reports: spya-thpsnd
ending: shipped
parts: 3
---
# Fewer top-level modes: Tweets becomes Summary's Thread

Part 1 of 3 of Greg's report `spya-thpsnd` (SPIDERYARN-READING2-AX), a suggestion filed from the
Feedback button on 2026-10-03 and checked as an admin's (`feedback-reporter.ts` exit 0, by the
sweep). Overseer queue item `qi-h99jjy25`. The other two parts are the natural-language command bar
(session `fb-command-bar-nl`, `qi-3wb7cgda`) and steering Debate (session `fb-debate-2610`,
`qi-ge6q7qeb`); each writes its own note.

> I would like to have fewer modes, and I can't figure out how to do that. You know, if a new user comes to Spideryarn, they're going to be overwhelmed. I guess there's a few potential solutions. One solution would be to sort of amalgamate them a bit more somehow, so there's just fewer icons at the bottom. But then there's submodes, but maybe that's okay because the submodes are more clearly labelled and they're all grouped together. So, for example, you can imagine putting glossary and ideas and quotes and stuff like that all within the marginalia mode, so that you could say, I only want... Yeah, submodes within that. That could work. And likewise, I was thinking about putting the tweet thread as a submode of summary, because they kind of serve related purposes. In the summary, if we did that, maybe we get rid of the slider. Not sure. I was thinking that I quite like, of the three versions of the summary length that we have, I quite like the shortest and the longest, so what is that, briefer and fuller. So it could just be briefer, fuller, and tweet thread as three buttons somehow. Not buttons, like group buttons. Not radio buttons exactly, but like, you know, a sense that you can have one of those three. I think I'd like to try that. I'm not sure if it's going to make things better, but then that gets rid of the tweet thread as a main mode, and it makes sense to think of it as a summary because it is kind of. But don't, yeah, so keep all of the tweet thread. Functionality and UI, just put it within as a submode within summary. And maybe there are other modes we could turn into submodes so that there are fewer top-level modes. I think let's try everything I just described, or at least if you think it's a good idea, try it. If you can see a better idea, or you have concerns about complexity, or you just think it's going to be bad UI, then push back or suggest alternatives. Like, I'm not confident about this. The other thing is, I think the feedback I've given previously about the command bar is really relevant here, because if, as a new user, I come in and I say, Well, I just want to understand how this paper, the methods about X, or I want to understand how it relates to another paper, or whatever, then as in if they fill in the why you're reading this, then somehow that should inform things. So maybe then if we did have a natural language command bar, you could imagine feeding that in somehow to it, and then it would pop up with an immediate, Hey there, these are the actions I'm going to take on your behalf. It sounds like what you're going to need is for me to do a few quick searches for those topics, and you might find the review mode, blah, blah, blah, and I've already kicked off the debate with a particular kind of search that you might enjoy. Well, you won't say might enjoy, but I've kicked off the debate with a particular lens, and so maybe debate then has a search box. An input text box. I know that might be overcomplicating it, but it would be cool if the debate could be steered, maybe in multiple directions, a bit like the way we can steer the search. Actually, that would be cool. Well, look, this is probably too many things in one big feedback report. So at least make progress on some of them, and we can discuss the others. You know, as always, let's try and get to something that doesn't add too much complexity first.
>
> — Greg, 2026-10-03

## What we did

Plan, reviews and evidence:
[261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md).

- **Built.** Tweets is no longer a button in the bar. Summary's slider is now a three-way control,
  **Brief | Fuller | Thread**, and Thread is the tweet thread as it was: the wide column, the copy
  buttons, the links to passages, writing itself when opened. Old `?mode=tweets` and
  `/read/<slug>/tweets` links open it. What is built is in [summaries.md](../project/summaries.md)
  and [tweets.md](../project/tweets.md).
- **Not built, and pushed back on: Glossary, Ideas and Quotes inside Marginalia.** Marginalia is a
  column to the right of the text, not a band, and is hidden on a narrow window. The plan proposes
  two smaller things instead, for Greg to decide: one bar button that opens a menu of the list
  modes, and a filter on the kinds of note in Marginalia. Queued as a question for him.
- **Queued as a question:** whether to stop writing the Simple level, which is still written and
  stored but no longer shown.
