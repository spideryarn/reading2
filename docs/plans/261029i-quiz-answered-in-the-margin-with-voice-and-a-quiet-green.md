# Quiz answered in the margin, with voice and a quiet green

Greg's reply to question [q-ejp09q](../user-feedback/questions/q-ejp09q.md) (reply `spya-jzgrua`,
2026-10-29), which followed his report `spya-fytjtf` and plan
[261029c](261029c-ideas-off-by-default-and-quiz-in-the-margin.md):

> Yes, let's try and avoid having to jump away from marginalia mode to the learn mode, because
> that'll take us out the flow. Also, it seems quite expensive. Can we experiment with evals with
> Haiku or Sonnet to see if they're good enough for the quiz mode? Yeah, the spacing effect point is
> a really interesting one. Let's start on just trying to make the quiz mode good. And one hunch I
> have is more often but easier and smaller quizzes. Make the voice button very easy to access, and
> then some kind of nice feedback, visual feedback actually, it might be quite important, not
> gamification. But just some of that sense of satisfaction of, you know, turning it a subtle green
> or whatever. And then we'll come back to some of these ideas, these other ideas later.
>
> — Greg, 2026-10-29 (`spya-jzgrua`)

Queue item `qi-msd5tmda`. The other ideas in q-ejp09q (B to E, and the spacing effect) are for later,
as he says. GPT Sol's review of this plan is
[261029i-plan-review-sol.md](261029i-plan-review-sol.md); what it changed is in § The plan review.

## What this does, in one paragraph

Pressing a Quiz question in the margin now opens a small answer box **right there**, instead of
jumping to Learn. The microphone is the first thing in it, and a microphone on the question line
itself opens the box and starts listening in one press. The mark arrives under the answer, in the
margin. An answered question turns a quiet green, with a tick, in the margin and in the band alike,
and stays green on later visits. The green says *answered*; it does not say right or wrong, and
nothing turns red. *Open in Quiz* stays, one line down, for the whole walk. The model half (would
Haiku 5.5 do for writing or marking a quiz, and would a prompt that writes more, smaller, easier
questions be better) is an eval harness committed now and **run after the OpenRouter key resets on
2026-11-01**.

## Two halves, and why they split where they do

**Built now, no model call:** answering in the margin, the voice button, the green. These change
nothing a model is asked.

**Measured first, then built:** anything that changes what the model writes. "More often but easier
and smaller" is, at bottom, a change to the generation prompt: more questions, each answerable in a
phrase or one sentence, nearer together. [quiz.md](../project/quiz.md) is explicit that
`evals/quiz.ts` is read before either prompt is edited, and that two runs of an identical prompt can
differ by as much as a change does; a prompt edited blind would be shipped on hope. So the "smaller"
prompt is written now, as an **arm of the eval**, and is shipped only if it wins.

What "smaller and more often" gets in this stage without a model is the shape of the interaction:
a question met beside its passage as you read, answered in a line, rather than a walk of twenty at
the end. The box asks for a line ("A line is enough"), not "a couple of sentences".

## Stage 1 — the marking moves into a hook both places use

`useQuiz.mark`, its attempt, its one-live-request guard and `showKept` move into
`useQuizMark(slug, source)` in [`useQuiz.ts`](../../src/web/useQuiz.ts). `useQuiz` composes it, so
the band is unchanged; the margin calls it too. A pure move: the band's tests
(`quiz-mark-stream.test.tsx`, `quiz-kept-answers.test.tsx`, `quiz-panel.test.tsx`) are the check.

Why a hook and not `useQuiz` in the margin: `useQuiz` subscribes to the job queue at its watching
cadence and re-reads on mount, which the margin must not do (marginalia.md: mounting the column
costs nothing). `useQuizRead`'s `noteMark` already merges a mark from anywhere into the shared
`kept`, so an answer given in the margin is ticked in the band and the prose, and the other way
round.

**One mark per question on the page** (Sol F2). Each hook's own guard is a ref the other cannot
see, so with the band and the margin both open the same question could be sent twice and paid for
twice. `useQuizRead` now has `claimMark(batchId, questionId)`, which both take before posting and
release when the stream ends; the second press gets one line saying the question is already being
marked elsewhere on the page.

## Stage 2 — answering in the margin

[`marginalia/MarginQuiz.tsx`](../../src/web/marginalia/MarginQuiz.tsx), out of
`MarginaliaColumn.tsx`. One open question per block's note; another block's can be open at the same
time.

```
 ┌ margin ──────────────────────────────┐
 │ Quiz                                 │
 │ ? Why does Seth doubt a faster    🎤 │   ← press the words: open the box
 │   computer would be conscious?       │     press 🎤: open it and start listening
 │  ┌────────────────────────────────┐  │
 │  │ A line is enough               │  │
 │  └────────────────────────────────┘  │
 │  [🎤 Talk] [➤]         Open in Quiz  │   ← mic first; Answer; the band, for the walk
 │  He ties consciousness to being      │   ← the mark, streamed; block chips jump
 │  alive, not to computing [¶ 12] …    │
 │ ✓ What does Seth call that view?     │   ← answered: a tick, on a pale green ground
 └──────────────────────────────────────┘
```

- **The question stays a button**; its press now opens and closes the box under it instead of
  opening Learn. *Open in Quiz* (the old press, `openQuizAt`) is a small link in the box, for the
  premise, the reference answer and the walk.
- **The box** is the band's in miniature: the shared `useDictationField` with the same context and
  keeper key, a `textarea` two rows tall that grows with the answer (never scrolls, spya-qnrxuw's
  rule), Cmd/Ctrl+Enter answers, a double press on Stop answers, keys stopped from bubbling
  (keynav). Refused while the microphone is busy, empty, too long, marking, or stale — the band's
  refusals.
- **The mark** is the band's own `Mark`, exported as `QuizMarkText`: `CitedText` over the article's
  blocks, the superseded line, the not-saved line.
- **Kept answers come back**, in the press that opens the box rather than in an effect after it, so
  a microphone press on an answered question adds to the answer (Sol F3). An answer whose read
  lands after the box opened goes in only if the box is still empty, the band's rule.
- **Opening another question, or closing this one, takes the mark with it**, aborting one still
  arriving: the band's Next. A replacement batch remounts the lines (keyed by batch), which does the
  same.
- **The note grows in place.** The collision pass (`useMarginLayout`) already pushes the notes below
  a taller note down, as an opened FAQ line does.
- **Owner only.** The Reader provides `MarginQuizContext` for the owner; without it the lines are the
  old press-opens-Quiz buttons. A stale quiz has no lines (the prose's rule).
- **What the margin leaves out**, on purpose: the premise (the margin shows stems only, the list's
  rule, because a question is met out of path order), *Show a reference answer*, *Discuss this in
  chat*, *Where to look again*. Each is one press away in *Open in Quiz*.

**One press to talk.** A microphone on each unanswered-or-answered question line opens the box and
starts dictation in the same press. It renders the box synchronously (`flushSync`) and then calls
`toggle`, all in the one handler, for two reasons:

- Safari grants the microphone only inside the gesture, and `toggle` asks for it synchronously.
- **A dictation is bound to the box it was started for** (`useDictation.ts` § `elsewhere`: the
  keeper's box name, `quiz:<slug>:<question>`, captured at the press). Started before the render,
  the dictation would be bound to the empty key of no question open, and its transcript refused the
  moment the question's box appeared.

Sol's F3 thought `flushSync` unnecessary because the field tolerates an absent box; that is true of
the caret, not of the keeper's binding, so it stays. If a browser still refuses the microphone,
dictation shows its own failure and the box's microphone works as usual.

How the margin learns the quiz without `memo(TableView)` hearing: `MarginQuizContext`, beside
`MarginCiteActions` and for the same reason. It carries the read's fields, not the read, because
`useQuizRead` returns a new object on every render (Sol F4): `quiz`, `kept`, `noteMark`, `refresh`,
`claimMark`, the block texts and `jumpTo`, memoised on those.

## Stage 3 — a quiet green

> some kind of nice feedback, visual feedback actually, it might be quite important, not
> gamification. But just some of that sense of satisfaction of, you know, turning it a subtle green

| State | Looks like |
|---|---|
| not answered | as before |
| answered — a kept answer, or a mark that reached `done` | a tick replaces the question mark, and the line's ground eases to a pale green (`--positive` at 13% over the page, 700 ms, none with reduced motion) |

**Green says answered, not right.** The first draft of this plan turned a line green only when the
hidden verdict said `right`. Sol's F5 argued against it, and it is right on three counts: it would
reverse quiz.md's rule that right, wrong and unjudged look the same; absence of green would read as
*wrong*, though it also means the quick-tier check failed or declined; and that check is known to
call an ill-posed question `right`. Green on any finished answer keeps every rule in quiz.md, needs
no verdict at all, lasts across visits (the kept answer is stored, the verdict is not), and is
closer to "not gamification": the satisfaction of having done it, a page that fills with quiet green
as you read. Whether Greg meant *right* is asked, with this as the default, in the follow-up on
q-ejp09q.

One class, `quiz-answered`, in quiz.css, on the margin's line and the band's question
([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).
In the band it goes while the box holds words the mark is not about. No red, no count, no score, no
streak, no sound.

## Stage 4 — the eval harness (run waits for 2026-11-01)

[`evals/quiz-models.ts`](../../evals/quiz-models.ts), with its pure half in
[`evals/quiz-models-lib.ts`](../../evals/quiz-models-lib.ts) and the eight marking cases moved,
unchanged, to [`evals/quiz-cases.ts`](../../evals/quiz-cases.ts) so both evals read one copy
(importing `evals/quiz.ts` would run it — Sol F7). Today both writing and marking a quiz use the
capable tier, **Sonnet 5.5** (Opus 5.5 on a High-powered article); the hidden verdict is already
quick tier. So the question is whether **Haiku 5.5** is good enough for either, and the harness also
carries the "smaller" prompt.

| Half | Arms | Runs |
|---|---|---|
| Writing | Sonnet 5.5 · Haiku 5.5 × current prompt · *smaller* prompt | 3 each, on 2 corpus articles |
| Marking | Sonnet 5.5 · Haiku 5.5, on the eight fixed cases | 3 each |

120 physical model calls, about $8 at production's ledger rates (`--dry-run` prints them; 72 are
the visible write/mark trials and 48 are the quick hidden-verdict calls made after each mark; Haiku
5.5 is not in `src/pricing.ts`, so it is estimated at Haiku 4.5's half of Sonnet).

- **Counted for every call**: cost (its own spend collector, into the ledger as `eval`), seconds,
  failures, questions kept and dropped, gaps, premises, words per question and per reference answer,
  and **how far apart a reader meets the questions** (`blocksBetween`, the mean number of blocks
  between one question's anchor and the next, in document order; and the longest gap). For marks:
  grade words (`GRADE_WORDS`), citations known and unknown, misattributed quotes, whether the
  poisoned case names the draft, and whether the hidden verdict agrees with each case's label.
- **A failure is a result.** A write that does not parse, or a model that refuses adaptive thinking
  or `effort`, is recorded against its arm and counted in *ok / runs*; averages over successes
  alone would flatter a model that fails half the time.
- **Judged by reading, blind.** All four writing arms appear once on a deterministically shuffled
  A/B/C/D sheet for the same article and run; each Haiku mark is paired with Sonnet's on the same
  case and run. The key is written separately. Ties are allowed. An Opus subagent (and Greg, if he
  likes) reads the sheets before the key.
- **The smaller prompt** is `QUIZ_SYSTEM` with four passages replaced: *HOW MANY* goes to thirty;
  each question answerable in a phrase or one short sentence, smaller and easier over thorough; the
  reference answer one short sentence; the questions spread evenly so a reader meets one soon after
  its passage. Each replacement asserts the passage it replaces is there exactly once, so an edit to
  the real prompt fails the arm loudly. **The cap goes up in all three places it lives** (Sol F6):
  the prompt's *HOW MANY*, the request's "up to", and the validator (`toQuestions`), which would
  otherwise keep twenty and drop the rest.
- **The plumbing**: `generateQuiz` takes an eval-only `experiment` (`model`, `instructions`,
  `maxQuestions`); `streamMessage` takes a `model` that `messagesWireBody` sends and the ledger
  records; `QuizRun.model` names it (Sol F8). Nothing in production passes any of these, and the
  harness stores no artefact, so no stamp or fingerprint is touched.

**What would decide it**, written before the run (Sol F9 tightened the first draft):

- **Haiku marks a quiz** if, in every one of its three runs: on `poisonedReference` it sides with
  the reader against the wrong draft, from the article; on `differentWords`, `elsewhere` and
  `moreComplete` it makes no correction the article does not carry (the "severe false correction"
  of evals/quiz.ts' header); it leaks no more grade words in total than Sonnet; and its verdicts
  agree with the hand labels at least as often as Sonnet's, less one. The blind read must not prefer
  Sonnet on more than a third of the pairs, ties counted as neither.
- **Haiku writes a quiz** if every run parses, its dropped questions average no more than one per
  batch above Sonnet's, and the blind read prefers Sonnet on no more than a third of the pairs.
- **The smaller prompt ships** (under the next quiz prompt version) if the blind read prefers it on
  more than half the pairs, its words per question are at least a quarter fewer, its
  `blocksBetween` is lower, and its drops are no worse than one per batch.
- Two articles and three runs are not precise. A result inside these margins is "no evidence of a
  difference", which for a cheaper model means it is worth a trial on Greg's own reading, not that
  it is proven.

The write-up goes in `docs/investigations/` when it has run. Until then the harness and its fixtures
are on `dev` and the queue item says what waits.

## The plan review

GPT Sol, read-only, [261029i-plan-review-sol.md](261029i-plan-review-sol.md). Ten findings:

| # | Finding | What we did |
|---|---|---|
| F1 | A margin answer's verdict never reaches the band, so the band's premise and *Where to look again* treat it as unjudged | **Not done, and why**: with green meaning *answered* (F5), nothing in the margin needs the verdict. A margin answer reaching the band unjudged behaves as an answer from an earlier visit does today: the next premise is shown, which errs towards help (quiz.md § Answers are kept). A shared verdict map is the right change if green ever means *right*. |
| F2 | Two hooks can mark the same question twice | `claimMark` in `useQuizRead`; closing or switching aborts; keyed by batch. Tested red first. |
| F3 | `flushSync` unnecessary; restore the kept answer in the press | Restore in the press: done. `flushSync`: kept, for the keeper binding above. |
| F4 | The context wakes on every owner render; it lacks blocks and jump | Narrow context, memoised on fields; blocks and `jumpTo` added. |
| F5 | Green-on-right is a product call that reverses a rule | Green means answered; *right* asked of Greg. |
| F6 | The thirty-question arm keeps twenty | Cap threaded through prompt, request and validator; tested. |
| F7 | Importing `evals/quiz.ts` runs it | Cases moved to `evals/quiz-cases.ts`. |
| F8 | The override must reach the run's model name | `QuizRun.model` is the experiment's model; the ledger records the wire's. |
| F9 | The decision rule leaned on counters | Rewritten above, with hard failures named before the run. |
| F10 | Layout, touch, keyboard and the one-press start untested | jsdom tests where they can reach; the rest in the browser check. |

## The code review

GPT Sol, fixing as it went, [261029i-code-review-sol.md](261029i-code-review-sol.md): fourteen
findings, all fixed in the stage and each read before commit. The ones that change behaviour: a
margin press that lost the one-mark claim to the band now takes the band's mark when it lands,
instead of saying "will be here" for ever; no switching question, and no late kept answer filling
the box, while dictation is live (both would strand the transcript); the band's answered question
gets the tick as well as the green; the margin's Answer button is 40px on a coarse pointer; each
microphone is described by its question. The eval: one shuffled A/B/C/D sheet per article and run
with premise and evidence shown (pairs gave the incumbent away, and hid what is needed to judge
support); the hidden verdict calls counted, so 120 calls and about $8, not 72 and $7; a failed
verdict call kept apart from an explicit *unclear*, through an eval-only callback production never
passes; dropped *questions* counted once each (a new optional `QuizDropped.questions`); gaps
counted as the blocks strictly between anchors; and each run in its own directory.

## Simpler options passed over

- **Keep the press opening Learn, and only add the mic and the green there.** Half a day less, and
  it leaves the one thing Greg named first: *"avoid having to jump away from marginalia mode"*.
- **Answer in the prose too.** quiz.md § In the prose deferred this for `TableView`'s render path;
  the margin is outside that path (a context, not a prop), which is why it can be done here and the
  prose can wait.
- **Ship the smaller prompt now and measure later.** It would mark every existing quiz outdated for a
  change nobody has seen work.
- **Green on *right***: above, F5.

## Tests

- [`tests/marginalia-quiz-answer.test.tsx`](../../tests/marginalia-quiz-answer.test.tsx): the press
  opens the box and does not open Learn; *Open in Quiz* does; an answer posts one mark and the line
  turns green; green on a `wrong` verdict too, with no grading word on screen; a kept answer is
  ticked, green, and put back with its mark; opening another question takes the box and draft; the
  band's question turns the same green and loses it on an edit; the margin will not mark a question
  the band is marking. Each of the three mechanisms (the box, the green, the claim) seen red by
  switching it off.
- [`tests/quiz-models-eval.test.ts`](../../tests/quiz-models-eval.test.ts): the smaller prompt's
  replacements, its refusal when the real prompt moves, the cap in request and validator, the arms,
  the plan of calls, the blind labelling, `batchStats`.
- The band's existing quiz tests, unchanged, for Stage 1.

## Browser check

A Sonnet subagent, Playwright on the box: the margin at its narrowest (200px) and at a comfortable
width; open, type, answer (the mark is a stubbed or real-key-less failure — the key is over its
limit — so the check is the box, the layout, the failure line, and a kept answer from the database
showing green); the microphone's one press on Chromium; light and dark.

**Done 2026-10-29**, on the local database: all of that held, at 178px too, with no console errors.
One defect: a box opened with Enter left the focus on the question, so typing went nowhere. Fixed
(the box takes the focus; Escape closes it and gives the focus back), with a test seen red first.
Left as they are: PageUp/PageDown in the box scroll the article, as the band's box does, and a
half-typed margin answer is not carried into the band by Open in Quiz.

## Docs

quiz.md (§ On screen, § In the prose's "answering stays in the band", the eval line), marginalia.md
(§ Quiz's questions), dictation.md (§ starting from a press that also opens the box), the eval's
line in `evals/README.md`. Then q-ejp09q gets Greg's reply quoted and `acted: spya-jzgrua`, and a
follow-up question on green.
