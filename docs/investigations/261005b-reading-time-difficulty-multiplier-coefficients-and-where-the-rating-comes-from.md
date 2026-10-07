# Reading-time difficulty: the multiplier's numbers, and where the rating comes from

Up: [investigations.md](../project/investigations.md) · For plan
[261005j](../plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md)
· Builds on research
[261005a](../research/261005a-reading-time-estimates-and-text-difficulty.md)

Done 2026-10-05. Three questions: how much do harder language and harder ideas slow reading; do
our own recorded reading times agree; and which model call should produce the rating.

**What was measured, and what was not.** The rating call was run for real, twice each on 24 local
articles (§ 4): it returns ratings, its paired ratings stay within one level, and the latest run
cost about six hundredths of a cent per call. What
nothing here shows is that a model's rating tracks how long anyone takes to read. The table in § 1
comes from other people's studies of other readers.

## 1. The numbers, from what was read

Each source below was opened and the passage read, 2026-10-05. The research doc had the first two
as abstracts or search snippets only.

**Language.**

- **Carver 1976, as Carver reports it in 1997** (*One second, one minute, one year of reading*,
  <https://readinghalloffame.org/sites/default/files/carver_97.pdf>, p. 13). College students,
  passages graded by difficulty: *"when reading rate is measured in actual words per minute, wpm,
  the dashed line shows that reading rate decreases rapidly from a high of about 320 wpm for
  passages at Grades 1 to 3 difficulty to a low of about 200 wpm for passages at Grades 16 to 18
  difficulty."*
- **Brysbaert 2019** (preprint, <https://osf.io/download/xynwg/>, p. 33–34): *"Miller and Coleman
  (1971) noticed that text difficulty correlates very well with word length. If instead of words
  per minute, they used letters per second as dependent variable, the effect of text difficulty on
  silent reading rate disappeared."* He then re-derives Britton 1978's easy and hard texts from
  word length alone: 4.2 letters a word predicts 261 words a minute (262 seen), 5.4 letters
  predicts 203 (182 seen).

Against 238 words a minute, 320 is 0.74× the time and 200 is 1.19×. Grades 1 to 3 is children's
text, which an article here rarely is, so the bottom of our table is fiction's 4.2 letters (0.91×)
and a little below it.

**Ideas, beyond word length.**

- **Carver again**, same passage, with rate counted in standard six-character words so that word
  length is taken out: *"Reading rate was approximately constant all the way from passages at
  Grades 1 to 3 in difficulty up to passages at Grades 13 to 15 in difficulty, varying only from
  about 250 to 270 Wpm. However, when the passages became relatively hard for these college
  students at Grades 16 to 18 in difficulty, rate dropped off to around 200 Wpm."* He puts it down
  to readers changing from reading to learning. 260 to 200 is 1.3× the time. The step comes only
  when the text is harder than the reader, which is a fact about the pair, not the text.
- **Britton 1978, in Brysbaert 2019**: the hard texts ran at 182 against 203 predicted from word
  length. 1.12× left over.
- **Wake Forest's workload estimator**
  (<https://cat.wfu.edu/resources/workload/estimationdetails/>): reading to understand, 250, 180
  and 130 words a minute for no, some and many new concepts, so 1.39× and 1.92×. A teaching rule of
  thumb. It lists Rayner 2016, Carver and others as reading, and ties no number to any of them.

**The table that follows.**

| rating | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| language | 0.88 | 0.92 | 1.00 | 1.08 | 1.17 |
| ideas | 0.95 | 1.00 | 1.05 | 1.12 | 1.20 |

Multiplied. **These are provisional product coefficients, informed by the studies above and not
derived from them.** No source gives five levels, and none is about a model's rating.

- **The neutral case is language 3, ideas 2**: ordinary adult non-fiction that explains a few ideas
  as it goes, read by a curious adult who has not studied the field. That is what we take 238 to
  describe. It is an assumption about what Brysbaert's pooled texts were like.
- **The hardest corner, 1.40, was chosen in light of measured totals.** The hardest texts in the
  studies used here came out at 1.19× the time at 238 (Carver's hardest passages, 200 words a minute, with word
  length and the learning step both in it) and 1.31× (Britton's hard texts, 182). Our own papers
  are at 1.19× (§ 2). Wake Forest's estimates for reading to understand are 1.32× for "some new
  concepts" and 1.83× for "many", relative to 238. Those are stipulated rates, not timed totals.
  None of these sources derives our 1.40 corner.
- Language 5 is Britton's hard texts as word length alone predicts them (1.17). 2 is fiction's word
  length (0.91). 1 is a little below that; Carver's easiest passages (0.74) are children's text,
  which an article here rarely is.
- Ideas 1 is Wake Forest's "no new concepts" cell (250 words a minute, 0.95). 5 is what is left of
  1.40 once language has had 1.17, and is a little above Britton's leftover (1.12), which is
  slowdown word length did not explain and not a measurement of conceptual load.
- The steps between are ours. Nothing measures them.
- **Multiplying is a modelling assumption**: "ideas" is meant as the slowdown left once the words
  are accounted for, which is how Carver's two curves relate. Nothing shows that a model asked for
  both keeps them apart; if it does not, hard pieces are counted twice. Fixing the corner at a
  measured total is what limits the damage.
- **The corners are 0.84 and 1.40.** The code holds the product to 0.8–1.45, which changes none of
  the 25 pairs today; it is there so an edit to one cell cannot take the estimate outside what was
  argued for here.

**The first table had an unsupported total, made conspicuous by the paid ratings.** It had language up to 1.20 and
ideas up to 1.40, each column argued from a source, and a corner of 1.68. Each column looked
defensible. But Carver's 1.19× actual-word total already includes the slowdown whose 1.3× ratio
appears in the standard-word curve. Using that total as a language-only factor and then multiplying
the residual slowdown again counts that component twice. The problem is using a total as a
component, not multiplying separate language and ideas factors. On the first run's 24 articles
in § 4 it put every research paper at 1.4× to 1.7×, above the timed totals cited here. A column can be
right and the product wrong. The paid run measured ratings, not reading time; it did not prove
that either coefficient table predicts readers' pace.

**What these numbers are not.** They are from college students reading short passages in a lab.
None of them is about a model's rating. A rating of "ideas 4" is not Carver's "Grades 16 to 18";
the prompt's descriptions of each level are our attempt to line them up, unchecked.

**Not found, or not opened.** Kintsch and Keenan 1973 (seconds per extra proposition), Rayner and
Pollatsek 1989's table of rates by subject, and the 2026 *Reading and Writing* paper on model
ratings and second-language reading time were seen only in search summaries or not at all, and
none of their numbers is used.

## 2. Our own recorded reading times

The app records seconds on screen per block, for an owner with the experimental switch on
([reading-time.md](../project/reading-time.md)). The script is
[`evals/reading-time-difficulty/pace.mjs`](../../evals/reading-time-difficulty/pace.mjs); it opens
`BEGIN READ ONLY`, checks the transaction says so, and prints its `Target:` first.

```
node --env-file=.env.prod evals/reading-time-difficulty/pace.mjs
```

For each article it takes body paragraphs of 25 words or more, divides the seconds spent by the
seconds 238 words a minute would give, and keeps the paragraphs between 0.5× and 3×: under that is
a glance, over it is a re-read or a reader who walked away. The article's figure is the median of
what is kept.

**Production, 2026-10-05.**

- 23 articles have any reading time, all one reader's. The switch is off for everyone else.
- 12 have eight or more kept paragraphs. Eleven are academic papers and one is a long essay. Their
  mean word length runs from 4.86 to 5.49 letters. There is no easy piece among them.
- The twelve medians run from 0.72 to 2.42, and their median is **1.19**.
- Word length alone (Brysbaert's equation) predicts 1.06 to 1.19 for them, median **1.13**.

**The local database** has 58 articles with reading time, seven with fifteen or more kept
paragraphs. Most of it is agents' browser tests scrolling a page, so it was not used.

**What it supports, and what it does not.**

- It cannot set a coefficient or check one. Twelve articles, one reader, one kind of text, and a
  window (0.5× to 3×) that by construction returns something near 1.
- It does not contradict the language column: papers with long words were read about a fifth
  slower than the flat estimate, which is what word length predicts.
- The observed 1.19 is above word length's predicted 1.13, but this sample cannot establish an
  extra slowdown for ideas, or its absence. One possible explanation is
  Carver's: the reader may know these fields, so the text is not harder than him. The sample cannot
  show that, and it cannot justify any cell of the table. Greg raised the reader's profile in the
  same report; the plan leaves it open.
- The spread between articles (0.72 to 2.42) is far wider than any table here would predict. These
  measurements cannot separate text difficulty from pauses, familiarity and how the piece was read.

## 3. Which call makes the rating

Greg's order was: an existing import-time call first, a cheap separate one failing that.

**What an import calls today.** `DEFAULT_INGEST_STEPS` (`src/pipeline.ts`) is `fetch`, `extract`,
`blocks`, `structure`, `assets`. Of those:

- `extract` calls a model only for a PDF, page by page, and never sees the piece whole.
- `structure` is the only call every import makes over the text. Since
  [261005a](../plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md)
  a long document is structured in slices of about a thousand blocks, and when that fails the tree
  is built from the headings with no model. So it is not one call over the whole piece either.
- `assets` calls a model only to find a PDF's figures.
- `arc` reads the whole piece, and is not part of an import.

**Why `structure` was not used.**

- A sliced document would return one rating per slice, to be merged; a fallback tree would return
  none.
- An article already imported could be rated only by buying its structure again. The backfill
  needs a separate call whatever is decided, so a piggyback would be a second way to do one thing.
- Structure's prompt and schema are measured ([structure-step.md](../project/structure-step.md)).
  Adding fields to them needs a before-and-after run of whole structure calls to show the tree is
  no worse, which costs tens of dollars, to save a call that costs a fraction of a cent.
  **So "does a piggyback hurt the call it rides on" was not measured.** The first two reasons
  decided it without that.

**What was chosen.** A call of its own to `deepseek/deepseek-v4.1-flash` on the zero-retention
route the paper-metadata step uses, reading a sample of about 3,000 words, made at the end of the
`blocks` step.

## 4. The paid run: does the call work, and does it repeat itself

```
npx tsx evals/reading-time-difficulty/rate.ts --paid
```

24 local articles of 400 body words or more, spread evenly across mean word length (4.2 to 5.9
letters), each rated twice. Latest results, using prompt `reading-difficulty/2`:
[`evals/results/reading-time-difficulty-2026-10-05.json`](../../evals/results/reading-time-difficulty-2026-10-05.json).
The first run, using `reading-difficulty/1`, is kept in
[`…-prompt-1.json`](../../evals/results/reading-time-difficulty-2026-10-05-prompt-1.json).
The bar was written into the plan before the run.

| what was asked | bar | first run, prompt 1 | latest run, prompt 2 |
|---|---|---|---|
| calls that returned a rating | 95% | 48 of 48 | 48 of 48 |
| two runs within one level, language | 90% | 24 of 24 (19 identical) | 24 of 24 (20 identical) |
| two runs within one level, ideas | 90% | 24 of 24 (20 identical) | 24 of 24 (17 identical) |
| language rises with word length (rank correlation) | 0.4 | 0.56 | 0.76 |
| spend, as the collector recorded it | — | $0.0330, so $0.0007 a call | $0.0281, so $0.0006 a call |

**Spot checks of the latest saved ratings.** These describe the outputs; neither results file
records an independent person's judgement of whether a rating is sensible.

- Personal essays are language 2–3 and ideas 2–4. The encyclopedia entries in this run are
  language 4 and ideas 3–5; the academic pieces are mostly language 4–5 and ideas 4–5.
- **Plain words for hard ideas does show up**: *Lies We Tell Kids* and *Distributed
  Representations: Composition & Superposition* came back language 3, ideas 4, both times.
  Their reasons describe conversational prose carrying abstract arguments.
- **Two imports of one paper can get different ratings.** One paper is in the corpus twice. One copy
  was rated 4 and 5 on both attempts, the other 4 and 4 on both. With the table above that is
  1.296× against 1.2096×: about four minutes on a fifty-minute paper. In the first run the copies
  were 4 and 4 versus 5 and 5, a difference of about ten minutes. Two runs on
  one copy agreeing does not mean the rating is stable against small changes in the sample.
- **Nothing was rated 1 on either scale**, and a 2 turned up on four pieces. The chosen set has
  no story or children's text, so the easiest end of both scales is untested.
- The largest gap between two attempts of one article is 0.108 of a multiplier (0.13 in the first run).

**Why there was a second run, the same evening.** The code review changed how a piece made of
very long paragraphs is sampled, so the call was checked again with prompt `reading-difficulty/2`.
The local corpus had moved, so 16 articles are in both runs. Of those, 9 got exactly the first run's rating and
none moved more than one level on either scale, comparing attempt A between runs. This is
agreement on this small overlapping set, not accuracy against a known difficulty or a guarantee
for a fresh rating. With the table above one level on one scale is about 4% to 9% of the minutes;
movement on both scales compounds.

**What it means for the minutes.** In the latest run, six of the 24 were 3 and 3 on attempt A,
and only two stayed 3 and 3 on both attempts (nine and six respectively in the first run).
That pair gives 1.05×; the 4–5 language and 4–5 ideas pairs give roughly 1.21× to 1.40×. These
are the table's adjustments, not measured slowdowns.

## What is still to do

- Rating the articles already in production: a script Greg runs, not yet written.
- The easy end of both scales: a story, a news item and a children's text, rated.
- Whether the rating predicts anyone's time. That needs recorded reading time from more than one
  reader, on pieces that differ.
- The reader's profile.
