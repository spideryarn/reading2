---
reports: spya-ddpn5x
ending: awaiting
---
# Use my ChatGPT subscription to pay, for a cheaper price

SPIDERYARN-READING2-5J (`spya-ddpn5x`), from Greg (admin), filed from the Feedback dialog. The time
in the file name is when this session picked the report up; the report text came in the brief,
because this session had no Sentry access.

> It would be amazing to be able to use my OpenAI subscription, if I've already got whatever it is,
> ChatGPT Pro, and then it would use that and I'd get a discounted price. Let's not implement it
> yet. Just do some research and put together a plan. Let's consider how complex it is, and then
> we'll go from there. But don't actually start implementing.

What we did: researched it and wrote a plan, as asked. Nothing is built.

- OpenAI's "Sign in with ChatGPT" can now let a reader's ChatGPT plan pay for an app's calls, but
  only for open-source and locally hosted apps so far. A paid hosted app like ours has to apply
  through an interest form. Even then it would cover OpenAI models only, and our main pipeline runs
  on Claude.
- Claude and Gemini subscriptions cannot be used by third-party apps. Both vendors forbid it.
- What we could build today is "connect your OpenRouter account", where the reader pays for their
  own calls. That is medium-large work (about 7–10 days of agent work), but it gives no discount on the models. The only
  saving would be a cheaper Spideryarn plan.
- Recommendation: Greg sends OpenAI's interest form, and we build nothing until readers ask for a
  cheaper plan or OpenAI lets us in.

Research: [260929a](../research/260929a-paying-for-model-calls-with-the-reader-s-own-ai-subscription.md).
Plan: [260929g](../plans/260929g-bring-your-own-ai-subscription.md).

**Second round, same day.** Greg answered the plan's questions, relayed by the Overseer. He wants
ChatGPT-plan readers to pay a quarter of the price and to drop back to Free if they disconnect. He
wants the nearest OpenAI model in place of Sonnet, live voice paid for, and error messages a reader
can act on. And he asked whether this can be built without it getting really complicated. The plan
is rewritten around the ChatGPT route:

- The swap for Sonnet is GPT-6.1 Sol: medium effort for the pipeline, low for chat.
- A quarter of the price covers what stays on us only if live voice is left off those plans. One
  full live conversation costs more than a £2 month brings in, and no allowance can be enforced
  today.
- Every error gets its own message.
- The answer to his question is **no**: about 6–9 weeks, mostly because every Claude call would need
  an OpenAI twin, billing would have to learn who pays for the models, and much of it cannot be tested until OpenAI lets us in.

The first step that costs nothing is Greg applying through OpenAI's form. The first that tells us
the most is an eval of Sol on our stages (~$10–20).

**Ending: Awaiting Greg** — parked, plan written.
