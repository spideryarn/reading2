---
reports: spya-ha9wa3
ending: shipped
---
# Quiz questions shaped by why you are reading

SPIDERYARN-READING2-6Q, from Greg (admin, verified by account id), no article. The time in the file
name is roughly when this session received the report; it runs on a pool account and could not
read Sentry.

> If the reader has told us why they're reading this article (the "Why are you reading this?" prompt
> from spya-esua8w), the quiz questions should be shaped around that goal. For example, if I've said
> I want to understand their methods, most of the questions should be about the methods, not an even
> spread across the paper.
>
> Why: Cody Dong pointed out that when he reads with a particular goal, he retains the goal-related
> parts much better. Self-testing works best on what you actually came for. It also fits spya-jc2ub9
> (easier questions that build on one another towards the takeaways): the build-up should head
> towards the takeaways that matter for my goal.
>
> Keep it simple: one batch per article as now, written with the owner's goal when there is one,
> and the same as today when there isn't. Visitors don't see the quiz, so there's no need for a
> separate generic set. If we ever show the quiz to visitors, give them a generic batch then. If the
> reader changes their goal, the existing "Write them again" can pick up the new one; no automatic
> regeneration needed for v1.
>
> Depends on spya-esua8w landing first (somewhere to store the goal).

**Ending: Shipped** — on `dev`, not deployed. Resolve 6Q (the next feedback sweep does the Sentry
status write).

What we did:

- **Report 60 had landed**, and the goal lives where it said: the article's *Why you're reading this
  one*. The quiz job already carried it; the quiz simply ignored it. Now the prompt reads it. With a
  goal, the questions still build up as a path, but head for the takeaways that matter for it and
  spend most of their steps on the parts that bear on it. With none, the prompt the model sees is
  unchanged except for the conditional rules.
- **One batch per article, the owner's**, as you said. Changing the goal does not rewrite a quiz;
  *Write them again* picks up the new one. Visitors still never see a quiz.
- **Measured**, on the PID review paper, six paid runs. The goal was *"what makes PID hard to use on
  real data"*. A blind judge (the questions shuffled across runs, which run each came from hidden)
  called **74% of the questions on-goal in both goal runs**, against 15–20% with no goal. The
  simpler check I declared first, "more than half the questions draw on the *Practical
  Considerations* section", **missed** (47%, 42%), because a fair number of the on-goal questions
  draw on other sections. GPT Sol checked both numbers and agreed with the blind reading, but
  scoped it: two paths on one article, not yet a general result.

**One small deviation, yours to decide:** you said *"the same as today when there isn't [a goal]"*.
The job carries your *About you* box and the goal as one string, so a reader with an *About you*
and no goal now gets a quiz whose vocabulary may be pitched to them. The prompt keeps *About you*
from changing which parts are asked about, and the About-only runs stayed at the no-goal share
(14–20%). Making it literally the goal alone means carrying the goal on every job as a second
field. That is a few files of plumbing and not worth it unless you want it.

Deferred: a *Written for: …* line in the Quiz band, like Trajectory's *Reading for*; and a label
when the goal has changed since the questions were written.

Plan: [260930j](../plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md).

## Follow-up, 2026-10-01: About you as well

You answered the deviation above (relayed by the Overseer):

> yes, Quiz should definitely adapt heavily based on User-profile and Why-are-you-reading
>
> — Greg, 2026-10-01

**Ending: Shipped as a partial step** — on `dev` in `4e65a05c`, `94ab1df4` and `59787248` (merged
as `691b714a`), not deployed. The prompt now asks for what you
said. The measurement shows the goal half working and the balance improved. It does **not yet show
*About you* moving the quiz heavily.**

What changed:

- **Both halves now steer the quiz.** They decide which parts it asks about, what kind of question
  it sets (someone applying the piece gets more *how is it done, where does it break*), and how it
  is pitched (questions the reader could already answer are left out). With both, the reason leads
  and *About you* chooses within it.
- **The counterweight against a narrow goal skipping the point.** The last few steps must ask what
  the piece as a whole concludes and the main evidence for it, taking those steps from setup, not
  from the goal.
- **No profile, no change.** A reader with neither box filled gets exactly the request every quiz
  got before 6Q. The reader rules are now a separate block, sent only when there is a profile.

What the measurement found: 28 paid runs on the PID review paper (old prompt, two rounds of new
wording), four blind judges who agreed on 89–100% of labels, with the bars written down before any
run.

- **The goal still steers it as strongly as before**: 61–79% of questions on-goal (old prompt
  56–81%); about half are *how-to-apply* questions, against 7–20% with no profile.
- **The balance is better but short of the bar.** On the old prompt, three of six goal runs had no
  question on the paper's conclusion or its evidence. Now every run has at least one, but one or two
  such steps rather than the three or four asked for.
- **About you: not shown.** All three bars for it failed: pitch, which parts, and two readers with
  the same goal (an electrophysiologist, a software engineer) getting measurably different quizzes.
  Read side by side, the two do differ (experimental caveats for one, the maths and tools for the
  other). But two runs a side cannot tell that apart from chance.

Shipped anyway (GPT Sol said *don't ship as the finished thing*; Opus, asked to arbitrate, said
ship as a partial step) because no reader is worse off, and holding it would have kept the rule you
overruled.

**Next step, yours to choose:**

1. **A test that could actually see an About effect.** Two or three articles, a newcomer against an
   expert so the pitch can move, three or four runs each. About 40 runs, $10–15.
2. **Or take About you as best effort for now**, and let readers' feedback decide.

Plan: [261001c](../plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md).
