# Quiz — the questions the article asks back

**Built 2026-08-31 to 2026-09-01.** The second half of [Remember](remember-mode.md). Recall asks the
reader what they took from the piece; Quiz asks them a dozen short-answer questions the piece itself
would set, and says how each answer sits against it.

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
[`src/routes.ts`](../../src/routes.ts) § `GET /api/quiz/:slug`, `POST /api/quiz/:slug/mark`,
[`src/web/useQuiz.ts`](../../src/web/useQuiz.ts),
[`src/web/QuizPanel.tsx`](../../src/web/QuizPanel.tsx),
[`src/web/App.tsx`](../../src/web/App.tsx) § `RememberBand`, `QuizSubBand`.
Types: [`src/types.ts`](../../src/types.ts) § `QuizQuestion`, `QuizEvidence`, `Quiz`, `QuizDropped`.
Tests: [`quiz.test.ts`](../../tests/quiz.test.ts),
[`quiz-panel.test.tsx`](../../tests/quiz-panel.test.tsx),
[`quiz-mark-route.test.ts`](../../tests/quiz-mark-route.test.ts),
[`quiz-mark-stream.test.tsx`](../../tests/quiz-mark-stream.test.tsx),
[`quiz-step-registration.test.ts`](../../tests/quiz-step-registration.test.ts).
Eval: [`evals/quiz.ts`](../../evals/quiz.ts) — **read this before editing either prompt.**
The plan, the spike and two cross-family reviews:
[260831al](../plans/260831al-review-quiz-sub-mode.md) and
[its review](../plans/260831al-review-quiz-sub-mode-review-sol.md).

## The order, and why it is not `ease + value`

Greg asked for two things at once — easy first, and central first — and the obvious reading of that
is a single blended score. **It is wrong, and the plan proposed it before a review caught it.** A
hard-central question scores (1, 5) and an easy-peripheral one (5, 1); both sum to 6, and the
tie-break towards *value* then puts the hard one first. The rule meant to open with something
answerable opens with the hardest question in the batch.

So the sort is lexicographic and the two judgements never mix:

**band** (`easy` → `medium` → `hard`), then **value** descending, then **document position** of the
first evidence block. [`orderQuestions`](../../src/quiz.ts) is the one place it happens, against the
whole batch, once. The panel never re-sorts — a second opinion about the same list is two lists that
drift.

**`ease` became a three-valued `band` after a spike measured the alternative.** Asked for a 1–5
integer on a real article, the model never left 2–4 across 24 questions, and `value` never went
below 3. A scale whose ends are never used is not a scale: four distinct sums across a dozen
questions leaves most of the list in arbitrary order, and one run had a five-way tie. Bands plus a
spread rule force the model to commit. The measurements are in
[the plan § Quotas](../plans/260831al-review-quiz-sub-mode.md).

**The spread rule is presence at each end, not a proportion.** A batch of four or more must carry at
least one `easy` and one `hard`, measured against what survived validation; a shorter batch is asked
for nothing, because demanding a spread from a three-question article is an instruction to pad. The
prompt asks for three of each end of a full twelve, and that difference is deliberate: the prompt
states a target, the gate enforces a floor, and asking the model for one of each would make the floor
the normal distribution. **The prompt does not mention the floor**, for the same reason — publishing
the lower number invites the model to aim at it. [`missingBandEnds`](../../src/quiz.ts) is where it
lives; the prompt should state what a good batch looks like and describe our machinery not at all,
which is what went wrong when it promised a retry that never existed.

It was a proportion — `min(3, floor(n / 4))` — until a production build failed on 2026-09-03 having
paid for nine good questions carrying one `hard`, and the number is gone rather than retuned:
[260903c](../plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md).

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
button in the band, cached per article and stamped. Its fingerprint is
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

- **One question at a time**, with *Show all twelve* underneath. Picking from the list closes it
  again, so the band goes back to one question and a box.
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
  clears the attempt along with the index and the draft. Not tidiness: a mark still streaming holds
  `useQuiz`'s one live request, and without the clear the new batch's Answer button is enabled and
  does nothing.

## What is deliberately not here

- **Attempts are not stored.** A reload starts fresh. `batchId` is the shape that keeps the door
  open; nothing else about v1 assumes statelessness.
- **No reader profile in the stamp**, so no `profileChanged` on the response. Adding one later needs
  no migration — it would be a field on the JSON.
- **Not scoped to `?at=`.** Whole article, every time.
- **No spoken quizzing.** Greg asked for it — *"ideally this would work well with Live Dialogue
  mode"* — and then chose to defer it whole rather than half-build it. The reasoning, and the three
  shapes it could take, are in [the plan § Spoken
  quizzing](../plans/260831al-review-quiz-sub-mode.md).
- **The questions do not know what you already said in Recall.** Also Greg's, also deferred: *"it
  should ideally/eventually take into account if the user has provided a freeform brain dump of what
  they remember"*. That wants a per-reader batch, which wants the profile in the stamp.

## See also

- [remember-mode.md](remember-mode.md) — the other half of the band, and the prompt faults this one
  inherited the fixes for
- [block-ids.md](block-ids.md) — the contract every `blockId` here is bound by
- [ai-gateway.md](ai-gateway.md) · [prompt-caching.md](prompt-caching.md) — the wire, and the
  breakpoint both prompts respect
- [ingest-queue.md](ingest-queue.md) — how a button in a band becomes a job
- [silent-success.md](../reusable/silent-success.md) — twelve plausible questions about nothing in
  particular look exactly like twelve good ones
