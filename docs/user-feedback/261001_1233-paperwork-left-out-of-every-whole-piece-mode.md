---
reports: spya-k930hy
ending: shipped
parts: 2
---
# The paperwork is left out of every mode that writes from the whole piece

The second part of report `spya-k930hy`
([SPIDERYARN-READING2-8M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8M)), a
suggestion from Greg (admin; `scripts/feedback-reporter.ts` exited 0), 2026-10-01, from the tweet
thread of `jco-2005-01-libre-spya-hk9cc7`. Overseer queue entry `qi-qczrxnye`.

> The structure, summary, tweet thread, and other such modes don't really need to include summaries
> of stuff like acknowledgements or conflicts of interest or affiliations or, you know, stuff like
> that that isn't really the content of the paper. The prompt should kind of say, yeah, we don't
> really need to emphasize that or include those in the summaries or tweet threads. And I guess
> perhaps the prompt could slightly more emphasize, like, what is the news you can use? What is the
> takeaway, you know, the conclusion from the paper?
>
> — Greg, 2026-10-01

The first part — Summary, Tweets and Structure, and the takeaway — shipped earlier:
[261001_1134](261001_1134-summaries-skip-the-paperwork-and-brief-gets-shorter.md).

**Ending: Shipped** to `dev`, for the *"other such modes"*. The plan, both GPT Sol reviews and the
measurement are [261003d](../plans/261003d-paperwork-in-every-whole-piece-mode.md).

What changed, in plain words:

- **Sketch, Illustrated, FAQ, Quiz, Ideas, Quotes, Glossary, Timeline, Arc** (the one sentence per
  part in Structure › Expanded) and **Debate's claim search** now carry the same paperwork rule.
  They choose no question, quote, idea, term or date from the authors' list, affiliations,
  acknowledgements, funding or disclosures. They keep them when the piece's argument is about them.
- **Every new mode gets it by default.** A test fails if a prompt that is shown the whole article
  neither carries the rule nor says why not. The ones that don't carry it, on purpose, are
  Citations, the referee prompts, and the modes that answer the reader, who may ask who funded it.
- **What it fixed, measured on four papers:** the old prompts mostly left the paperwork out of these
  modes already. Arc was the exception. It opened with *"Only the authors and their disclosures
  stand before the argument"* and closed on the references. The new prompt cuts that from most
  runs to a few, but not to none. Timeline no longer spends events on an essay's own editor's
  notes. Blind reads found no loss of content.
- **Existing articles** will show these modes as written by an older prompt, with *Write it again*.
  Arc rewrites itself the next time its owner opens the article, at about one call each.

Not done, and queued as a proposal (`qi-2byhh6nc`): removing the paperwork before any model reads
it. That would be the complete fix, but it changes what every stage counts as the article, so it
needs its own plan and your yes.
