# Review this plan before it is built

You are the cross-family reviewer. The plan is
`docs/plans/260907d-make-the-quiz-adaptive.md` in this worktree. **Read it in full first.**

## What is being decided

Greg (the product owner) asked for a difficulty slider on the quiz. That was deferred with three
objections, and on 2026-09-06 he chose **an adaptive quiz** instead: get one right and the next is
harder, get one wrong and the next is easier. No control, no visible difficulty. The plan above is
how I propose to build it. Nothing has been written yet — this review happens *before* stage 1, so a
bad design costs an hour rather than a stage.

## Read these before judging

- `docs/project/quiz.md` — the whole feature. Especially "The order, and why it is not `ease +
  value`", "What a mark says, and what it may not", and "What is deliberately not here".
- `src/quiz.ts` — `orderQuestions`, `missingBandEnds`, and the long header comments.
- `src/quiz-mark.ts` — `QUIZ_MARK_SYSTEM`, `gradeWords`, `markAnswerStream`, `QuizMarkEvent`.
- `src/web/useQuiz.ts` — `readMark` and the terminal contract.
- `src/web/QuizPanel.tsx` — the `at` index, `move`, the `batchId` reset effect, `QuestionList`.
- `docs/plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md`
  § "Three questions for Greg" — the three decisions the slider collided with.

## The constraints this plan must not break

1. **The panel shows neither `band` nor `value`.** Adaptive must not leak difficulty either — no
   "here's a harder one", no pips, no level. Carrying metadata in the payload is fine; showing it is
   not.
2. **Attempts are not stored.** `docs/project/privacy.md` says publicly that answers are not stored.
   Adaptive state must die with the attempt. If you think adaptivity genuinely requires persistence,
   say so loudly — that is a stop-and-escalate, not a decision to take.
3. **The panel must not re-sort.** `QuizPanel`'s stated invariant: *"a panel that sorted would be a
   second opinion about the same list, and two lists drift."* The plan argues that one-at-a-time
   selection from a server-ranked pool is selection, not re-sorting. **Attack that argument.** If it
   is sophistry, say so — it is the load-bearing claim in the whole design.
4. **Simplest version first.** No item-response theory, no difficulty model, no calibration, no
   scoring. If the plan is over-built anywhere, cut it.

## What I most want you to attack, in this order

1. **The correctness signal.** The mark deliberately refuses to grade, and adaptivity needs to know
   whether the reader was right. The plan's option A adds a hidden `GOT: yes|partly|no` line at the
   top of the marking reply, parsed and stripped server-side, emitted as its own frame, never
   rendered. Option C (a separate cheap call) is named as the fallback.
   - Is A likely to contaminate the tone of `QUIZ_MARK_SYSTEM`? That prompt's tone is the product.
   - Is the strip-the-first-line parse robust? What does it do to streaming, to `MARK_MAX_TOKENS`,
     to an abandoned stream, to a model that ignores the instruction or writes the line in prose?
   - Is C actually the better v1 despite being a second call? Say so plainly if you think it is.
   - Is there a fifth option neither of us has thought of?
2. **The invariant argument** (constraint 3 above).
3. **The ladder's edges.** Three rungs is short and a batch is typically 6 easy / 3 medium / 3 hard.
   Empty bands, the top and bottom, exhaustion, out-of-order picking from *Show all twelve*,
   Previous walking the path rather than the array. Is the "step past an empty rung in the direction
   of travel, then the other way, then anything" fallback right, or is there a case where it hands
   the reader something absurd?
4. **Three verdict values rather than Greg's two.** `partly` holds the rung. Justified, or scope
   creep against an explicit instruction?
5. **The measurement plan.** Is a simulated reader over a real batch an honest measurement of an
   ordering change, or is it circular — proving the algorithm does what the algorithm does? If
   circular, what would actually be evidence?
6. **The decision to not end the quiz after a run of wrong answers.** The plan argues that ending
   someone's quiz is a verdict about the reader, which this product refuses to deliver. Is that
   right, or is it leaving a reader to grind?

## What I do not want

Do not redesign the generation prompt — the `easy`-leaning prompt shipped on 2026-09-05, is
measured, and is out of scope. Do not propose storing attempts. Do not propose showing the reader
their level. Do not suggest a git branch strategy.

## Output

Findings ordered by how much they would change the plan, each with: what is wrong, why it matters,
and what you would do instead. Say explicitly at the end whether you would **build this plan as
written**, **build it with the changes you list**, or **not build it** — and if the last, what
instead. Be concrete; I will check each finding myself and some of them will be wrong.
