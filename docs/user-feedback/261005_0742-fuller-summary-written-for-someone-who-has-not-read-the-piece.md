---
reports: spya-rntjxu
ending: shipped
---
# Fuller is hard to follow: write it for someone who has not read the piece

`spya-rntjxu`, from Greg (admin; `feedback-reporter.ts` exit 0, by the sweep), filed 2026-10-05
07:42 UTC from Summary's Fuller view of `2605-20355v1-spya-ygtwkz`. SPIDERYARN-READING2-DE;
Overseer queue item `qi-b5g9a55h`. This session has no Sentry sign-in and did not write the Sentry
status; the next feedback sweep does.

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> Use Sonnet for web research on what makes for a really good summary, and tweak the prompts
> accordingly.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did. What is built is in
[summaries.md](../project/summaries.md#written-for-someone-who-has-not-read-it-since-2026-10-05);
the plan and GPT Sol's reviews are
[261005h](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md).

- **The research**, by a Sonnet subagent:
  [261005c](../research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md).
  Every guide it found asks for a summary that stands on its own, with each term said in everyday
  words where it first appears. It found no evidence that telling a writer "the reader has not read
  this" is enough by itself, so the prompt change is a list of things to check.
- **The prompt.** Fuller gains two rules. A name the piece introduces (a coined term, an
  abbreviation, its label for a method or an experiment) is said in everyday words the first time
  it is used. And nothing is referred to before the summary has introduced it. Also, the reader's
  profile no longer covers a term merely because it claims the piece's field. Brief is unchanged.
- **A larger version was built first and not shipped**: a whole section of eight rules and a
  closing check. Measured side by side on five papers
  ([261005b](../investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md)), the two
  tied, 5 pairs to 5, and the plan had said beforehand that a tie goes to the smaller change.
- **What the measurement shows for what shipped**, for a reader with a profile: against the old
  Fuller a blind judge found it easier to follow in 6 pairs of 10 and harder in 1, and preferred
  it in 6 of 10. Every main finding it left out, an old summary of the same piece left out too.
  That is a modest result, not a large one.
- **Mixed for a reader with no profile; no improvement claimed.** It has its own queue entry,
  `qi-4meqvjr4`.
- **Not checked against the article the report came from.** It is only in production, which this
  session cannot read.

Summaries already written keep their text until somebody presses *Write it again*.

**It waited five hours on a spending limit.** The box's OpenRouter key had spent its monthly
limit, so nothing could be measured from 12:25 to about 17:30 BST, when Greg raised it. Until
then this note said *awaiting*.
