# 261020c — One Recall prompt, measured against Recall's and Tutorial's evals

Up: [investigations.md](../project/investigations.md). For plan
[261020m](../plans/261020m-recall-and-tutorial-become-one-recall.md) (Greg's report `spya-gtzeqm`,
2026-10-19).

**What was asked.** Is one prompt, `LEARN_SYSTEM` with Tutorial's teaching folded in, at least as
good as Recall on Recall's thirteen single replies, and as good as Tutorial on Tutorial's four
scripted readers over five turns?

**Decided: ship run 3.** On Recall's cases it is close to the old Recall prompt, with slightly
fewer word-limit misses and hint-rule breaks. On the scripted readers it does what Tutorial did:
the reader who has not read the piece starts from zero and is never asked what they "remember".
It also adds Recall's hints, about where Tutorial had none.

## How

Sonnet 5.5 (`anthropic/claude-sonnet-5.5`, the standard tier), tools off, the Noema article
(`data/noema-mythology-of-conscious-ai`).

- `evals/learn-recall.ts`: 13 single replies, each a way Recall has gone wrong before.
- The multi-turn eval (then `evals/learn-tutorial.ts`, now `evals/learn-recall-turns.ts`): four
  scripted readers × five turns. The readers are *has not read it*, *remembers some*, *an expert
  with a goal* and *a rich account that drifts into its own views*. For this work it learned to
  run kind `learn`, to measure the body before the hint against Recall's 120, and to count hints,
  including a hint after a say-it-back as a defect.

Baselines were the shipped prompts, run the same day: Recall on its 13, and Tutorial on its 4×5.

## Results

| | Recall baseline | merged run 1 | run 2 | **run 3** |
|---|---|---|---|---|
| Recall's 13: over 120 words before the hint | 3 | 0 | — | **1** |
| closing question with no id of its own | 0 | 3 | 5 | **3** |
| closing question with no hint | 0 | 2 | 5 | **1** |
| hint breaking its rules | 2 | 2 | 1 | **0** |
| banned phrase (all *actually*, mostly inside a quotation) | 2 | — | — | **3** |

| | Tutorial baseline | run 1 | run 2 | **run 3** |
|---|---|---|---|---|
| 4×5 turns: over the ceiling | 0 (of 140) | 0 (of 120) | — | **1** (of 120) |
| more than one question mark | 0 | 2 | 0 | **0** |
| citing no block | 0 | 0 | 0 | **0** |
| quotation with no id in its sentence | 2 | 1 | 2 | **3** |
| quoted words not the article's | 1 | 0 | 2 | **1** |
| own-view turns (first two turns) | 0 (0) | 2 (1) | 2 (0) | **0 (0)** |
| turns with a hint | 0 | 16 | — | **16** |
| hint after a say-it-back | — | 0 | — | **0** |

Files: `evals/results/261020m-baseline-recall.md`, `261020m-baseline-tutorial.md`,
`261020m-merged-tutorial-1.md` … `-3.md`, `261020m-merged-recall-3.md` (the same as
`learn-recall.md`).

## What reading them showed

- **Run 1** asked the not-read reader *"Do you remember what the brain-as-meat-computer idea
  needs…"* in their fifth turn: a quiz on a text they had not read. It also met `dontRemember`
  (*"I read it last week"*, remembering nothing) with the not-read opening, *"what's your own
  hunch"*, and opened with a verdict, *"Your recollection is on the right track"*. So the prompt now
  separates *has not read it* from *read it and forgot*, never asks a not-read reader what they
  "remember", and lists that kind of opener as a verdict. GPT Sol's plan review (F2, F3) added
  three things at the same point. A question about a case the article does not discuss is
  reasoning, so it gets no hint. A cue names only where to look and what the passage is about.
  After a failed recall, the next question is a different one.
- **Run 2** overcorrected. Four of Recall's stuck readers (`lost`, `weak`, `dontRemember`,
  `nudgeFailed`) were told the missing piece and then asked to *"put that in your own words"*.
  For `nudgeFailed`, that meant repeating the answer it had just been given. A say-it-back is
  Tutorial's move for someone meeting the piece for the first time. For a reader who has read it,
  it gives up the act of recall, which is the point of the mode. So say-it-back is now reserved
  for the not-read reader, and a stuck reader who has read it gets a cue, a *why* or a *connect*.
- **Run 3**: the not-read reader is started from zero with a cited claim. They get a prediction
  first, then a *why*, then an apply about a case the article discusses. They get a concrete
  example when they say they don't follow. There are no "do you remember" questions. The
  `remembers`, `expert` and `richRecall` readers get Recall's cue-and-hint turns. None of the
  twenty turns asks for the reader's own view. Of the three closing questions with no id, two
  have the id in the sentence just before (`correct`, `nudgeFailed`), and the third is `unclear`'s
  clarification, which is right. The one closing question with no hint is `unclear`'s, also
  right.

Still imperfect: a quotation's id more often comes later in the sentence than straight after it
(23 against Tutorial's 10). The banned-phrase hits are the word *actually* inside the article's
own rainstorm sentence. And `richRecall`'s second turn ran to 127 words.
