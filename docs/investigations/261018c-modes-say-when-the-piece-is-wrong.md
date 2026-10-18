# Modes say when the piece is wrong: does `widerWorld` work, and what does it cost?

Up: [investigations.md](../project/investigations.md). The measurement behind
[261018h](../plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md), for Greg's
`spya-h5mteu`. The harness is [`evals/wider-world.ts`](../../evals/wider-world.ts); the arms,
blind pairs, keys and judge verdicts are in `evals/wider-world/out/`.

## The setup

- **What it runs.** Production's `converse` (Chat, Recall, Tutorial) and `markAnswerStream`
  (Quiz), with our tools off. The article is the committed Seth essay. The model is Sonnet 5.5.
- **Nineteen cases.**
  - The piece dates the Antikythera mechanism to "around 2,000 BCE"; it is usually dated to about
    150–100 BCE. That case runs on all four surfaces.
  - The neural-replacement argument, which Seth says "fails at its first hurdle", is contested.
  - Biological naturalism, which the piece itself calls a minority view.
  - Two plain passages, McCulloch and Pitts, and Nagel, which want no outside note.
  - A reader who has the piece's position backwards.
- **Arms.** `before1` and `before2` ran on 578e00716, before any prompt change. `after3` and
  `after4` ran on the two final wordings before the code review, and `after5` on the shipped text after it (12e211203). `after` and `after2` were earlier drafts, kept as runs.
- **The judge.** A fresh Opus subagent read only the pairs file, with an arm-neutral `facts` line
  for each case. It answered four questions:
  - **Q1 world**: does a reply tell the reader something true and wanted about the world?
  - **Q2 provenance**: is the article kept apart from memory and from the web?
  - **Q3 against the reader**: is outside knowledge used against the reader?
  - **Q4 mode damage**: brevity, turn shape, no grading.
- **Shuffling.** `blindCoin` shuffled the sides, and each key was balanced 9/10.

## What it showed

| comparison | Q1 world | Q2 provenance | Q3 against the reader | Q4 mode shape |
|---|---|---|---|---|
| `before1` vs `before2` (control) | 2–0, 17 same | 2–0, 17 same | 0 of 19 | 2–1, 16 same |
| `before1` vs `after3` | **after 5–0**, 14 same | after 2–0 | 0 of 19 | **before 6–0** |
| `before1` vs `after4` | **after 5–0**, 14 same | 1–1 | 0 of 19 | before 4–1 |
| `before1` vs `after5` (shipped, after the code review) | **after 5–0**, 14 same | **after 5–0** | 0 of 19 | before 5–1 |

**The world.** Before the change, only Chat ever flagged the wrong date: once from memory and once
with linked web sources. Recall, Tutorial and Quiz said nothing, and one Quiz mark worked out
"roughly four thousand years" from the piece's date. After the change, all four surfaces flag it
with the origin labelled. Chat searched and linked web sources; the other three labelled the point
as outside the piece and from memory. Their outside notes ranged from one to three sentences, despite
the prompt's target of one or two. The only other case the judge counted was Chat noting that the
neural-replacement argument is disputed. No reply on a plain passage gained an outside note, and
no outside sentence carried a block id. No reply used the outside view against the reader, and the
judge flagged no false fact in either arm.

**The cost.** The first final wording (`after3`) made the plain cases worse. On replies with
nothing to flag, it primed sentences about the reader's answer: "That is the claim you made",
"does not change your answer", "Nothing in the article conflicts with what you said". Those lost
6–0 on mode shape, against a control spread of 2–1. The section's last paragraph talked about the
reader's reading four times. It was rewritten to say the note is about the piece, not about them
(52fbdee6f). That brought mode shape to 4–1. One of the four losses is a judge false positive: it
objects to a Recall nudge with two directions joined by *"or"*, which the prompt explicitly allows.
The other three are real leaks against the prompts' own rules: two Quiz replies judge the reader's
answer, and Tutorial opens with *"You've described Chalmers's argument correctly"*. The control also
split on three cases, so this small sample cannot separate those remaining leaks confidently from
ordinary output variation.

**After the code review** (`after5`, the shipped text), provenance became a clear win (5–0)
rather than a tie. Mode shape went 5–1 against. Two of those five are the cost of the feature
itself: the Antikythera note makes the Recall and Tutorial turns longer, and in Tutorial it reads
as an abrupt line mid-lesson. One is the Quiz McCulloch case grading the reader's answer again
("doesn't change your answer"). The same leak appeared in `after3`, but not in `after4`. The other
two are oddities in one run each. The Quiz eval's own marking cases show no more grading phrases
than before the change (`evals/results/261018h-quiz-marks-after-review.md`). That Quiz leak is the
thing to watch in real marks: `gradeWords` would not catch "doesn't change your answer".

**The earlier drafts, in brief.** The first draft told the model that a reader who repeated the
piece "has read it right". Recall then opened "You've got the article right", which is a banned
phrase, and later "so you've reported it faithfully". Three probes of the next wording gave two
clean replies out of three.

## The modes' own evals

Run before and after, on the final wording or the one before it:
- **Recall** (`evals/learn-recall.ts`, 13 readers). It added no outside note to any of them.
  Banned phrases went 2, 2, then 3, and unlinked closing questions 1, 3, then 2, which is inside
  that eval's known noise.
- **Tutorial** (`evals/learn-tutorial.ts`, 20 turns). No outside notes. Over 140 words went 0 to 0,
  and more than one question mark went 2 to 0.
- **Quiz marking** (`evals/quiz.ts --marks-only`). Grade words were 0 to 0.

The results are in `evals/results/261018h-*`.

## What this does not show

- **One article and one model.** The trigger has been seen to fire on one checkable error and one
  live dispute. It has not been measured on an article where the error is subtler than a date.
- **Only `after5` is on the shipped text.** The probes and `after2`–`after4` ran on earlier wordings. The `after5` judge was also told outright that Recall's "or" nudge and Quiz's brief "nothing missing" statement are allowed, so its Q4 is not strictly comparable with the earlier judges'.
- **Search behaviour was not measured.** With our tools off, Recall's and Tutorial's searches are
  the provider's, and the eval cannot see their queries. The privacy rule (never the reader's words
  in a query) is pinned by `tests/wider-world.test.ts`, not measured.
- **Spend.** About $3 across all arms, judges excluded.
