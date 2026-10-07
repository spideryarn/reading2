/**
 * **The Quiz band** — the questions the article would ask, and what the reader
 * made of them.
 *
 * The other half of Learn. Free recall asks the reader what they took from
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
 *
 * ## A kept answer is put back in one place
 *
 * Finished marks are stored since 2026-10-05 (report spya-e8ujxn), and coming
 * back to a question — by Previous, by reopening Quiz, by a reload — shows the
 * answer and its mark again. **One effect does it, after every effect that can
 * move the walk**, and not `move` itself: the batch reset, the filter and an
 * arrival can all write `at` in one commit, and an arrival at the question
 * already open goes round `move` altogether, so a restore inside `move` could
 * leave one question's answer in another's box. It fills an empty box under a
 * question with no attempt, and nothing else — never a draft, never a live
 * mark. The restored attempt is marked `restored`, which the verdict effect
 * skips. docs/plans/261005b-quiz-answers-are-kept-and-restored.md, GPT Sol's
 * plan review F3 and F4.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  List,
  LoaderCircle,
  MessageCircleQuestionMark,
  RotateCcw,
  SendHorizontal,
  TriangleAlert,
} from "lucide-react";
import type { BlockId, Quiz, QuizQuestion, QuizQuestionId, QuizVerdict } from "../types.js";
import { MAX_QUIZ_ANSWER_CHARS } from "../types.js";
import { showPremise } from "./quiz-ladder.js";
import { firstWrongIn, type SectionTally, sectionTally, weakSections } from "./quiz-sections.js";
import type { Section } from "./position.js";
import { lastBefore, questionIsRead, type ReadSoFar, readShareLabel, shareRead } from "./read-filter.js";
import { SharePie } from "./SharePie.js";
import type { Attempt, UseQuiz } from "./useQuiz.js";
import type { LearnView } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { JobProgress } from "./JobProgress.js";
import { AboutMade } from "./BandAbout.js";
import { ModeSurface } from "./ModeSurface.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { ICON_BUTTON_CLASS, IconButton } from "./IconButton.js";
import { WrittenForYou } from "./WrittenForYou.js";
import { ReadError } from "./ReadError.js";
import { Button } from "./components/ui/button.js";
import { keepDictation } from "./dictation-keep.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { type UseDictationField, useDictationField } from "./useDictationField.js";
import { armActivation } from "./activation.js";
import { LEARN_SUB_MODES, visibleLearnViews } from "./sub-modes.js";
import { useRenderCount } from "./perf.js";
import { withVoice } from "./voice.js";
import { BandWaiting } from "./BandWaiting.js";

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
 * **What the band's (i) adds after the mode's own words**: how many questions
 * there are, how many the model wrote that checking left out, and who wrote
 * them — Greg, 2026-10-01 (spya-ucu35y, plan 261001m). *Question n of m* stays
 * in the band: it is where you are, not a fact about the batch.
 *
 * **Left out** counts whole questions only — malformed, a repeat, or with no
 * evidence the article holds (src/quiz.ts § `drop`). Not `overCap`, which
 * src/quiz.ts calls a hint rather than a finding, and not evidence trimmed
 * from a question that was kept.
 *
 * **It opens with Quiz's own sentence, not Learn's catalog words**: the
 * catalog now describes the whole mode, so it would lead a Quiz card with the
 * three conversation parts before reaching Quiz. This band therefore does not
 * pass `mode` to `ModeSurface`; the card leads with Quiz's sub-mode words from
 * `LEARN_SUB_MODES` instead — always, so the (i) is there in every state,
 * as `mode` would have made it.
 */
function QuizAbout({ quiz }: { quiz: Quiz | null }) {
  const what = <p>{LEARN_SUB_MODES.quiz.description}.</p>;
  if (!quiz) return what;
  const n = quiz.questions.length;
  const { malformed, duplicate, unanchored } = quiz.dropped;
  const left = malformed + duplicate + unanchored;
  return (
    <>
      {what}
      {/* "in all": the whole batch, where the band's "Question n of N" counts
          only what *Only what I've read* leaves in (plan 261006g). */}
      <p>{questionCount(n)} in all.</p>
      {left > 0 && (
        <p>
          {left === 1
            ? "One more the model wrote was left out in checking."
            : `${left} more the model wrote were left out in checking.`}
        </p>
      )}
      <AboutMade
        generator={quiz.generator}
        version={quiz.version}
        generatedAt={quiz.generatedAt}
        elapsedMs={quiz.elapsedMs}
      />
    </>
  );
}

/**
 * **Recall | Tutorial | Explore | Quiz**, at the top of the Learn band.
 *
 * A control rather than two links, because the two are one choice — and it is
 * rendered by `LearnBand` and handed to whichever panel is showing, so that
 * both halves of Learn carry the same control in the same place rather than
 * each growing its own.
 *
 * The navigation rules it triggers (clear `thread` in one step; Quiz wins a
 * pasted collision) are `LearnBand`'s, in src/web/App.tsx. This component only
 * says which half is open and asks for the other.
 *
 * **Words, not icons, and that was weighed** (SPIDERYARN-READING2-71, plan
 * 260930h § 2): Greg's "maybe remember mode as well" left it open, and a glyph
 * whose meaning lives only in a hover card says nothing to a sighted reader on
 * a touch screen, where the card never opens. The quiz's ‹ › are conventional
 * enough to stand alone; "say what you took from it" versus "the article asks"
 * is not. GPT Sol's plan review, finding 4.
 */
/**
 * **The second paragraph of each chip's card**: what a press would not have
 * told you. Greg, 2026-10-04 (spya-wbhrm7): *"Provide rich tooltips for the
 * remember mode submode buttons"*, and the same day (spya-usyhwy) *"each
 * submode button should have its own tooltip"*. The first paragraph is the
 * command bar's line (`LEARN_SUB_MODES`).
 *
 * Recall's sentences were `MODE_CATALOG.learn.how` until that day, when the
 * catalog's paragraph was cut to what is true of the whole mode. Each claim,
 * against the source:
 *  - Recall, Tutorial: no turn runs before the reader's first message; the
 *    prompts are in src/converse.ts, and Tutorial is built for a reader who
 *    has not read the piece (docs/project/learn-mode.md § Tutorial).
 *  - Explore: highlights and notes go in the digest with every turn; earlier
 *    conversations go as a list it may open, not as their text
 *    (src/reader-notes.ts; GPT Sol's plan review, finding 1).
 *  - Quiz: the press arms `quiz` (below), and the marker is given the whole
 *    article with the question's evidence passages (src/quiz-mark.ts; finding 4).
 * Exported for tests/learn-header-cards.test.tsx.
 */
export const LEARN_VIEW_HOW: Readonly<Record<LearnView, string>> = {
  recall:
    "The AI does not reply until you have said or typed what you took from the piece. One adaptive voice corrects briefly, then usually nudges you to remember a little more; if you are stuck, it fills the gap instead. It is asked to point its replies back to the passages they use.",
  tutorial:
    "It waits on you too. It is about what the author says, and it works even if you have not read the piece yet.",
  explore:
    "It is sent your highlights and notes, plus a list of your earlier conversations. It can open one of those and may search the web when useful.",
  quiz: "Pressing it writes the questions if there are none yet. A model compares each answer with the article, using the question's reference passages.",
};

export function LearnSubModeToggle({
  slug,
  value,
  experimental,
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
  value: LearnView;
  /**
   * **Whether the reader's experimental-features switch is on**, which decides
   * whether the Explore chip is drawn and nothing else (sub-modes.ts §
   * `visibleLearnViews`). Required, for `DiagramPanel`'s reason: a new mount
   * site cannot forget it and quietly show a chip the switch is hiding. The
   * chip for the part the reader is in is always drawn, so the row has one
   * pressed. docs/project/experimental-features.md.
   */
  experimental: boolean;
  onChange(next: LearnView): void;
}) {
  return (
    /* No `role="group"`: each button already says what it is and whether it is
       pressed, and the two honest alternatives are worse — a `fieldset` needs a
       `legend` this band has no room for, and a `tablist` promises arrow-key
       navigation that would then have to be written and kept. */
    <div className="learn-submode">
      {/* A card on every chip, the way the other five sub-mode rows have one
          (StructureMode.tsx § `StructureViewToggle`): `TooltipGroup` so that
          reading along the row is one gesture, `keepSide` so a card is not
          thrown onto the chips beside it. The card is for a pointer and for
          keyboard focus; a finger's tap presses the chip, which is why the
          conversation band's (i) lists the visible parts as well (LearnAbout.tsx §
          `LearnSubModesAbout`). */}
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {visibleLearnViews(experimental, value).map((view) => (
          <Tooltip
            key={view}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={
              <ControlTip
                head={LEARN_SUB_MODES[view].label}
                what={`${LEARN_SUB_MODES[view].description}.`}
                how={LEARN_VIEW_HOW[view]}
              />
            }
          >
            <button
              type="button"
              className={`learn-submode-btn${value === view ? " on" : ""}`}
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
                   `?learn=` is query state, so Back and Forward move it too, and
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
              {LEARN_SUB_MODES[view].label}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
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
   * reading time is off** (a visitor; every owner has it), and then there is no tick-box and every question is
   * walked, exactly as before: an empty level map would otherwise read as
   * "read nothing" and hide the whole quiz.
   */
  readSoFar?: ReadSoFar | undefined;
  /** The Recall | Tutorial | Explore | Quiz control, built by `LearnBand`. */
  subMode?: React.ReactNode;
  /** Every block this article has, id to plain text — the "is this real" check
      every citation chip in the band is drawn through. */
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * **Hands `Reader` the ← / → handler**, or `null` on unmount — the
   * `horizontal` argument of `useArrowNav` (keynav.ts), as Skim's
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
   * shared link lands you where the link-maker was, and a quiz is the owner's
   * alone. (Until 2026-10-05 the reason given was that the answer did not
   * survive a reload. It does now, and where the walk opens is worked out from
   * the kept answers instead — `resumedBatch`, below.)
   * docs/plans/260831al-review-quiz-sub-mode.md § Which question is open.
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
  /* Whether the arrival effect will run in this commit. A handled arrival
     cannot keep overruling later filter presses if its owner leaves it in
     the props. */
  const arrivalSeen = useRef<{
    batchId: string | undefined;
    arrival: QuizArrival | null | undefined;
  }>({ batchId: quiz?.batchId, arrival: undefined });
  const takingArrival =
    arrivalSeen.current.batchId !== quiz?.batchId || arrivalSeen.current.arrival !== arrival;
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
    /* An explicit destination owns this navigation, including its cleanup.
       Letting the filter clear first would lose a same-question draft or
       abort its mark even though the arrival writes the right index last. */
    if (
      takingArrival &&
      arrival?.batchId === quiz?.batchId &&
      questions.some((q) => q.id === arrival?.questionId)
    ) return;
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
  }, [filterActive, included, includedAt, at, owner.attempt, typed, quiz?.batchId, takingArrival, arrival, questions]);

  /**
   * **Open at the first question not yet answered.** Greg, 2026-10-05, on the
   * plan's Q-quiz-resume: *"yes, first unanswered question"*. Until then a
   * reader who came back was put on question one with their answer showing,
   * and pressed Next past everything they had done.
   *
   * **Once for a batch, before any question of it is drawn** — `resuming`
   * below holds the question back until this has run. That is what keeps it
   * from being a second thing that moves the reader: nothing is on screen to
   * be moved from, no draft or mark exists to lose, and the restoring effect
   * further down sees no question and so cannot fill the box of the one being
   * left (postmortem 261005d is that mistake, made by an arrival). Answers
   * that arrive later — another device, *Try again* after a read that could
   * not say — fill the box of the question open and move nothing.
   *
   * - **Among the steps the reader may land on**, so it waits for the reading
   *   levels as the walk does, and an unread question is not "the first
   *   unanswered".
   * - **Every one answered opens at the first.** There is no next thing to do,
   *   so the start of the path, with its answer showing, is the least
   *   surprising place; the last question would look like a quiz left half way.
   * - **A question asked for by name wins** — the arrival effect below is the
   *   later writer, and when the arrival is seen here first (the levels still
   *   loading) the batch is counted as opened rather than chosen again once
   *   they load. An arrival for another batch, or for no question, is not one.
   * - Not an arrival by Next, so the step shows its premise.
   *
   * After the batch reset and the filter effect, whose `setAt` this overrides.
   */
  const [resumedBatch, setResumedBatch] = useState<string | undefined>(undefined);
  const resuming = quiz != null && resumedBatch !== quiz.batchId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per batch, when the walk can say where the reader may land; the kept answers and the filter are read as they stand
  useEffect(() => {
    /* A 404 resets the walk, so the same batch returning needs a fresh choice
       too. Its previous completion must not outlive the questions. */
    if (!quiz) {
      setResumedBatch(undefined);
      return;
    }
    if (!resuming) return;
    const named =
      arrival?.batchId === quiz.batchId && questions.some((q) => q.id === arrival.questionId);
    if (!named && waitingForReading) return;
    setResumedBatch(quiz.batchId);
    if (named) return;
    const to =
      includedAt.find((i) => {
        const q = questions[i];
        return q !== undefined && !owner.kept.has(q.id);
      }) ?? includedAt[0];
    if (to === undefined) return;
    /* Not `move`: there is no draft or mark to take away — the batch reset has
       just cleared them, and nothing has been drawn since. */
    setAt(to);
    setArrivedByNext(false);
  }, [quiz?.batchId, resuming, waitingForReading, arrival]);

  /**
   * **Land on a question pressed in the prose** — `QuizArrival`.
   *
   * **Declared after the batch reset, the filter and the opening effect, on
   * purpose**: all four can run in one commit — the band mounting with an arrival, or a new
   * batch — and the last `setAt` is the one that lands. It is idempotent, so
   * StrictMode running it twice lands in the same place; only the hand-back is
   * repeated, and the owner clears an arrival only if it is still the one it
   * was handed. GPT Sol's plan review, 260930i finding 2.
   *
   * - **Another batch's arrival is taken and ignored** — finding 1.
   * - **The question already open is not moved to**, `pick`'s rule: `move`
   *   aborts a mark in flight and drops the draft (finding 3). Its index is
   *   still written last, and the filter yields to a new valid arrival before
   *   it can clear any answer state.
   * - **The tick-box gives way.** The reader asked for this question by name, so
   *   if *Only what I've read* would hide it — or the reading levels are still
   *   loading, while the walk waits — it is turned off, visibly, rather than
   *   the walk landing somewhere else.
   * - A jump is not an arrival by Next, so the step shows its premise.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for a new arrival or a new batch; `move` is recreated every render and the rest is read as it stands
  useEffect(() => {
    const sameBatch = arrivalSeen.current.batchId === quiz?.batchId;
    arrivalSeen.current = { batchId: quiz?.batchId, arrival };
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

  /** Undefined while the step at `at` is filtered out, and until the batch has
      been opened somewhere — see the effects above. */
  const question: QuizQuestion | undefined =
    changingBatch || resuming || waitingForReading || included[at] === false ? undefined : questions[at];
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
  const transcribe = useReaderTranscriber();
  const dictate = useDictationField({
    value: typed,
    onChange: setTyped,
    box,
    context: { kind: "article", slug: owner.slug },
    transcribe,
    /* One box per question: an answer offered back under a different question
       would be the wrong answer. */
    keep: keepDictation(`quiz:${owner.slug}:${question?.id ?? ""}`),
    /* A double press on Stop also answers (dictation.md § A double press). */
    onDone: () => submit(),
    /* One box across every question: an answer goes to the one it was said to. */
    doneKey: question?.id,
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
  const [readingReplacement, setReadingReplacement] = useState(false);
  const run = (label: string, verb: () => Promise<void> = owner.write) =>
    owner.rewriting && !owner.job && !owner.starting && !owner.failed ? (
      <div>
        <p className="gloss-quiet">The new questions haven't loaded yet.</p>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={readingReplacement}
          onClick={() => {
            setReadingReplacement(true);
            /* A delayed or failed post-job GET needs another read, never a
               second paid rewrite — including the stale banner's button. */
            void owner.refresh().then(
              () => setReadingReplacement(false),
              () => setReadingReplacement(false),
            );
          }}
        >
          Read the new questions
        </Button>
      </div>
    ) : (
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
   * the thing the reader is editing *against*, and a keystroke aimed at a typo
   * would take it off the screen (it is kept since 2026-10-05, but it would
   * come back only on leaving the question and returning). Quiz is not a test
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

  /**
   * **The box is as tall as what is in it** — Greg, 2026-10-03 (spya-qnrxuw):
   * *"show the whole answer and don't put my answer in a scrollable box."*
   * Chat's composer's mechanism without its roof: `auto` first, or the box could
   * only ever grow. `rows` is the floor; the band is what scrolls.
   *
   * **Measured again when the width changes, and not only when the words do.**
   * Rotate an iPad under a long answer and more lines wrap inside a height
   * nobody re-asked for, with the overflow hidden — the words would be there
   * and not on screen. GPT Sol's plan review, F1.
   *
   * The passed-over line of CSS is `field-sizing: content`: no Firefox, and a
   * Safari too recent to promise on the iPad this was reported from.
   */
  const fitBox = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    /* `scrollHeight` stops inside the border and the box is `border-box`. */
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  };
  const hasQuestion = question !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect measures the DOM, and `typed` is what changed it; `hasQuestion` is the box mounting
  useLayoutEffect(fitBox, [typed, hasQuestion]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hasQuestion` is the box mounting and unmounting, which is when there is an element to watch
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* Width only: the fit itself changes the height, and reacting to that
       would be a loop. */
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitBox();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [hasQuestion]);

  /**
   * **A finished mark that is about the words in the box.** From here the next
   * thing to do is go on, so the fill moves from Answer to Next (spya-smev24).
   * Read from `status`, never from the verdict: right, wrong and unjudged look
   * the same, because how the reader did is not for showing.
   */
  const settled = mine?.status === "done" && !superseded;

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
   *
   * **A restored attempt is not a new mark, and is skipped.** It is `done`
   * with no verdict — verdicts are not stored — which is exactly the shape
   * "the latest mark could not be judged" has, so recording it would delete a
   * verdict earned this visit every time the reader pressed Previous. GPT
   * Sol's plan review of 261005b, F4.
   */
  useEffect(() => {
    if (verdictBatch.current !== quiz?.batchId) {
      verdictBatch.current = quiz?.batchId;
      return;
    }
    if (attempt?.status !== "done" || attempt.restored) return;
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
   * **Put a kept answer back** — the box and the mark together, for the
   * question actually on screen.
   *
   * **Declared after the batch reset, the filter, the arrival and the verdict
   * effects, on purpose**, so their scheduled moves take precedence. State
   * writes do not change this effect's captured values: a valid arrival to a
   * different question must wait for its destination to render before we
   * restore. It is keyed on the batch, the id of
   * the question drawn, and that question's kept answer — so it runs when the
   * walk lands somewhere (however it got there), and again when kept answers
   * arrive after the question did.
   *
   * **It only ever fills a vacancy**: no attempt at all, and an empty box. A
   * draft, a mark in flight, a failed mark and a finished one are all left
   * alone. And **`typed` and the attempt are read, not depended on** — keyed
   * on them, a reader who typed over nothing and then cleared the box would
   * have their old answer jump back in under the caret.
   *
   * `question` is undefined while a batch is changing or the step at `at` is
   * filtered out, so nothing is restored under a question the panel has not
   * committed to. Idempotent, so StrictMode's second run changes nothing.
   */
  const shownId = question?.id;
  const keptHere = shownId === undefined ? undefined : owner.kept.get(shownId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate triggers — landing on a question, or its kept answer arriving; `typed` and the attempt are read as they stand (see above), and `showKept` is read fresh
  useEffect(() => {
    if (shownId === undefined || !keptHere) return;
    /* The arrival effect above schedules state; this closure still sees the
       question from before that move. Wait for its destination to render. */
    if (
      arrival &&
      arrival.batchId === quiz?.batchId &&
      arrival.questionId !== shownId &&
      questions.some((q) => q.id === arrival.questionId)
    ) return;
    if (owner.attempt !== null || typed !== "") return;
    setTyped(keptHere.answer);
    owner.showKept(shownId);
  }, [quiz?.batchId, shownId, keptHere]);

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
   * browser — the ends of the path do not wrap, as Skim's do not.
   *
   * Read through a ref, so `Reader` is handed one stable function for the life
   * of the panel and a quiz render does not re-render the reading view.
   */
  const unmarked = typed.trim() !== "" && (mine?.status !== "done" || superseded);
  /* **And not while the microphone is recording or its transcript is on its
     way**, box empty or not: a browser that shows no rough words leaves the box
     empty while it listens, and the transcript lands through `setTyped` after a
     move — under the *next* question. GPT Sol's plan review, finding 2. */
  const listening = dictate.busy;
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

  const cannotAnswer = !typed.trim() || tooLong || marking || owner.stale || dictate.busy;
  const answerName = marking ? "Marking…" : mine?.status === "failed" && !superseded ? "Try again" : "Answer";

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
    if (dictate.busy || !question) return;
    const answer = typed.trim();
    if (answer === "" || tooLong || marking || owner.stale) return;
    void owner.mark(question.id, answer);
  };

  return (
    <ModeSurface
      label="Quiz"
      feature="gloss quiz"
      /* Quiz is Learn's other half, so its (i) opens with Learn's
          catalog words (mode-catalog.ts has no `quiz`, on purpose). */
      about={<QuizAbout quiz={quiz && owner.status === "ready" ? quiz : null} />}
      /* **A fragment, because `subMode` is an optional prop.** `LearnBand`
          passes one on every render, so an empty row is not a state a reader
          can reach — but `head={subMode}` would hand the surface `undefined`
          for any caller that did not, and the row would vanish rather than sit
          empty. The fragment is always a header. */
      head={
        <>
          {/* The mode's name went on 2026-09-05 — the Dock says it (§ Stage 5 of
              docs/plans/260905d-declutter-the-reading-view-top-bars.md). The row
              stays for the Recall | Tutorial | Explore | Quiz control, which is the one thing here
              the Dock does *not* say. */}
          {subMode}
          {/* Written for your profile, and the Regenerate in its panel — Greg,
              2026-10-02: *"it needs a "Regenerate for my profile". That's more
              important, ok to lose answers."* `write` is the forced run *Write
              them again* makes; the new batch takes the answers with it (the
              `batchId` effect above), and the panel says so before the press.
              Owner-only like the band. Plan 261002f. */}
          {quiz && owner.status === "ready" && (
            <WrittenForYou
              written={owner.profiled}
              changed={owner.profileChanged}
              slug={owner.slug}
              regenerate={{
                run: () => void owner.write(),
                busy: owner.job !== null || owner.starting || owner.rewriting,
                refresh: () => owner.refresh(),
                consequence: "Writes new questions for your profile; your answers so far are cleared.",
              }}
            />
          )}
        </>
      }
      /* No standing *Write them again* under the question any more — Greg,
          2026-09-29 (SPIDERYARN-READING2-53): *"let's just rely on the
          Metadata mode for that."* Metadata's *AI processing* has a
          Quiz row; the stale banner keeps its own button.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          Keep the footer while a current batch's job is starting, running or
          failed, or its replacement has not loaded. Otherwise removing the
          button removes the only place to show progress, failure or a read retry. Not on a
          stale batch, whose banner carries the job; an outdated one has no
          banner (plan 260929c), so its job shows here. */
      foot={
        quiz &&
        owner.status === "ready" &&
        !owner.stale &&
        (owner.job || owner.starting || owner.failed || owner.rewriting) ? (
          <div className="quiz-rewrite">{run("Write them again")}</div>
        ) : null
      }
    >

      {owner.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner.status === "loading" && <BandWaiting className="gloss-quiet">Looking for the questions…</BandWaiting>}

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

          {/* **"Could not read" is not "none".** The questions are here and the
              reader's earlier answers to them are not: said once, quietly,
              with the read again — `retryRead` is a GET and never spends.
              Only when nothing is held for this batch; a later read that
              cannot say leaves what an earlier one brought (useQuiz.ts §
              `fromServer`). GPT Sol's plan review of 261005b, F5. */}
          {owner.keptUnread && questions.length > 0 && (
            <p className="gloss-quiet">
              Your earlier answers could not be loaded.{" "}
              <Button type="button" size="xs" variant="outline" onClick={() => void owner.retryRead()}>
                Try again
              </Button>
            </p>
          )}

          {waitingForReading && questions.length > 0 && (
            <BandWaiting className="gloss-quiet">Looking for what you have read…</BandWaiting>
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
                      below keeps its own meaning — *you have a finished mark
                      for this question* — which stays true whatever the reader
                      is typing now. */}
                  {answered.has(question.id) && !superseded && " — answered"}
                </p>
                {/* **What "of N" leaves out, said wherever "of N" is.** This
                    sentence was under the list, which is closed until asked
                    for — so the band said "Question 1 of 5" and the (i) card
                    "12 questions", both true and neither explained. Moved, not
                    repeated (GPT Sol's F3 on plan 261006g), and it names the
                    whole batch so the two figures meet. */}
                {hiddenCount > 0 && (
                  <p className="gloss-hint">
                    There are {questions.length} in all:{" "}
                    {hiddenCount === 1
                      ? "the other one is about a passage you have not read yet."
                      : `the other ${hiddenCount} are about passages you have not read yet.`}
                  </p>
                )}
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
                  {/* **Chat's send button, and its words on a card** — Greg,
                      2026-10-03 (spya-fzgcqu): *"replace the answer text label
                      with, you know, an icon and a tooltip, just as we do with
                      other places in the chat."* `chat-send` is the box;
                      `quiz-go` is the fill, which this button has until its
                      answer is marked and Next has after (quiz.css).

                      Refused on an empty answer, while one is in flight, on a
                      stale quiz and on both microphone states — `submit` says
                      no to every one of them, and the server to the first
                      three. **`aria-disabled`, not `disabled`**, so the card
                      still opens on a button that cannot be pressed, which is
                      when a reader wonders what it is (tooltips.md). */}
                  <Tooltip
                    placement="top"
                    content={
                      <ControlTip
                        head={answerName}
                        what="Have your answer marked against the article."
                        how="Cmd+Enter or Ctrl+Enter in the box does the same."
                      />
                    }
                  >
                    <button
                      type="button"
                      className={settled ? "chat-send" : "chat-send quiz-go"}
                      /* *Try again* only where trying the same thing again is
                         what the press means. Once the box has been edited the
                         button is sending a different answer, not retrying a
                         dropped connection — and the note above it says "Press
                         Answer". */
                      aria-label={answerName}
                      aria-busy={marking || undefined}
                      aria-disabled={cannotAnswer || undefined}
                      onClick={cannotAnswer ? undefined : submit}
                    >
                      {marking ? <LoaderCircle className="cmt-spinner" size={18} /> : <SendHorizontal size={18} />}
                    </button>
                  </Tooltip>
                  <Mic dictate={dictate} disabled={marking || owner.stale} />
                  {tooLong && (
                    <span className="gloss-error">
                      That is longer than {MAX_QUIZ_ANSWER_CHARS} characters.
                    </span>
                  )}
                </div>
                <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />

                {mine && (
                  <Mark
                    attempt={mine}
                    superseded={superseded}
                    emptied={typed.trim() === ""}
                    blocks={blocks}
                    onJump={onJump}
                  />
                )}

                {/* Under the mark and above the reference answer since
                    2026-10-03: where the reader looks when they have finished
                    reading what the mark says. */}
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
                    {/* **One element, two looks.** Quiet like its neighbours until
                        the answer is marked, then the filled box Answer had:
                        Greg expected "a button at the bottom underneath" the
                        mark and the grey chevron did not read as one
                        (spya-smev24). A plain `<button>` switching class and
                        not an `IconButton` swapped for something else, so
                        focus stays put as the mark lands; refused the way
                        `IconButton` refuses, so its card still opens. */}
                    <button
                      type="button"
                      className={settled && canGoNext ? "chat-send quiz-go" : ICON_BUTTON_CLASS}
                      aria-label="Next question"
                      aria-disabled={!canGoNext || undefined}
                      onClick={
                        canGoNext
                          ? goNext
                          : (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                      }
                    >
                      <ChevronRight />
                    </button>
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

                <ReferenceAnswer
                  question={question}
                  open={showAnswer}
                  onToggle={() => setShowAnswer((v) => !v)}
                  onJump={onJump}
                />

                {/* How many the filter leaves out is said beside the count
                    above, list open or closed. */}
                {listing && (
                  <QuestionList
                    questions={questions.filter((_, i) => included[i])}
                    currentId={question.id}
                    answered={answered}
                    onPick={pick}
                  />
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
 * the line docs/project/learn-mode.md § The prompt is the feature draws for
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
              {/* In the title's voice: the author's heading kept, or the model's (fonts.md). */}
              <button
                type="button"
                className={withVoice("quiz-look-again-section", row.section.titleVoice)}
                onClick={() => onRead(row.section.blockId)}
              >
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
 * How much is a small pie with the figure on its card, not a line of text
 * (spya-mafmm6; docs/plans/261003e-quiz-read-so-far-as-a-small-pie-chart.md).
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
      <span className="quiz-only-read-what">
        <label>
          <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> Only
          what I’ve read
        </label>
        {share !== null && (
          <SharePie
            share={share}
            label={sentenceCase(`${readShareLabel(share)} of the piece read so far`)}
            detail="Counted in words, from the passages that have been on screen long enough to read."
          />
        )}
      </span>
      {readSoFar.status === "failed" && on && (
        <span className="gloss-hint">couldn’t load what you have read, so this is every question</span>
      )}
    </div>
  );
}

/** "about 40% of…" → "About 40% of…": the card's line is a sentence. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
              a sentence about a heading must stay a `#`. Links are off —
              nothing in this prompt governs what a model may link, and an
              `href` built from model output is
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
      {/* The mark is whole and usable; what failed is keeping it. Quiet, under
          the mark it is about, and it stays with it across Next and Previous
          for the rest of the visit — after which it is true. Not an error
          colour: nothing the reader did went wrong and there is nothing to
          retry but answering again. GPT Sol's plan review of 261005b, F7. */}
      {attempt.status === "done" && attempt.notSaved && (
        <p className="gloss-count">
          This answer could not be saved, so it will not be here when you come back.
        </p>
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
            {/* Answered means one thing: a mark that reached `done`, this
                visit or an earlier one — the keys of `useQuiz`'s `kept`. */}
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
      <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} disabled={disabled} again={dictate.again} sendingAfter={dictate.sendingAfter} />
      <span className="quiz-mic-label">
        {dictate.dictation.armed ? "Listening…" : dictate.readOnly ? "Writing it down…" : "Talk"}
      </span>
    </span>
  );
}
