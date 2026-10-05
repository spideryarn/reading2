# Summary's length follows the length of the piece

Up: [plans.md](../project/plans.md) · the mode: [summaries.md](../project/summaries.md)

**Status: built, on `dev`, not deployed.** GPT Sol reviewed the plan (approve, five findings, all
taken) and the code. **What shipped is smaller than what was planned**: Fuller's length follows
the piece, Brief's does not, because the measurement said a banded Brief was worse.
[§ What changed between the plan and what shipped](#what-changed-between-the-plan-and-what-shipped).
**Later the same day Brief went from about 80 words to about 100**, still for every piece:
[§ A slightly longer Brief](#a-slightly-longer-brief-2026-10-05).

## What it is for

Greg, 2026-10-04, from Summary's Fuller view of a book (`spya-gttwhn`, admin, so trusted input):

> The length of the summaries should somewhat reflect the length of the text. Not linearly. But a
> book will surely need (at least somewhat) longer summaries than a short article. Hopefully we can
> add a tweak to the prompts to this effect.

Until this change Brief was asked for about 80 words and Fuller for about 500, whatever the
piece. The only allowance was one sentence in Fuller's prompt, *"Shorter is fine for a short
piece"*.

**What that did**, two writes each on Opus with the guard on, before any change
(`evals/results/simple/high-none-len0a` and `len0b`). "Its words" here and below is the body the
request sends: the bibliography and other supplements are not counted.

| piece | its words | Brief | Fuller |
|---|---:|---:|---:|
| *Keep Your Identity Small* (an essay) | 879 | 88, 105 | 402, 492 |
| *Haters* (an essay) | 1,398 | 98, 94 | 553, 527 |
| *Geometric Deep Learning* (a book) | 47,957 | 113, 95 | 489, 515 |

So the length did not follow the piece in either direction: a Fuller summary of an 879-word essay
was about half as long as the essay, and a book got no more than an essay did.

## The change

**Four length bands, chosen by the body's word count, each with its own numbers in Fuller's
prompt.** The band is picked in code from the words of the body-evidence blocks the request sends
(the same set the prompt shows), and Fuller's system prompt is built for that band.

| band | body words | Fuller: paragraphs · about · never more than |
|---|---|---|
| `short` | under 2,500 | three to five · 250 · 330 |
| `standard` | 2,500 to 14,999 | **as before**, five to eight · 500 · 600 |
| `long` | 15,000 to 39,999 | six to nine · 700 · 820 |
| `book` | 40,000 and up | eight to eleven · 900 · 1,050 |

- **Not linear, as asked.** From the short band to the book band the piece is at least sixteen
  times longer and Fuller's ask is 3.6 times.
- **The standard band's Fuller prompt does not change by a byte**, and neither does Brief's in
  any band, pinned by the hashes `tests/simple-two-levels.test.ts` already held. Fuller's answer
  budget and validation limit do change (below), so the measurement included standard-band
  articles: Dodo twice before and after, Scaling once before and twice after, with two earlier
  same-prompt Scaling writes reported separately (Sol's plan review, F2).
- **Three values and nothing else.** The band changes the paragraphs asked for, the words asked
  for and the "never more than" in Fuller's LENGTH section. Everything else in the prompt is the
  same in every band.
- **The prompt version is `simple-prompt/9`.** Every stored summary becomes *outdated*, which is
  silent, and none is rewritten for it: an unforced run skips a stored summary whatever its
  prompt's age. Metadata's Rerun, and *Write it again* when it is offered, write the new length.
  So Greg's Rovelli summary changes when he presses Rerun on it, and not before.

### Fuller's stored limit rises, once, for every band

`SIMPLE_LIMITS` in `src/types.ts` is the hard cap that both the writer and every reader enforce:
over it, the write fails and stores nothing. It has to clear the book band's "never":

| | before | now |
|---|---|---|
| Brief | 2 to 3 paragraphs, 240 words | unchanged |
| Fuller | 3 to 8 paragraphs, 850 words | 3 to 13 paragraphs, 1,400 words |

The minimum stays, so every stored summary still reads. The answer's token budget
(`ANSWER_TOKENS`) is computed from these limits and grows with them.

**What this gives up:** the cap is one number per level, not per band, so a standard-band Fuller
that ran to 1,000 words would now be stored where before it failed the write. The prompt's own
"never more than 600" is what holds the length, as it did before (the cap was already 250 over
it). A per-band cap is the alternative, and it is passed over: the reader-side check
(`isSimpleParagraphs`) has no article to measure, so a per-band cap could only be enforced at
write time, and two caps that disagree is more machinery than the risk is worth.

**A rollback** of the whole change after a book-length summary is stored would make that one
summary read as absent (over the old cap), and the next press would write a new one, paid for and
in different words. So roll back the prompt and keep the raised limit: then everything stored
still reads (Sol's plan review).

## The simpler option passed over

**One sentence in the prompt, and no code**: *"Let the length follow the piece: shorter for a short
piece, longer for a book."* It is what the prompt nearly said already, and the table above is what
that got: 402 words for an 879-word essay. A model given a number writes to the number. And a
book's summary could not get much longer in any case, because the prompt's "never more than 600"
and the stored cap of 850 would both still be there. Telling the model the piece's word count and
asking it to choose is the same idea with one more step, and it leaves the stored cap as the only
thing that knows what length was meant.

**A formula instead of bands** (say, the square root of the word count) gives every article its own
prompt. Bands give four prompts that can each be read, pinned by a test and measured.

## What it costs

- **A longer wait for Fuller on a long piece.** Brief is shown first (since 2026-10-04), so the
  wait is for Fuller alone: 47 and 53 s to the book's Fuller, against 34 and 88 s before (the 88
  was a retry the guard asked for).
- **A little more money on a long piece**: a few hundred more answer tokens on a write whose cost
  is almost all the article itself.
- **A shorter wait and a slightly cheaper write on a short piece.**

## What was built

One stage.

1. `src/simple-summary.ts`: `SIMPLE_BANDS`, `bandFor(bodyWords)`, `FULLER_LENGTH` per band,
   `lengthFor`, `simpleSystem(level, band)`. `SIMPLE_SYSTEMS` stays as the standard band's pair,
   so everything that pinned it still does; `SIMPLE_SYSTEMS_BY_BAND` holds all four.
   `generateSimpleSummary` counts the evidence's words and picks the band. `src/types.ts`:
   Fuller's limit. `evals/simple/probe.ts` records each article's band and hashes the pair of
   prompts that band sends (Sol, F1).
   The code review found a real splitter collision: literal block-looking text in a code block
   can render like a second block while selecting a different band. The current fingerprint now
   includes the band, shared with generation; freshness and unforced stamps retain the old
   algorithm for pre-band summaries. [The postmortem](../postmortems/261005b-derived-instructions-must-participate-in-the-request-fingerprint.md).
2. Tests: `tests/simple-length-bands.test.ts` (the thresholds at their edges, each band's asks,
   Brief the same in every band), and in `tests/simple-summary.test.ts` the request for a body at
   each edge carries that band's prompts, with a 100,000-word supplement that must not count. The
   band lookup was mutated to count every block and five of those went red.
3. Measured, and written up in
   [docs/investigations/261005a](../investigations/261005a-summary-length-bands-measured.md).
4. Docs: [summaries.md § Length follows the piece](../project/summaries.md#length-follows-the-piece-since-2026-10-05).
   `/help` states no length, so it did not change.

No UI changes, so no browser check was run: the panel draws however many paragraphs it is given,
eight were already drawn, and eleven in the band is three more of what the band already scrolls.

## What changed between the plan and what shipped

The plan Sol reviewed (commit `ec32200e2`) banded Brief as well: 60 words for a short piece, 80,
110, and 140 in three paragraphs for a book, because Greg wrote "summaries", plural. It also gave
the two long bands one more sentence, *"This is a long piece. Cover the whole of it, the later
parts as well as the opening, and give each main part its share."* Both were built, measured and
taken out.

- **Brief.** A blind judge preferred the old, unbanded Brief in six pairs of eight, the banded one
  in one. In all four short-essay pairs the 60-word Brief left out a point the essay itself marks
  as important (the judge quoted the passage each time), and in both book pairs the longer Brief
  was the one judged padded. And asked for 60 words it wrote 71 to 94, so the cut was mostly not
  happening anyway. Brief is back to its old prompt, byte for byte, and its limits did not move.
- **The sentence.** Sol's F4: it fights Brief's own "at most one other key idea", so it was
  excluded from the main Brief comparison; the exploratory `len1whole` write still included it
  in both levels. For Fuller it was measured apart, two writes each on the
  long article and the book with it against two without: the judge preferred without twice, with
  once, and one tie, and the two control pairs (without against without) split as widely. It
  raised the long article's Fuller from about 610 words to about 695, nearer the 700 asked for,
  and in three of the four pairs the judge suspected a bent claim in the with-sentence summary
  alone. Coverage favored it in two pairs, so an effect remains possible; the sample did not
  establish an overall preference benefit. Left out pending stronger evidence.

## Measuring it

By [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
with `evals/simple/probe.ts`, which calls production's own `generateSimpleSummary`. The write-up
is [261005a](../investigations/261005a-summary-length-bands-measured.md); in short:

| piece (body words, band) | Fuller before | Fuller after |
|---|---|---|
| *Keep Your Identity Small* (879, short) | 402, 492 | 281, 237 |
| *Haters* (1,398, short) | 553, 527 | 331, 300 |
| *Dodo* (12,143, standard) | 534, 471 | 489, 482 |
| *The Scaling Hypothesis* (12,646, standard) | 440 (and 481, 438 the day before) | 484, 497 |
| *Race* (16,744, long) | 529, 509 | 620, 607 |
| *Geometric Deep Learning* (47,957, book) | 489, 515 | 834, 846 |

- No write failed, on a limit or otherwise, in 28 recorded writes.
- **The judge preferred the banded Fuller in all eight pairs where the prompt differed**, and
  called the old one padded in five of them. In the three standard-band pairs, where the prompt is
  the same on both sides, it preferred the old once and neither twice, which is the noise.
- **The Rovelli book is not in the local database**, and a session's production reads are
  refused, so *Geometric Deep Learning* stands in for it: about the same length.
- A piece over 100,000 words was not run: it would have cost several dollars a write, and the
  book band asks the same of it as of a 48,000-word one.

## Open, for Greg (asked in the debrief, not waited on)

- **[Q-summary-length-numbers]** whether these four rows are the lengths he wants. They are easy
  to change: one table, `FULLER_LENGTH` in `src/simple-summary.ts`.
  **Decided: keep them for now** — Greg, 2026-10-05: "let's see how it feels".
- **[Q-brief-for-a-book]** whether he wants a longer Brief for a book anyway. He wrote
  "summaries", plural; the measurement says a longer Brief reads as padded and a reader would
  rather have the 80-word one. The recommendation is to leave Brief alone.
  **Decided: slightly longer** — Greg, 2026-10-05: "maybe Brief could be ever so slightly longer
  but not much". Dispatched to session `brief-slightly-longer`.
  **Built**: about 100 words where it was about 80, for every piece.
  [§ A slightly longer Brief](#a-slightly-longer-brief-2026-10-05).

## Ledger

**The plan review** (GPT Sol, read-only, 2026-10-05; approve):
[the prompt](261005b-summary-length-plan-review-prompt.md),
[its answer](261005b-summary-length-plan-review-sol.md). The plan it read is commit `ec32200e2`.

| ID | Finding | Disposition |
|---|---|---|
| F1 (P2) | the probe hashed the standard pair of prompts for every article | fixed for new writes; three early `len1a` hashes remain unreliable (investigation § How) |
| F2 (P2) | unchanged prompt bytes do not excuse standard articles from measurement, since their budget and limits changed | taken: Dodo twice before and after; Scaling once before, twice after, plus two earlier same-prompt writes outside the blind pairs |
| F3 (P2) | a judge who sees only the summaries cannot tell an omission that matters | taken: the short essays' pairs carry the whole essay, and it is what found Brief's omissions |
| F4 (P2) | the "cover the whole of it" sentence conflicts with Brief's "at most one other key idea" | taken: excluded from the main Brief comparison (the exploratory `len1whole` still had it); measured apart for Fuller, then out of that too |
| F5 (P3) | the book's body is 47,957 words, not 49,462 (that is every block) | fixed |

**The code review** (GPT Sol, write-capable, 2026-10-05; approve after its own fixes):
[the prompt](261005b-summary-length-code-review-prompt.md),
[its answer](261005b-summary-length-code-review-sol.md). The candidate was commit `de2eb5bb9`.

| ID | Finding | Disposition |
|---|---|---|
| F6 (P1) | two articles can render to the same bytes, share a fingerprint, and be in different bands (a code block whose text looks like the next block's line) | fixed by Sol, red first: the band is in the fingerprint for `/9` and later, and a summary stored by `/1` to `/8` keeps the old algorithm so none goes stale. Read and taken; the fix had [a narrow second check](261005b-summary-length-f6-check-sol.md). [The postmortem](../postmortems/261005b-derived-instructions-must-participate-in-the-request-fingerprint.md) |
| F7 (P2) | the long band's paragraph ask was pinned by no test | fixed by Sol: a literal assertion |
| F8 (P2) | three early `len1a` files record a prompt hash that is not their band's | not repaired, explained: the cause is in the investigation § How. The prose and the tallies are unaffected |
| F9 (P3) | "no effect" said more than the sentence trial showed | fixed by Sol: "did not establish an overall preference benefit" |
| F10 (P3) | the eval's header said `len2` shipped, and other small contradictions | fixed by Sol |

**The arms**, under `evals/results/simple/high-none-<arm>/`:

| arm | what it is |
|---|---|
| `len0a`, `len0b` | the prompt before bands, twice |
| `len1a`, `len1b` | bands on both levels, no sentence. Its Fuller prompts are the ones that shipped; its Brief prompts did not ship |
| `len1whole` | one book write with the sentence in both levels (the first build) |
| `len2a`, `len2b` | the long article and the book, Brief as before, Fuller with the sentence. Not shipped |

- **Two control writes of the long article** (and of *Dodo*) were made with the long bands
  switched off by a one-line edit, not on the earlier commit; the standard band's prompt is the
  old prompt byte for byte. The saved files do not verify the old answer budget or limits.
- A paid run was lost: one unreadable article in a batch of four crashed the probe before the
  other three were written to disk.
- $6.96 of model calls across the 28 recorded writes, and the lost run on top.

### A slightly longer Brief (2026-10-05)

Greg, 2026-10-05, answering [Q-brief-for-a-book]:

> maybe Brief could be ever so slightly longer but not much

**Built: Brief is asked for about 100 words and never more than 150, where it was about 80 and
130, for every piece. The prompt version is `simple-prompt/10`.** One table changed,
`BRIEF_LENGTH` in `src/simple-summary.ts`; Fuller's prompts are the same bytes in every band,
and Brief's stored limit (240 words) did not move. As with `/9`, every stored summary becomes
*outdated*, silently, and none is rewritten for it.

| | asked for | written, mean (range) |
|---|---|---|
| before | about 80, never more than 130 | 97 words (88 to 113), eleven writes |
| measured and left | about 90, never more than 140 | 103 words (90 to 141), twelve writes |
| **shipped** | about 100, never more than 150 | 110 words (91 to 137), twelve writes |

- **What the judge said:** it preferred the 100 to the old Brief in
  six pairs of eleven and the old in four, and the 90 in three against eight. Two writes of the
  old prompt, the control, split four to one. That control shows variation between writes;
  it does not establish that 100 is no worse or that 90 is worse.
- **The "not padded" bar has not been established.** The judge called the 100
  the padded side in five pairs and the old one in two; it called one of two old writes padded
  in two control pairs of five. This is adverse evidence for 100, not proof of harmless variation.
- **Every piece, not the long ones alone.** For the book the judge preferred the old Brief in
  all four pairs (two at each ask), as in both of round one's. The pieces under 15,000 words
  leaned to the 100, five to two. These small subgroups do not establish a per-band policy;
  they also do not establish that increasing Brief for every piece is harmless.
- **The simpler option passed over** was to leave Brief alone, which is what the measurement
  alone would support. Choosing 100 for every piece is a product judgment in response to the
  request for slightly longer; the measurement does not show that it costs nothing a judge
  can see. Treating the 90 result as noise cannot also justify ruling that arm out as worse.
- **The 90 arm** and the tallies are in
  [261005a § A slightly longer Brief](../investigations/261005a-summary-length-bands-measured.md#a-slightly-longer-brief-round-three).
  The arms are `high-none-brief90a|b` and `high-none-brief100a|b`; the pairs, key, judge's
  instructions and answers are `*-brief*` in `evals/results/simple/length-bands-261005b/`.
- **Cost**: about $4.50 for 24 writes (four unpriced by the provider, estimated from their
  twins), and no judge cost beyond a subagent.
- **Tests**: the pinned Brief hash and version in `tests/simple-two-levels.test.ts`, the ask in
  `tests/simple-length-bands.test.ts` and `tests/simple-summary.test.ts`.

**The review** (GPT Sol, write-capable, 2026-10-05), in two passes because the first could run
nothing: [the prompt](261005b-brief-slightly-longer-review-prompt.md) and
[its answer](261005b-brief-slightly-longer-review-sol.md), **do not ship**;
[the second prompt](261005b-brief-slightly-longer-review-2-prompt.md) and
[its answer](261005b-brief-slightly-longer-review-2-sol.md), **sound after fixes** on the code
and the evidence.

| ID | Finding | Disposition |
|---|---|---|
| F11 (P1) | the "not padded" bar is not established: the 100 was called padded in five pairs, the old in two, and a lopsided control does not make that chance | taken, fixed by Sol: the three docs and the source comment no longer say it is met |
| F12 (P2) | 3 to 8 was called noise and then used to rule the 90 out | taken, fixed by Sol: both tallies are described, and 100 over 90 is called a product judgment |
| F13 (P2) | a longer Brief for every piece is not supported: the book favoured the old one in four of four | the wording taken, fixed by Sol. **Its recommendation, to leave Brief at 80 and 130, is not taken**: Greg asked for slightly longer. It is reported to him and to the Overseer as the reviewer's dissent, and going back is two numbers in `BRIEF_LENGTH` |
| F14 (P3) | summaries.md still called `/9` the version | fixed by Sol |

The second pass checked every number in the docs against the result files, that all twelve
`brief100` files were written with the prompts now in the tree (and that the twelve `brief90`
ones were not), that Fuller's bytes are unchanged in every band, the judge's instructions for a
lean, five verdicts by hand, and that the seed replays to 6 and 16, then 11 and 11.

**It was blocked first.** At about 17:10 the dev OpenRouter key answered `limit: 300`,
`limit_remaining: 0`, so no write could be made and an unmeasured prompt change was not shipped.
Greg raised the limit to 400 and the measurement ran that evening. What the session wrote down
while blocked, from the files already here:

- **Today's Brief is not 80 words.** Asked for about 80 and never more than 130, the eleven
  `len0a|len0b` writes came back at 88 to 113 words, about 97 on average
  ([261005a § Length](../investigations/261005a-summary-length-bands-measured.md#length)). So
  "about 80 to about 100" describes the ask, and the words on the page are already near 100.
- **The model runs over the ask at every size tried.** Asked for 60 it wrote 71 to 94; for 110
  (the long article) 139 and 112; for 140 (the book) 159 and 145, and those two were the ones
  judged padded. So an ask of 100 would likely write about 115 to 125, which is close to the
  long band's banded Brief that the judge did not prefer. (That guess was high: measured, it
  wrote 110.)
- **So the arms worth paying for are small**: an ask of about 90 and one of about 100 (each with
  its "never more than" moved by the same amount), on the same six pieces, two writes each,
  against `len0a|len0b` as the before side and `len0a` against `len0b` as the control. Same
  judge setup as round one, with the two short essays in full so an omission can be checked.
  Judge every band, then read the long and book pairs apart: that is what answers "every piece
  or only the long ones".
- **What it would cost**: the probe writes both levels, so each write is a whole press. Round
  one's 28 writes were $6.96, and the book is most of it. One new arm over six pieces twice is
  about $3; two arms about $6, or about $3.50 if the second arm is run on the long article and
  the book alone.
- **To build when measured**: `BRIEF_LENGTH` in `src/simple-summary.ts` (or a per-band table like
  `FULLER_LENGTH` if only the long bands move), `SIMPLE_PROMPT_VERSION` to `/10`, the pinned
  Brief hash in `tests/simple-two-levels.test.ts` and the "Brief the same in every band"
  assertion in `tests/simple-length-bands.test.ts`. `SIMPLE_LIMITS.brief` (240 words) already
  clears it.
