---
reports: spya-jghnva
ending: shipped
---
# Skim: the question above a quote should set the quote up

`spya-jghnva`, a suggestion from Greg (admin row, Sentry confirmed, event
`eb4b9f4e4a874884ae60063a1e02d24f`), filed 2026-10-06 05:45 UTC from Skim on
`2608-13566v1-spya-yurten`. This session has no Sentry sign-in and did not write the Sentry status;
the next feedback sweep does.

> In Skim mode, when generating a question, use it as a way to contextualise the quote.
>
> For example, this question doesn't do that very well:
>
> "Which interpretation does their evidence favour, and how close to the training data does the test sit?"
>
> The quote then is something like "our results favour the latter interpretation..."
>
> The question we generate with Skim mode is an opportunity to situate the quote, eg it could tell us what's being asked of the evidence and/or what are the two interpretations?

**Ending: Shipped, in part.** It is on `dev` and not deployed.

What we did, in
[261006e](../plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md),
measured in [261006b](../investigations/261006b-skim-cue-situates-the-quote-eval.md):

- **The prompt is `skim/10`.** When a quote leans on words it does not explain ("the latter"), its
  cue names the question or the options first, as a question, and then points. On this report's own
  quote it now writes *"Which of the two possibilities does the evidence favor: real transfer or
  benchmark-specific gains?"* A cue may be 200 characters (it was 140).
- **A route already planned keeps its old cues** until it is planned again from Metadata's *AI
  processing*. That is the house rule for an older prompt.
- **What is not shown.** Blind, the new cue was preferred to the old one in 50 pairs of 88 against
  19. But on the 13 quotes that truly lean on something unsaid it was 7 to 5, which is no different
  from the old prompt against itself. GPT Sol's review said the plan's own bar was not met; an Opus
  arbiter agreed and still said land, because nothing got worse.
- **The deferred half, waiting on Greg.** A first wording set a scene on every cue. It situates far
  better (11 to 2 on those 13) but gave the finding away about twice as often and got the context
  wrong in one cue in ten. Whether to move towards it is the question `[Q-skim-cue-scene]` in the
  session's debrief. This session could not write the Overseer's queue (`--by` takes only `greg` or
  `overseer`), so it asked the Overseer to add the entry, with this report id as its source.

**[Q-skim-cue-scene] decided: stay with what shipped (skim/10).** Greg, 2026-10-06:

> use your judgment. don't change things too much - the Skim questions were mostly good

So neither the every-cue scene (B) nor a further round (C) is built. Queue entry qi-pjrr5g86 is
dropped.
