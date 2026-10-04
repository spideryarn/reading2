# Quick search, lower floors: how often a passage is right, by the score it got

Up: [investigations.md](../project/investigations.md)

Plan: [261004k](../plans/261004k-quick-search-lower-floors-so-more-shows-up.md). This follows
[261003c](261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md) and
[261003f](261003f-quick-search-category-words-score-under-the-floor.md), and reads the scores both
saved. The feature is in
[search.md § Quick search](../project/search.md#quick-search-a-meaning-search-in-about-a-second);
the code is `src/quick-search.ts`.

## What was asked

> for the Quick search, perhaps a more permissive threshold, so that more shows up
>
> — Greg, 2026-10-04

Quick search asks a small model (Jev) one yes/no question per paragraph and gets a probability for
each. Until today it showed paragraphs scoring 0.7 or more (the *floor*), best first, at most 20;
and when none reached 0.7, the best 8 at 0.5 or more (the *fallback floor*).

## The short answer

- **Floor 0.7 → 0.65. Fallback floor 0.5 → 0.4.** Cap unchanged at 8.
- **Why 0.65.** Counted by the score a passage got, on searches that already work: 86% of passages
  at 0.7 or more are right, 62% of those from 0.65 to 0.7, 38% from 0.6 to 0.65, 13% from 0.5 to
  0.55. 0.65 is the last band where a passage is more likely right than wrong, and that holds on
  all three kinds of query measured.
- **Why 0.4.** On bare-word searches that find nothing at the floor, passages from 0.4 to 0.5 are
  right as often (52%) as those from 0.5 to 0.55 (54%), which the fallback already showed. Below
  0.4 it is 47%, and at 0.3 three more searches for a topic the article does not cover start
  showing a wrong passage.
- **What a reader sees more of.** A search that already worked: about 11% more passages (6.2 to
  6.9 a search). A question or a request: 38% more (7.5 to 10.4). A bare word: 33% more (5.3 to
  7.1), and 107 of 111 such searches show something, against 99.
- **How much more noise.** On searches that already work, 84% right against 86%. A fallback list
  is 54% right against 61%, and its top result is right on 22 of 38 lists against 24. The one
  absent topic that already showed wrong passages ("human memory", 1 to 4 of them) now shows 8.
  No absent or near-miss topic that showed nothing starts showing something.
- **One thing gets worse: 6 of 111 bare-word searches show fewer passages than before.** A search
  whose best paragraph scores 0.65 to 0.7 used to get the fallback's eight; now one or two clear
  the floor and that is the whole list. "Results" (capital R) on Greg's paper goes from 8, 6, 8 to
  1, 8, 2 over three runs. The same cliff was at 0.7 before; it moved, it did not grow (three of
  89 queries cross it between runs, before and after). Removing it needs a different rule, below.
- **Precision is measured on three articles, not six.** The text of the other three (Greg's paper
  among them) is in production and not on this machine, so their new passages are unjudged. Sizes
  and counts are all six.
- **Spend: $0.** No Jev call was made: a score does not depend on the floor, so the saved scores
  were replayed. The judging was done by subagents inside the session.

## What was measured

Run on 2026-10-04 on the Hetzner box. Scripts are saved as `.txt` beside the results in
[evals/results/quick-search-lower-floors-2026-10-04/](../../evals/results/quick-search-lower-floors-2026-10-04/);
to re-run, copy them into a gitignored `data/qeval/` as `.mjs` and run from the repo root
(`replay-floors`, then `pool3`, the judges, `analyse3`, `replay-floors` again, `chosen`, `shapes`).
No article text is in the results: ids, scores, verdicts.

**The scores**, all from the shipped wording, three runs a query:

| group | queries | searches | from | what |
|---|---|---|---|---|
| working | 44 | 132 | 261003c | phrases, questions, and topics the article mentions |
| bare | 37 | 111 | 261003f | one or two words naming a kind of passage or a field, and their case and number variants |
| request | 8 | 24 | 261003f | the same intents typed as a question |
| absent | 31 | 93 | both | topics the article does not cover: 6 from 261003c, 5 and 20 near-misses from 261003f |

**The rule replayed**: keep what scores M or more, best 20; if nothing does, keep what scores F or
more, best 8. M over 0.7, 0.65, 0.6, 0.55, 0.5; F over 0.5, 0.45, 0.4, 0.35, 0.3.

**Judging.** The earlier labels (a thorough search's hits, and two blind judges) cover what the old
floors showed. For everything a lower floor could newly show on the three fixture articles, a third
blind judge: 254 unjudged (query, paragraph) pairs, 86 already-judged ones to measure agreement, and
97 decoys that never scored above 0.3. Five Opus subagents, one file each, shown the query, each
paragraph with its section heading, no score, article order, cut at 1,500 characters, asked *would a
reader who typed this be glad to be shown this paragraph?* and told to choose no when torn. This is
261003f's second judge's set-up.

| | |
|---|---|
| already-judged pairs shown again | 86 |
| agree with the earlier label | 70 (81%) |
| earlier yes, now no / earlier no, now yes | 8 / 8 |
| decoys marked right | 0 of 97 |

The disagreements are even, so the new judge is neither stricter nor looser than the old labels.

## Results

### Right, by score band (`summary3.json`; three fixtures, every pair judged)

Each (search, passage) counted once. "Any run" is what a floor of that band would add to a search.

| score | working | request | bare |
|---|---|---|---|
| 0.7 or more | 473 of 547, **86%** | 65 of 110, 59% | 77 of 130, 59% |
| 0.65 to 0.7 | 44 of 71, **62%** | 28 of 50, 56% | 24 of 44, 55% |
| 0.6 to 0.65 | 25 of 66, **38%** | 9 of 44, 20% | 34 of 56, 61% |
| 0.55 to 0.6 | 18 of 66, 27% | 3 of 29, 10% | 43 of 92, 47% |
| 0.5 to 0.55 | 9 of 69, 13% | 7 of 22, 32% | 75 of 161, 47% |

On working and request searches the drop is between 0.65 and 0.6. Bare words fall off more slowly,
which is why they get the fallback and the others do not.

The fallback's own bands: bare searches with nothing at 0.7, their best 8.

| score | right |
|---|---|
| 0.65 to 0.7 | 7 of 8, 88% |
| 0.6 to 0.65 | 18 of 23, 78% |
| 0.55 to 0.6 | 19 of 32, 59% |
| 0.5 to 0.55 | 40 of 74, 54% |
| 0.45 to 0.5 | 26 of 61, 43% |
| 0.4 to 0.45 | 29 of 45, 64% |
| 0.35 to 0.4 | 26 of 55, 47% |

0.45 to 0.5 and 0.4 to 0.45 are noisy either side of a half; together, 55 of 106, 52%.

### Each floor, all six articles (`replay-floors.json`)

Passages a search, and searches showing something.

| floor | fallback | working | request | bare | bare showing something | absent showing something (passages) |
|---|---|---|---|---|---|---|
| 0.7 | 0.5 (before) | 6.21 | 7.54 | 5.33 | 99 of 111 | 4 of 93 (9) |
| 0.7 | 0.4 | 6.21 | 7.54 | 6.64 | 107 | 4 (25) |
| **0.65** | **0.4** | **6.89** | **10.42** | **7.09** | **107** | **4 (25)** |
| 0.65 | 0.35 | 6.89 | 10.42 | 7.69 | 109 | 4 (25) |
| 0.65 | 0.3 | 6.91 | 10.42 | 7.90 | 110 | 7 (28) |
| 0.6 | 0.4 | 7.45 | 13.04 | 7.51 | 107 | 4 (18) |
| 0.5 | 0.4 | 8.48 | 15.63 | 8.96 | 107 | 4 (9) |

The same rows on the three fixtures, where everything shown is judged (`replay-floors-fixtures.json`):

| floor | fallback | working right | request right | bare right | bare lists with nothing right |
|---|---|---|---|---|---|
| 0.7 | 0.5 (before) | 473 of 547, 86% | 65 of 110, 59% | 161 of 267, 60% | 14 |
| **0.65** | **0.4** | **517 of 618, 84%** | **93 of 160, 58%** | **212 of 378, 56%** | **11** |
| 0.6 | 0.4 | 542 of 684, 79% | 102 of 204, 50% | 210 of 391, 54% | 10 |
| 0.5 | 0.4 | 569 of 819, 69% | 112 of 255, 44% | 255 of 494, 52% | 16 |

A floor of 0.6 adds 66 passages to working searches of which 41 are wrong, and takes requests to
half wrong. That is the line not crossed.

### The absent topics (`chosen.json`)

Four of 93 searches show something, before and after: "human memory" on Greg's paper on all three
runs, "government regulation" on one. "human memory" showed 4, 1 and 3 wrong passages and now shows
8, 8 and 8. Nothing else changes until the fallback floor reaches 0.3, where three more searches
show a wrong passage.

### The cliff (`shapes.json`)

The fallback is read only when nothing clears the floor. So one passage at 0.67 turns a list of
eight into a list of one. Against today's lists, on the 111 bare searches: 81 are longer, 6 are
shorter, and 38 passages shown today are no longer shown.

| typed | article | before, three runs | after |
|---|---|---|---|
| Results | Greg's paper | 8, 6, 8 | 1, 8, 2 |
| definitions | Constitution | 8, 8, 1 | 1, 1, 3 |
| methods | OpenAI | 4, 8, 2 | 8, 2, 8 |
| Methods | OpenAI | 8, 8, 1 | 8, 3, 5 |

Rule shapes that would remove it, measured and **not adopted**:

| rule | bare: shorter than before | passages a bare search | working right (fixtures) | unjudged |
|---|---|---|---|---|
| **0.65, nothing → best 8 at 0.4 (chosen)** | 6 | 7.09 | 84% | 0 |
| 0.7, nothing → best 8 at 0.4 | 0 | 6.64 | 86% | 0 |
| 0.65, fewer than 3 → best 8 at 0.4 | 1 | 7.63 | 79% | 44 |
| 0.65, fewer than 3 → best 8 at 0.5 | 1 | 6.27 | 80% | 0 |
| 0.65, fewer than 8 → best 8 at 0.4 | 0 | 8.23 | 74% | 60 |

- Leaving the floor at 0.7 never shortens a list, and gives a search that already works nothing.
- "Fewer than three" all but removes the cliff. It also pads a search that correctly found its one
  or two paragraphs with weaker ones (the reason 261003o passed it over), and costs five points on
  working searches. It is the better rule if a list of one where eight were available bothers a
  reader more than a padded list does. That is a product question, and it is in the plan.

### Does a weaker result read as weaker

By its number and its place, not by its mark. Hits are yielded best first and each row prints its
score; *Prioritised*, the default order, has a bar the reader can raise, and it starts at 30, under
both floors, so nothing new is hidden. A quick hit's paragraph bar and spine mark do not vary with
its score (a quick hit is drawn *bare* since 261003i). Nothing here changes how a hit is drawn.

## Limits

- **Three articles for precision.** The 669 unjudged pairs on the other three are sizes only.
  Greg's own paper is one of them.
- The bare, variant and request queries were written by a person with a hypothesis (261003f).
- One new judge, one pass, Opus, the same family as the earlier judges. 81% agreement with the
  earlier labels on 86 pairs.
- "More likely right than wrong" was chosen as the line after the bands were read, not before.
- Request verdicts are their base query's: "where does it give examples?" is judged as "examples".
- The scores are yesterday's. Nothing was re-run against Jev today.
