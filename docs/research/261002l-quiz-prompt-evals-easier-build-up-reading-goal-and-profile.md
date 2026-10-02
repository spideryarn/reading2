# Quiz: four rounds of measuring the question-writing prompt

Written 2026-10-02 from plans dated 2026-09-05 to 2026-10-01; none had a research write-up. Plans:
[260905g](../plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md) (start easier),
[260930c](../plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md) (build up),
[260930j](../plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md) (reading goal),
[261001c](../plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md) (profile and goal, "adapt heavily").
All generation runs were production's own `generateQuiz` on `claude-sonnet-5`. Judges were fresh
subagents reading only a shuffled, arm-hidden file.

## The question, per round

1. **Easier start** (2026-09-05): after a reader said the questions were too hard, does leaning the
   prompt easier (`quiz/2` to `quiz/3`) put easy questions first?
2. **Build up** (2026-09-30): does a path prompt (`quiz/4` to `quiz/5`, with a "premise" field so each
   step leans on the last) make each question less effortful and build to the takeaways?
3. **Reading goal** (2026-09-30): does a stated purpose move which parts the quiz asks about?
4. **Profile and goal** (2026-10-01): can *About you* also move the quiz, and can the goal move it
   without dropping the piece's conclusion?

## Numbers

**1.** One generation run each, one article (*The Mythology of Conscious AI*). `evals/results/quiz.md`
(`quiz/2`, 2026-09-01) against `evals/results/quiz-easier-2026-09-05.md` (`quiz/3`): easy questions
4 to 6 of 12, and value 4-or-5 questions 5 of 11 to 9 of 12. The plan's own caveat: neither side is a
measurement. A first draft asking for only two hard questions was put back to three by a Sol review,
because validation drops would leave no margin.

**2.** Five articles, `evals/quiz-build-up.ts`, arms in `evals/results/quiz-build-up/`. Blind reads by
an Opus subagent, five pairs each:

| comparison | effort per question | builds up |
|---|---|---|
| `before` vs `before-2` (control) | 4-0-1 to one side | 3-1-1 |
| `before` vs `after` | `after` 5 of 5 | `after` 5 of 5 |

The control's own 4-0 means the count is weak; the judge called the old quizzes "a set of standalone
recall questions" and traced a build sequence through every new one. Mean reference-answer length fell
from about 48 to about 30 words; questions per quiz rose from 10-12 to 17-20. A recurring defect, premises
that restate something no question asked, was patched in `after-2` and `after-3`; on dense papers the
premise drifted from restating to scene-setting (about 15 of 19 on `after-2` by the blind judge, about
5 of 14 on `after-3` by the author's count, not blind-judged).

**3.** Article `entropy-24-00930-spya-pywwkq`, target part 7, six paid runs,
`evals/results/quiz-reading-goal/`. Share of questions mostly in part 7: none 10% and 5%, About-only 5%
and 7%, goal 47% and 42%. The predeclared bar was "more than half": missed. A blind Sonnet judge of
all 112 questions found 74% on-goal in both goal runs against 14-20% for the other arms.

**4.** 28 Sonnet runs in two rounds ($5 for the first twenty), four blind Sonnet judges agreeing on
89-100% of labels, bars checked by `evals/quiz-reading-goal-261001c-bars.ts`. Passed: no-profile
request unchanged; the goal moves the *kind* of question (`APPLY` 53-55% against 7-20% with no
profile; the old prompt already did this at 50-69%). Failed under both round-2 judges: *About you*
moves the pitch, moves the parts, or chooses within a goal (`FORMAL` share 57-62% against 60-64%);
goal strength fell narrowly short of 65% on-goal in 2 of 6 runs. Balance moved the right way: no
round-2 run dropped both conclusion and evidence, where 3 of 6 old runs did.

## Decisions

- Round 1: `quiz/3` kept. Round 2: `quiz/5` shipped as a path, with the dense-paper premise drift
  named as a known limitation rather than hidden. Round 3: the goal shipped; Sol's review put the claim at "most questions are about the goal for
  these two paths, on one article". Round 4: shipped to `dev` as a partial step.
- Round 4 was not claimed as the feature. Sol said not to ship as-is; Opus, asked to arbitrate,
  recommended shipping, because holding would keep the old rule that Greg had overruled:

> yes, Quiz should definitely adapt heavily based on User-profile and Why-are-you-reading
>
> — Greg, 2026-10-01 (as relayed by the Overseer, quoted in 261001c)

- The budget finding in round 2 mattered more than the blind read: one long paper spent 48,896 output
  tokens against a 54k ceiling. Raising the ceiling to 78k was refused in Sol's review because the call
  would outlive its 740 s job claim; the ceiling stays 54k and `STEP_BUDGET_MS.quiz` went from 150 s to 600 s.

## Dead ends

- A 64k thinking budget (above). A first prompt draft with no premise field (`after-1`, kept but
  not judged).
- Using the predeclared "part 7" proxy as the only goal measure: it undercounts on-goal questions
  that sit in neighbouring parts, hence the blind judge.
- Round 4's `BACKGROUND` label (could the electrophysiologist already answer this?): judges gave it for
  0-6 questions per run in any arm, so it could not see a 2-question change.

## Caveats

One article for rounds 3 and 4; five for round 2. Two runs per arm. Round 2 (build-up) had a judge
misread on pair 1, which was discarded. Round 4's round-2 wording was not measured after Sol's final
one-clause fix. Round 4's own next step offered to Greg: about 40 Sonnet runs, $10-15, on 2-3 articles
with readers who differ sharply, or accept *About you* as best effort.

## How to re-run

`evals/quiz-build-up.ts` (`report`, `pairs`), `evals/quiz-reading-goal.ts` (`blind`, `score`) with the
committed judge file `evals/quiz-reading-goal-judge.md`; `npm run eval:quiz -- --generate-only` for round 1.
The harness records which commit's `src/quiz.ts` wrote each run.

Up: [research.md](../project/research.md)
