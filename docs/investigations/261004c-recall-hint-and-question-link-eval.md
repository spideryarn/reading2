# Recall's question link and hint: what two eval runs showed

Up: [investigations.md](../project/investigations.md) · the plan:
[261004h](../plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md) · the mode:
[remember-mode.md](../project/learn-mode.md)

**Question.** Greg asked (`spya-fryxrf`, 2026-10-04) for Recall's questions to link the passage that
answers them, and for a Hint button after a question. `REMEMBER_SYSTEM` now asks for both. Does the
model put a block id on the question itself, write a hint the panel can hide, and write one that
helps without giving the answer — and did the rest of the reply get worse?

**Short answer.** The format holds: in both runs all 13 replies ended with a hint in the exact
spelling the panel hides, and none would have been shown in the open. The question carried its own
valid block id in 11 of 13 replies, then 12 of 13. The first prompt let three hints state the
answer; the revision improved that but did not eliminate it: at least two run-2 hints can still be
read out as answers to their questions. **The long tail got worse than before the feature, but the
revision did improve overall length**: 6 of 13 ran over 120 words before the hint in both new runs,
against 3 of 13 before the change, while run 2 returned to about the before run's total and mean.

## Method

`npm run eval:remember -- data/noema-mythology-of-conscious-ai`: production's `converse` with
`kind: "remember"`, Sonnet 5, the same thirteen scripted readers as every earlier run
([`evals/remember-recall.ts`](../../evals/learn-recall.ts)). One sample of each reader per run,
so a difference of one or two replies is inside what a re-run would move. The counts come from
[`evals/remember-recall-checks.ts`](../../evals/learn-recall-checks.ts), which splits each reply
with the panel's own `splitHint`; the judgement on each hint is mine, from reading all thirteen
against their questions. No blind judge.

| | transcript | prompt |
|---|---|---|
| before | `evals/results/remember-recall.md` as committed at `8548c0d4a` | the one-voice prompt of 2026-10-02 |
| run 1 | [`remember-recall.261004h-run-1.md`](../../evals/results/remember-recall.261004h-run-1.md) | as first built (commit `35ca72d7f`) |
| run 2 | [`remember-recall.261004h-run-2.md`](../../evals/results/remember-recall.261004h-run-2.md) | after the revision below |

## Numbers

| | before | run 1 | run 2 |
|---|---|---|---|
| replies ending on a question | 13 | 13 | 13 |
| the question carries its own valid block id | not counted | 11 | 12 |
| a hint, in the spelling the panel hides | none asked for | 13 | 13 |
| a hint over 25 words | | 0 | 0 |
| a hint that is itself a question | | 0 | 1 |
| a hint with no block id of its own | | not counted | 3 |
| a hint that plainly states the answer (my reading) | | 3 | at least 2 |
| over 120 words before the hint | 3 | 6 | 6 |
| body words, total | 1,401 | 1,547 | 1,393 |
| body words, mean | 108 | 119 | 107 |
| body words, median | 106 | 116 | 88 |
| a banned phrase | 8 | 7 | 7 |
| citing no block at all | 0 | 0 | 0 |

## What reading them showed

**Run 1.** The two questions without an id of their own (`garbled`, `partial`) had the id in the
sentence just before the question, so the reader still had somewhere to look. Three hints handed
over the answer: `nudgeFailed`'s was the article's answering sentence in quotation marks,
`justTellMe`'s named the term the question asked for, and `garbled`'s said what the thought
experiment claims, which was the question.

**The revision.** Three sentences: an id in the sentence before the question is not the question's;
the hint is never the article's answering sentence or the word asked for, and one that could be
read out as an answer is cut back; and the hint gives the reply no extra room.

**Run 2.** Several hints point and stop, such as "It's a kind of lab-grown tissue, not a digital
system at all" and "there's an example about neurons firing spikes to clear waste products". But
zero answer-giving hints was too generous under the prompt's own test — "If the hint could be read
out as an answer to your question, it says too much." `partial` asks where Seth takes the idea when
he applies it to mind uploading; its hint answers that he compares it to the odds of a storm forming
inside a weather office's computers. `justTellMe` asks what is at stake for mind uploading; its hint
answers that the reader's odds of surviving upload are like a hailstorm forming in those computers.
Those two plainly answer, and several other hints sit close enough to the line that the exact count
should not carry much weight. The one question without an id is `disagreement`, where the model
asked the reader's own view rather than what the piece says, and its hint was a second question.
Three hints carry no id of their own though they describe the article.

## What is still wrong

- **Length.** Six replies are over the ceiling in each new run. Five of the six are the same replies
  in each run (`lost`, `dontRemember`, `justTellMe`, `ambiguous`, `disagreement`); `weak` is the
  sixth in run 1 and `nudgeFailed` in run 2. That is three more over-length replies than before the
  feature. Run 2 is shorter overall than run 1: 1,547 body words (mean 119, median 116) fell to
  1,393 (mean 107, median 88), beside
  1,401 before the feature (mean 108, median 106). The revision improved the distribution without
  moving the over-120 count. One sample each, so either difference may be noise; length is the first
  thing to check after a week of use.
- **`justTellMe` and `nudgeFailed` still end on a question** after giving the answer. That predates
  this work and is allowed ("a smaller and easier nudge on a different point"), but with a hint
  under it the reply now reads as more of a quiz than it did.
- **`unclear` is still corrected rather than asked what it meant**, as on 2026-10-02.
- **"That tracks"** opens two replies in run 2 despite its ban; "actually" is mostly inside
  quotations of the article.
- **Nothing here tests the pressed hint**: whether a reader who opens one then remembers. That needs
  a reader.
