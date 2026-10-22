---
reports: spya-e5t77w
ending: shipped
comment: Shipped the simplest step: a long piece's glossary follows its length and takes in names met once, like Torricelli. The rest of "explain this" is written up and queued: select-to-look-up, quieter underlines, two stages.
---
# Torricelli: the glossary missed a name, and "explain this" as one continuum

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-21 23:11 UTC, a suggestion filed from
`/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`, paragraph `spya-zbpzqk`.
Feedback row #674; Sentry event `59848cd54c9b4fd8a32bfff66155ba96`. Session
`fbe5t77w-explain-names-glossary`. No addenda when re-read before building, or before this note.

> In this paragraph, which you can check from the database, it makes reference to Torricelli. I
> don't know who that is. I was hoping that the sources mode would notice it. […] the whole point is
> to make it just a click away. […] there's almost a continuum from the glossary to ideas to
> citations. […] Let's just focus on the glossary and the citations and the things that are referred
> to that aren't cited. […] In the case of something like Torricelli, whoever that is, maybe that
> requires a web search. […] I'd quite like to give a bit of discretion to the LLM that, you know, if
> it doesn't know the answer, if it's not sure, or if it needs disambiguation or whatever, that it
> has the option to run web searches for stuff. […] maybe by default, we just highlight a crapload of
> things that might deserve further explanation. And then maybe you click on them to find out more.
> I think the downside is then there's a delay, which sucks. […] we only generate them for the first
> portion of the article. And then if the reader gets sort of towards the end of that portion, then
> we generate the rest […] I've increasingly been thinking that it'd be useful to have an
> explanations underlined, where we just be like, This sentence or this idea or this phrase is
> complicated. Help me understand it or unpack it or whatever. […] often when I click on a citation,
> what I'm really asking is, you know, what does it say? Help me understand why it's referenced.
>
> I suppose I should wrap this up. Well, the simplest extension would be to say the glossary should
> include stuff like Torricelli that's kind of some kind of reference that might be of interest to
> the reader, whether it's a person or a name or a thing or a technical term. I've got a hunch that
> maybe it would have been found by the glossary, but the glossary only finds so many […] Can you
> write this up, or at the very least signpost to it from a doc? […] use your judgment if there's
> anything where you think there's, like, really good evidence that it'd be fairly easy to
> implement, and you're pretty confident it'd be good for the user and would be a good experience.

The whole report is in production's row, and `feedback-unswept.ts --show spya-e5t77w` prints it.

**Ending: Shipped**, on `dev`, for the simplest step. Plan
[261022f](../plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md).

**Why he was missed.** His hunch was right, and there were two causes. The glossary asked for at
most 20 terms whatever the length, so his 38,000-word book got 21. And the prompt left out on
purpose a name the argument does not rest on, which is what a name dropped once is.

**What changed** (`glossary/10`). The count follows the length, up to 80. A long piece is worked
through part by part. A name met once earns an entry. Measured on his book, read from production and
never written back: a first run gives about 70 entries, Torricelli among them, in about 40 seconds
for $0.25. One *Find more* on his existing list takes it from 20 to 87. Section in
[glossary.md § A long piece, and a name met once](../project/glossary.md#a-long-piece-and-a-name-met-once).

**The write-up.** The direction is
[explain-this-vision.md](../project/explain-this-vision.md) (not decided), signposted from
[reading-view-overview.md](../project/reading-view-overview.md),
[vision.md](../project/vision.md) and [interface-vision.md](../project/interface-vision.md). The
evidence is [261022b](../research/261022b-explain-this-evidence.md), a web and literature search
plus two Opus subagents prompted from opposite sides.

**Queued, not built:**

- `qi-y96xdmy8`: select a short phrase, and *Look up* is offered beside *Ask AI*.
- `qi-ahk295cc`: a fainter underline for a name the argument does not rest on.
- `qi-cazzyq8j`, needs Greg: the two-stage idea, with candidates underlined and entries written
  ahead of the reader.

Web search in the batch was not built: the model knew Torricelli, and a reader's own *Look up*
already searches. A model-placed "this sentence is hard" underline was not built either, because the
evidence is against the model choosing where a reader is confused. The reader-initiated version
already exists: select, then *Ask AI*.
