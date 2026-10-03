---
reports: spya-t0dg9u
ending: shipped
---

# The command bar takes a sentence

A suggestion from Greg (an admin; `feedback-reporter.ts` exited 0 on the production row), sent from
Remember on `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`; Sentry
SPIDERYARN-READING2-AW; Overseer queue qi-3wb7cgda, session `fb-command-bar-nl`.

> Already provided feedback that I would like the command bar eventually to be much richer. And
> indeed, it struck me that we could get rid of the quick search icon and just have that be
> something you could do from the command bar. So you could say, search for blah blah blah. I
> realize that's going to get complicated, but that's, I think, where we want to go. What I was
> going to suggest was that maybe if we used Jev, the type-safe, very quick classification model,
> which we've already got the API key for, maybe we could allow the user to provide natural language
> input. So I want to see what's changed on this site since yesterday, and it would know to pick the
> changelog, for example, or search for blah blah blah. Well, in that case, it would know that this
> is a search, and it should hand off. Maybe it has an option for this requires an LLM to interpret.
> It's not one of the options, or it's an option but it needs parameters or something. And then in
> that case, the command bar should have a little dictation voice icon next to it so that I can
> talk. And so let's start with an eval to see if Jev can do a good job of it. And if not, then
> fine, let's use something like DeepSeek or Luna. It's got to be something with quite a low
> latency. And yeah, run an eval and then try and At least get to a V1. In the past, we talked about
> the idea that there could be parameters, so search for X, and that it would be in the UI. I guess
> this idea of voice and natural language, I can't tell if we would also still want the parameters,
> or if the natural language kind of subsumes that idea because it's just more powerful. I guess, as
> always, do some research, do some evals, and maybe let's go with whatever you think is going to
> get us most of the value without too much complexity.

**Shipped**, on `dev`. The plan is
[261003k](../plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md); the
eval is
[261003e](../investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md).

- **The eval first**: Jev picks the right row 94% of the time in about 0.3 s but cannot pull the
  words out of a sentence, so GPT Luna does that, and only when the command needs words.
- **The v1**: type or say a sentence; when nothing matches, Enter asks. A pick Jev is very sure of,
  that only takes you somewhere, runs at once. Anything else is drawn under *Did you mean* and
  waits for Enter.
- **The microphone** was already in the bar's box (261003f, the same day).
- **Parameters stay.** The typed verbs (`find X`, `tag X`) are instant and free, and they are what
  a sentence lands on; the sentence is for when you did not know the verb.

**Not built, and queued** (qi-7mpz6n48 in the Overseer's queue, each needing Greg): taking the
quick-search icon away in favour of the bar; answering questions about the app from the Help; two
commands from one sentence.
