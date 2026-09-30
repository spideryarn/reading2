# Quiz questions in the prose, and so in Trajectory's stops

**Status:** built, in review · 2026-09-30 · from [SPIDERYARN-READING2-6V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6V),
an admin report (Greg's own account, checked with `scripts/feedback-reporter.ts`, exit 0).

## What Greg asked for

> Let's try adding quiz questions to the trajectory mode. I don't exactly know what the interface for
> this would look like.
>
> I was just thinking back to the experiment we made with decorated.html, which looks like it was
> actually including quiz questions in the text as you read along, where it would ask you sort of in
> situ, hey, by the way, you know, what did you take away from that last section? It's actually a
> cool idea. So why don't we say, when you're in quiz mode, that maybe it does that, i.e. It shows you
> quiz questions in the text.
>
> Actually, let's just go one step further and say if you've generated quiz questions, it should
> always show them in situ in the text, whether you're in quiz mode or not.
>
> And then we could reuse that in trajectory mode somehow. For example, one option would be that you
> add the quiz questions for some or all trajectory steps in the left-hand column underneath, so that
> the quiz questions aren't their own step; they're part of an existing step.
>
> Or maybe alternatively they'd be better off as their own step. I'm not sure. Perhaps spin off a
> couple of Opus and/or GPT-Sol agents with different personas or as product managers to generate
> and/or review screenshots of prototypes of different, or mock-ups of different versions of this,
> and then. And then make a decision about what you think will make for the best user interface.
> Don't add too much complexity at this stage, so I guess prioritise ideas by a combination of ease
> and value.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6V, sent from Trajectory on `pmc13013618-spya-uekgh6`)

## The design pass

Two product managers, as asked, each working alone:

- **GPT Sol, "the pragmatic PM"** — read the code and costed each option
  ([its answer](260930i-design-pass-sol-pm.md)).
- **Opus, "the learning-science PM"** — built the options as DOM injected into the real running
  app on a 1,687-word essay (`vb-spya-vu3xen`, 12 questions, an 8-stop route) and screenshotted
  them at 1280 and 390 wide.

| Option | Screenshot | Opus | Sol |
| --- | --- | --- | --- |
| **P1** a quiet question line after the passage it is about; pressing it opens Quiz there | [1280](260930i-mock-p1-marker-1280.png) · [390](260930i-mock-p1-marker-390.png) | 1st | 1st |
| **P2** the same line, pressed open into an answer box in the prose | [1280](260930i-mock-p2-expanded-1280.png) · [390](260930i-mock-p2-expanded-390.png) | P1's pressed state, *if cheap* | 4th: high cost |
| **P3** decorated.html's gate at the end of each top-level section | [1280](260930i-mock-p3-gate-1280.png) | defer | 3rd |
| **T1** the stop's questions on its card in the band | [card](260930i-mock-t1-card-1280.png) · [prose, 390](260930i-mock-t1-prose-390.png) | prose half only | 2nd |
| **T2** a question as its own stop | [1280](260930i-mock-t2-stop-row-1280.png) | last | last |
| **T3′** (Opus's own) the pass's questions at its end, above *More detail ›* | [1280](260930i-mock-t3-end-of-pass-1280.png) · [390](260930i-mock-t3-end-of-pass-390.png) | 3rd | — |

What decided it:

- **They agree on P1**, and it is Greg's firmest sentence — *"always show them in situ in the
  text"*. The Trajectory ideas are his exploratory ones (*"somehow"*, *"I'm not sure"*).
- **P1 is already the Trajectory feature.** A stop is a passage in the prose, and the question line
  hangs after that passage, just above **Next stop ›** — the [390 shot](260930i-mock-t1-prose-390.png)
  shows it. On a phone the band steps aside once you walk, so the prose is what a Trajectory reader
  actually sees.
- **The card version asks the same question twice.** Opus's finding on stop 1: the cue says *"What
  three-part practice does the author offer…"*, the quiz question *"What three things does the author
  say to do…"*. The card is read *before* the passage; the prose line comes *after* it, so the cue is
  the pre-question and the quiz question the recall.
- **A question as its own stop (T2)** would turn the route from "a list of Quotes" into a union of
  two things, each with its own position, address and door — two independently ordered paths braided
  together, for the least value.
- **Answering in the prose (P2)** means lifting most of `QuizPanel`'s answer surface — dictation, the
  answer/mark binding, the streamed mark, the batch 409, the premise rule — into a second place, and
  streaming tokens through `memo(TableView)`. The Quiz band already does all of that, one press away.
- **What decorated.html actually did** (Sol): its gate asked one generic free-recall question per
  section, nobody marked it, and it revealed the section summary. It was not Quiz. So P3 recreates
  the look of the memory rather than the request.

## What v1 does

1. **Every question is shown in the prose** after the block holding its **last** evidence passage in
   document order — only then has the reader met all of what it is about. Questions anchored on the
   same block share one row group, in path order. **The question's words only, never its premise**
   (a premise is an earlier question's answer; quiz.md § It adapts). A muted line in the prose column
   with Quiz's `MessageCircleQuestionMark`, apparatus (`user-select: none`), the whole line a button.
2. **Pressing it opens Quiz at that question**: `?mode=remember&remember=quiz`, `thread` cleared, one
   pushed entry — Remember's rule 1 — and an in-memory **arrival** that `QuizPanel` takes and turns
   into `move(index, false)`. That is a jump, so the premise is shown, as for a pick from the list.
   Pressing another line while Quiz is open does the same. Which question is open stays out of the
   URL (quiz.md § On screen), so the arrival is state that `Reader` holds, handed down the way
   chat's `ChatHandoff` is, and cleared once taken.
3. **In every mode, including Trajectory and Quiz itself**, for an owner, whenever there is a current
   quiz. Not when the quiz is `stale` (its evidence may no longer be the prose). An `outdated` quiz
   (older prompt) is still shown, as it is walked.
4. **In Trajectory, nothing else.** The row hangs before the door in the same place.

### How

- **`useQuizRead` / `useQuiz(slug, read)`**, the Quotes split (`useQuotesRead`): the opening GET moves
  up to `ArticlePage` and into the owner capability as `quiz`, so the prose has the list in every
  mode; `QuizSubBand` layers the job and the marks on top, and a finished job's `refresh` updates the
  prose too — *Write them again* moves the lines to the new batch. No job subscription at the top, for
  the reason `QuotesBand` gives.
- **`src/web/quiz-anchors.ts`** (pure): the quiz and the article's blocks → `Map<BlockId,
  QuizQuestion[]>`. A question with no evidence block still in the article is not placed.
- **`TableView` gets a second slot, `quizAfter`** — a memoised `ReadonlyMap<BlockId, ReactElement>`,
  drawn after `.prose` and before `afterBlock`, on `afterBlock`'s path (a sibling of `.prose`, so no
  comment offset moves). `afterBlock` stays one mode's single slot, as its comment says; the quiz
  lines are a standing property of the article, like the quote marks, and are memoised in `Reader` on
  the quiz, its staleness and a stable press handler, so scrolling costs `TableView` nothing.
- **The arrival and the tick-box.** If *Only what I've read* would filter the arriving question out,
  `QuizPanel` turns the tick-box off (visibly) rather than landing somewhere else — the reader asked
  for this question by name. A question id not in the batch on screen (a new batch in between) is
  taken and ignored.

### GPT Sol's plan review, and what changed

[The review](260930i-quiz-questions-in-the-prose-review-sol.md): no P0, *"revise before building"*,
all seven taken.

1. **The arrival names its batch** — `{ batchId, questionId }`; an arrival from another batch is
   taken and ignored, because a replacement batch may reuse ids with new meanings (quiz.md § The
   artefact, and the batch every mark binds to).
2. **One landing, after the batch reset, safe under StrictMode.** The arrival effect is declared
   after the reset and filter effects, so its `setAt` is the one that lands in their commit; it is
   idempotent, so running twice lands in the same place; only `onTaken` is guarded (the parent
   clears the arrival only if it is still the same object). `Reader` clears an untaken arrival when
   the mode leaves Remember.
3. **Pressing the line for the question already open does not move** — `pick`'s rule, because
   `move` aborts a streaming mark and drops the draft.
4. **A render-count test**: an `at`-only update does not render `TableView`; a new batch does.
5. **Tests for two display rules**: no premise text in the prose; an `outdated`, non-stale quiz is
   still drawn.
6. **`answered` resets with the batch** in `useQuiz` (a pre-existing gap: a reused id could show a
   new question ticked).
7. **The navigation test** starts from another mode with `remember=recall&thread=…`, and checks one
   pushed entry, `thread` cleared, one Back restoring the old address, and no job POST.

### What the browser check found

A Sonnet agent drove the built page on `vb-spya-vu3xen` (1280 and 390, plain, Glossary, Trajectory,
pressing lines, copy-select). Two defects, both fixed before review:

- **The lines hung left of the text** — 6px in Plain at 1280, 36px (under the gutter's icons) with a
  band open — because `.prose` is a centred 65ch box inside a wider cell and the line was drawn
  against the cell. The line now takes `.prose`'s own `max-width` and `margin-inline: auto`, in the
  reading face and size so `ch` is the same width.
- **A second press while Quiz was open pushed an identical entry**, so one Back did nothing. It now
  sets only the arrival when Quiz is already open. The test went red first.

Otherwise: 12 lines on a 41-paragraph essay, not a wall; clear of **Next stop ›** by 8px at both
widths; `user-select: none` holds; one Back after a press restores the old view.

### Passed over

- **Read-aware lines** (hide a question until its passages are read). The reading levels change every
  minute; putting them in the memo would re-render `TableView` over the whole article, and a
  question's words before you reach its passage are a pre-question, not a giveaway.
- **One slot, merged**: making `afterBlock` a map would braid the open mode's door with a standing
  feature; two props is fewer parts touching.

## Deferred

- **Answering in the prose** (P2), and with it any in-prose mark. The trigger: Greg finds the trip
  to the band is the friction.
- **The pass's questions at the end of a pass** (T3′), above *More detail ›* — the best retrieval-
  practice fit of the Trajectory options, and it reuses this row. Next step if the prose lines prove
  their worth.
- **Questions on the stop card** (T1), **section gates** (P3), **questions as stops** (T2).
- **Showing which line is the question open in Quiz**, and ticking answered ones in the prose.
- **Visitors.** The quiz is not in the public payload and marking is an owner POST, so a visitor sees
  no lines, by construction.

## Tests

- `quiz-anchors`: last evidence block wins across sections; shared anchors group in path order; a
  question whose blocks have gone is not placed.
- `QuizPanel`: an arrival moves to its question with the premise shown; turns *Only what I've read*
  off when it would hide it; an unknown id is taken and ignored; taken once.
- The prose: lines render after the right block in every mode, before Trajectory's door, not when
  stale, and pressing one sets the mode, the sub-mode and the arrival in one push.
