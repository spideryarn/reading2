# The "?" should just say "help me understand"

**[SPIDERYARN-READING2-3W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3W)** · reported
2026-09-12 11:19 UTC · kind: none given · from an admin (Greg) · *shipped*

## What the reader said

> Re "I don't get this, or maybe what's around it. What am I missing — here, or somewhere
> earlier?". Make this prompt more general and minimal. Eg help me understand

On the reading view (`temporal-context-reinstatement-spya-dhqkf9`), build `d358f773`.

## What we did

**Shipped on `dev`:** pressing the "?" beside a paragraph now asks *"Help me understand."* That is
what appears in your conversation as your question.

The long sentence was long because it was also telling the model where to look: nearby, or somewhere
earlier. You asked for both of those, on 09-04 and 09-05. They haven't been dropped. They're now
a line in the instruction the model gets whenever the "?" is pressed, which you never see. Older
conversations keep the sentence they were started with.

GPT Sol reviewed the plan and the code. Plan:
[260915d-help-question-says-help-me-understand.md](../plans/260915d-help-question-says-help-me-understand.md).

**Not done:** the web-reach eval (`evals/chat-web-reach.ts`) sends this sentence in its "?" case and
was not re-run, because it costs money. Its next run can't be compared like for like with the
09-13 results.
