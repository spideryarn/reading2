# The reading-time estimate knows how hard the piece is: a model rates its language and its ideas at import

Up: [plans.md](../project/plans.md) · Queue item `qi-q4hqtt8k` · Report `spya-jew7ds` · Follows
[261005c](261005c-reading-time-estimate-says-its-rate-its-range-and-what-it-does-not-know.md), which
put the question to Greg · Research:
[261005a](../research/261005a-reading-time-estimates-and-text-difficulty.md) · Evidence:
[261005b](../investigations/261005b-reading-time-difficulty-multiplier-coefficients-and-where-the-rating-comes-from.md)

**Status:** plan, 2026-10-05, reviewed by GPT Sol
([prompt](261005j-reading-time-difficulty-plan-review-prompt.md),
[answer](261005j-reading-time-difficulty-plan-review-sol.md)). Built, 2026-10-05, on `dev`; see the
Log for what is not done.

> yes, either difficult language and/or difficult ideas both slow down reading time. the research
> will hopefully provide evidence to figure out the numbers/coefficients/etc . Piggyback on an
> existing LLM call during import? Or failing that this could be a quick/cheap DeepSeek call to
> return a few fields of structured data specifically if there's nothing to piggyback on
>
> — Greg, 2026-10-05, answering `Q-reading-time-difficulty`

The options were A, leave the minutes flat; B, the word-length equation; C, a model rates language
and ideas at import and the minutes are multiplied. Greg chose C.

## What we are building

1. **A rating per article**: language 1 to 5, ideas 1 to 5, and one sentence saying why, made by a
   cheap model reading a sample of the piece when it is imported. Stored with the model's id and
   the time.
2. **A multiplier from the rating**, one table per dimension, multiplied. `readingMinutes` and
   `readingRange` take it, so the shelf card, the masthead, Metadata and a visitor's page all move
   together.
3. **The card says so.** `ReadTimeCard` gives 238 as the starting rate, then the adjustment: the
   two ratings, the multiplier and the model's sentence. Its "does not know how hard this piece is"
   paragraph becomes what is still true: a model judged it from sampled passages, and it does not
   know who is reading. An article with no rating keeps the flat minutes and the card says it has
   not been rated.

## The numbers

**These are provisional.** They are our choice of steps, informed by the studies below. No study
measures a model's rating against reading time, and none gives five levels. The sources, the
quotes and the arithmetic are in the investigation.

- **Language.** In actual words a minute, college students went from about 320 on the easiest
  passages to about 200 on the hardest (Carver 1976, in Carver 1997): 0.74× to 1.19× the time at
  238. Nearly all of it is word length. Brysbaert 2019 re-derives Britton 1978's easy and hard
  texts as 261 and 203 words a minute from word length alone: 0.91× and 1.17×.
- **Ideas, beyond word length.** Counted in standard-length words, rate was flat until the passage
  was hard for those readers, then fell from about 260 to about 200 (Carver): 1.3×. Britton's hard
  texts ran at 182 against the 203 predicted: 1.12× left unexplained, which is not the same as
  measured conceptual load. Wake Forest's teaching rule of thumb is 250, 180 and 130 words a minute
  for no, some and many new concepts.

| rating | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| language | 0.88 | 0.92 | 1.00 | 1.08 | 1.17 |
| ideas | 0.95 | 1.00 | 1.05 | 1.12 | 1.20 |

- **The neutral case is language 3, ideas 2**: ordinary adult non-fiction that explains a few
  ideas as it goes, read by a curious adult who has not studied the field. That is what we take
  238 to describe, and it multiplies to exactly 1.
- **The two are multiplied**, as an assumption: "ideas" is meant as the slowdown left after the
  words are accounted for. A model asked for both may count one thing twice, and nothing here shows
  it does not.
- **The hardest corner is 1.40, and that is set by the measured totals, not by the columns.** The
  hardest texts anyone timed came out at 1.19× (Carver's hardest passages, 200 words a minute) and
  1.31× (Britton's, 182). Our own papers sit at 1.19×. The first table here topped out at 1.68,
  which no measurement supports; it was cut back on 2026-10-05, after the paid run showed that
  most papers would land at 1.4–1.7× (see the Log).
- **Floor 0.84, ceiling 1.40**: the table's own corners, written down as bounds (`0.8`–`1.45`) so
  that a later edit to one cell cannot quietly take the estimate outside them.
- **Applied before rounding** and before the one-minute floor.

**What our own data says: almost nothing.** Twelve production articles have enough paragraphs read
once to give a pace, all one reader's, eleven of them academic papers, so there is no easy piece to
compare with. Their median pace is 1.19× the flat estimate; word length alone predicts 1.13×. It
neither sets a number nor checks one.

## Where the rating comes from: its own cheap call, not a piggyback

Greg asked for a piggyback first, twice. There is nothing sound to ride on:

- The only model call every import makes over the text is `structure`. A long document is
  structured in slices, so no call reads the whole piece, and when slicing fails the tree is built
  with no model at all.
- An article already imported could only be rated by buying its structure again. So the separate
  call has to exist for the backfill anyway, and a piggyback would be a second way to do one thing.
- Structure's prompt is the most measured in the app. Showing that extra fields leave its tree no
  worse is a before-and-after panel costing tens of dollars, to save a tenth of a cent an article.

So: one call to `deepseek/deepseek-v4.1-flash`, the model and zero-retention route the paper
metadata step already uses (Greg's choice, 2026-10-01). A new `AiJob`, `reading-difficulty`, since
`difficulty` already names a field on FAQ and glossary items.

- **It reads a sample of the finished paragraphs**, not the piece: up to about 3,000 words in six
  evenly spaced runs of whole body paragraphs, so a book costs what an essay does (about a tenth of
  a cent) and the ending counts as much as the opening. The trade-off: a piece that is easy for
  most of its length and hard in one chapter is rated on what the sample happened to catch.
- **Strict schema** through `withChatJsonSchema`: `language` and `ideas` as integers 1–5, `reason`
  a string. The prompt is `READING_DIFFICULTY_SYSTEM`. It describes each level in plain words, says
  the text is data, and carries `plainWords("explain")` for the reason.
- **Made at the end of the `blocks` step**, from the blocks that step has just produced, so the
  rating is always about the text the reader is served. (The first draft put it in `extract`. An
  extract-only revision carries the old blocks forward, and would have shown a new rating beside
  old prose. GPT Sol, F1.)
- **It never fails the step.** A refusal, a timeout (15 s) or an answer that fails its checks is
  logged by kind and the article is left unrated. A caller's abort still propagates. The cost is
  that an import waits a few seconds longer, and at worst fifteen, before `structure` starts.
- **Runnable on its own**: `scripts/rate-reading-difficulty.ts <slug>` prints its `Target:` and the
  rating. It stores nothing. See below for the backfill.

### The simpler options passed over

- **B, the word-length equation, with no model.** Free, published, and blind to hard ideas in plain
  words, which is the example in the report. Greg chose C over it.
- **A pipeline step of its own.** About ten registries and a hand-kept SQL CHECK, and no step may
  fail without failing the import. A call inside `blocks` needs none of that.
- **A table of its own.** Every read of the minutes (shelf, article, visitor) would need a join;
  columns on the revision ride the projections that are already there.
- **One overall level**, as the old version had. It cannot say "plain words, hard ideas".

## Where it is stored

Five nullable columns on `article_revisions`: `reading_language` and `reading_ideas` (smallint,
CHECK 1–5), `reading_difficulty_reason`, `reading_difficulty_model`,
`reading_difficulty_rated_at`. One CHECK holds them all null or all set. The migration is additive.

- **An artefact kind of its own, `readingDifficulty`, written by `blocks`** beside the blocks. Not
  through `META_COLUMNS`: every `meta` write clears every column it owns, so a standalone
  `metadata` run would have wiped a good rating (GPT Sol, F2). `blocks` always writes it: a rating,
  or "unrated", which nulls all five.
- **`carry`** in `REVISION_CARRY_POLICY`, the time included: a revision that does not run `blocks`
  keeps the rating, and making a revision is not rating the piece again.
- **Two types.** What a reader's screen needs is `{ language, ideas, reason }`, and that is what
  `Meta.readingDifficulty` and the public DTO carry, so a visitor's minutes match the owner's and
  `PublicArticle` stays assignable to `Article`. The stored artefact adds the model and the time,
  both required. The export's `meta.json` carries all five.

**Articles already here stay flat, and the card says they have not been rated.** Rating them is a
write to production under a moving revision pointer, which needs the safeguards
`src/backfill-registry-facts.ts` documents. That script is not in this work; it is queued, and
Greg runs it.

## Stages

1. **The multiplier, the storage and the card.** `src/reading-time.ts`: the two tables, the bounds,
   `difficultyMultiplier`; `readingMinutes` and `readingRange` take an optional rating. The
   migration, the artefact kind, the projections, both exports. The card, `articleStats`,
   `describeArticle`.
2. **The call.** `src/reading-difficulty.ts`: the sample, the request, the checks on the answer; the
   job's rows in the gateway tables; the dry-run script; the paid check below.
3. **Wiring it into `blocks`**, the privacy page's sentence about what DeepSeek reads, the docs.

GPT Sol reviews this plan, then the code.

### The paid check, and what it has to show

`evals/reading-time-difficulty/rate.ts`: up to 24 local articles spread across word length, each
rated twice. It tests whether the call works and repeats itself. **It does not calibrate the
table.** Decided before the run:

- at least 95% of calls return a rating;
- the two runs agree within one level on at least 90% of articles, on each scale;
- language rises with mean word length (rank correlation of 0.4 or more);
- read by a person, no rating is absurd, and the plain-words-hard-ideas case exists in the results.

If it fails these, the wiring in stage 3 does not land.

## Tests, seen red first

- `difficultyMultiplier`: the literal value of named pairs (neutral is exactly 1, `(5,5)` is 1.404,
  `(1,1)` is 0.836); every pair inside the bounds; harder is never quicker on either scale;
  unrated is exactly 1.
- `readingMinutes(360, {5,5})` is 2, not the 3 that multiplying the rounded flat figure gives. The
  range scales with it. Unrated answers are what they are today.
- The shelf card, the masthead and Metadata show the same minutes for a rated article, and that
  number is a literal worked out by hand, different from the flat one.
- The card: rated, it names both ratings, the multiplier and the reason, calls 238 the starting
  rate, and no longer says it does not know how hard the piece is; unrated, it says the piece has
  not been rated.
- The call: the request names the route's model and a strict schema; a good answer is a rating; a
  level out of range, a fractional or string level, a missing field, a blank reason, text that is
  not JSON, a truncated completion, a refusal and a timeout each leave the article unrated without
  throwing; a caller's abort throws.
- The sample: within its word budget, whole paragraphs, deterministic, reaches the last tenth of
  the piece, and a short piece is sent whole.
- Storage, against Postgres: a rating written by `blocks` reads back on the owner's article, on the
  shelf entry's minutes and through the real public reader (numbers and reason, neither model nor
  time); "unrated" nulls all five; a half-written rating is refused by the CHECK; a later revision
  that does not run `blocks` carries all five, the time unchanged; a `metadata`-only write leaves
  them alone.
- The pipeline: `blocks` run with a stubbed gateway stores the rating and sends the gateway body
  paragraphs and no note; with the gateway refusing, the step still succeeds. Removing the call
  fails a test.
- Both exports carry a rated fixture's rating.

## Known, and left

- **A cached shelf can be a visit behind.** The browser keeps the last shelf it was sent, minutes
  included, and shows it until the live one arrives. So a freshly rated article can show its old
  flat minutes for a moment. Nothing new: the same is true of every number on the card.
- **`effort: none`** on the call is the paper-metadata route's setting. The paid check is what says
  whether a judgement call is good enough without thinking.

## Open, for Greg

- **The reader's profile.** He raised it in the report, and Carver's step comes only when the text
  is harder than the reader. Not in this work.

## Log

- 2026-10-05: evidence read, production's recorded times checked read-only, plan written. The
  Overseer told that the dev key was empty; Greg raised its limit the same hour.
- 2026-10-05: GPT Sol's plan review, APPROVE WITH CHANGES, ten findings. Taken: the call moves
  from `extract` to the end of `blocks` (F1, F6); the rating is its own artefact and not part of
  the `meta` write (F2); a display type and a stored type (F3); the numbers called provisional, a
  neutral case named, the bounds described as what they are (F4); the card's wording (F5); the
  tests given positive controls, and the multiplier applied before rounding (F7); acceptance
  criteria written before the paid run (F8); privacy, export and the cached shelf named (F10).
  Changed in scope: the backfill write is out of this work and queued, because doing it safely is
  a piece of work of its own (F9).
- 2026-10-05: built. The paid check ran on 24 local articles and met its bar (all rated, the two
  runs never more than a level apart, $0.03). **Reading its results changed the table**: the first
  one put every research paper at 1.4× to 1.7×, and no timed total is that high, so the top was
  cut back to 1.40. The investigation says what the mistake was.
- 2026-10-05: GPT Sol's code review
  ([prompt](261005j-reading-time-difficulty-code-review-prompt.md),
  [answer](261005j-reading-time-difficulty-code-review-sol.md)). Its first start was killed by the
  box's memory guard with no verdict; the one fix it had made, the sampler reaching the end of a
  piece made of very long paragraphs, was kept, and the paid check run again on it. The second
  start found no storage defect by reading. Taken: `blocks` still reserved 5 seconds in
  `STEP_BUDGET_MS` though it now ends with a 15-second call, so a slow rating could meet the
  claim's deadline first and cancel the import; now 25. It also corrected the investigation where
  it mixed the two paid runs and where it called agreement accuracy.
- 2026-10-05: **status.** On `dev`, not deployed. New imports are rated; articles already here are
  not, and say so. Not done: the backfill script; a browser look at the card (the box was short of
  memory all evening); the easy end of both scales, which the local corpus cannot test.
