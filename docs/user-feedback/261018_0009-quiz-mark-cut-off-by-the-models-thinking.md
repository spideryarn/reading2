---
reports: spya-ag4hsu
ending: shipped
---

# A quiz mark cut off because the model's thinking used up its room

Report `spya-ag4hsu` (#602, `SPIDERYARN-READING2-JS`), from Greg (an admin), filed 2026-10-18,
build `614e42c5`, on `rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`, Learn › Quiz.
A problem.

> "The reply about your answer ran past the room it had and stopped part-way, so it is not a whole
> mark. Trying again usually gets one that fits. [ai-mark-cut-off]"
>
> Why are we hitting size limits? This seems like a bug. This was just a simple conversation, and it
> was a quiz question, and I answered, and I wanted to hear what the AI had to say. So let's, I mean,
> why are we truncating so aggressively, or what's going on here? If there's a straightforward
> improvement, make it. If this is nuance, I suppose we need to discuss it. But I'm hoping you can
> just use your judgment to avoid this in future.

**Ending: Shipped**, on `dev`. A bug, and a straightforward fix. The mark's limit, 1,200 tokens, was
set when the model wrote marks without thinking first. Since 2026-10-09 the model is Sonnet 5.5,
which thinks first, and the thinking counts against the same limit. On this book one mark spent 832
tokens thinking and had 368 left for its reply. The limit is now 4,000, and the thinking is left on.
Plan [261018b](../plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md) stage 1;
postmortem [261018a](../postmortems/261018a-a-ceiling-sized-for-one-model-inherited-by-the-next.md).
Other calls whose limits were set before the model change may have the same problem. Checking them
is queued as `qi-vva8v98m`.
