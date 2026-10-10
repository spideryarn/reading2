# What a Citations row says, and where each word came from

Up: [investigations.md](../project/investigations.md) · the mode: [citations.md](../project/bibliography.md)
· the plan it informed: [261003j](../plans/261003j-citations-say-only-what-the-bibliography-supports.md)

## What was asked

Greg's report `spya-zmdb7y` (2026-10-03) said a Citations row seems to add only a paraphrase of the
citing paragraph, and should say nothing about a paper beyond what the article's bibliography gives.
Two questions follow. How much of a row is the model's own words about the work? And is what would
be left — title, authors, year — really from the article?

## What was measured

[`evals/citations-say-less.ts`](../../evals/bibliography-say-less.ts), free and deterministic: it reads
stored lists and calls no model. Run on 2026-10-03 over the five local articles with a stored list,
194 rows. The raw output is
[`evals/results/citations-say-less-261003.tsv`](../../evals/results/citations-say-less-261003.tsv).

**The model's sentence, `why`.** Every row has one. It averages 9 to 18 words by article, and comes
to 2,143 words over the 194 rows. Between 36% and 73% of its content words are absent from the
paragraphs that cite the work. That number is a screen and not a finding: a paraphrase swaps words
by definition. Reading thirty of the sentences against their citing paragraphs found none that said
something the paragraph did not.

**What is left.** The script flags a row when a word of its title, an author, or its year is not in
the article's text or the row's stored reference entry. This is a lexical flag over the whole
article: it catches a name the article never says, and cannot see a name the article gives to a
different work (GPT Sol showed a Smith 1999 row mislabelled Jones 2020 passing, because both words
were elsewhere in the article). It flagged eleven rows, read one by one:

- seven titles are labels the model built where the article gives no title (*"Roon's Twitter
  reply"*, *"OpenAI Five (OA5) blog/report"*), which the prompt asks for;
- two years are false alarms: the article's `1963` is glued to `63ya` in the block text;
- one author is the model correcting the article's typo (*Dojolonga* for Djolonga);
- one author carries the model's gloss (*"Archimedes (attributed by Pappus of Alexandria)"*);
- **one author is from the model's memory**: *The Bitter Lesson · Sutton*, in an article that never
  names Sutton. It is correct, and nothing marks it as ours.

So: one unsupported author found by hand among the flagged rows. That is not a rate for
misattributed authors, which this script cannot measure.

## What was decided

`why` is no longer drawn by default on the row, the hover card or Marginalia's note; it appears only
beside a check made against it. The rendering tests hold that; on these 194 rows it is 2,143 words
before and 0 after.

Code now drops authors or a year the article never gives (`locateInArticle` in `src/citations.ts`).
The original block-only replay called that function on stored rows with no entry: **3 by-lines dropped in 194,
no years** — the three authors above, and both glued years kept. No prompt changed, so no model was
called. The corrected replay, run again after code review, gives the same three; see the
[plan's measurement section](../plans/261003j-citations-say-only-what-the-bibliography-supports.md#measured-after).

## What was ruled out

- **A model-judged eval of whether `why` adds anything.** Not run: the decision does not depend on
  the exact share, and Greg's reading and mine agreed.
- **A tolerance for a corrected spelling in the author check.** One case in 194; the row keeps its
  title, which carries the article's own spelling.

## Limits

Five articles, all local, three of them essays with inline links and no reference list. The Entropy
paper the report was filed on is not in the local database and was not measured. The author check
reads block text only, so a name that appears only inside a link's address counts as absent.
