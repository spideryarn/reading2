# Recall's question link and hint: what two eval runs showed

Up: [investigations.md](../project/investigations.md) · the plan:
[261004h](../plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md) · the mode:
[remember-mode.md](../project/remember-mode.md)

**Question.** Greg asked (`spya-fryxrf`, 2026-10-04) for Recall's questions to link the passage that
answers them, and for a Hint button after a question. `REMEMBER_SYSTEM` now asks for both. Does the
model put a block id on the question itself, write a hint the panel can hide, and write one that
helps without giving the answer — and did the rest of the reply get worse?

**Short answer.** The format holds: in both runs all 13 replies ended with a hint in the exact
spelling the panel hides, and none would have been shown in the open. The question carried its own
valid block id in 11 of 13 replies, then 12 of 13. The first prompt let three hints state the
answer; after one revision none plainly does. **Replies got longer, and the revision did not fix
that**: 6 of 13 ran over 120 words before the hint in both runs, against 3 of 13 before the change.

## Method

`npm run eval:remember -- data/noema-mythology-of-conscious-ai`: production's `converse` with
`kind: "remember"`, Sonnet 5, the same thirteen scripted readers as every earlier run
([`evals/remember-recall.ts`](../../evals/remember-recall.ts)). One sample of each reader per run,
so a difference of one or two replies is inside what a re-run would move. The counts come from
[`evals/remember-recall-checks.ts`](../../evals/remember-recall-checks.ts), which splits each reply
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
| a hint that states the answer (my reading) | | 3 | 0 |
| over 120 words before the hint | 3 | 6 | 6 |
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

**Run 2.** The hints point and stop: "It's a kind of lab-grown tissue, not a digital system at
all", "He compares it to the odds of a real storm forming inside a weather office's computers",
"there's an example about neurons firing spikes to clear waste products". The one question without
an id is `disagreement`, where the model asked the reader's own view rather than what the piece
says, and its hint was a second question — the one hint that breaks its rules outright. Three hints
carry no id of their own though they describe the article.

## What is still wrong

- **Length.** The six long replies are the ones that tell before they ask (`lost`, `dontRemember`,
  `justTellMe`, `ambiguous`, `disagreement`, `nudgeFailed`), at 121 to 168 words. The prompt allows
  a direct answer to run over, and `lost` was 173 before any of this, but three more are over than
  were. One sample each, so it may be noise; it is the first thing to check after a week of use.
- **`justTellMe` and `nudgeFailed` still end on a question** after giving the answer. That predates
  this work and is allowed ("a smaller and easier nudge on a different point"), but with a hint
  under it the reply now reads as more of a quiz than it did.
- **`unclear` is still corrected rather than asked what it meant**, as on 2026-10-02.
- **"That tracks"** opens two replies in run 2 despite its ban; "actually" is mostly inside
  quotations of the article.
- **Nothing here tests the pressed hint**: whether a reader who opens one then remembers. That needs
  a reader.
