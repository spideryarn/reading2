# Citations: influence unknown unless confident, before and after

Up: [investigations.md](../project/investigations.md) · the plan:
[261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md) ·
the mode: [citations.md](../project/citations.md)

**The question.** The list prompt used to require an influence number on every row and sent "I do
not know this work" to the same low number as "this work is obscure". `citations/6` asks for a
number only when the model is confident it knows the work, and null otherwise. Does it say unknown
a sensible amount of the time, and are the works it still scores actually well known?

**The short answer.** About half the rows now say unknown, where none did. The numbers that remain
are the same numbers as before. An outside check of a sample found 17 of 24 scored works about
right and one too high, and 10 of 12 unknown works fair to call unknown; it did not call a famous,
titled work unknown.

## Method

`evals/citations-influence.ts`, which calls production's own `generateCitations` and stores
nothing. Three local articles (antikythera-mechanism, scaling-hypothesis, openai-huggingface), the
old prompt twice (`before-1`, `before-2`, commit 4a9452699) and the new prompt twice (`after-1`,
`after-2`, commit 2b2dc6b7e), all on `claude-sonnet-5` at standard power. The second run of each
prompt is the control. Every file under `evals/results/citations-influence/` records the prompt's
version and hash. Rows are paired across runs by normalised title, then by first author and year;
the second rule can pair two different works by one author in one year, and the tables mark which
rule paired each row. About $3.50 in all, estimated from token counts.

Three differences from the real step, none of which touches a score: no previous list (so no
inherited ids), no registry lookup, and standard power whatever the article's switch says.

## Before

Every row had a number: 148 of 148 in `before-1`, 109 of 109 in `before-2`. Nine rows in `before-1`
sat at 0.1, eight of them Antikythera web pages and news pieces.

Two runs of the old prompt agree on the number and not on the list. Paired rows differ by 0.042 on
average, and no pair by more than 0.2. But only 79 rows pair: Antikythera gave 79 rows one run and
37 the next. That instability is the list's, it is older than this change, and it means every count
below is best read as a share.

The lists stored locally were made by `citations/1` to `/3`, so they are only a rough guide: 194
rows, all with a number, 10 at or below 0.15.

## After

| article | run | rows | with a number | unknown |
|---|---|---|---|---|
| antikythera | 1 | 77 | 39 | 38 |
| antikythera | 2 | 74 | 28 | 46 |
| scaling-hypothesis | 1 | 76 | 35 | 41 |
| scaling-hypothesis | 2 | 25 | 14 | 11 |
| openai-huggingface | 1 | 6 | 0 | 6 |
| openai-huggingface | 2 | 6 | 0 | 6 |

Unknown is 44% to 62% of a long list, and all of the short one, whose works are blog posts and
model cards.

- **The numbers that remain did not move.** On Antikythera, 32 rows have a number under both
  prompts, differing by 0.044 on average and never by more than 0.1. That is the old prompt's own
  spread.
- **What became unknown is the bottom.** No row in any `after` run is at or below 0.15. On
  Antikythera, 34 paired rows went from a number to unknown and none the other way.
- **Known versus unknown, run to run.** Of 83 rows that pair across `after-1` and `after-2`, 38 are
  unknown in both, 32 have a number in both, and 13 flip. On Antikythera alone, paired by title,
  5 of 57 flip. Most of the rest are scaling-hypothesis rows paired by author and year, the weaker
  rule, so some of those 13 are mis-pairs rather than a change of mind.
- **Where both runs give a number** they differ by 0.075 on average; four pairs differ by 0.2 or
  more, against two under the old prompt.

## Are the confident ones actually well known?

A Sonnet subagent checked a sample of `after-1` on the web, mostly through OpenAlex, without seeing
this write-up: [the table](../../evals/results/citations-influence/web-check-261003.md).

**Works given a number (24 sampled):** 17 about right, 1 too high (Woan & Bayley 2024, scored 0.4,
real and covered in the press, no citations yet), none clearly too low, 6 it could not judge. 21 of
24 are confirmed to exist and none was shown not to. The ordering holds: the 2006 *Nature* paper at
1.0 has several hundred citations, and the rows at 0.2 to 0.3 have between none and 23.

**Works called unknown (12 sampled):** 10 fair to call unknown (news pieces, fresh preprints, a
topic that is not a work, rows with no title), 1 that arguably should have had a number (Brants et
al. 2007), 1 ambiguous (*Schmidhuber 2015/2018*, an author and two years with no title).

**What the check cannot say.** The sample is 36 rows from two articles, skewed to Antikythera at the
low end. About 11 rows had no citation count to find, and five could not be confirmed to exist.
OpenAlex counts run low, so they rank works and do not measure them. "About right" is one model
reading another's number against a count, not a ground truth.

## What it means for the product

- The row now says *influence unknown* on roughly half of a long list. That is the honest version
  of what was a column of 0.2s and 0.3s.
- Because unknown is common, the threshold bar could not go on always showing a row with no
  influence; it judges such a row on its relevance alone (the plan's stage 1, item 4).
- One scored work in 24 was too high, and it was a recent paper with press coverage. A number from
  memory is still a number from memory; the band's (i) goes on saying so.
- *Dig deeper* filling the number in from the web is stage 2, measured separately below once built.
