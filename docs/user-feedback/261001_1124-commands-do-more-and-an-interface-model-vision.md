---
reports: spya-rkn8mn
ending: shipped
---

# Commands do more, and a vision for an interface model

SPIDERYARN-READING2-8D, a suggestion from Greg (an admin; `feedback-reporter.ts` exited 0 on the
production row), sent from Tweets on `jco-2005-01-libre-spya-hk9cc7`; Overseer queue qi-gwp9epnd:

> Add a lot more Metadata functionality to Commands, e.g. to reprocess (a particular mode) with more
> powerful AI.
>
> And in general, look for ways to make Commands more powerful and universal and an easy-to-use way
> to do most things.
>
> My dream would actually to include a way to type/speak questions/commands, e.g.
> - "add a tag of X to this paper" would trigger the appropriate tool
> - "do they talk about X?" would add a search
>
> Perhaps an LLM would run the appropriate tools (ideally Jev via OpenRouter as a first-pass for
> speed, falling back to a more powerful LLM if Jev is unsure about what's the right thing to do).
>
> Ideally we would provide this interface-LLM (for clarity, I'm distinguishing it from the
> content-LLM that focuses on the article - though obviously in practice we might be using the same
> models, just prompted differently) with a bunch of information about how Spideryarn works, and/or
> give it tools that search its own Help page and/or the docs in the repo and/or code (which is open
> source on GitHub).
>
> I suppose in the long-term, we might allow the main Chat to do all this stuff too... actually, that
> would be neat. Yes, that should definitely be the aspiration. Create a
> chat-llm-help-commands-vision.md (or similar), and delegate to one or more agents to make as much
> progress on all this as you can.
>
> If anything is complex or needs my input, defer it (and we'll discuss), otherwise use your
> judgment about how to make this work nicely.

**Shipped**, with two questions left for Greg. Everything is in
[261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md).

- **The bar re-runs any mode.** Type *rerun glossary*, *redo quotes* or *simple summary again*, and Enter
  starts the run and takes you to Metadata › AI processing, where it shows. It does not open the
  mode, because opening an empty mode could start a second paid run.
- **Metadata from the bar:** *High-powered AI*, *AI processing* and *Share this article* open that
  section of the Metadata page. *Archive this article* (or *Put this article back*) and *Export this article*
  do the thing.
- **Commands that take words:** *find X*, or *do they talk about X?*, opens Search on those words.
  It is the deterministic first step toward your example.
- **The vision:** [chat-llm-help-commands-vision.md](../project/chat-llm-help-commands-vision.md).
- **Jev measured:** it picks the right command 94% of the time in 0.3 s, against Sonnet's 97% in
  2 s, and every mistake it made came with low confidence. So *"Jev first, fall back when unsure"*
  looks workable. [261002c-jev-picks-a-command.md](../investigations/261002c-jev-picks-a-command.md).

**Waiting on you**, also listed in [awaiting-approval.md](awaiting-approval.md):

1. **More powerful AI for one run.** Your example is two commands today: switch on *High-powered
   AI*, then *Glossary › Run again*. Running one mode on Opus without switching the whole article
   would be a new kind of charge. Is it wanted, and what should one run cost a reader?
2. **Letting a model act.** The vision proposes that a model may navigate on its own, may only
   *propose* anything that writes or spends (you press Enter), and may never delete or publish. Is
   that the line?

## Greg's answers to the follow-ups (2026-10-02)

Recorded in [chat-llm-help-commands-vision.md § Decided](../project/chat-llm-help-commands-vision.md):
the line is accepted to start with, the one-run Opus option is held off, dictation in the bar is
wanted (queued with `fbwh2xys`), and tags are wanted (`fbqmev0s`). Off awaiting-approval.md.
