# Make the quiz adaptive

**Status: revised after cross-family review, building.** Written 2026-09-07 in
`worktree-adaptive-quiz`. The review is
[260907d-…-review-sol-1641.md](260907d-make-the-quiz-adaptive-review-sol-1641.md); it said *"I would
not build the plan as written"* and this is the version that answers it. What changed is listed at
the bottom.

Get one right and the next is harder; get one wrong and the next is easier. This replaces the
difficulty slider Greg asked for in SPIDERYARN-READING2-21, and the replacement is the point rather
than a compromise.

Greg chose this on 2026-09-06 over three other endings — declining the slider, a narrower slider, and
building it as asked. **No verbatim quotation from him survives**, so there is none here; what
follows is the reasoning as recorded on the day, in the note-taker's words rather than his.

The reasoning: it serves the goal the slider was for — start easy, stay at the right level —
**without a knob and without exposing scores**. So the thing being built is not a control. It is the
absence of one. The reader never learns what `band` or `value` mean and never has to tune anything
to get a quiz pitched at them.

Context: [quiz.md](../project/quiz.md) · [remember-mode.md](../project/remember-mode.md) ·
the report [260905_1800](../user-feedback/260905_1800-quiz-questions-too-hard.md) ·
the deferral [260905g § Three questions for Greg](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md#three-questions-for-greg-and-one-decision).

---

## The problem this plan is really about

The ladder is easy. **The signal that drives it does not exist, and the product refuses to produce it
on purpose.**

[quiz.md § What a mark says, and what it may not](../project/quiz.md): *"No score, no grade, no
fraction, no 'mostly right'. The reply confirms claims and points at passages; it never says how the
reader did."* `gradeWords` in [`src/quiz-mark.ts`](../../src/quiz-mark.ts) counts the grading
vocabulary on every real mark precisely to watch that rule leak.

An adaptive quiz needs to know whether the reader got it right. So the whole of the difficulty is
this: **how do we obtain a correctness judgement without putting one in front of the reader, and
without disturbing the one prompt in this feature whose tone is the product?**

The review's sharpest sentence, and the one that decided the design:

> a slightly worse mark is visible on every answer. A missed adaptive move is invisible and
> comparatively harmless. The risk budget should favor the prose.

## What we are building, in one paragraph

The server keeps ranking the batch exactly as it does today — `orderQuestions`, once, band then value
descending then document position. The client walks that ranking instead of stepping along it. It
starts at the front of the server's array and, after each finished mark, picks the next unseen
question by stepping one band from **the band of the question just answered** — harder if right,
easier if wrong, staying put if we could not tell. A **separate, small classifier call** reads the
question, the reader's answer and the finished mark and returns `right` or `wrong`; its answer rides
the terminal `done` frame, is optional, and is never rendered, logged or stored. Nothing persists; a
reload starts the quiz fresh, as now.

---

## The three decisions the slider collided with, and what adaptive does about each

[260905g](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md#three-questions-for-greg-and-one-decision)
parked this work behind three things already decided with an argument attached.

**1. "A combination of centrality and easiness" is the blend that was killed on review.**
Hard-central `(1,5)` and easy-peripheral `(5,1)` both sum to 6, so a blend cannot tell them apart and
the tie-break opens with the hardest question in the batch — the exact complaint the report starts
with. *Adaptive never blends them.* Band picks the rung; value picks which question on that rung, via
the server's existing order. The two judgements stay in different jobs, which is the finding that
killed the blend, honoured rather than worked around.

**2. The panel deliberately shows neither `band` nor `value`.** The glossary's condition for keeping
model scores at all is that the number you sorted by is printed on every row
([glossary.md](../project/glossary.md)); `QuizPanel` prints neither on purpose, because a difficulty
label changes how the reader answers. *Adaptive has no control, so there is no number to justify
printing.* The metadata stays in the payload — it is already there — and stays off the screen. A
**hard constraint on the build**: no "here's a harder one", no pips, no level indicator, no change to
the "Question 3 of 12" line, and no new copy anywhere that refers to difficulty.

**3. The quiz sorts on the server, once.** This is the invariant nearest to the work, and the review
was right that the first draft of this plan talked its way around it. Its own section follows.

## The invariant, amended honestly rather than reinterpreted

`QuizPanel` says: *"a panel that sorted would be a second opinion about the same list, and two lists
drift."*

The first draft argued that one-at-a-time selection is not ordering. **The review called that
sophistry and it was right.** An adaptive walk plainly produces a new encounter order: easy → medium
→ hard → medium is not a subsequence of the server's array, so the "subsequence" tripwire the first
draft proposed was not merely weak, it was false. Preserving an invariant by redefining its words
makes every later change impossible to judge.

So the invariant is **amended**, in `QuizPanel` and in quiz.md, to say what is actually true:

> The server remains the sole authority for the static ranking. Adaptive traversal may change the
> cross-band encounter order, but it must preserve the server's relative order **within** every
> band, and the client must never sort.

That is a real constraint and it is testable: within any one band, the questions must be met in
server order, always. It keeps the property the original rule was protecting — there is exactly one
opinion about which `hard` question is the best `hard` question, and it is `orderQuestions`' — while
being honest that the reader now meets the bands in an order the server did not choose.

**The tripwire, restated so it is true:** no `.sort()`, no comparator, and no re-scored copy of
`questions` on the client. Selection is a scan of the server's array front to back for the first
unseen question in a given band. *Show all twelve* keeps showing the server's order, untouched.

Selection stays client-side. Moving it to the server would need either a round trip per question or
the client posting its history up, which is more machinery for no product gain — and the history is
the thing we have promised not to store.

---

## The correctness signal

**Chosen: a separate classifier over the finished mark.** The review's fifth option, which neither of
us had at the start and which is better than the four the first draft weighed.

After the mark stream finishes, a second, small model call is given **the question, the reader's
answer, and the visible mark that was just produced** — and nothing else. It returns one token:
`right` or `wrong`. That verdict is attached to the terminal `done` frame, optionally. The reader
never sees it; nothing writes it down.

Why this one:

- **`QUIZ_MARK_SYSTEM` is not touched at all.** That prompt spends two pages separating confirmation
  from grading, and asking the same generation to decide a verdict first would make grading its
  opening framing task. Telling it "now write the prose as if you hadn't" does not undo the
  conditioning, and the eight-case eval is far too noisy to prove it did — quiz.md already records
  two runs of an *identical* prompt scoring 0 and 3 on `gradeWords`. A tone regression would be
  visible on every answer and unprovable either way. Not a risk worth taking for a signal whose
  failure mode is one mis-pitched question.
- **It is cheap, because it does not need the article.** The mark it is reading has already done the
  work of comparing the answer against the piece, with citations. The classifier is a reading-
  comprehension task over three short texts.
- **It cannot break streaming.** No first-line buffering, no strip-the-prose heuristic, no
  reply-replay when the model ignores the instruction — all of which the review took apart in the
  first draft's option A. The visible stream is byte-for-byte what it is today.
- **It is off the critical path.** The verdict is not needed until the reader presses Next.

Cost: one extra call site, and the terminal frame arrives a beat later than the last delta. That beat
delays only the answered tick, not a word of what the reader is reading.

**What was rejected, and why, kept because the reasons are the design:**

- **A hidden `GOT:` line at the top of the mark** — the first draft's recommendation. Rejected above.
- **A trailing verdict** — cannot be found without buffering the whole reply, which un-streams a mark
  a person is watching arrive.
- **A separate classifier over the whole article** — the honest fallback if the mark-reading
  classifier cannot tell the four hard cases apart (see Measuring). Kept in reserve, not built.
- **Regexing the mark for agreement** — `gradeWords` pointed the wrong way. It would make the ladder
  depend on the exact phrasing the marking prompt exists to suppress.

**One thing the first draft got factually wrong**, caught by the review and verified here: it claimed
a separate call would ride the mark call's article cache. It would not.
[prompt-caching.md](../project/prompt-caching.md): *"A cache matches bytes, not intentions. The prefix
has to be identical, character for character, from the very top of the request."* A different system
prompt changes the bytes before the article, so the cache entry is unreachable — and using the
identical system prompt would surrender exactly the isolation the separate call is for. The argument
is deleted rather than repaired; the design does not need it, because it does not send the article.

### Two values and an absence, not three

The first draft proposed `right` / `partly` / `wrong`, with `partly` holding the rung. **Dropped.**
Greg's rule is binary, and `partly` is a fuzzy middle that would absorb a large share of short-answer
responses and leave the ladder stationary while looking adaptive.

Instead: **`right`, `wrong`, or nothing at all.** A partial answer is `right` if what is missing does
not change whether the question was answered, and `wrong` if it does — which is a judgement, but it
is the same judgement the marking prompt already makes carefully, and it is made by a classifier
reading that mark.

**Absence is a first-class outcome, not an error path.** No verdict when: the classifier call fails,
times out or returns anything that is not one of the two words; the question is genuinely unsettled
by the article; the mark never reached `done`; the reader skipped, or their attempt failed, or their
answer was superseded by an edit. Absence holds the band. That makes every failure mode of this
feature *quiet and harmless*, which is the property worth designing for: the worst thing a broken
classifier can do is give the reader another question at the same level.

---

## The ladder

Three rungs — `easy`, `medium`, `hard`. Two changes from the first draft, both from the review.

**There is no separate "rung" state.** The target is computed from **the band of the question actually
being answered**, plus that answer's verdict. One less state variable, no way for a hidden rung and
the visible question to drift apart, and manual picks from the list stop being a special case.

**The band search is total.** A table of nine entries, not a rule with a "then anything" at the end:

| band answered | `right` → | `wrong` → | no verdict → |
|---|---|---|---|
| `easy` | medium, hard, easy | easy, medium, hard | easy, medium, hard |
| `medium` | hard, medium, easy | easy, medium, hard | medium, easy, hard |
| `hard` | hard, medium, easy | medium, easy, hard | hard, medium, easy |

Read a row as: try each band in turn, and take the **first unseen question in that band, scanning the
server's array front to back**. Every row lists all three bands, so the search always terminates with
an answer while any question is unseen, and there is no undefined case. The pattern is the review's:
*target first, then continue in the verdict's direction, then reverse*; bounded at both ends, so
`right` at `hard` and `wrong` at `easy` stay put.

### The edges, stated

- **The first question is `questions[0]`** — the front of the server's array. That is the highest-value
  question in the *lowest band present*, which is usually `easy` but **is not guaranteed to be**: a
  batch below `SPREAD_FROM` (= 4) is exempt from the spread rule entirely, so a three-question
  article may contain no `easy` at all. The first draft's "the first question is always easy" was
  simply false. Deterministic, not random: two readings of the same article should open the same way,
  and the eval below needs it to be reproducible.
- **Top and bottom.** `right` at `hard` stays at `hard`; `wrong` at `easy` stays at `easy`. Nothing is
  invented above or below.
- **Exhaustion is not adaptation, and gets called that.** A struggling reader who exhausts every
  `easy` and `medium` question will eventually be handed a `hard` one, because the alternative is
  ending their quiz. That is the honest consequence of "no auto-end" and it is documented as
  exhaustion rather than dressed up.
- **Everything seen.** Next is disabled, exactly as it is today at the end of the array. No
  wrap-around.
- **A run of wrong answers does not end the quiz.** Ending someone's quiz because they are getting
  things wrong is a verdict about the reader delivered by the machine, which is the thing
  [remember-mode.md](../project/remember-mode.md) and the marking rules refuse; and "we stopped
  because you were struggling" would be the loudest possible leak of the difficulty we are hiding.
  The review agreed, and added a correction this plan accepts: adding it later is **not** "one counter
  and one sentence" — it would expose hidden grading, and needs a fresh product decision rather than a
  cheap follow-up.

---

## Navigation, specified before it is built

The review's third finding: `path + cursor + rung` does not actually define the behaviour, and
`A → B → C → Previous to B → pick D` breaks it. So the state is specified here, in full, first.

**State** (session-only, all of it):

- `seen: QuizQuestionId[]` — every question shown, in the order first shown. **Unique**, which is what
  keeps "Question *n* of 12" from exceeding 12 and stops a question being selected twice.
- `cursor: number` — index into `seen` of the question on screen.

No rung. No verdict history — a verdict lives on the attempt, and only the attempt for the question
on screen is ever consulted.

**Transitions:**

| action | behaviour |
|---|---|
| **Next**, at the tail (`cursor === seen.length - 1`) | Select via the table above, from the on-screen question's band and its attempt's verdict. Append, `cursor++`. |
| **Next**, inside history | Move forward through `seen`. **No new selection**, no verdict re-applied. |
| **Previous** | `cursor--`, never below 0. Walks the encounter order. |
| **Pick from *Show all*, already seen** | `cursor` moves to its position in `seen`. Nothing else changes. |
| **Pick from *Show all*, not yet seen** | Append, `cursor` to the end. **The pick itself moves nothing** — the reader reached past the ladder, so the ladder learns nothing from the reach. |
| **Answering that picked question** | Does move the ladder, on the next Next. Picking is not evidence; a finished mark is, wherever the question came from. |
| **New `batchId`** | `seen = [questions[0].id]`, `cursor = 0`, plus the existing draft/attempt/list resets. |

**The one surprising case, chosen deliberately.** After `A → B → C → Previous to B → pick D`, `seen`
is `[A, B, C, D]` and Previous from D goes to **C**, not B. `seen` is the order the reader met the
questions in, and Previous walks it. The alternative — remembering where the reader jumped from —
needs a second stack to serve one rare gesture, and the four properties above cannot all hold at once
anyway. Named here because it is the kind of thing that otherwise gets discovered as a bug.

A verdict is never applied twice, because selection happens only at the tail and only reads the
on-screen question's own attempt.

---

## Shape of the change

**`src/quiz-ladder.ts`** — new, pure, no React and no fetch, so the eval can import it. Exports the
verdict type, the band table, and one function `(questions, seenIds, fromBand, verdict) → next
question | undefined`. Deterministic; no clock, no randomness.

**`src/quiz-verdict.ts`** — new. The classifier: its prompt, its one-token parse, its short deadline,
and its refusal to throw. Returns `"right" | "wrong" | undefined`, never rejects.

**Changed:** `src/types.ts` (`verdict?` on `QuizMarkResult`), `src/quiz-mark.ts` (call the classifier
after the stream completes, put it on `done`), `src/routes.ts` (pass the field through),
`src/web/useQuiz.ts` (read it onto the attempt), `src/web/QuizPanel.tsx` (`seen`/`cursor` in place of
`at`; `QuestionList` keyed by id rather than index), `docs/project/quiz.md` (the amended invariant,
the ladder, the classifier).

**`src/web/modes/` note.** The A1–A3 refactor has landed — eleven controllers — but **quiz is not one
of them**: the client code is still `src/web/QuizPanel.tsx` and `src/web/useQuiz.ts`, wired in via
`modes/conversation/ConversationModes.tsx`. The brief expected a `modes/quiz/` home; there isn't one,
and this plan does not create one. That move is somebody else's stage and braiding it into a
behaviour change would make both harder to review.

## What is deliberately not in this

- **No item-response theory, no difficulty model, no calibration, no scoring.** A nine-cell table and
  a scan of an array.
- **No storage.** [privacy.md](../project/privacy.md) says publicly that answers *"go to a model to be
  marked and are not stored"*. `seen`, `cursor` and the verdict live in React state and die with the
  attempt. The verdict is **not logged** either — a per-answer right/wrong in the logs is a stored
  grade wearing a different hat. If any part of the build seems to need persistence, that is a
  stop-and-write-it-up.
- **No visible difficulty, anywhere.**
- **No new URL parameter.** A path through the questions is even less shareable than an index, and
  quiz.md's reasoning for keeping the index out of the URL holds harder here.
- **No change to generation or to `orderQuestions`.** The `easy`-leaning prompt shipped 2026-09-05, is
  measured, and is out of scope.

## The simpler options passed over

**Step the ladder on skipping rather than on correctness.** Pressing Next without answering means
"too hard"; answering means "go up". No classifier, no second call, no risk to anything. Genuinely
the cheapest thing with an adaptive shape, and it is on the record as the option this plan chose
against — because a reader who conscientiously answers all twelve would get no adaptation at all,
which is precisely the reader this feature is for, and because it conflates "I don't want to answer
this" with "I couldn't".

**Ask the reader.** A "did you get that?" tick after each mark is free and accurate. Rejected because
it is a control, and the whole reason Greg chose adaptive over the slider is that the reader should
not have to operate anything.

## Measuring it

*"It feels better" is not a result.* The review's sixth finding was that the first draft's simulation
was circular — defining a reader as "right on easy, wrong on hard" and then showing the ladder moves
accordingly proves only that the code follows its own table. That is accepted. So the simulation is
kept, **relabelled as what it is**, and real evidence is sought elsewhere.

**1. A worked trace (an acceptance test, not a finding).** `quiz-ladder.ts` is pure, so a simulated
reader is a function from a question to a verdict. It proves the transition table is implemented and
answers the one question the brief asks — *what does an adaptive run look like beside the fixed one* —
without pretending to be evidence that the bands suit anybody.

The falsifiable part, narrow on purpose: **the struggling reader must not meet a `hard` question in
the first five**, and **the confident reader must not still be on `easy` at question five**.

#### The result

The batch is the real one generated on 2026-09-05
([`evals/results/quiz-easier-2026-09-05.md`](../../evals/results/quiz-easier-2026-09-05.md)), in the
server's order — already paid for, and the current prompt's own output. Reading `e5` as *easy, value
5*:

```
batch (server order):    e5 e5 e4 e4 e3 e3 m5 m4 m4 h5 h5 h3
```

| reader | the questions they meet, in order | hard in first 5 | still easy at Q5 |
|---|---|---|---|
| **fixed order** (any reader) | `e5 e5 e4 e4 e3 e3 m5 m4 m4 h5 h5 h3` | 0 | **yes** |
| adaptive · **confident** | `e5 m5 h5 m4 h5 m4 h3 e5 e4 e4 e3 e3` | 2 | no |
| adaptive · **middling** | `e5 m5 e5 m4 e4 m4 e4 h5 e3 h5 e3 h3` | 0 | yes |
| adaptive · **struggling** | `e5 e5 e4 e4 e3 e3 m5 m4 m4 h5 h5 h3` | 0 | yes |

The readers are defined by what they can do, not by what would flatter the ladder: *confident* gets
easy and medium and misses hard, *middling* gets easy and misses everything above, *struggling* gets
nothing right.

**Both claims hold** — no `hard` in the struggling reader's first five, and the confident reader is
off `easy` by question two. But the honest reading of that table is more interesting than the pass:

- **For a confident reader adaptive is a large change.** The fixed order spends their first five
  questions on `easy`; adaptive has them at `medium` by Q2 and `hard` by Q3. This is where the
  feature earns its keep.
- **For a middling reader it is a real but modest change** — they alternate `easy` and `medium` and
  do not meet a `hard` question until Q8, where the fixed order hands them all three in a block at
  Q10–12.
- **For a struggling reader it changes nothing at all.** The adaptive walk and the fixed order are
  *identical*, and that is not a bug: the fixed order already opens with six `easy` questions,
  because the 2026-09-05 prompt work made it lean easy. Their problem was already solved by the
  cheaper fix, and adaptivity has nothing left to add for them.

That last row is worth stating plainly rather than burying, because it qualifies the whole feature:
**the reader whose complaint started this — "the quiz questions are too hard" — is the reader
adaptivity does least for.** What it adds is at the other end, for the reader the easy-leaning prompt
now under-serves. A run of wrong answers still walks them down to `easy` and keeps them there, which
is the behaviour asked for; it simply coincides with where the batch already started.

**2. The classifier, against labelled cases — this is the measurement that can veto the design.**
`evals/quiz.ts` already carries eight hand-written marking cases chosen as the eight ways the marking
prompt misbehaves, and four of them are exactly the hard cases for a classifier reading a mark:
`differentWords` (right, worded differently) and `elsewhere` (right, from another passage) must come
back `right`; `confidentlyWrong` must come back `wrong`; `poisonedReference` — where the mark defends
the reader against a wrong reference — must come back **`right`**, and getting that one backwards
would punish a reader for being right, which is the single worst thing this feature can do.
`illPosed` should return no verdict rather than a guess. Hand-label all eight, add one materially
partial and one genuinely ambiguous case, and run it more than once, because the model varies.

If the classifier cannot separate those, the fallback is the whole-article classifier named above —
and if that fails too, the honest outcome is to report that adaptivity cannot be driven safely and
stop, rather than ship a ladder that mis-pitches on a signal we know is wrong.

#### The result

`npm run eval:quiz -- --marks-only`, twice, 2026-09-07. Marking model `anthropic/claude-sonnet-5`,
classifier `openai/gpt-5.6-luna`. 16 model calls and **$0.1114** per run — eight marks and eight
verdicts.

**Six of seven labelled cases matched, and the two runs were identical — every one of the eight
verdicts the same both times.**

| case | hand label | verdict |
|---|---|---|
| `differentWords` — right, worded unlike the draft | right | **right** ✓ |
| `elsewhere` — right, from another passage | right | **right** ✓ |
| `confidentlyWrong` | wrong | **wrong** ✓ |
| `noIdea` — asked to be told | wrong | **wrong** ✓ |
| `moreComplete` — more than the draft had | right | **right** ✓ |
| **`poisonedReference`** — the mark defends the reader | right | **right** ✓ |
| `illPosed` — the article does not settle it | none | **right** ✗ |
| `half` — materially partial | *deliberately none* | `wrong`, both runs |

**The veto case passed.** `poisonedReference` is the one that would have stopped this shipping: the
draft answer is wrong, the reader is right, the mark takes the reader's side — and a classifier that
read that defence as `wrong` would hand a reader who was right an easier question, punishing them
for being right in a channel they cannot see. It came back `right`, twice.

**The one miss is in the harmless direction, and the label is arguable.** On `illPosed` the
classifier said `right` where the label wanted no verdict. The consequence is that a reader who was
careful about an unfair question gets a slightly harder one next — not that they are marked down. And
the label is genuinely debatable: the reader *was* right to be careful, so `right` is a defensible
reading of the same exchange. It is recorded as a miss rather than relabelled after the fact, because
moving a label to meet a result is how a measurement stops being one.

**The stability is the part worth noticing.** quiz.md records that two runs of an *identical* marking
prompt scored 0 and 3 on `gradeWords` — at eight cases, tone noise and a real regression are the same
size. The verdict is not like that: eight for eight identical across two runs, including the
unlabelled `half`. A one-word classification over three short texts is a far steadier thing to measure
than prose, which is part of why this design is safer than putting the verdict in the marking prompt.

Two runs is still two runs, and `evals/quiz.ts` says why counts here are a prompt to look rather than
a verdict.

**3. A real browser pass.** Take a quiz, answer wrongly on purpose, confirm the next question is
easier and that nothing on the page says so.

## Testing

- `quiz-ladder.test.ts` — all nine table cells; the bounded top and bottom; a missing `medium` stepped
  past; exhaustion; every question selected at most once; **the amended invariant** — within any band,
  questions are always met in server order.
- `quiz-verdict.test.ts` — `right`/`wrong` parsed; anything else, a throw, and a timeout all yield
  `undefined`; the classifier never rejects.
- mark-stream tests — a `done` frame with no verdict still marks and still ticks; a verdict never
  appears in a `delta`; the visible reply is unchanged.
- `quiz-panel.test.tsx` — the full transition table above, including the `A→B→C→Prev→pick D` case;
  answering wrongly leads to an easier question; **no band or value string is ever rendered**.
- Each ladder edge gets a red test before its branch exists.

## Stages

1. `src/quiz-ladder.ts` + tests. Pure, no UI, no model.
2. `src/quiz-verdict.ts` + tests, then the labelled-case measurement. **The design's veto point.**
3. Wire the verdict onto `done` through the route and the hook.
4. The panel: `seen`/`cursor` replacing `at`.
5. Trace table into this doc, browser pass, docs, bookkeeping, second review.

## What the review changed

1. **Option A → the review's fifth option.** The classifier reads the finished mark, so
   `QUIZ_MARK_SYSTEM` is untouched. All the first-line-buffering failure modes disappear with it.
2. **The verdict rides `done` only** — one protocol, not "a frame" in one paragraph and "the done
   frame" in another, and it keeps the deliberate zero-or-more-deltas-then-one-terminal-frame
   contract intact.
3. **The invariant is amended rather than reinterpreted**, and the false "subsequence" tripwire is
   replaced by the per-band one, which is true.
4. **`partly` is gone**; two values and an absence, with absence as a designed outcome.
5. **The rung state is gone**; the target derives from the answered question's band.
6. **The band search became a total nine-cell table**, with "then anything" deleted.
7. **Navigation is specified before implementation**, with `seen` unique and the surprising Previous
   case named.
8. **"The first question is easy" was false** below `SPREAD_FROM`; corrected.
9. **The simulation is relabelled** a worked trace, and the classifier gets the real measurement.
10. **The wrong prompt-cache argument is deleted.**

## Questions and assumptions for Greg

Recorded here rather than asked, since this runs autonomously.

1. **A run of wrong answers does not end the quiz** — the most likely thing to be overruled, and no
   longer cheap to add later.
2. **Picking from *Show all twelve* does not move the ladder, but answering the picked question
   does.**
3. **Previous walks the encounter order**, with the consequence named above.
4. **Assumed:** a hidden verdict does not violate "no score, no grade". The rule as written governs
   what the reply *says to the reader*; this one is never rendered, never logged, never stored, and
   dies with the attempt. The honest tension: the product refuses to grade, and this asks a model to
   grade in private — and adaptivity is itself a statement about the reader, made in the choice of
   the next question rather than in words. Greg chose adaptive knowing that; it is written down so
   the choice stays visible.
5. **Assumed:** *Show all twelve* keeps the server's order rather than the path.
