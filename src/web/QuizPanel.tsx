/**
 * **The Quiz band** — the questions the article would ask, and what the reader
 * made of them.
 *
 * The other half of Remember. Free recall asks the reader what they took from
 * the article; this asks the questions the article itself would ask, from a
 * batch written once and cached as an artefact (src/quiz.ts).
 *
 * ## One at a time, and the list underneath it
 *
 * The default is one question, because the point of a quiz is to answer rather
 * than to shop. *Show all N* is there because Greg asked for it and the reason
 * is a real one — a reader who cannot answer this question may be able to
 * answer the next, and hunting for that by pressing Next a dozen times is worse
 * than reading a list. Picking from the list closes it again, so the band is
 * back to one question and a box.
 *
 * ## The order is the path
 *
 * Since `quiz/5` the batch is a path the model set, each step leaning on the
 * ones before and ending at what the piece is for, and it is **never re-sorted
 * here**: Next is the next question in the array and Previous the one before.
 * A panel that sorted would be a second opinion about the same list, and on a
 * path it would ask a step before the one it leans on.
 *
 * **What adapts is the help, not the order.** A step may carry a premise — the
 * answer to the step before, restated — drawn as a quiet line above the
 * question, and hidden only when the reader has just come here with Next from a
 * step judged right. The rule is src/web/quiz-ladder.ts § `showPremise`; this
 * file owns the two facts it needs, the verdicts and how the reader arrived.
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md § The walk.
 *
 * ## Only what you have read
 *
 * > if there's a tick box that defaults to only show me questions for stuff
 * > I've read, and then it would only show quiz questions for the stuff that
 * > the user has read.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-61)
 *
 * With reading time on, a tick-box, on by default, narrows the walk to the
 * questions whose evidence passages the reader has read (src/web/read-filter.ts
 * says what "read" means). **The path is not rebuilt**: `at` stays an index into
 * the artefact's array, and the filter only changes which indices can be landed
 * on. A Next that skips an unread step is not an arrival from the step before,
 * so the premise is shown — it is the bridge over the step skipped. And the
 * panel never draws a question it has not committed to: while the one at `at`
 * is filtered out, nothing interactive is drawn, and an effect moves through
 * `move`, which takes the draft and the mark with it. GPT Sol's findings on
 * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md.
 *
 * ## "Show a reference answer", and the word that is not "the"
 *
 * The button says *a* reference answer, and that is the whole design of it.
 * What is behind it was written by a model over the whole article before any
 * reader answered anything, and it is wrong often enough that the marking
 * prompt is told outright the article outranks it (src/quiz-mark.ts, and
 * `evals/quiz.ts` poisons one on purpose to check). Calling it *the* answer
 * would tell the reader their better answer was worse.
 *
 * It is collapsed rather than absent for the obvious reason: a reader who has
 * given up wants it, and a reader who has not must not have it in the corner of
 * their eye while they type.
 *
 * ## The two rules that are not cosmetic
 *
 * **A question is ticked answered only when the mark reaches `done`.** That
 * lives in `useQuiz`, not here; what this file must not do is draw a completed
 * mark from a `reply` that is merely non-empty. `attempt.status` is the only
 * thing consulted, and a `"failed"` attempt keeps its half-written reply on
 * screen *and* keeps the Answer button live. A stream that stops cleanly
 * without finishing looks exactly like one that finished, which is the failure
 * this whole shape is arranged against.
 *
 * **A mark stays bound to the exact answer and batch it was computed for.** The
 * box goes editable again as soon as a mark lands, so without this the reader
 * sits in front of feedback about a sentence they have deleted, under a line
 * that still says the question is answered. `superseded` below is the answer
 * half; the `batchId` effect is the batch half, and that one also releases the
 * old request, which is otherwise still holding `useQuiz`'s single live slot
 * and leaves the new batch's Answer button enabled and inert.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, List, MessageCircleQuestionMark, RotateCcw, TriangleAlert } from "lucide-react";
import type { BlockId, QuizQuestion, QuizQuestionId, QuizVerdict } from "../types.js";
import { MAX_QUIZ_ANSWER_CHARS } from "../types.js";
import { showPremise } from "./quiz-ladder.js";
import { firstWrongIn, type SectionTally, sectionTally, weakSections } from "./quiz-sections.js";
import type { Section } from "./position.js";
import { lastBefore, questionIsRead, type ReadSoFar, readShareLabel, shareRead } from "./read-filter.js";
import type { Attempt, UseQuiz } from "./useQuiz.js";
import type { RememberView } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { IconButton } from "./IconButton.js";
import { keepDictation } from "./dictation-keep.js";
import { sendForTranscription } from "./dictation-upload.js";
import { type UseDictationField, useDictationField } from "./useDictationField.js";
import { armActivation } from "./activation.js";
import { REMEMBER_SUB_MODES } from "./sub-modes.js";
import { useRenderCount } from "./perf.js";

/**
 * **A question pressed in the prose, to open Quiz at** — since 2026-09-30
 * (SPIDERYARN-READING2-6V; QuizInProse.tsx). In memory, owned by `Reader` and
 * cleared once taken, the way chat's `ChatHandoff` is: which question is open
 * stays out of the URL (docs/project/quiz.md § On screen).
 *
 * **It names its batch**, because a replacement batch can reuse a question id
 * with a new meaning — the reason every mark binds to `batchId`. An arrival from
 * another batch is taken and ignored. GPT Sol's plan review, 260930i finding 1.
 */
export interface QuizArrival {
  readonly batchId: string;
  readonly questionId: QuizQuestionId;
}

/**
 * **The reading view's sections, for "Where to look again"** — the same
 * `Section` list the spine and `?at=` use, and each block's row to find one by.
 * docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md.
 */
export interface QuizSections {
  sections: readonly Section[];
  rowOf: ReadonlyMap<BlockId, number>;
}

/** "3 questions", "1 question". */
function questionCount(n: number): string {
  return `${n} question${n === 1 ? "" : "s"}`;
}

/**
 * **Recall | Quiz**, at the top of the Remember band.
 *
 * A control rather than two links, because the two are one choice — and it is
 * rendered by `RememberBand` and handed to whichever panel is showing, so that
 * both halves of Remember carry the same control in the same place rather than
 * each growing its own.
 *
 * The navigation rules it triggers (clear `thread` in one step; Quiz wins a
 * pasted collision) are `RememberBand`'s, in src/web/App.tsx. This component only
 * says which half is open and asks for the other.
 *
 * **Words, not icons, and that was weighed** (SPIDERYARN-READING2-71, plan
 * 260930h § 2): Greg's "maybe remember mode as well" left it open, and a glyph
 * whose meaning lives only in a hover card says nothing to a sighted reader on
 * a touch screen, where the card never opens. The quiz's ‹ › are conventional
 * enough to stand alone; "say what you took from it" versus "the article asks"
 * is not. GPT Sol's plan review, finding 4.
 */
export function RememberSubModeToggle({
  slug,
  value,
  onChange,
}: {
  /**
   * **Only so that a press can be recorded**, and read nowhere else in here —
   * `RefereeViews` in App.tsx took the same prop for the same reason on the same
   * day. Arming at the click rather than one level up is what `Dock` and
   * `DiagramPanel` already do, and it keeps the button and the token in one
   * file, so a test that clicks the real chip is a test of the real rule.
   */
  slug: string;
  value: RememberView;
  onChange(next: RememberView): void;
}) {
  return (
    /* No `role="group"`: each button already says what it is and whether it is
       pressed, and the two honest alternatives are worse — a `fieldset` needs a
       `legend` this band has no room for, and a `tablist` promises arrow-key
       navigation that would then have to be written and kept. */
    <div className="remember-submode">
      {(["recall", "quiz"] as const).map((view) => (
        <button
          key={view}
          type="button"
          className={`remember-submode-btn${value === view ? " on" : ""}`}
          /* `aria-pressed` rather than `aria-selected`: this is a pair of toggle
             buttons, not a tablist, and claiming to be a tablist without the
             arrow-key handling a tablist promises is worse than not claiming
             it. */
          aria-pressed={value === view}
          onClick={() => {
            /* **The gesture seam for the questions.** Pressing Quiz with none
               written writes them — Greg's rule about opening a mode, one level
               down (src/web/activation.ts). Here, in a real `onClick`, and
               deliberately *not* inside the `setBoth` the caller runs:
               `?remember=` is query state, so Back and Forward move it too, and
               retracing your steps through this toggle must not buy a model
               call. Recall arms nothing — it is a conversation the reader
               starts, and there is no empty artefact for a press to fill.

               **Armed before the `value === view` check, not after**, so that
               pressing Quiz while already *in* Quiz mints a press. That is the
               rule the bar's own mode buttons follow — pressing the mode you are
               in re-arms it (tests/modes-that-start-themselves.test.tsx § "runs
               it when the mode pressed is the one already open") — and it is the
               only way back from a read that failed, because a failed read keeps
               the press and re-reads, and nothing re-fires without a new nonce.
               GPT Sol, 2026-09-06. */
            if (view === "quiz") armActivation(slug, "quiz");
            /* The sub-mode itself does not change, and writing the same value to
               the URL would push a history entry that goes nowhere. */
            if (value !== view) onChange(view);
          }}
        >
          {REMEMBER_SUB_MODES[view].label}
        </button>
      ))}
    </div>
  );
}

export function QuizPanel({
  owner,
  arrival,
  onArrivalTaken,
  subMode,
  blocks,
  readSoFar,
  sections,
  onJump,
  onArrowKeys,
}: {
  owner: UseQuiz;
  /** A question pressed in the prose, to go to — `QuizArrival`. */
  arrival?: QuizArrival | null | undefined;
  /** Tells the owner of `arrival` it has been dealt with, so it can clear it. */
  onArrivalTaken?: ((taken: QuizArrival) => void) | undefined;
  /**
   * The article's sections, for "Where to look again". Absent in a test that
   * is not about it, and then the block is not drawn.
   */
  sections?: QuizSections | undefined;
  /**
   * The reader's reading so far — src/web/read-filter.ts. **Absent means
   * reading time is off**, and then there is no tick-box and every question is
   * walked, exactly as before: an empty level map would otherwise read as
   * "read nothing" and hide the whole quiz.
   */
  readSoFar?: ReadSoFar | undefined;
  /** The Recall | Quiz control, built by `RememberBand`. */
  subMode?: React.ReactNode;
  /** Every block this article has, id to plain text — the "is this real" check
      every citation chip in the band is drawn through. */
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * **Hands `Reader` the ← / → handler**, or `null` on unmount — the
   * `horizontal` argument of `useArrowNav` (keynav.ts), as Trajectory's
   * `onControl` does. Absent in a test that is not about the keys.
   */
  onArrowKeys?: ((handler: ((dir: -1 | 1) => boolean) | null) => void) | undefined;
}) {
  useRenderCount("QuizPanel");
  const { quiz, attempt, answered } = owner;
  const questions = quiz?.questions ?? [];

  /**
   * **Where on the path the reader is** — an index into the artefact's array,
   * which is the path. Next adds one, Previous takes one away, and "Question
   * *n* of *N*" is this plus one.
   *
   * Until 2026-09-30 this was a `seen` list and a cursor into it, because the
   * band ladder made the order the reader met the questions in differ from the
   * server's. On a path they are the same order, so the second list had
   * nothing left to record.
   *
   * Deliberately not in the URL: the rule `?at=` and `?thread=` serve is that a
   * shared link lands you where the link-maker was, and what a link would frame
   * here is an answer that does not survive a reload anyway. It arrives with
   * stored attempts. docs/plans/260831al-review-quiz-sub-mode.md § Which
   * question is open.
   */
  const [at, setAt] = useState(0);
  /**
   * **The reader came to this question by pressing Next on the one before.**
   *
   * One of the two facts `showPremise` needs from here, and the one a verdict
   * map cannot supply: a `right` on step 4 is evidence the reader is holding
   * step 5's thread only if they walked straight from 4 to 5. A pick from the
   * list, Previous, the opening question and a new batch all set it false.
   * GPT Sol's R2-1 on the plan.
   */
  const [arrivedByNext, setArrivedByNext] = useState(false);
  /**
   * **How each answered question was judged, this session** — by question id,
   * the latest finished mark's verdict.
   *
   * Needed as state because the attempt is not enough: `move` clears it, so
   * by the time step 5 is on screen step 4's attempt is gone, and so is the
   * verdict it carried. **Never rendered, logged or stored**, for the reason
   * `Attempt.verdict` in useQuiz.ts gives: it is the grade the marking prompt
   * refuses to give. It may select scaffolding and navigation — whether a
   * premise is shown, and which sections "Where to look again" names — but the
   * word itself, a count or a score never reaches the page.
   */
  const [verdicts, setVerdicts] = useState<ReadonlyMap<QuizQuestionId, QuizVerdict>>(
    () => new Map(),
  );
  /**
   * Which batch the verdict-recording effect has seen.
   *
   * The reset effect and the recording effect run from the same render. On a
   * replacement batch, that render can still carry the old completed attempt;
   * if question ids were reused, clearing the map and then recording that
   * attempt would put the old verdict straight back. This ref makes the first
   * effect pass for a new batch a reset-only pass.
   */
  const verdictBatch = useRef(quiz?.batchId);
  const [typed, setTyped] = useState("");
  /** The whole ordered batch, open. Closes again as soon as one is picked. */
  const [listing, setListing] = useState(false);
  /** Per question, and reset by `move` — see the comment on the button. */
  const [showAnswer, setShowAnswer] = useState(false);
  /** "Only what I've read" — on by default, per visit. Greg's words. */
  const [onlyRead, setOnlyRead] = useState(true);

  /**
   * **Which steps of the path the reader may land on.** Every one, unless the
   * tick-box is on *and* the levels can be believed (`loaded`). While they are
   * `loading` the walk waits rather than guessing; if they `failed` it is the
   * whole path, and a line says so — an empty map from a failed read is not
   * "read nothing" (GPT Sol's finding 1).
   */
  const filtering = readSoFar !== undefined && onlyRead;
  const waitingForReading = filtering && readSoFar.status === "loading";
  const filterActive = filtering && readSoFar.status === "loaded";
  const readLevels = readSoFar?.levels;
  const included = useMemo(
    () => questions.map((q) => !filterActive || !readLevels || questionIsRead(q, readLevels, blocks)),
    [questions, filterActive, readLevels, blocks],
  );
  const includedAt = useMemo(
    () => included.flatMap((yes, i) => (yes ? [i] : [])),
    [included],
  );
  const hiddenCount = questions.length - includedAt.length;

  const box = useRef<HTMLTextAreaElement | null>(null);

  /* A new batch is a new set of questions with new ids, so an index, the
     verdicts and a half-typed answer from the old one mean nothing. Keyed on
     `batchId` rather than on the question count, because a dozen questions
     replaced by a dozen different ones is the case that matters and a count
     would not see it.

     **`clearAttempt` is on this list and it is not cosmetic.** The mark belongs
     to the batch it was computed against, so it goes with the rest — but the
     line that matters is the abort inside it. A mark still streaming holds
     `live.current` in useQuiz.ts, and `mark` opens with `if (live.current)
     return`, so leaving it there gives the new batch an Answer button that is
     enabled and does nothing at all. Nothing goes red and nothing is logged;
     the reader just presses it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset trigger — a new batch invalidates the index, the verdicts, the draft and the mark, and none is read here; `clearAttempt` is stable
  useEffect(() => {
    owner.clearAttempt();
    /* The walk starts at the front of the path, and nobody arrived there by
       Next. The verdicts go with the batch: a new batch of the same article
       can reuse nothing, and a map that outlived it would be keyed on ids
       that now name different questions — or, if a test or a future writer
       kept the ids, the same ones with a different path around them. */
    setAt(0);
    setArrivedByNext(false);
    setVerdicts(new Map());
    setTyped("");
    setListing(false);
    setShowAnswer(false);
  }, [quiz?.batchId]);

  /**
   * **Off a filtered-out step, through `move`.** When the question at `at` is
   * not one the reader may land on — the opening step before anything is read,
   * the tick-box turned on, the switch turned off and on again — go to the
   * first included step at or after it, else the last one before it. With none
   * at all, drop the draft and the mark, since the empty state has no box to
   * hold them.
   *
   * **After the batch reset, and reading from 0 on a new batch.** Both effects
   * run in the same commit, and the later `setAt` is the one that lands; the
   * reset's `setAt(0)` has not reached `at` yet, so on a new batch this starts
   * from the front itself rather than from the old batch's index.
   */
  const filterBatch = useRef(quiz?.batchId);
  /* A replacement batch reaches render before either reset effect reaches the
     state it owns. Do not paint the new batch at the old batch's index in that
     gap: even when that index happens to be included, its question would sit
     over the old batch's draft and mark until the passive effects run. The
     reset below always schedules a render (`setVerdicts(new Map())`), and the
     filter effect commits the new batch to this ref before that render. */
  const changingBatch = filterBatch.current !== quiz?.batchId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `move` is recreated every render and reads nothing this list does not already cover
  useEffect(() => {
    const from = filterBatch.current === quiz?.batchId ? at : 0;
    filterBatch.current = quiz?.batchId;
    if (!filterActive || included[from] !== false) return;
    const target = includedAt.find((i) => i >= from) ?? lastBefore(includedAt, from);
    if (target !== undefined) {
      move(target, false);
      return;
    }
    if (owner.attempt || typed !== "") {
      owner.clearAttempt();
      setTyped("");
      setShowAnswer(false);
    }
  }, [filterActive, included, includedAt, at, owner.attempt, typed, quiz?.batchId]);

  /**
   * **Land on a question pressed in the prose** — `QuizArrival`.
   *
   * **Declared after the batch reset and the filter effect, on purpose**: all
   * three can run in one commit — the band mounting with an arrival, or a new
   * batch — and the last `setAt` is the one that lands. It is idempotent, so
   * StrictMode running it twice lands in the same place; only the hand-back is
   * repeated, and the owner clears an arrival only if it is still the one it
   * was handed. GPT Sol's plan review, 260930i finding 2.
   *
   * - **Another batch's arrival is taken and ignored** — finding 1.
   * - **The question already open is not moved to**, `pick`'s rule: `move`
   *   aborts a mark in flight and drops the draft (finding 3). Its index is
   *   still written last, though: the filter effect just above can be trying to
   *   move off this unread question in the same commit. Writing the requested
   *   index again lets the arrival win without clearing the attempt.
   * - **The tick-box gives way.** The reader asked for this question by name, so
   *   if *Only what I've read* would hide it — or the reading levels are still
   *   loading, while the walk waits — it is turned off, visibly, rather than
   *   the walk landing somewhere else.
   * - A jump is not an arrival by Next, so the step shows its premise.
   */
  const arrivalBatch = useRef(quiz?.batchId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for a new arrival or a new batch; `move` is recreated every render and the rest is read as it stands
  useEffect(() => {
    const sameBatch = arrivalBatch.current === quiz?.batchId;
    arrivalBatch.current = quiz?.batchId;
    if (!arrival || !quiz) return;
    if (arrival.batchId === quiz.batchId) {
      const to = questions.findIndex((q) => q.id === arrival.questionId);
      if (to >= 0) {
        if (filtering && (waitingForReading || included[to] === false)) setOnlyRead(false);
        if (sameBatch && to === at) {
          /* Last writer wins over the filter effect above. This is intentionally
             not `move`: staying on one question must preserve its live mark and
             draft. It is still a jump, so it no longer counts as arriving by
             Next and its premise is shown. */
          setAt(to);
          setArrivedByNext(false);
        } else {
          move(to, false);
        }
        setListing(false);
      }
    }
    onArrivalTaken?.(arrival);
  }, [arrival, quiz?.batchId]);

  /** Undefined while the step at `at` is filtered out — see the effect above. */
  const question: QuizQuestion | undefined =
    changingBatch || waitingForReading || included[at] === false ? undefined : questions[at];
  /* The reader's place, counted among the steps they may land on. */
  const position = includedAt.indexOf(at) + 1;
  const nextAt = includedAt.find((i) => i > at);
  const previousAt = lastBefore(includedAt, at);

  /**
   * **Dictation, in the box the reader is most likely to talk into.**
   *
   * The same hook, the same context and the same priming as the recall
   * composer next door (`{ kind: "article", slug }` is what puts this article's
   * glossary in front of the transcriber, which is exactly the vocabulary
   * somebody answering a question about it is about to use —
   * docs/project/dictation.md). Talking is expected here for the reason it is
   * expected there: an answer from memory arrives as speech more readily than
   * as typing, and the whole point is to get what the reader remembers out
   * rather than what they can be bothered to type.
   */
  const dictate = useDictationField({
    value: typed,
    onChange: setTyped,
    box,
    context: { kind: "article", slug: owner.slug },
    transcribe: sendForTranscription,
    /* One box per question: an answer offered back under a different question
       would be the wrong answer. */
    keep: keepDictation(`quiz:${owner.slug}:${question?.id ?? ""}`),
  });

  /**
   * The run button, and **which verb it calls is the argument**.
   *
   * One helper with `owner.write()` hard-coded until 2026-09-06, which put a
   * *forced* request behind the empty state's button — and that is a
   * double-charge, not a nicety: `work_key` is computed from the request
   * including `force`, so the automatic unforced run and a press here during the
   * same second are two requests `enqueueOrGet` will not collapse, and the
   * reader pays for two. GPT Sol found it in the plan for this change.
   *
   * So: `ensure` where there is nothing, `write` where there is something to
   * replace. The same split, and the same reason, as `useIdeas`.
   */
  const run = (label: string, verb: () => Promise<void> = owner.write) => (
    <JobProgress
      job={owner.job}
      /* Between the press and the first poll there is no job yet, and without
         this the button comes straight back and invites a second press —
         `JobProgress` § `starting`. The quiz went without it until 2026-09-03
         because a comment there said this panel only ever watches jobs it did
         not start, which was never true of it. */
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => verb()}
      onCancel={owner.cancel}
      label={label}
      step="quiz"
      icon={<MessageCircleQuestionMark size={13} />}
      runningLabel="Writing…"
    />
  );

  const marking = attempt?.questionId === question?.id && attempt?.status === "marking";
  const mine = question && attempt?.questionId === question.id ? attempt : null;
  const tooLong = typed.length > MAX_QUIZ_ANSWER_CHARS;

  /**
   * **The mark on screen and the words in the box have parted company.**
   *
   * The box goes editable again the moment a mark lands, and a mark is about
   * one exact answer. So the reader can be reading feedback on a sentence they
   * have already deleted, under a line that still says the question is
   * answered, on a screen with nothing wrong with it — which is what makes this
   * worth a rule rather than a shrug. `attempt.answer` in useQuiz.ts is the
   * text the marker was actually given.
   *
   * **The option passed over was clearing the attempt on any edit**, which is
   * one line and needs no new field. It is wrong for this feature: the mark is
   * the thing the reader is editing *against*, nothing stores it, and a
   * keystroke aimed at a typo would take it away for good. Quiz is not a test
   * and losing your feedback for touching the box is a punishment. Comparing
   * instead keeps the mark readable, says plainly whose answer it is about, and
   * comes back by itself if the reader puts the old words back.
   *
   * A `"marking"` attempt cannot reach this — the box is `disabled` while a
   * mark is in flight — so no status is excluded and there is no second
   * condition to keep in step.
   *
   * **An emptied box counts, and the first version of this got that wrong.** It
   * excluded the empty case, because the note then told a reader who had
   * selected all and deleted to "press Answer" while the Answer button is
   * disabled for exactly as long as the box stays empty — an instruction
   * pointing at a control that cannot be used. But excluding it restored the
   * original hole in miniature: an empty box, feedback about the answer that
   * was just deleted, and a line still reading "answered". **The note was the
   * thing to change, not the rule** — see `Mark`, which says the answer is gone
   * rather than telling anybody to press anything. GPT Sol's second review.
   */
  const superseded = mine !== null && typed.trim() !== mine.answer;

  const move = (to: number, byNext: boolean) => {
    /* The attempt on screen belongs to the question that is leaving, and
       `clearAttempt` also aborts a mark still in flight — one live request per
       attempt, and the old one goes when the reader moves on. */
    owner.clearAttempt();
    setTyped("");
    /* **Collapsed again for the new question**, and this is the line that keeps
       the disclosure honest. Left open it would carry over, so a reader who
       looked up one answer would meet the next question with its answer already
       under it — which is not a quiz. */
    setShowAnswer(false);
    setAt(to);
    setArrivedByNext(byNext);
  };

  /**
   * **Remember how each finished mark was judged**, before `move` clears it.
   *
   * Only a mark that reached `done` carries a verdict, so skipping, a failed
   * mark and an abandoned stream record nothing — and nothing reads as *show
   * the premise*. That is the designed outcome rather than an error path, and
   * it is why nothing here needs a fallback.
   *
   * **The latest mark wins, including one with no verdict.** A reader who goes
   * back and answers a step again has told us something newer than the first
   * verdict; a classifier that failed on the second try leaves no evidence
   * either way, and absence errs towards help. So `undefined` deletes.
   *
   * **`superseded` is deliberately not consulted.** A reader who edits the box
   * after their mark arrives stops the question counting as answered — the mark
   * on screen is about words they have changed — but they did answer it, and it
   * was judged. Un-learning that would mean a keystroke deciding whether the
   * next step carries its premise.
   *
   * Guarded on the question being in this batch, because the attempt can
   * outlive a batch by one render — the reset effect clears it, but the prop
   * arrives before the clear lands.
   */
  useEffect(() => {
    if (verdictBatch.current !== quiz?.batchId) {
      verdictBatch.current = quiz?.batchId;
      return;
    }
    if (attempt?.status !== "done") return;
    const { questionId, verdict } = attempt;
    if (!questions.some((q) => q.id === questionId)) return;
    setVerdicts((was) => {
      if (was.get(questionId) === verdict) return was;
      const next = new Map(was);
      if (verdict) next.set(questionId, verdict);
      else next.delete(questionId);
      return next;
    });
  }, [attempt, questions, quiz?.batchId]);

  /**
   * **Whether the question on screen carries its premise.** The rule is
   * src/web/quiz-ladder.ts § `showPremise`; what this supplies is the verdict
   * on the step before, how the reader got here, and whether validation left
   * a hole in the path.
   */
  const before = at > 0 ? questions[at - 1] : undefined;
  const premised =
    question !== undefined &&
    showPremise({
      question,
      previousVerdict: before ? verdicts.get(before.id) : undefined,
      arrivedByNext,
      batchHasGaps: (quiz?.dropped.gaps ?? 0) > 0,
    });

  /**
   * **The mark for the question on screen is still arriving.**
   *
   * The verdict is the last thing to land — it is judged from the finished
   * mark, so it arrives with `done`, after the reader has already read every
   * word. And the next step's premise depends on it: pressing Next in that
   * window would arrive with *no* verdict, show a premise the reader may not
   * need, and abort the classifier on the way out — adaptation silently
   * switched off, on a screen that looks completely normal. GPT Sol's finding
   * 1 on the band ladder's built code, and it holds for the premise the same
   * way.
   *
   * So Next waits. It is usually imperceptible — one word from a quick-tier
   * model — and it is bounded by that call's own short deadline. **Previous and
   * the list stay live**, which is what keeps this from being a trap: a reader
   * who does not want to wait for a mark can leave, and leaving aborts it, as
   * it always did.
   */
  const stillMarking = mine?.status === "marking";
  const canGoNext = !stillMarking && nextAt !== undefined;

  /* **Arrived by Next only if nothing was skipped.** A Next over an unread
     step did not come from the step before, whose answer the premise restates,
     so the premise is shown. */
  const goNext = () => {
    if (!canGoNext || nextAt === undefined) return;
    move(nextAt, nextAt === at + 1);
  };
  const goPrevious = () => {
    if (previousAt !== undefined) move(previousAt, false);
  };

  /**
   * **← / → step the path** — SPIDERYARN-READING2-71; docs/project/keyboard.md
   * § ← / → in Quiz. The buttons' own rules, so the keys can do
   * no more than the buttons, plus one the buttons do not have: **a key will not
   * throw away words that have not been marked.** The textarea stops its own
   * key presses, so this is the reader who typed, clicked somewhere else, and
   * pressed → expecting nothing. A click on a labelled button is a deliberate
   * act; a stray key is not. A failed or unfinished mark is not a mark.
   *
   * `false` is "took nothing", and `useArrowNav` then leaves the key with the
   * browser — the ends of the path do not wrap, as Trajectory's do not.
   *
   * Read through a ref, so `Reader` is handed one stable function for the life
   * of the panel and a quiz render does not re-render the reading view.
   */
  const unmarked = typed.trim() !== "" && (mine?.status !== "done" || superseded);
  /* **And not while the microphone is recording or its transcript is on its
     way**, box empty or not: a browser that shows no rough words leaves the box
     empty while it listens, and the transcript lands through `setTyped` after a
     move — under the *next* question. GPT Sol's plan review, finding 2. */
  const listening = dictate.dictation.armed || dictate.readOnly;
  const stepByKey = useRef<(dir: -1 | 1) => boolean>(() => false);
  stepByKey.current = (dir) => {
    if (!question || unmarked || listening) return false;
    if (dir === 1) {
      if (!canGoNext) return false;
      goNext();
      return true;
    }
    if (previousAt === undefined) return false;
    goPrevious();
    return true;
  };
  useLayoutEffect(() => {
    if (!onArrowKeys) return;
    onArrowKeys((dir) => stepByKey.current(dir));
    return () => onArrowKeys(null);
  }, [onArrowKeys]);

  /**
   * Picking a question by hand out of the list — a jump to that step on the
   * path, which Next and Previous then walk on from.
   *
   * **A jump is not an arrival by Next**, so the step shows its premise
   * whatever the verdict on the one before it: the reader did not just carry
   * that thread here.
   */
  const pick = (id: QuizQuestionId) => {
    const to = questions.findIndex((q) => q.id === id);
    /* **Picking the row you are already on closes the list and does nothing
       else.** `move` aborts a mark in flight and throws away the draft and the
       feedback, so treating "the current one" as a move would let a reader
       destroy their own half-typed answer by tapping the row that is already
       highlighted. Lost once in a rewrite, and GPT Sol's finding 3 on the
       ladder caught it. */
    if (to === at || to < 0) {
      setListing(false);
      return;
    }
    move(to, false);
    setListing(false);
  };

  /**
   * **Where to look again** — the sections whose answers this visit were
   * judged wrong, weakest first (src/web/quiz-sections.ts), each with the way
   * back into the prose and, where one can be landed on, the way back to its
   * first missed question. That second half is the steer: the path is never
   * reordered, so the quiz is steered towards a weak section by offering its
   * question again, through `pick` — a jump, so the step shows its premise,
   * and a pick of the question already open does nothing (GPT Sol's F2 on the
   * plan). Only questions 61's filter lets the reader land on are offered.
   */
  const lookAgain = useMemo(
    () => (sections ? weakSections(sectionTally(questions, verdicts, sections.sections, sections.rowOf)) : []),
    [sections, questions, verdicts],
  );
  const landable = (id: QuizQuestionId) => {
    const i = questions.findIndex((q) => q.id === id);
    return i >= 0 && included[i] === true;
  };

  const submit = () => {
    /* **Not while the microphone is involved, and that is two states.**
       `readOnly` stops typing and nothing else, so this button is still live
       during the two seconds between the reader stopping and the good words
       arriving; `armed` is the microphone actually recording, which is the
       likelier press here of the two — this is the box a reader is *told* to
       talk into. Marking the recogniser's rough guess is the one outcome the
       two-pass design must not produce, and it would be marked as the reader's
       own answer. The same pair chat's composer carries, for the same reason.
       docs/project/dictation.md § Adding it to a box. */
    if (dictate.readOnly || dictate.dictation.armed || !question) return;
    const answer = typed.trim();
    if (answer === "" || tooLong || marking || owner.stale) return;
    void owner.mark(question.id, answer);
  };

  return (
    <ModeSurface
      label="Quiz"
      feature="gloss quiz"
      /* **A fragment, because `subMode` is an optional prop.** `RememberBand`
          passes one on every render, so an empty row is not a state a reader
          can reach — but `head={subMode}` would hand the surface `undefined`
          for any caller that did not, and the row would vanish rather than sit
          empty. The fragment is always a header. */
      head={
        <>
          {/* The mode's name went on 2026-09-05 — the Dock says it (§ Stage 5 of
              docs/plans/260905d-declutter-the-reading-view-top-bars.md). The row
              stays for the Recall | Quiz control, which is the one thing here
              the Dock does *not* say. */}
          {subMode}
        </>
      }
      /* No standing *Write them again* under the question any more — Greg,
          2026-09-29 (SPIDERYARN-READING2-53): *"let's just rely on the
          Metadata mode for that."* Metadata's *AI processing* has a
          Quiz row; the stale banner keeps its own button.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          Keep the footer only while a current batch's job is starting,
          running or failed. Otherwise removing the button also removes the
          only place this mode can show that progress or failure. Not on a
          stale batch, whose banner carries the job; an outdated one has no
          banner (plan 260929c), so its job shows here. */
      foot={
        quiz &&
        owner.status === "ready" &&
        !owner.stale &&
        (owner.job || owner.starting || owner.failed) ? (
          <div className="quiz-rewrite">{run("Write them again")}</div>
        ) : null
      }
    >

      {owner.error && <p className="gloss-error">{owner.error}</p>}

      {owner.status === "loading" && <p className="gloss-quiet">Looking for the questions…</p>}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has written questions about this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes about a minute. Written once and
            kept — you will not be asked again unless the article changes.
          </p>
          {/* **`ensure`, not `write`.** There are no questions — that is what
              this branch is — so the unforced request is the right one, and it
              is the *same request* the automatic run makes, which is what stops
              a press landing beside it from being charged twice. See `run`. */}
          {run("Write the questions", owner.ensure)}
        </div>
      )}

      {quiz && owner.status === "ready" && (
        <>
          <Staleness stale={owner.stale} run={run} />

          {questions.length === 0 && (
            <p className="gloss-quiet">
              The questions were written, but none of them survived checking against the article.
              Writing them again is worth a try.
            </p>
          )}

          {readSoFar && questions.length > 0 && (
            <OnlyRead
              on={onlyRead}
              onChange={setOnlyRead}
              readSoFar={readSoFar}
            />
          )}

          {waitingForReading && questions.length > 0 && (
            <p className="gloss-quiet">Looking for what you have read…</p>
          )}

          {filterActive && questions.length > 0 && includedAt.length === 0 && (
            <div className="gloss-empty">
              <p>None of these questions is about a passage you have read yet.</p>
              <p className="gloss-hint">
                Read on, or untick <em>Only what I’ve read</em> to see all {questions.length}.
              </p>
            </div>
          )}

          {question && (
            /* One group for the whole band, so moving along a row of citations
               shows each card immediately instead of waiting out the open delay
               again — chat's reason, and the dock's. */
            <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
              <div className="quiz-one">
                <p className="gloss-count">
                  Question {position} of {includedAt.length}
                  {/* Dropped while the box holds something that has not been
                      marked, because this line sits directly above that box and
                      reads as a claim about what is in it. The tick in the list
                      below keeps its own meaning — *you got a finished mark for
                      this question at some point this session* — which stays
                      true whatever the reader is typing now. */}
                  {answered.has(question.id) && !superseded && " — answered"}
                </p>
                {/* **The premise, as a lead-in rather than part of the
                    question**: its own element, quieter, above the stem. The
                    question reads as a whole without it — the prompt insists —
                    so hiding it leaves nothing dangling. Never in the list
                    below; see `QuestionList`. */}
                {premised && <p className="quiz-premise">{question.premise}</p>}
                <p className="quiz-question">{question.question}</p>

                <textarea
                  ref={box}
                  className="quiz-answer"
                  value={typed}
                  rows={4}
                  placeholder="Your answer, a couple of sentences"
                  aria-label="Your answer"
                  /* `readOnly` rather than `disabled` while the transcript is on
                     its way: it refuses typing and leaves the box in the tab
                     order with its selection intact, instead of greying it out
                     as though it were broken. useDictationField.ts says why. */
                  readOnly={dictate.readOnly}
                  onChange={(e) => setTyped(e.target.value)}
                  /* Every key press is stopped from bubbling, and that is not
                     tidiness: the article's ↑/↓ navigation listens on the window
                     (keynav.ts) and would scroll the page out from under the
                     reader while they moved the caret through their own answer.
                     Chat's composer carries the same stop for the same reason. */
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  disabled={marking || owner.stale}
                />
                <div className="quiz-actions">
                  <button
                    type="button"
                    className="gloss-run"
                    /* Disabled on an empty answer, while one is in flight, and on
                       a stale quiz — all three of which the server would refuse
                       anyway (400, one-live-request, 409). Disabling is the
                       courtesy; the route is the rule.

                       And on both microphone states, which nothing else would
                       refuse: `submit` returns silently there, so a lit button
                       would be a press that marks nothing and says nothing. */
                    disabled={
                      !typed.trim() ||
                      tooLong ||
                      marking ||
                      owner.stale ||
                      dictate.readOnly ||
                      dictate.dictation.armed
                    }
                    onClick={submit}
                  >
                    {/* *Try again* only where trying the same thing again is
                        what the press means. Once the box has been edited the
                        button is sending a different answer, not retrying a
                        dropped connection — and the note above it says "Press
                        Answer". */}
                    {marking
                      ? "Marking…"
                      : mine?.status === "failed" && !superseded
                        ? "Try again"
                        : "Answer"}
                  </button>
                  <Mic dictate={dictate} disabled={marking || owner.stale} />
                  {tooLong && (
                    <span className="gloss-error">
                      That is longer than {MAX_QUIZ_ANSWER_CHARS} characters.
                    </span>
                  )}
                </div>
                <DictationStrip dictation={dictate.dictation} />

                {mine && (
                  <Mark
                    attempt={mine}
                    superseded={superseded}
                    emptied={typed.trim() === ""}
                    blocks={blocks}
                    onJump={onJump}
                  />
                )}

                <ReferenceAnswer
                  question={question}
                  open={showAnswer}
                  onToggle={() => setShowAnswer((v) => !v)}
                  onJump={onJump}
                />

                <div className="quiz-step">
                  {/* One step back along the path — the question before this
                      one in the array, wherever the reader came from. After a
                      jump from the list that is the step the jump skipped to,
                      not the one they were on before it: the path is the only
                      order there is, and a history stack would be a second
                      one. Not an arrival by Next, so the step shows its
                      premise. */}
                  {/* **Icons, their words in the tooltip** — Greg,
                      SPIDERYARN-READING2-71; docs/project/icons.md §
                      Navigation. `IconButton`, so an unavailable one is
                      `aria-disabled` rather than natively disabled and its
                      card still opens; the click is refused in there. The
                      tooltip names the key, which does the same thing. */}
                  <Tooltip content={<p>Previous question (←)</p>} placement="top">
                    <IconButton
                      label="Previous question"
                      titled={false}
                      disabled={previousAt === undefined}
                      onClick={goPrevious}
                    >
                      <ChevronLeft />
                    </IconButton>
                  </Tooltip>
                  <Tooltip
                    content={
                      <p>{stillMarking ? "Next question (→), once the mark has finished" : "Next question (→)"}</p>
                    }
                    placement="top"
                  >
                    <IconButton label="Next question" titled={false} disabled={!canGoNext} onClick={goNext}>
                      <ChevronRight />
                    </IconButton>
                  </Tooltip>
                  <Tooltip
                    content={<p>{listing ? "Hide the list" : `Show all ${questionCount(includedAt.length)}`}</p>}
                    placement="top"
                  >
                    <IconButton
                      label={listing ? "Hide the list" : `Show all ${questionCount(includedAt.length)}`}
                      titled={false}
                      aria-expanded={listing}
                      onClick={() => setListing((v) => !v)}
                    >
                      <List />
                    </IconButton>
                  </Tooltip>
                </div>

                {listing && (
                  <>
                    <QuestionList
                      questions={questions.filter((_, i) => included[i])}
                      currentId={question.id}
                      answered={answered}
                      onPick={pick}
                    />
                    {hiddenCount > 0 && (
                      <p className="gloss-hint">
                        {hiddenCount === 1
                          ? "One more is about a passage you have not read yet."
                          : `${hiddenCount} more are about passages you have not read yet.`}
                      </p>
                    )}
                  </>
                )}

                {lookAgain.length > 0 && (
                  <LookAgain
                    rows={lookAgain}
                    retryOf={(row) => {
                      const id = firstWrongIn(row, verdicts, landable);
                      return id === question.id ? undefined : id;
                    }}
                    onRead={onJump}
                    onRetry={pick}
                  />
                )}
              </div>
            </TooltipGroup>
          )}
        </>
      )}
    </ModeSurface>
  );
}

/**
 * **"Where to look again"** — places, never a verdict.
 *
 * Names sections and nothing else: no count, no score, no "you got", which is
 * the line docs/project/remember-mode.md § The prompt is the feature draws for
 * the marks, and this block inherits it. The section's name jumps the prose to
 * its first block, which is the (re-)read Greg asked for; the icon beside it
 * goes back to its first missed question, drawn only when there is one the
 * reader can land on that is not already open.
 */
function LookAgain({
  rows,
  retryOf,
  onRead,
  onRetry,
}: {
  rows: readonly SectionTally[];
  retryOf(row: SectionTally): QuizQuestionId | undefined;
  onRead(id: BlockId): void;
  onRetry(id: QuizQuestionId): void;
}) {
  return (
    <div className="quiz-look-again">
      <p className="quiz-look-again-head">Where to look again</p>
      <ul>
        {rows.map((row) => {
          const retry = retryOf(row);
          return (
            <li key={row.section.blockId}>
              <button type="button" className="quiz-look-again-section" onClick={() => onRead(row.section.blockId)}>
                {row.section.title}
              </button>
              {retry !== undefined && (
                <Tooltip content={<p>Back to its question</p>} placement="top">
                  <IconButton
                    label={`Back to a question on ${row.section.title}`}
                    titled={false}
                    onClick={() => onRetry(retry)}
                  >
                    <RotateCcw />
                  </IconButton>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * **"Only what I've read", and how much that is.**
 *
 * The figure is the share of the body's words in passages read — the same
 * rule as the tick-box — so the two cannot disagree. Said only once the levels
 * can be believed: while loading it says nothing, and after a failed read it
 * says the filter is off rather than claiming a share of zero.
 */
function OnlyRead({
  on,
  onChange,
  readSoFar,
}: {
  on: boolean;
  onChange(next: boolean): void;
  readSoFar: ReadSoFar;
}) {
  const share = readSoFar.status === "loaded" ? shareRead(readSoFar.levels, readSoFar.bodyWords) : null;
  return (
    <div className="quiz-only-read">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> Only what
        I’ve read
      </label>
      {share !== null && <span className="gloss-hint">{readShareLabel(share)} of the piece read so far</span>}
      {readSoFar.status === "failed" && on && (
        <span className="gloss-hint">couldn’t load what you have read, so this is every question</span>
      )}
    </div>
  );
}

/**
 * **The mark, and whose answer it is about.**
 *
 * Two rules live here, and both are about the reader believing something the
 * screen has not earned.
 *
 * **The failure is drawn beside the reply rather than instead of it.** A
 * half-arrived mark is worth reading and the reader has already read it. What a
 * failure changes is the button, which says "Try again", and the tick, which is
 * not given.
 *
 * **`superseded` says the words in the box are no longer the words this was
 * computed from.** Said rather than enforced by deletion: see the long note in
 * `QuizPanel` for the option passed over. The sentence is deliberately about
 * the mark and not about the reader — it states which answer this describes and
 * how to get one for the new answer, and it does not scold.
 */
function Mark({
  attempt,
  superseded,
  emptied,
  blocks,
  onJump,
}: {
  attempt: Attempt;
  /** The box has been edited since this mark was computed. */
  superseded: boolean;
  /** …and edited down to nothing, which changes only what the note may say. */
  emptied: boolean;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  return (
    <>
      {superseded && attempt.reply && (
        <p className="gloss-count">
          {/* Two sentences for one rule, and the split is about what the reader
              can act on. With words in the box there is something to mark and
              the button is live, so the note says how. With the box empty there
              is not, and the Answer button is disabled — so it says what the
              mark is about and stops, rather than naming a control that cannot
              be pressed. */}
          {emptied
            ? "This mark is about an answer you have since deleted."
            : "This mark is about your previous answer. Press Answer to have the new one marked."}
        </p>
      )}
      {attempt.reply && (
        <p className="quiz-reply">
          {/* `CitedText`, not `CitedMarkdown`: the marking prompt asks for plain
              prose paragraphs and forbids lists and headings, so a stray `#` in
              a sentence about a heading must stay a `#`. The summary panel makes
              the same call. Links are off — nothing in this prompt governs what
              a model may link, and an `href` built from model output is
              somewhere a hostile page can steer a reader
              (docs/project/security.md).

              `partial` while the mark is arriving says only the tail is
              half-written. */}
          <CitedText
            text={attempt.reply}
            blocks={blocks}
            onJump={onJump}
            partial={attempt.status === "marking"}
          />
        </p>
      )}
      {attempt.status === "failed" && attempt.error && (
        <p className="gloss-error">{attempt.error}</p>
      )}
    </>
  );
}

/**
 * **"Show *a* reference answer"** — and the article is what a mark is judged
 * against, not this.
 *
 * The indefinite article is the design, not the copy. What is behind this door
 * was written by a model over the whole article before anybody answered
 * anything, by a cheaper batch call, and it is wrong often enough that
 * `QUIZ_MARK_SYSTEM` is told outright that the article outranks it — see
 * src/quiz-mark.ts, and the poisoned case in evals/quiz.ts. Calling it *the*
 * answer would tell a reader who was right that they were wrong.
 *
 * Collapsed rather than absent, because a reader who has given up wants it and
 * a reader who has not must not have it in the corner of their eye. Whoever
 * mounts it owns shutting it again — `move` in `QuizPanel` does, on every
 * change of question.
 */
function ReferenceAnswer({
  question,
  open,
  onToggle,
  onJump,
}: {
  question: QuizQuestion;
  open: boolean;
  onToggle(): void;
  onJump(id: BlockId): void;
}) {
  return (
    <div className="quiz-reveal">
      <button type="button" className="quiz-disclose" aria-expanded={open} onClick={onToggle}>
        {open ? "Hide the reference answer" : "Show a reference answer"}
      </button>
      {open && (
        <div className="quiz-reference">
          <p className="quiz-reference-text">{question.referenceAnswer}</p>
          {/* The blocks the answer was drawn from, as chips that jump. Every one
              of these survived `findQuote` relocating the model's quote in the
              block it named, so a chip here points at a paragraph that really
              does carry the answer — src/quiz.ts § validateEvidence. */}
          {question.evidence.length > 0 && (
            <p className="quiz-evidence">
              <span className="quiz-evidence-label">Where it comes from</span>
              {question.evidence.map((e) => (
                <BlockRef key={`${e.blockId}:${e.start}`} id={e.blockId} onJump={onJump} />
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The whole batch, in **the artefact's order**.
 *
 * Greg asked for this: *"we should give the user the option to reveal a bunch of
 * questions at a time so they can pick which one(s) to answer"*. A reader who
 * cannot answer this one may be able to answer the next, and finding that out by
 * pressing Next a dozen times is worse than reading a list.
 *
 * **Nothing here sorts** — the order is the path, the same order Next walks.
 *
 * **Stems only, never premises.** A premise restates the answer to the step
 * before it, so a list that drew them would answer rows the reader has not
 * reached yet, all at once, to anybody who opened it to choose. GPT Sol's F3
 * on docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md.
 * Opening a question from here shows its premise on the question itself,
 * because a jump is not an arrival by Next (src/web/quiz-ladder.ts).
 *
 * The rows are not numbered — the band says "Question 3 of 12" above, and two
 * numberings that have to agree are a second source of truth even when, as on
 * a path, they happen to.
 */
function QuestionList({
  questions,
  currentId,
  answered,
  onPick,
}: {
  questions: readonly QuizQuestion[];
  /** Keyed by id rather than index: an id says which row without trusting that
      two arrays line up. */
  currentId: string;
  answered: ReadonlySet<string>;
  onPick(id: string): void;
}) {
  return (
    <ol className="quiz-list">
      {questions.map((q) => (
        <li key={q.id}>
          <button
            type="button"
            className={`quiz-list-row${q.id === currentId ? " on" : ""}`}
            aria-current={q.id === currentId ? "true" : undefined}
            onClick={() => onPick(q.id)}
          >
            {/* Answered is session state and means one thing: a mark that
                reached `done`. `useQuiz` is the only place an id gets in. */}
            <span className="quiz-list-tick" aria-hidden="true">
              {answered.has(q.id) ? "\u2713" : ""}
            </span>
            <span className="quiz-list-q">{q.question}</span>
            {answered.has(q.id) && <span className="sr-only"> — answered</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The article has moved under the questions, and **only that** gets a banner.
 * Stale means every mark is refused with a 409 until the questions are
 * rewritten, so the button under it is the only useful thing on the screen.
 *
 * `outdated` — the questions predating the current prompt — only means better
 * questions are available, and is not announced: Greg, 2026-09-29
 * (SPIDERYARN-READING2-55), *"it's not worth bugging the user about it."*
 * Re-running is in Metadata. Plan 260929c.
 */
function Staleness({
  stale,
  run,
}: {
  stale: boolean;
  run(label: string): React.ReactNode;
}) {
  if (!stale) return null;
  return (
    <div className="gloss-stale">
      <p>
        <TriangleAlert size={13} />
        These questions were written about an older version of the article, so answers cannot be
        marked against them.
      </p>
      {run("Write them again")}
    </div>
  );
}

/**
 * The microphone, **labelled**.
 *
 * Recall's is labelled and this one is too, for the same reason: the box expects
 * speech, and a bare icon in a band nobody has used before does not say so. The
 * word also carries the state — *Listening…* while the tape is running,
 * *Writing it down…* during the two seconds between stopping and the good
 * transcript landing, which is exactly the gap in which the Answer button must
 * refuse to fire. docs/project/dictation.md.
 *
 * Draws nothing where a microphone cannot be opened — `supported` means "can
 * open a microphone", not "has the Web Speech API".
 */
function Mic({ dictate, disabled }: { dictate: UseDictationField; disabled: boolean }) {
  if (!dictate.dictation.supported) return null;
  return (
    <span className="quiz-mic">
      <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} disabled={disabled} />
      <span className="quiz-mic-label">
        {dictate.dictation.armed ? "Listening…" : dictate.readOnly ? "Writing it down…" : "Talk"}
      </span>
    </span>
  );
}
