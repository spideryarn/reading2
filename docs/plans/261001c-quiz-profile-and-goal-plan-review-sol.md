Verdict: **revise before build**. The product direction and basic prompt hierarchy are right; the evaluation cannot yet demonstrate several of the claims it is meant to support.

**F1 — P1: Resolve the priority conflict between personal relevance and “KEEP TO WHAT MATTERS.”**

The proposed instruction selects “what a person like that would most want” ([plan:27](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:27>)), while the existing prompt excludes any detail the argument does not depend on ([src/quiz.ts:746](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:746>)). A personally relevant but peripheral detail leaves the model with contradictory instructions: ignore the profile or violate the importance rule.

Likewise, “fewer setup steps for an expert” must not remove article-specific prerequisites required by the path rules ([src/quiz.ts:606](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:606>)).

Add explicit precedence:

> Personalise among the consequential, article-backed material. A profile never turns trivia into a useful question. Prior knowledge may remove background-only questions, but never an article-specific step a later question depends on.

The existing “answerable without having read the piece” rule otherwise aligns well with the change ([src/quiz.ts:714](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:714>)).

**F2 — P1: The arms cannot show “reason leads; About chooses within it.”**

The About text and goal both point toward applying PID to recordings ([plan:84](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:84>)). A successful `both` arm could therefore be merely two aligned hints. It cannot show that the reason constrained the path and About selected within that constraint. There is also no old-prompt `both` arm.

Use diagnostic profiles that predict different subtopics within the same goal—for example:

- an electrophysiologist already working with continuous recordings;
- a software/tool author implementing PID.

Both should remain strongly GOAL-on, but select different practical problems. Compare About-fit within the GOAL-on questions, rather than requiring overall FIT to equal the unrestricted About-only arm. The current bar at [plan:120](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:120>) actually works against “reason leads”: restricting the path to the goal may legitimately lower overall About coverage.

**F3 — P1: FIT is too subjective and conflates all three intended effects; question kind is not measured.**

At [plan:98-103](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:98>):

- `FIT` combines part selection, question kind and pitch into one judgment.
- `ASSUMED` asks a judge to know what this particular neuroscientist could answer from their field. That is not observable from the profile and principally measures question selection, not pitch.
- Nothing measures the promised application/judgment/foundational question kinds.

Use separate predeclared measures:

- `ABOUT_TARGET`: one of explicitly named subtopics or evidence ranges predicted by the About line.
- `KIND`: application / appraisal-of-evidence / conceptual-foundation / other.
- `BACKGROUND_ONLY`: answerable from a list of knowledge explicitly stated in the eval profile.
- Pitch screens: number of questions spent defining those already-known concepts, and questions that unnecessarily explain their terminology.

For this purpose, make the eval profile explicit about what the reader already knows. “Computational neuroscientist” alone is too underdetermined.

**F4 — P1: The balance rule has the right intent but the wrong scaling shape.**

“Three or four in a quiz of twenty” ([plan:67-70](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:67>)) is liable either to remain three or four in a six-question quiz, overwhelming the goal, or be ignored because it is presented only as an example.

A better instruction is:

> Reserve a short, connected route through the piece’s overall claim and its main support—normally three or four steps in a twenty-question path, one or two in a short path. Do not pad the quiz to reach that number.

“Connected route” matters: three isolated central questions do not necessarily preserve the path.

**F5 — P1: The CENTRAL ground truth and bar do not test that balance rule.**

The central points are derived from where the old no-profile quizzes ended ([plan:103-110](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:103>)). That is circular: the old model output becomes the authority for what the article centrally claims.

Declare them from a human reading of the article’s abstract/conclusion, with supporting block IDs, before generation. C1 appears to be framing, C2 the overall conclusion, and C3 supporting findings; label those roles rather than calling all three equivalent “central points.”

The bar at [plan:121](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:121>) requires only one C1 and one C2 question—two questions, despite the prompt requiring three or four—and never uses C3. It should require:

- the scaled number of CENTRAL questions;
- coverage of the overall claim and at least one main support;
- specifically in each new goal and both run.

Clarify “every run in every arm” as well. If it includes the stored old runs, it is already likely to fail: several old About/goal paths do not ask C2 directly.

**F6 — P1: Several bars are vague or easier than the observed noise.**

At [plan:112-123](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:112>):

- “give or take one run’s wobble” is undefined.
- FIT merely being above old About can pass by one question.
- ASSUMED merely being lower can pass by one question.
- The old goal runs were both 14/19, so calling 65% “74% minus one run’s wobble” is unsupported. It can still be the chosen product floor, but should be named as such.
- “GOAL share as the goal arm” and “ASSUMED no higher” do not define pooling, per-run behavior, or tolerance.

State each bar as an integer or exact percentage for each run, and require the effect to exceed the old prompt’s run-to-run spread. With only 14–20 questions, one label is already 5–7 points.

**F7 — P1: Reusing the stored arms is not adequately attributable under the prompting guide.**

Temporal separation itself is correct—the guide explicitly asks for before and after on different commits ([prompting-guide.md:117](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/project/prompting-guide.md:117>)). The problem is provenance:

- `ArmFile` stores neither prompt hash, source hash nor generator ([evals/quiz-reading-goal.ts:31](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/evals/quiz-reading-goal.ts:31>)).
- The old plan records that `none-1/2` used an earlier draft than the other four runs ([260930j:192](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:192>)).
- The harness has no reproducible command for producing the shuffled questions/key/judge rubric, although this plan relies on a new four-label blind evaluation.

Before editing the prompt, generate fresh old-prompt controls—including `both`—and record `sourceHash`, model/generator, prompt-source hash and git SHA. Add a seeded blind-export command and commit the judge instructions. The existing runs remain useful historical evidence, but should not be the sole baseline.

**F8 — P1: “No profile stays as it is” is not currently guaranteed.**

The user message remains byte-identical, as tested at [tests/profile-prompts.test.ts:146](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/tests/profile-prompts.test.ts:146>). The complete request does not: rewriting `QUIZ_SYSTEM` changes the second system block on every no-profile call ([src/quiz.ts:1026-1040](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:1026>)). A conditional paragraph can still influence a model when its condition is absent.

If byte-identical no-profile behavior is a hard requirement, append the profile rules only when `profile` exists. This does not sacrifice the article cache: the article is `system[0]` and carries the explicit breakpoint; these rules are in `system[1]`, after it.

If the constant design is retained, narrow the claim to “intended to be unchanged” and strengthen the no-profile evaluation. Matching only part-7 and GOAL shares can miss a large change elsewhere in the path.

**F9 — P2: Several directly false comments/docs are omitted from the update list.**

In addition to the planned `src/quiz.ts` header and `quiz.md` edit:

- [docs/project/reader-profile.md:127-133](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/project/reader-profile.md:127>) explicitly says About changes vocabulary only.
- [src/profile.ts:4-8](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/profile.ts:4>) says downstream has no reason to treat the two halves differently; Quiz now deliberately does, even though they can still travel in one labelled string.
- [tests/profile-prompts.test.ts:124-130](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/tests/profile-prompts.test.ts:124>) describes only a reading reason moving the path. Add an assertion that an About-only rendered prompt no longer says “ordinary path”; the current marker tests would not catch forgetting the `readerSection` change.
- [evals/quiz-reading-goal.ts:1-19](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/evals/quiz-reading-goal.ts:1>) describes only the goal experiment, and [line 35](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/evals/quiz-reading-goal.ts:35>) still calls About a control.
- The contract above `PROMPT_VERSION` says changes to what a question is cause a bump ([src/quiz.ts:156](</home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:156>)). Not bumping remains defensible to preserve existing batches, but that exception should be recorded there, not only in the plan.

The exclusion of `PROFILE_RULES`, the existing profile plumbing, and the decision not to alter schema/routes/stamps are otherwise sound.