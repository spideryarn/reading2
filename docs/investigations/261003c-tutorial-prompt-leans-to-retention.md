# Tutorial's prompt, weighted towards the author: a before and after

Up: [investigations.md](../project/investigations.md) · the plan:
[261003i](../plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md)
· the mode: [remember-mode.md](../project/remember-mode.md)

**Question.** Greg asked (`spya-mtsf0y`, 2026-10-03) for Tutorial to focus *"more on retention of the
article rather than helping me explore my own thoughts."* Does the changed `TUTORIAL_SYSTEM` ask
about the author more and about the reader's own view less, without getting longer or citing worse?

**The blind labels say yes.** Tasks asking for the reader's own view fell from 19 of
60 turns to 6 of 60, against a control spread of one turn (9 and 10 in the two old-prompt samples).
None is now in a reader's
first two turns (6 before), and one follows another once (7 before). Uncited turns fell from five
to one, but one new-prompt reply exceeded 140 words and quotation-link faults remain.
The judge's input, the key and its labels are in the tree, so the totals below can be recounted:
`evals/results/remember-tutorial.261003i-judge-items.md` (what it was shown), `…-judge-key.json`
(which arm, reader and turn each item is) and `…-judge-labels.json`. GPT Sol's code review asked for
them (CR-5); they had been left in a scratch directory.

## Method

[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).

- **Production's own function**: `converse` with `kind: "tutorial"`, through
  [`evals/remember-tutorial.ts`](../../evals/remember-tutorial.ts). Sonnet 5, our tools off.
- **Two articles, six scripted readers, five turns each.** The Noema fixture
  (`data/noema-mythology-of-conscious-ai`): `notRead`, `remembers`, `expert`, and a new `richRecall`.
  The Entropy article Greg was reading (Levin, *Self-Improvising Memory*; 77 blocks, copied
  read-only from production into a scratch directory, not into this repo): `richRecall`, a close
  paraphrase of Greg's own three turns plus two more, and `terseGoal`, a short first message that
  names a goal. Run it with `--readers=entropy` and a directory holding that article's `blocks.json`
  and `meta.json`.
- **Four arms per article**: the old prompt twice (the control) and the new prompt twice. The old
  prompt is `src/converse.ts` at `428054781`, prompt hash `71e02face0b0`; the new one is hash
  `bcbae5f3f60a`. Each result file prints its hash. 120 turns in all, about $2.
- **A blind judge.** The closing paragraph of each of the 120 turns was put in one file in an order
  set by a hash of its text, with the arm hidden and the key kept apart. A fresh Sonnet subagent that
  read only that file labelled each: **A** about what the author says, **B** the reader's own view,
  **C** a prediction for somebody who has not read it, **D** a comprehension check or no question.
  No arm clustered at either end of the file (mean positions 50 to 71 of 120).

## What the labels say

| arm | A: the author | B: own view | C | D |
|---|---|---|---|---|
| Noema, old, sample 1 | 9 | 7 | 1 | 3 |
| Noema, old, sample 2 | 7 | 8 | 1 | 4 |
| Noema, new, sample 1 | 14 | 3 | 1 | 2 |
| Noema, new, sample 2 | 15 | 1 | 1 | 3 |
| Entropy, old, sample 1 | 7 | 2 | 0 | 1 |
| Entropy, old, sample 2 | 6 | 2 | 0 | 2 |
| Entropy, new, sample 1 | 8 | 1 | 0 | 1 |
| Entropy, new, sample 2 | 8 | 1 | 0 | 1 |
| **old, all** | **29** | **19** | 2 | 10 |
| **new, all** | **45** | **6** | 2 | 7 |

- **Own view in a reader's first two turns:** 6 before, 0 after.
- **Own view straight after own view:** 7 before, 1 after (Noema's `expert`, turns 3 and 4, in one
  sample).
- **Where the old prompt did it most:** the `expert` (3 and 4 of 5 turns) and the reader who had not
  read it (3 and 2 of 5). The new prompt's remaining six are one each for four conversations and two
  for that one `expert` run. That run breaches the prompt's ban on consecutive own-view tasks.
- The judge named ten items it found hard to call: four in new-prompt runs that it labelled A, three
  in old-prompt runs that it labelled B, and three others. Flipping every one of those seven against
  the result gives 16 before and 10 after — still a wider gap than the control's.

## Reading the turns

The conversations show the intended shift. On Greg's own script, after he speculates and asks for a
web search, the old prompt discussed critiques and closed with *"Does collapsing that line strike you as
solving the puzzle, or dodging it?"* The new prompt also discussed critiques, and closed with *"what would
count as evidence that a memory is doing work, rather than just being shaped by whatever stores
it?"* — closer to the piece, which calls this a hypothesis to be investigated, though it is one of
the judge's hard calls. **The pointer to Chat is not reliable**: it appeared after the search request in both
new-prompt Noema runs (*"For going deeper into that debate, Chat is the better place."*) and in
neither Entropy run. `terseGoal` was taken straight to the passage on polycomputing in all four
arms, old and new, and never started from zero or asked whether they had read it. The opening
prediction for `notRead` survives (label C, once per run).

## The cheap screens

Printed in each result file; none of them is the measure.

| | old (60 turns) | new (60 turns) |
|---|---|---|
| over the 140-word ceiling | 0 | 1 |
| turns citing no block | 5 | 1 |
| quotations of the article | 80 | 99 |
| … with no id before the sentence ends | 6 | 9 |
| … with the id later in the sentence, not straight after | 8 | 9 |
| … with an id that names another block | 1 | 8 |
| quoted with an id, but not found as quoted | 8 | 4 |

**These are the original screen's counts, and they sum correctly from the eight files.** A review
subsequently fixed two gaps in `quoteCheck`: it dropped ellipsis pieces shorter than four characters
(even an invented "not"), and it missed a phrase when a closing quotation mark included a comma or
full stop. Those fixes do not rewrite these historical counts; rerunning the screen would be a new
measurement. Regression tests are in
[`tutorial-quote-screen.test.ts`](../../tests/tutorial-quote-screen.test.ts).

**The quotation screen also over-counts.** It treats
any quoted run of eight characters that occurs in some block as a quotation of the article, so a
scare-quoted term — "temptations", "life matters", "software", "polycomputing" — counts, and is then
flagged because the sentence's id is for a different passage or there is none. Every flagged item in
the new-prompt files was read (seventeen of them): all are single terms, a two- or three-word phrase,
or a section's title. That does not establish GPT Sol's gate (PR-2, no unlinked article quotation).
In Entropy's new sample 1, `richRecall` turn 2 repeats *"facilitates its own transformation,"* in
the closing question without an id in that sentence. This is a four-word phrase quoted from the
article earlier in the same answer; the terminal comma made the original screen miss it. A
four-word minimum would therefore not prove the gate either. The retention result should not be
read as a guarantee that every quoted phrase has its link, or that every quotation is faithful.

**The own-view pattern in the eval is noise** and is kept only as a flag: it marked 7 turns under the
old prompt and 7 under the new, where the blind labels found 19 and 6.

**One finding changed the build.** About one article quotation in ten has its id later in the same
sentence, not straight after the closing mark, under both prompts. The first design for painting the
quoted words on a click required the id straight after; it now takes every quotation in the chip's
sentence ([`src/web/citations.ts`](../../src/web/citations.ts) § `quotesBefore`).

## Limits

- Scripted readers do not react to the tutor, so a conversation can drift from what a person would
  have said next. The scripts are the same in every arm.
- Two samples per arm. The two old-prompt samples agree closely (9 and 10 own-view turns), but that
  is two samples.
- One judge, one model family. Its labels were not checked by a second.
- The first pass at this, earlier the same day, ran generic readers on both articles and was thrown
  away after the plan review (PR-3): a reader's script has to be about the article it is run on.

## Files

`evals/results/remember-tutorial.261003i-{noema,entropy}-{before,after}-{1,2}.md`.
