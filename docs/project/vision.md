# Vision

## Intent

The brief, in Greg's words (2026-08-24):

> I'm interested in trying a new way of reading that's AI assisted, but still — well, **it augments
> human cognition, but it doesn't replace it.** So the idea would be that instead of trying to make
> things too easy, trying to replace the words with quick and easy summaries so much, but rather we
> **help the user get what they need from it, help them read efficiently, but deeply, help them
> internalize and interrogate.**

Everything else in these docs is downstream of that sentence. When a design decision is genuinely
close, the tiebreak is: which option leaves more of the thinking with the reader?

## The problem with AI reading tools

The default move is compression: paste an article, get bullet points, done. That's genuinely useful
for triage and genuinely corrosive for understanding. It replaces the reading rather than supporting
it — "trying to make things too easy". The reader ends up with a fluent impression of the piece and
none of its texture: no arguments they could reconstruct, no sentences they could quote, no sense of
where the author was strong and where they were hand-waving.

## What we want instead

Tools that make deep reading *cheaper*, not optional.

- **Scan before you commit.** — *"you could sort of scan through things quickly if you just want to
  kind of get a vague sense of the landscape"*
- **Descend on demand.** — *"or you could burrow deeply."* From any point in that overview, go
  straight down into the actual prose.
- **Stay oriented.** The reader should always know where they are in the argument, at whatever
  altitude they're flying.
- **Interrogate.** Ask questions of the text at the point of confusion, in place.
- **Internalise.** Come away with something retained, not just something skimmed.

The first feature built on this is [granularity zoom](granularity-zoom.md).

## Principles

1. **The text is the destination, not the source material.** Summaries exist to route the reader
   into the prose. Every generated line should be a door, not a wall. (Concretely: leaves are
   verbatim and carry no gist — [granularity-zoom.md § Node shape](granularity-zoom.md#node-shape).)
2. **Speak the author's language.** Summaries reuse the author's own terms and framing where possible,
   so that when the reader arrives at the passage, they recognise it. Avoid the flattening "the author
   argues that…" voice. Enforced in the prompt rules at
   [granularity-zoom.md § Generation](granularity-zoom.md#generation).
3. **Effort in the right places.** We are not trying to minimise reading time. We're trying to minimise
   time spent on the parts the reader didn't need, so there's more left for the parts they did.
4. **Legible provenance.** Anything the model asserts is anchored to a block id, and the reader can
   always reach the passage it came from in one action. See
   [AGENTS.md § The one contract that matters](../../AGENTS.md#the-one-contract-that-matters).
5. **No hidden reformulation.** We never silently rewrite the author's prose in the reading view.
   Generated text lives at generated altitudes; the rightmost level is verbatim, always.

## Anti-goals

- A chatbot with the article stuffed in the context window.
- "Read this in 2 minutes."
- Engagement mechanics, streaks, or anything optimising for time-in-app.
- Auto-generated confident claims with no path back to the source.

How we'd know we're failing at this rather than succeeding is itself unresolved —
[Q6](open-questions.md#q6).

## Where this goes after granularity zoom

> And then we'll add a bunch of other readability — not readability, like **reading assistant
> functionality** as well.

The same block-id spine ([architecture.md § Pipeline](architecture.md#pipeline)) supports a family of
these, each to be judged against the principles above:

- **Ask in place** — a question about the paragraph under the cursor, answered from the surrounding
  context, cited back to block ids.
- **Author's glossary** — the terms this piece uses in a non-obvious way, defined from the piece itself.
- **Argument view** — claims, the support offered for each, and the moves the author doesn't make.
- **Confusion signal** — the reader marks a passage as unclear; the highest-value input we can get.
- **Notes and highlights** anchored to block ids, surviving re-extraction ([Q2](open-questions.md#q2)).
- **Recall** — a few durable questions generated from what the reader actually dwelt on.
