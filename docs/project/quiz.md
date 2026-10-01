# Quiz — the questions the article asks back

Up: [reading-view-overview.md](reading-view-overview.md)

**Built 2026-08-31 to 2026-09-01.** The second half of [Remember](remember-mode.md). Recall asks the
reader what they took from the piece; Quiz walks them, one small question at a time, up to the
piece's takeaways, and says how each answer sits against it.

Greg, 2026-08-31:

> The current Review mode is designed as a kind of free recall, where the user can just talk about
> what they remember. Let's add a new Review "Quiz" sub-mode where the agent generates questions
> that require short-form answers (e.g. perhaps a couple of sentences, give or take). By default, it
> just reveals one at a time, but we should give the user the option to reveal a bunch of questions
> at a time so they can pick which one(s) to answer. In other words, it should probably generate in
> batches of a dozen or so. Importantly, the questions should be ordered by a combination of ease
> and value (i.e. easy-first-then-getting-harder, and central-or-important-first).

And, when asked whether an exchange should carry on:

> Unlike the default freeform sub-mode, Quiz doesn't need to be a conversation — it's just a
> question then answer.

That answer is the whole shape. **A quiz is not a thread.** No `ChatThread`, no `ThreadKind` of its
own, no rows in `chat_threads` — which is why this is one artefact, one route and one panel rather
than another arm through every place a thread kind is dispatched on. (This said "no *third*
`ThreadKind`" until 2026-09-01, when Referee mode's Candidates took that number and proved the point:
it needed the CHECK constraint widened, both stores' normalisers, the route's validation and a branch
in `converse` — [referee-mode.md § 4](referee-mode.md).)

Code: [`src/quiz.ts`](../../src/quiz.ts) (the stage, the prompt, the validation, the sort),
[`src/quiz-mark.ts`](../../src/quiz-mark.ts) (the marking prompt and its stream),
[`src/web/quiz-ladder.ts`](../../src/web/quiz-ladder.ts) (whether a step's premise is shown, and it never sorts),
[`src/web/read-filter.ts`](../../src/web/read-filter.ts) (which questions are about what you have read),
[`src/web/quiz-sections.ts`](../../src/web/quiz-sections.ts) (the answers counted by section, and which to look at again),
[`src/quiz-verdict.ts`](../../src/quiz-verdict.ts) (whether they got it right, asked in private),
[`src/routes.ts`](../../src/routes.ts) § `/api/quiz/:slug` (the GET) and `/api/quiz/:slug/mark` (the POST),
[`src/web/useQuiz.ts`](../../src/web/useQuiz.ts),
[`src/web/QuizPanel.tsx`](../../src/web/QuizPanel.tsx),
[`src/web/modes/conversation/ConversationModes.tsx`](../../src/web/modes/conversation/ConversationModes.tsx)
§ `RememberBand`, `QuizSubBand`.
Types: [`src/types.ts`](../../src/types.ts) § `QuizQuestion`, `QuizEvidence`, `Quiz`, `QuizDropped`.
Tests: [`quiz.test.ts`](../../tests/quiz.test.ts),
[`quiz-panel.test.tsx`](../../tests/quiz-panel.test.tsx),
[`quiz-mark-route.test.ts`](../../tests/quiz-mark-route.test.ts),
[`quiz-mark-stream.test.tsx`](../../tests/quiz-mark-stream.test.tsx),
[`quiz-step-registration.test.ts`](../../tests/quiz-step-registration.test.ts),
[`quiz-ladder.test.ts`](../../tests/quiz-ladder.test.ts),
[`quiz-verdict.test.ts`](../../tests/quiz-verdict.test.ts),
[`quiz-sections.test.ts`](../../tests/quiz-sections.test.ts).
Eval: [`evals/quiz.ts`](../../evals/quiz.ts) — **read this before editing either prompt.**
The plan, the spike and two cross-family reviews:
[260831al](../plans/260831al-review-quiz-sub-mode.md) and
[its review](../plans/260831al-review-quiz-sub-mode-review-sol.md).

## A path, since 2026-09-30

Greg, 2026-09-29 (SPIDERYARN-READING2-5W):

> For the quiz mode, maybe what we want is, like, more questions, but try and make them easier,
> where maybe only a sentence or two is needed, and make the questions build on one another
> gradually, and so that each answer is not that effortful, but that by the time you've answered a
> whole bunch of them, you know, you've kind of gradually built up towards an understanding of why
> it is the way, you know, what the key takeaways are.

So a batch is **a path, not a pool**: up to twenty small questions, each answerable in a sentence or
two, walked in the order the model set them. The prompt has the model decide the piece's two to four
takeaways privately first, start with what the piece plainly says, lean each step on the one before,
and end at the takeaways and why they hold. **The stored order is the model's, and nothing sorts
it** — not the server, not the panel. The plan, both cross-family reviews and the measurements are
[260930c](../plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md).

**What went with the pool.** Until then each question carried a `band` (easy / medium / hard) and a
`value` (1–5), the server sorted band → value → document position, a gate refused a batch without a
question at each end of the band scale, and the panel walked it with a band ladder. A sequence whose
steps lean on each other cannot be sorted by band or hopped across by a ladder, so all of that went
together. The reasoning that built it — why the sort was lexicographic rather than `ease + value`,
why presence at each end rather than a proportion, why five easy and three hard — is in
[260831al](../plans/260831al-review-quiz-sub-mode.md),
[260903c](../plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md) and
[260905g](../plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md), and it is
worth reading before anybody reintroduces a score on a question.

**A quiz written before `quiz/5` is still a pool**, stored band-sorted, easy first, and the panel
walks it front to back like a path, with no premises. It is `outdated`, which since 2026-09-29 is
deliberately silent ([Greg, SPIDERYARN-READING2-55](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)):
re-running it is in Metadata. A tab still running the old ladder would throw on a question with no
`band`, so `GET /api/quiz/:slug` adds `band: "easy", value: 3` to every question that lacks them —
**in the response only, never the artefact**, and kept until there is a client-version boundary to
hang its removal on (`withOldClientBands` in [`src/quiz.ts`](../../src/quiz.ts)).

## It adapts: the premise

**Greg's 2026-09-06 decision still holds** — the quiz adapts to the reader, and there is no control.
What adapts changed. The ladder moved the reader between bands (right, harder; wrong, easier); a path
cannot be reordered, so what adapts now is **how much help a step carries**.

Most steps carry a **premise**: one sentence restating the answer to the question immediately before,
which this one builds on.

```
Q5 after a right answer to Q4:       Why does Seth doubt a faster computer would be conscious?

Q5 after a wrong answer, a skip,     Seth ties consciousness to being alive, not to computing.
a jump from the list, or Previous:   Why does Seth doubt a faster computer would be conscious?
```

The rule is [`showPremise`](../../src/web/quiz-ladder.ts): hidden **only** when the reader came to
this question by Next from the one before and was judged right on it; shown otherwise; and **always
shown in a batch with a gap** — a question dropped in validation with a kept one after it — because
there the premise is the bridge over the missing step. The prompt holds up the other half:

- **A premise restates the previous answer and adds nothing**, above all not the next step, which is
  what the question asks for. A string match catches only the crudest giveaway (`readPremise` drops a
  premise that contains the reference answer outright); the rest is the prompt's and the eval's job.
- **The question is whole without its premise** — no "this", "that", "given this" pointing back —
  because the reader who got the last one right sees it alone.
- **The all-questions list shows stems only.** A premise is an earlier question's answer, and
  scanning the list must not answer rows the reader has not reached.
- **The marker never sees the premise** ([`src/routes.ts`](../../src/routes.ts) § `markOneAnswer`):
  the reader may not have been shown it, and the question is whole without it.

**Nothing on screen says it is happening**, and that is a hard rule rather than a preference: no
level, no "here's some help", no change to the "Question 5 of 18" line. `quiz-panel.test.tsx` asserts
that the words `easy`, `medium`, `hard`, `harder`, `easier`, `difficulty` and `level` never reach the
page.

**A dropped middle step is counted, not refused.** Sol's first review asked for any batch with a gap
to fail; in the baseline runs three of ten batches dropped a whole question, so that would throw
away about a third of paid batches — 260903c's failure again. `QuizDropped.gaps` counts them, the
pipeline logs it with `premised` (how many steps carry a premise — none means the path has become a
list again), and the plan names the trigger for doing more.

### Whether the reader got it right is asked somewhere else

The mark [may not say how the reader did](#what-a-mark-says-and-what-it-may-not), and the walk has
to know. So the judgement is made by a **separate, small call that reads the finished mark** —
[`src/quiz-verdict.ts`](../../src/quiz-verdict.ts) — and its one-word answer rides the terminal `done`
frame. The word is never rendered, never logged and never stored; the panel holds it in React state
for the length of the visit. It may choose scaffolding and navigation — whether a premise is shown,
and which sections [Where to look again](#where-to-look-again) names — but never a count, a score or
a line of copy about how the reader did.

**`QUIZ_MARK_SYSTEM` is deliberately untouched by this.** The obvious design was to have the marking
prompt emit a hidden verdict of its own, one call instead of two; it was rejected because that prompt
spends two pages separating confirmation from grading, and making grading its opening framing task
risks the tone on *every* answer — a regression that eight noisy eval cases could never prove either
way. A missed adaptive move is invisible and harmless; a worse mark is visible every time. The
classifier never sees the article, either, which is why it can be quick tier: the mark it reads has
already done the comparing, with citations.

**Absence is a designed outcome, not an error path.** The classifier failing, timing out, returning
anything unrecognised, or declining an ill-posed question all arrive as no verdict, which means *show
the premise* — every failure errs towards help, and it can never break a mark, which is complete
before the verdict is asked for. A *wrong* verdict is a real mis-step — the measured `illPosed` case
comes back `right` — and its cost is one premise hidden that should have been shown.

**What it does not do:** it does not end the quiz after a run of wrong answers. Ending someone's quiz
because they are getting things wrong is a verdict about the reader delivered by a machine — the thing
[remember-mode.md](remember-mode.md) and the marking rules refuse.

## A reference answer is not an answer key

Each question carries a model-written answer, produced over the whole article **before any reader
answered anything**, revealed behind a collapsed control.

The control says **"Show *a* reference answer"**, and the article, not that answer, is what a mark is
judged against. This is not politeness. The reference answer is one model's reading, written by a
cheaper batch call, and it is sometimes wrong; if the marker deferred to it, a reader who was right
would be told they were not — the single worst thing this feature can do.
[`QUIZ_MARK_SYSTEM`](../../src/quiz-mark.ts) says so outright (*"IF THE REFERENCE ANSWER AND THE
ARTICLE DISAGREE, THE ARTICLE WINS"*), and `evals/quiz.ts` poisons one on purpose with valid block
ids to check that it does. It does: the model quoted the article, said *"the reference answer has
this backwards"*, and sided with the reader.

Every reference answer is anchored. Each question names one to three `QuizEvidence` — a block id
**and a quote** — and every quote is relocated in that block with `findQuote`; what is stored is the
article's own characters at the offsets found, never the model's typing. A question whose ids are
invented or whose quotes cannot be found is dropped whole, and the counts survive on the artefact as
`QuizDropped`, because a dropped question is otherwise indistinguishable from one the model chose not
to set. [block-ids.md](block-ids.md) is the contract.

## What a mark says, and what it may not

**What you got, what's missing, where to look.** No score, no grade, no fraction, no "mostly right".
The reply confirms claims and points at passages; it never says how the reader did.

The line between the two is the same one [remember-mode.md § The prompt is the
feature](remember-mode.md#the-prompt-is-the-feature) draws, and the marking prompt inherits that
section's entitlement rules wholesale — a correction must be carried by a quoted sentence that
contradicts the reader *by itself*, disagreeing with the author is not getting it wrong, and a
shorter answer is not a worse one. What Quiz adds is the case Recall does not have: the question has
a right answer and the reader missed it. Even then the reply states what the article says and stops.

### The rule is counted, not enforced

The prompt names the grading words by hand — *"correctly"*, *"tracks the article"*, *"holds up"* —
and they still get through, in about 0 to 3 replies out of eight. That range is the difficulty: two
runs of an **identical** prompt scored 0 and 3, so at eight cases a leak and the noise are the same
size and no amount of re-reading eval runs says whether a change helped.

So `gradeWords` in [`src/quiz-mark.ts`](../../src/quiz-mark.ts) counts them on **every real mark**
and puts the number on the log line. It blocks nothing, and that is the decision rather than an
omission: a gate would fail a mark the reader has already watched arrive, over a sentence they may
not mind — trading a rule they cannot see for a failure they can. Whether the ban ever gets teeth is
a question to answer from that number, not from eight cases. `evals/quiz.ts` imports the same list
instead of keeping its own, because the eval's copy is the one that would quietly stop matching the
prompt.

## The artefact, and the batch every mark binds to

`quiz` is a pipeline step like `ideas` or `timeline` — off the default list, run on demand by a
button in the band — and, since 2026-09-06, by pressing the **Quiz** chip itself,
which is Greg's rule that opening a mode is the reader asking for it
([260906b](../plans/260906b-opening-a-mode-starts-it-generating.md);
[`activation.ts`](../../src/web/activation.ts)). The chip arms whether or not the
sub-mode changes, so pressing Quiz while already in Quiz is how a reader asks
again after a read that failed. `useQuiz` grew a second verb for it: **`ensure`**
is unforced and is what both the automatic run and the empty state's button call,
**`write`** is forced and is what *Write them again* calls. They must not be
confused — `work_key` includes `force`, so the two are different requests and a
reader who pressed the button beside an automatic run would pay for both.
It is cached per article and stamped. Its fingerprint is
`articleWithIdsFingerprint` (blocks, tree, and a head including the URL), shared with `ideas` and
`sketch`. [architecture.md § Storage](architecture.md#storage) has the family.

**`batchId` is the field worth knowing about.** Between a reader seeing a question and pressing
Answer, *Write them again* can replace every reference answer while the question ids and the
document's shape stay as they were. `POST /api/quiz/:slug/mark` reads the question, its reference
answer and its evidence from the server's copy, and answers **409** when the batch the reader was
shown is not the batch that is there. Never a silent fall-forward to the question with that id in
the new batch. It is also what keeps the door open for stored attempts: an attempt row can point at
an immutable batch instead of copying the question into itself.

**Every one of those refusals is asked twice.** Reading the quiz and reading the article are two
separate resolutions of "the current revision", so a publication landing between them would hand the
model one revision's question beside another revision's prose — with the staleness guard, whose
whole job is to stop that, already passed. `markOneAnswer` re-checks after the article read. It is a
re-check rather than a snapshot: closing the window entirely needs a revision-scoped read the
[`ArticleReader`](../../src/store/contracts.ts) contract does not have.

Marking is a model call in a request handler, which is the **second** deliberate exception to
"model calls happen in the pipeline" — the first is explaining a selection
([`src/explain.ts`](../../src/explain.ts)), and this is shaped on it. It streams, because a person is
waiting.

Two ways a mark can look finished when it is not, and both are refusals rather than ticks:
`finish_reason: "length"` is the reply hitting `MARK_MAX_TOKENS` mid-sentence, which arrives with a
perfectly ordinary `[DONE]` after it; and a reader who navigates away aborts the **provider** call,
not merely the writing of frames, and gets no `done` at all.

## On screen

`?remember=quiz`, and the Recall | Quiz toggle at the top of the band —
[url-state.md](url-state.md) has the parameter and its defined collision with `?thread=`.

**The step row is icons, their words in tooltips** (Greg, 2026-09-30, SPIDERYARN-READING2-71:
*"let's use icons instead of text labels, you know, perhaps with tooltips"*;
[icons.md § Navigation](icons.md)): Previous, Next and *Show all N questions* are `ChevronLeft`,
`ChevronRight` and `List`. **Three things keep their words.** *Answer* is the one real action and
the mark's note names it; *Show a reference answer*'s indefinite article is the point (§ A reference
answer is not an answer key); and the Recall | Quiz toggle, because on a touch screen a hover card
never opens, and "say what you took from it" versus "the article asks" is not something a glyph
carries on its own (GPT Sol's plan review; Greg's *"maybe remember mode as well"* left it open). **← / → step the questions** as Previous and Next do —
[keyboard.md § ← / → in Quiz](keyboard.md), which also has the one rule the keys add.

- **One question at a time, in path order.** Next goes to the next step, Previous to the one before,
  and "Question *n* of *N*" is the position on the path. *Show all N* lists the question stems —
  never their premises — and picking one jumps there and closes the list. A jump always shows the
  premise, because the reader did not come from the step before.
- **Next waits while a mark is still arriving.** The verdict is judged from the finished mark, so it
  lands with the last frame rather than the last word — and the next step's premise depends on it.
  Previous and the list stay live, so a reader who does not want to wait can still leave, which
  aborts the mark as it always did.
- **Which question is open is deliberately not in the URL.** The rule `?at=` and `?thread=` serve is
  that a shared link lands you where the link-maker was; here what a link would frame is an answer
  that does not survive a reload anyway. It arrives with stored attempts, which is what would make
  it true.
- The answer box is the shared `useDictationField` — [dictation.md](dictation.md) — because an
  answer from memory arrives as speech more readily than as typing.
- The mark is drawn with `CitedText`, so its block ids are chips that jump the prose.
- **A question is ticked answered only when its mark reaches `done`.** A stream that stops cleanly
  without finishing looks exactly like one that finished, which is the whole reason `attempt.status`
  and not a non-empty reply is what the tick reads. [silent-success.md](../reusable/silent-success.md).
- **A mark stays bound to the exact answer it was computed for.** The box goes editable again as
  soon as a mark lands, so the reader can end up reading feedback about a sentence they have
  deleted. Every attempt carries the answer it was marked on, and when the box no longer matches it
  the band says *"This mark is about your previous answer"* and stops calling the question answered.
  The mark itself stays on screen — it is the thing the reader is editing against, nothing stores
  it, and taking it away for a keystroke aimed at a typo would be its own kind of wrong. Put the old
  words back and it is a current mark again.
- **A new batch takes the mark with it.** *Write them again* mints a new `batchId`, and the panel
  clears the attempt along with the index, the draft and the verdicts. Not tidiness: a mark still streaming holds
  `useQuiz`'s one live request, and without the clear the new batch's Answer button is enabled and
  does nothing.

## In the prose, in every mode

Greg, 2026-09-30 (SPIDERYARN-READING2-6V):

> Actually, let's just go one step further and say if you've generated quiz questions, it should
> always show them in situ in the text, whether you're in quiz mode or not.

So once an owner has questions, each one is also a muted line in the prose, after the block holding
its **last** evidence passage — only there has the reader met all of what it asks about. Pressing it
opens Quiz at that question. The design pass (two product-manager agents, screenshots of six
options), the choice and what was deferred are
[260930i](../plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md).

- **The question's words only, never its premise** — the list's rule, for the list's reason.
- **Pressing it is a jump**, so the band shows the premise; it goes through
  `?mode=remember&remember=quiz` with `thread` cleared, one pushed entry, and an in-memory
  `QuizArrival` that names its batch ([`QuizPanel.tsx`](../../src/web/QuizPanel.tsx)). Pressing the
  question already open does nothing, since `move` would abort its mark; if *Only what I've read*
  would hide it, the tick-box turns itself off. It arms nothing and buys nothing — a line exists only
  because a quiz does.
- **Not drawn for a stale quiz**, whose passages may no longer be the prose; drawn for an outdated
  one. Not drawn for a visitor: the public payload has no quiz.
- **Shown whether or not you have read the passage.** The reading levels move every minute and would
  re-render the whole article through `memo(TableView)`; a question before its passage is a
  pre-question, not a giveaway.
- **Answering stays in the band.** Answering in the prose would put a second copy of the answer box,
  the mark binding and the premise rule in `TableView`'s path — the plan's *Deferred* says what would
  change that.
- The read moved up for it: `useQuizRead` in `OwnedReader`, `useQuiz(slug, read)` in the band — the
  Quotes split — so *Write them again* moves the lines too.
  [`quiz-anchors.ts`](../../src/web/quiz-anchors.ts), [`QuizInProse.tsx`](../../src/web/QuizInProse.tsx),
  `TableView`'s `quizAfter`.

## Only what you have read

Greg, 2026-09-30 (SPIDERYARN-READING2-61):

> So we generate questions for the whole article, but we might filter, you know, if there's a tick
> box that defaults to only show me questions for stuff I've read, and then it would only show quiz
> questions for the stuff that the user has read.

With [reading time](reading-time.md) on, the band has a tick-box, **Only what I've read**, on by
default, and beside it how much of the piece you have read ("about 40% of the piece read so far").
The batch is still written over the whole article; the filter is the panel's, computed in the
browser from the levels the page already has. The plan and GPT Sol's six changes to it are
[260930e](../plans/260930e-quiz-only-asks-about-what-you-have-read.md).

- **Read** is a reading-time level of 3 or more — on screen for 70% of the time the block takes to
  read — and a question is read when **every** one of its evidence blocks is, and is still in the
  article. The share counts body words only, the reading-time clock's rule.
  [`src/web/read-filter.ts`](../../src/web/read-filter.ts).
- **The path is not rebuilt.** `at` is still an index into the artefact's array; the filter only
  changes which indices can be landed on. "Question *n* of *N*" and *Show all* count what can be
  landed on, and the list says how many more are about passages not yet read.
- **A Next that skips a step is not an arrival by Next**, so the premise is shown: it is the bridge
  over the step skipped. `showPremise` did not change.
- **Nothing is drawn under a question the panel has not moved to.** While the step at `at` is
  filtered out — at the opening, on ticking the box, after the switch goes off and on — nothing
  interactive is drawn and an effect moves through `move`, which takes the draft and the mark with it.
- **An empty level map is not "read nothing" until it is `loaded`.** While the opening read is
  pending the band says it is looking; if it failed, it walks every question and says so. With
  reading time off there is no tick-box at all.
- The tick-box is per visit, not remembered.

## Shaped by who you are and why you are reading

Greg, 2026-09-30 (SPIDERYARN-READING2-6Q):

> If the reader has told us why they're reading this article (the "Why are you reading this?"
> prompt from spya-esua8w), the quiz questions should be shaped around that goal. For example, if
> I've said I want to understand their methods, most of the questions should be about the methods,
> not an even spread across the paper.
>
> Keep it simple: one batch per article as now, written with the owner's goal when there is one,
> and the same as today when there isn't. […] If the reader changes their goal, the existing "Write
> them again" can pick up the new one; no automatic regeneration needed for v1.

The goal is the article's *Why you're reading this one* ([reader-profile.md](reader-profile.md)),
asked on the add page and in Skim. The quiz job already carried it — `POST /api/jobs` freezes
the rendered profile onto every job — and the stage now hands it to the prompt. With a reason, the
path heads for the takeaways that matter for it and spends most of its steps on the parts that bear
on it; it is still a path, still anchored, and never says a reason was given. With none, the prompt
has the same user message byte-for-byte (`tests/profile-prompts.test.ts`). The later 261001c change
also restored the pre-6Q system bytes: reader rules are now a separate system block, sent only when
a profile exists and after the article's cache breakpoint. The original plan and measurement are
[260930j](../plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md).

6Q kept *About you* to the vocabulary a question assumes. Greg reversed that the next day:

> yes, Quiz should definitely adapt heavily based on User-profile and Why-are-you-reading
>
> — Greg, 2026-10-01

The prompt (`QUIZ_READER_RULES`, a system block sent only with a profile) tells both halves to shape
**which parts** the quiz asks about, **what kind** of question it sets (someone applying the piece
gets more *how is it done, where does it break*), and **how it is pitched** (a question the reader
could answer from their own field without the piece is left out). The reason leads where both are
given; *About you* chooses within it. **The counterweight:** the last steps — normally three or four
in a twenty-question path, one or two in a short one — ask for the piece's conclusion and its main
evidence, taken from setup rather than from the reader's goal; in a long path, one closing question
is not enough.

**It is on `dev` as a partial step, not as the finished request.** It was shipped because readers
come out no worse on any measure, and better on the failure Greg named. Holding it would have kept
the rule he overruled. What the measurement did and did not show:

The measurement did not establish the main About claim. Across one article and two runs per arm,
both judges failed all three About bars: no measured pitch change, no predicted movement towards
findings and data, and no formal-topic gap between the electrophysiologist and tool-author profiles.
The goal still changed question kind (`APPLY` 53–55% against 7–20% with no profile), as the old
prompt already did. Four of six round-2 goal/profile runs met the 65% on-goal floor; the range was
61–79%. The balance improved without meeting its bar: every run had one or two questions on the
conclusion or its support, against three of six old runs with neither, but only three of six had
both and none had the required three central questions. The evidence therefore supports a modest
balance improvement, not the claim that the quiz yet adapts heavily to *About you*. Plan, exact
numbers and review conclusion:
[261001c](../plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md).

- **Not the shared profile machinery.** `profileSection` promises the profile changes *"nothing
  about its proportions"*, and `PROFILE_RULES` speaks of words spent and carries rules the quiz has
  no use for; the quiz needs the proportions to move and a balance rule in its own terms. So it has
  its own section and rules in [`src/quiz.ts`](../../src/quiz.ts).
- **Not in the stamp, and no `profileHash`.** Changing your goal never rewrites a quiz; *Write them
  again* is a forced run and picks up the goal at the press. A `profileHash` would put the quiz in
  the *make public* dialog as personalised (`ProfileCarrying`, src/store/pg.ts) though visitors
  never see a quiz. It arrives with the label that would read it.
- **`quiz/5` was not bumped**, so a stored quiz is not marked outdated by this; goal-aware
  generation arrived inside version 5 and reaches only quizzes written from now on.
- **Which jobs carry the goal.** Every quiz the reading view or Metadata asks for. Not a CLI run
  (`scripts/stage.ts` posts no profile), and a Retry reuses the failed job's own snapshot. A shelf
  read that fails is swallowed and the quiz is written without the goal, as for every profiled mode.
- **Visitors never see a quiz** (it is not in the public page's modes), which is why one batch per
  article can be the owner's. If that changes, visitors get a generic batch then.

## Where to look again

Greg, 2026-09-30 (SPIDERYARN-READING2-6R):

> Score each quiz answer against the article's blocks, giving a rough per-section picture of what the
> reader has got. That could steer your adaptive quiz (spya-jc2ub9) towards the sections they're
> weakest on, not just adjust its difficulty. And somehow indicate to the reader which sections to
> (re-)read next.

**A join, not a model call.** Each verdict is counted against the sections its question's evidence
blocks are in — the reading view's own Sections (`buildSections`, the level one above the leaves),
so the names are the ones on the spine. Once an answer this visit has been judged wrong, a block
under the step row names up to three sections, weakest first (the largest share of judged answers
wrong). Each name jumps the prose there — the (re-)read — and an icon beside it goes back to that
section's first missed question — the steer. The plan and GPT Sol's review are
[260930i](../plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md).

- **It names places and says nothing about the reader**: no count, no fraction, no "you got". No
  verdict counts as neither, so a skip or a failed classifier never puts a section on the list.
- **The path is still never reordered.** The steer is a jump back through `pick`, so the step shows
  its premise, a jump to the question already open does nothing, and only questions the reading
  filter lets the reader land on are offered.
- **Per visit, like the verdicts it is made of**: nothing stored, logged or sent, so the privacy page
  did not change. A stored per-section picture, new questions aimed at a weak section, and a
  "read these next" list of unread sections are deferred, with the reasons, in the plan.

## What is deliberately not here

- **Attempts are not stored.** A reload starts fresh. `batchId` is the shape that keeps the door
  open; nothing else about v1 assumes statelessness. **The adaptive walk did not change this**: the
  path, the position in it and the hidden verdict map are React state and die with the visit (the
  verdict map also resets on a new batch). The verdict is not written to a log either — a per-answer
  right/wrong on a log line is a stored grade wearing a different hat, and
  [privacy.md](privacy.md) makes a public promise about it.
- **No reader profile in the stamp**, so no `profileChanged` on the response, although the prompt
  reads the profile since 2026-09-30 (above). Adding one later needs no migration — it would be a
  field on the JSON.
- **Not scoped to `?at=`.** Whole article, every time — narrowed only by what you have read,
  above. (The lines in the prose are placed by passage, but the band still walks the whole path.)
- **No spoken quizzing.** Greg asked for it — *"ideally this would work well with Live Dialogue
  mode"* — and then chose to defer it whole rather than half-build it. The reasoning, and the three
  shapes it could take, are in [the plan § Spoken
  quizzing](../plans/260831al-review-quiz-sub-mode.md).
- **The questions do not know what you already said in Recall.** Also Greg's, also deferred: *"it
  should ideally/eventually take into account if the user has provided a freeform brain dump of what
  they remember"*. That wants a per-reader batch, which wants the profile in the stamp.
- **No "written for: …" line** in the band, like Skim's *Reading for*. Greg: keep it simple.

## See also

- [remember-mode.md](remember-mode.md) — the other half of the band, and the prompt faults this one
  inherited the fixes for
- [block-ids.md](block-ids.md) — the contract every `blockId` here is bound by
- [ai-gateway.md](ai-gateway.md) · [prompt-caching.md](prompt-caching.md) — the wire, and the
  breakpoint both prompts respect
- [ingest-queue.md](ingest-queue.md) — how a button in a band becomes a job
- [silent-success.md](../reusable/silent-success.md) — twenty plausible questions about nothing in
  particular look exactly like twenty good ones
