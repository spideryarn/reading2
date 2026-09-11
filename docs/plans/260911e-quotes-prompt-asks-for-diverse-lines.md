# Quotes: the prompt asks for lines that say different things (`quotes/5`)

Report [SPIDERYARN-READING2-2X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2X), the
note is [260911_1309](../user-feedback/260911_1309-quotes-prompt-emphasises-diversity.md). It follows
straight on from 2W —
[260911a](260911a-quotes-find-more-and-a-fade-that-carries-priority.md), which made the prompt
importance-first, raised the count to one per ~200 words, and added Find more.

> Perhaps make a minimal tweak to the Quotes prompt to slightly emphasise diversity (i.e. to avoid
> ending up with loads of quotes that say basically the same thing)
>
> — Greg, 2026-09-11

## Where the repeats come from

Both places the brief suspected, and 260911a made both likelier:

- **The first pass.** "Importance first" plus a bigger count pushes the model towards the sentences
  the argument rests on, and a piece states its thesis more than once. Nothing in the prompt said a
  second statement of the same point was worth less than a new point.
- **Find more's tail.** The taken list ruled out *the same sentence* and *a longer or shorter cut of
  it*, but not *the same point in other words*. The one local list with a Find-more tail
  (`fowler-phrenology`, 15 → 48) shows it: three lines on people failing in a business they are
  unfit for, three on happiness coming from the faculties used together.

Nothing mechanical catches either. `dedupeOverlaps` compares spans, and two sentences making one
point share no span.

## What changed

A short paragraph and one clause, in the two places (src/quotes.ts):

- `SYSTEM`'s *SPREAD THEM OUT* section becomes *SPREAD THEM OUT, AND DO NOT REPEAT A POINT*, with a
  short paragraph: each quote should say something the others do not; keep the best statement of a
  point made several times.
- Find more's *ALREADY ON THE LIST* adds "and not a point one of them already makes, in other words".

`PROMPT_VERSION` goes to `quotes/5`. New runs only; every existing list shows its *outdated*
sentence, as every one already did after `quotes/4`.

## Passed over

- **A mechanical check** — embeddings or a second model call to drop near-duplicates. Real
  machinery for something Greg asked to be a minimal prompt tweak, and it would need a threshold
  nobody has measured. If the prompt is not enough, this is the next step.
- **Only one of the two places.** Each alone leaves the other source of repeats open, and together
  they remain one small prompt-only change.

## Not measured

Whether the lists actually repeat less is unmeasured, as `quotes/4`'s shift towards importance
was. No live pass was run: one article's before-and-after is a single sample of a noisy judgment.
The next Find more on a real list is the check.
