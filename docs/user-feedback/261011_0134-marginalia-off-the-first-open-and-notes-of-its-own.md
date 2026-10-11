---
reports: spya-mw08mv, spya-qyuet0
ending: shipped
---
# Marginalia: no longer on a first open, and a few notes of its own

Two suggestions from Greg, both proved his with `feedback-reporter.ts` (exit 0), so trusted and
built. Overseer queue item `qi-zqajzkf3`. This session did not write the Sentry status; the next
sweep does it from this note.

> I had previously suggested that by default when we open an article for the first time, we would
> open Marginalia mode. Actually I think the UI complexity is overwhelming for new users so let's
> not open Marginalia mode by default.
>
> — Greg, 2026-10-11 01:34 UTC (`spya-mw08mv`, SPIDERYARN-READING2-H3, from /changelog)

> The marginalia mode is a nice idea, but it's still not yet useful. […] I think we could give the
> LLM just a bit more freedom to play and experiment, so perhaps it can produce other scribble notes
> as it sees fit. Perhaps it can explain things that would otherwise be confusing, or provide other
> notes sparingly that might be helpful to the reader. We don't want to overdo it, though. […] maybe
> the marginalia mode could highlight really important cross-references, especially if there's an
> inconsistency or if the reader might benefit from being reminded what that other section said.
>
> — Greg, 2026-10-11 01:53 UTC (`spya-qyuet0`, SPIDERYARN-READING2-HG, from /)

**Ending: Shipped**, both. On `dev`, not deployed. Plan, reviews and measurements:
[261011o](../plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md).

## What we did

- **A first open is the guide alone** (`spya-mw08mv`). An article opened for the first time opens
  in Chat's guide where a band fits, and the article alone where it does not, at any width; the
  Marginalia column no longer comes too. This reverses half of
  [261004_2032](261004_2032-a-first-opened-article-starts-in-summary-and-marginalia.md). A link or a
  remembered view with the column on still shows it.
- **Marginalia writes a few notes of its own** (`spya-qyuet0`). Yes, it runs a model: one call per
  article, which wrote the *so / but / vs* words. That same call may now also write a handful of
  short notes, each beside the passage it is about:
  - **Tension**: this passage and another seem not to agree. Your inconsistency case.
  - **Recall**: what a passage far from here said, which this one leans on.
  - **Note**: something easy to stumble on, explained in a sentence, or, rarely, any other short
    note the model thinks would help.

  A Tension or Recall links to the other passage, with its preview card and the jump. Each note
  quotes the words it is about, at both ends, and we check those words are really there, so a note
  cannot point at the wrong passage. Notes are shown open (they are few), in the AI's typeface,
  with a card saying AI wrote them and might be wrong.
- **Cross-references already existed**, as links in the prose
  ([cross-references.md](../project/cross-references.md)): many of them, unranked, with no
  sentence. The margin's Tension and Recall notes are the few that matter, with a sentence saying
  why.

## What Greg should know

- **It found a real inconsistency in the Transformer paper every time**: §6.1 gives 41.0 BLEU for
  English-to-French, while the abstract and Table 2 give 41.8.
- **It is sparing**: about one note per eighteen paragraphs on four test articles, mostly
  explanations. Two of five distinct Tensions were weak (a pedantic "over 2 is barely 2.04", and
  an essay's development of its argument read as a contradiction). The card tells the reader to
  judge.
- **The cost** goes from about 4.9 to 5.7 cents an article per run. Every article that already has
  relation words gets them rewritten, with notes, the next time its owner shows the column.
- **The relation words moved a little**: 83–87% agree with the old prompt's, where two runs of the
  old prompt agree on 91%, and a few more turns are drawn.
- **Owner only**, like the relation words. A visitor to a shared article does not see the notes.
- Metadata's re-run row is now *Marginalia notes* (was *Relation words*).
- **Found along the way**: Nagel's *What is it like to be a bat?* came out of extraction with a
  paragraph spliced into the middle of a sentence, and the model noticed it in every run. Queued
  for a look of its own (below).

## Choices made for the simplest version

In the plan's § Questions, each easy to change: the effort stays `low` (`medium` measured no
better); four kinds of note; about one note per eight paragraphs at most.

## Not done here

- The extraction bug in Nagel's article: queued as `qi-dc9bvfqj`, a proposal for Greg to authorise. Not part of either report.
