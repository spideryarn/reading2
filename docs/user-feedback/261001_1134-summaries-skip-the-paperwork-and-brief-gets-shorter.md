---
reports: spya-k930hy, spya-w3z96b
ending: shipped
---
# Summaries skip the paperwork, end on the takeaway, and Brief gets shorter

Two suggestions from Greg (admin; `scripts/feedback-reporter.ts` exited 0 on both), both sent from
`jco-2005-01-libre-spya-hk9cc7`. Overseer queue entry `qi-nyxxcrcp`.

[SPIDERYARN-READING2-8M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8M), report
`spya-k930hy`, from the tweet thread:

> The structure, summary, tweet thread, and other such modes don't really need to include summaries
> of stuff like acknowledgements or conflicts of interest or affiliations or, you know, stuff like
> that that isn't really the content of the paper. The prompt should kind of say, yeah, we don't
> really need to emphasize that or include those in the summaries or tweet threads. And I guess
> perhaps the prompt could slightly more emphasize, like, what is the news you can use? What is the
> takeaway, you know, the conclusion from the paper?
>
> — Greg, 2026-10-01

[SPIDERYARN-READING2-8F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8F), report
`spya-w3z96b`, from Summary › Brief:

> In Summary mode, tweak the prompt for the Brief sub-mode to produce slightly shorter output.
>
> — Greg, 2026-10-01

**Ending: Shipped** to `dev`. The plan, the measurement and both GPT Sol reviews are
[261001p](../plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md).

What changed, in plain words:

- **One shared paperwork rule** (`src/paperwork.ts`) in Summary, Tweets and Structure. Author lists,
  affiliations, acknowledgements, funding and disclosures are left out when they only record how the
  piece was produced. They are kept when the piece uses them as part of its argument. Structure
  still has a node for them, because every block needs one, but its line now just says what it is.
- **Summary and Tweets end on the piece's own conclusion**, and are told never to add advice the
  piece does not give. In blind reads, the new versions gave the clearer conclusion 24 times to 0
  across 39 pairs. The control, old against old, split 7 to 5.
- **Brief is shorter**: two paragraphs instead of three, and a mean of 124 words against 139.
- **Tweets no longer list the authors.**
- **New articles get it on their own.** An existing article's summary and thread now read as
  written by an older prompt. Metadata offers to rewrite them, so this article can get the new
  versions from there.

Not done, and named in the plan: the other whole-piece modes (Sketch, FAQ, Quiz and the rest) don't
carry the rule yet.

Found on the way, and not caused by this change: a structure answer occasionally contains
JavaScript where the JSON should be, which fails the reader's ingest until they press Retry. The old
prompt does it too, 1 in 28 answers in this measurement. It is written up in the plan's Ledger for
Greg to decide on.
