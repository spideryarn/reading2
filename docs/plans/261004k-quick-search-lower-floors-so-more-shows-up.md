# Quick search: lower floors, so more shows up

Up: [plans.md](../project/plans.md)

> for the Quick search, perhaps a more permissive threshold, so that more shows up
>
> — Greg, 2026-10-04

Follows [261003o](261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md), and
answers the spirit of its Q1. The measurement is
[investigation 261004d](../investigations/261004d-quick-search-lower-floors-precision-by-score-band.md),
and every number here is from it.

## What changes

Quick search asks a small model for a probability per paragraph. Two named constants in
[`src/quick-search.ts`](../../src/quick-search.ts) decide what is shown:

| constant | what it is | before | after |
|---|---|---|---|
| `QUICK_FLOOR` | a paragraph at or above this is shown, best 20 | 0.7 | **0.65** |
| `QUICK_FALLBACK_FLOOR` | when nothing reaches the floor, the best 8 at or above this | 0.5 | **0.4** |

Nothing else: the same rule, the same cap, no change to how a hit is drawn.

## Why these two numbers

Chosen by counting how often a passage is right at each score, judged blind on three articles.

- **0.65**: from 0.65 to 0.7 a passage is right 62% of the time on a search that already works;
  from 0.6 to 0.65, 38%. The next step adds more wrong than right on working and request searches;
  bare queries remain 61% right in that lower band. This is an incremental criterion, not proof
  that 0.65 is the only defensible floor.
- **0.4**: on a bare word that finds nothing at the floor, 0.4 to 0.5 is right about as often
  (52%) as the 0.5 to 0.55 the fallback already showed (55%). In the 0.35–0.4 band it is 47%, and at 0.3
  topics the article does not cover start showing wrong passages.

## What a reader sees

- More: about 11% more passages on a search that already worked, 38% more on a question, 33% more
  on a bare word. 107 of 111 bare-word searches show something, against 99.
- More noise: 84% right against 86% on searches that already work. A fallback list is 55% right
  against 62%. "human memory" on a paper about a network forgetting shows 8 wrong passages
  against 1 to 4.
- **Fewer, on 6 of 111 bare-word searches** (see Q1).
- A weaker result still reads as weaker by its printed score and its place, and the *Prioritised*
  bar still lets a reader raise the cut. Its mark does not change with its score, as before.

## The simpler option passed over

Lowering only the fallback floor (0.7 and 0.4). It never shortens a list. It also gives nothing to
a search that already finds something, which is most searches, and the request was for more.

## Stages

One stage.

1. Red first in `tests/quick-search.test.ts`: the floor is 0.65 inclusive (0.65 kept, 0.6499
   dropped when another clears it); the fallback floor is 0.4 inclusive (0.4 kept, 0.3999 not);
   nothing reaching 0.4 gives nothing; the fallback floor is under the floor.
2. The two constants, with the measurement in their comments.
3. `docs/project/search.md` § Quick search.
4. Gates: this test file, `npm test`, `npm run typecheck`, lint on touched files.
5. GPT Sol code review, write-capable, with the investigation's conclusion in the candidate.

## Questions for Greg

**Q1. Should a search that finds one or two sure passages also show its best guesses?**

Background. There are two lists. The ordinary one is every paragraph the model is fairly sure of
(0.65 or more). The fallback is shown only when the ordinary list is empty: the best eight
guesses. So one sure paragraph switches the guesses off.

```
scores for a search:   0.67  0.61  0.58  0.55  0.52  0.50  0.47  0.44

today's rule           [0.67]                                          1 shown
                       (0.67 clears the floor, so no guesses)

if it scored 0.64      [0.64  0.61  0.58  0.55  0.52  0.50  0.47  0.44]  8 shown
                       (nothing clears the floor, so the best eight)
```

That is why 6 of 111 bare-word searches now show fewer than before: "Results" on your paper went
from 8, 6, 8 passages over three runs to 1, 8, 2.

- **A (built): leave it.** One rule, already there. A search that found its one right paragraph
  shows just that paragraph. The cost is the picture above.
- **B: when fewer than three clear the floor, show the best eight guesses as well.** The cliff
  all but goes (1 of 111 shorter). A bare word shows 7.6 passages against 7.1. The cost: a search
  that correctly found one or two paragraphs is padded with weaker ones, and searches that already
  work drop from 84% right to 79%. About an hour, and 44 passages it would show are not yet
  judged.

Pick B if a short list where more was available bothers you more than a padded one.

**Decided, A — as built.**

> ok, go with your recommendation. I don't completely follow. The quick searches seem much worse
> than the thorough searches, so I wonder if the best-of-all-worlds approach is to run a quick
> search immediately, and and also kick off a thorough search in the background that will finish a
> few seconds later.
>
> — Greg, 2026-10-04

The second half is a new piece of work, not an answer to Q1; it was dispatched as its own session
(`search-auto-thorough`).

**Still open from 261003o**: Q2 (should a fallback list say that it is one) and Q3 (a line saying
a question works better than a bare word). Lower floors make Q2 matter a little more, since a
fallback list is now about half right.

## Log

- 2026-10-04: measured by replaying the saved scores (no Jev call, $0) and a third blind judge on
  the three fixture articles. Constants changed red first.
- 2026-10-04: GPT Sol's code review
  ([prompt](261004k-quick-search-lower-floors-code-review-prompt.md),
  [answer](261004k-quick-search-lower-floors-code-review-sol.md)): **land**, no P0 or P1, and it
  would choose the same two numbers. It recomputed the headline numbers and they matched. Three
  P2, fixed by the reviewer: the replay broke ties in JSON order, not the article's (one capped
  list differed; fallback lists are 62% and 55% right, not 61% and 54%); re-running the pool
  script after judging emptied the pool; and "the last band more likely right than wrong" was
  stronger than the evidence, since bare words are still 61% right from 0.6 to 0.65. Three P3 in
  the wording, also fixed, including "the cliff did not grow", which the data does not show.
