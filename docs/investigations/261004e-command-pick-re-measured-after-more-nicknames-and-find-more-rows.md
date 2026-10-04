# Command pick, re-measured after more nicknames and the Find more rows

Written 2026-10-04, finding F8 of
[plan 261004k](../plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md). It follows
[261003e](261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md), which chose
the models. The numbers are in `evals/command-pick/results/261004/summary.md` (`summarise.ts`), the
saved answers are beside it, and how to rerun it is in
[evals/command-pick/README.md](../../evals/command-pick/README.md).

## The question

When the command bar matches nothing, it sends the sentence to a fast model that picks one of the
bar's own rows. `src/command-pick.ts` says the wording and order of that list are a measured thing.
Plan 261004k changed the list: every mode got more nicknames, and two rows are new, *Glossary › Find
more* and *Quotes › Find more*. Did the picker get worse, and is the run-at-once cut of 0.95 still
right?

## What the model is shown

**Nicknames are part of it.** Each option's line is `name — description (also called: a, b, c)`
(`describeOption`), so every new nickname is read by the model. They also multiply: a *Run again*
row carries seven phrases per nickname of its mode, and a *Find more* row four. *Glossary › Run
again* went from 28 phrases to 70. The request grew from 4,892 tokens to 7,042.

## What was measured

- **Production's arrangement only**, as `src/command-pick-call.ts` runs it: Jev
  (`typesafe/jev-1.13`) picks, and when the pick takes words GPT Luna (`openai/gpt-5.6-luna`) copies
  them out. The arms that lost on 2026-10-03 were not rerun.
- **The list as it is today**: 68 rows for an owner on an article with Experimental on, plus the
  five argument commands and `none`.
- **228 requests**: the 192 from 2026-10-03, and 36 new ones labelled before any model saw them.
  The new ones: ten asking for more of the glossary or more quotes, eleven using a new nickname
  inside a sentence ("show me the table of contents", "what's the tldr"), five that should still
  mean *Run again*, one "add more detail to the summary", and nine with no right answer or a
  question for Chat.
- **The bar answers 10 of the 228 itself**, so 218 are what production would send.
- One run, from the Hetzner box, 2026-10-04:
  `npx tsx evals/command-pick/run.ts --arm jev-pick,hyb-luna --budget 1`.

## The numbers

On the same 192 sentences, both runs scored on today's labels:

| | 2026-10-03 | 2026-10-04 |
|---|---|---|
| whole outcome right, all 192 | 181 (94%) | 177 (92%) |
| whole outcome right, the 185 the bar cannot answer | 174 (94%) | 170 (92%) |
| no right answer, and none given (35) | 27 | 25 |
| Jev's call: median / p90 | 0.29 s / 0.35 s | 0.30 s / 0.41 s |
| Jev's call: cost | $0.00021 | $0.00030 |

On the 36 new sentences: 33 right (31 of the 33 the bar cannot answer).

- **Find more: 10 of 10**, at 0.73 to 0.99. The second choice was *Run again* each time for the
  glossary, never above 0.26.
- **Still Run again: 5 of 5**, at 0.97 to 1.00, with Find more never above 0.01.
- **New nicknames in a sentence: 11 of 11.**
- **The three misses** are all requests with no right answer: "add a definition of my own to the
  glossary" opened Glossary (0.54), and "find more quotes in all my articles" and "get more quotes
  out of all my articles" picked *Quotes › Find more* (0.91 and 0.72).

Over all 218 that would be sent, the whole outcome was right on 201 (92%), with a p90 of 1.19 s
for the two calls together. When Jev's first choice was wrong, a right row was in its top three 16
times of 17.

## What changed on the old sentences

Ten picks changed; 182 did not. Five went from right to wrong and one from wrong to right.

| sentence | 2026-10-03 | 2026-10-04 |
|---|---|---|
| what do other people think of this paper | Debate 0.99 | Debate's Reception sub-mode 0.70 |
| who has responded to this online | Debate 0.91 | Reception 0.52 |
| show me where they define entropy | Look up a term 0.29 | Search 0.20 |
| compare this with the paper I read yesterday | none 0.25 | Library 0.22 |
| send this to my kindle | none 0.53 | Export 0.40 |
| how much am I paying for this (wrong before) | Metadata 0.56 | Profile 0.69, right |

**Two of the five are not today's change.** Reception is a row added between the two runs, before
plan 261004k, and it is a fair answer to both sentences; the label accepts only the mode because
the sub-mode did not exist when it was written. Counting it as right gives 179 of 192.

**The other three were coin tosses both times**: no pick above 0.53 in either run, and the right
row is still in the top three. Search did gain nicknames today ("locate", "look for"), which may
be why it edged ahead for "show me where they define entropy"; one run cannot say.

On the 182 unchanged picks, confidence barely moved (median 0.000), but it drifted down more often
than up: 12 fell below 0.95 and 3 rose to it.

## Anything paid, picked when it was not asked for

Production runs a pick at once only when it is confident and the row merely moves the reader.
Anything that generates waits for a second Enter whatever the confidence.

- **No row that generates, writes or spends was wrongly picked at 0.95 or above.** Ten such picks
  in all. The highest that production would really send: *Timeline › Run again* for "regenerate the
  timeline for all my papers" (0.83, and it was the same pick on 2026-10-03), and *Quotes › Find
  more* for "get more quotes out of all my articles" (0.72).
- **The Find more rows inherit Jev's known weakness**: it reads "all my articles" as "this
  article". That is the same miss 261003e reported for Share and Run again, on a new row.

## Is 0.95 still right?

Yes. Of the picks that would run at once:

| cut | same 185, 2026-10-03 | wrong | same 185, 2026-10-04 | wrong | all 218 today | wrong |
|---|---|---|---|---|---|---|
| 0.8 | 42 | 4 | 45 | 4 | 47 | 4 |
| 0.9 | 37 | 1 | 38 | 1 | 39 | 1 |
| 0.95 | 35 | 0 | 35 | 0 | 36 | 0 |

The same shape as before, and the same count of automatic runs. The margin is thin: "run everything
again on every article I have" now goes to AI processing at 0.92, up from 0.81. It opens a section
and changes nothing. This is still a handful of errors on sentences written to be traps, so 0.95
stays a starting point, not a proof.

## What should change in production

**Nothing has to.** The wider wording cost two points on the old sentences at most, and most of
that is a new sub-mode being a reasonable answer. Three things to decide rather than fix:

1. **The request is 44% bigger and costs 44% more** ($0.00030 a pick), nearly all of it the
   mechanical phrases on the *Run again* and *Find more* rows ("rerun lexicon", "re-run lexicon",
   "regenerate lexicon"…). Those exist for the bar's literal matcher. Leaving them out of what the
   model reads would give the tokens back, but it is a change to measured wording and would need
   its own run. Not measured here.
2. **A sentence that opens with "find" never reaches the model.** The bar's own verb reads "find
   more good quotes for me" as *Find words: more good quotes for me*. Jev picked *Quotes › Find
   more* for it at 1.00. Three of the 36 new sentences were taken this way. This is the bar's
   matching, not the picker.
3. **"All my articles" picks this article's row**, now including Find more. It waits for an Enter,
   and the row's name says which list it adds to.

## Caveats

- **One run per day, and the list changed twice between them.** Before plan 261004k, four rows
  were added (the Thread summary, Debate's two sub-modes, Remember's Explore) and two removed (the
  Tweets mode, the Simple summary). This run cannot separate that from today's nicknames.
- **Two labels were widened for a row that was renamed**: "turn this into a twitter thread" (`p15`
  and `b04`) now also accepts the Thread sub-mode, since the Tweets mode it named is gone. Decided
  before the run. The blind one was first attached to the wrong id (`b05`) by a slip, and moved to
  `b04` after the summary showed it; `b04` is word for word `p15`.
- **The new 36 were written by the agent that ran this**, with the list in front of it, so they are
  no blind test. Three were added after checking which sentences the bar answers itself, and before
  any model call.
- **Rule 4 is generous to the glossary**: a request for more terms accepts *Glossary › Run again*
  as well as Find more, because that row's own description says it adds terms. Jev chose Find more
  all five times, so the rule did not decide anything.
- **Small numbers.** A difference of four sentences in 192 is inside what a second run could move.

## Spend

$0.07, in the ledger as job `eval`: 228 Jev calls ($0.067), the first two of them a probe to price
a call before the run, and 47 Luna calls ($0.002).
