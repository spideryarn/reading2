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
 * than to shop. *Show all twelve* is there because Greg asked for it and the
 * reason is a real one — a reader who cannot answer this question may be able
 * to answer the next, and hunting for that by pressing Next twelve times is
 * worse than reading a list. Picking from the list closes it again, so the band
 * is back to one question and a box.
 *
 * The order is the artefact's and is **never re-sorted here** — easy questions
 * first and central ones within a band, decided by src/quiz.ts § `orderQuestions`
 * against the whole batch. A panel that sorted would be a second opinion about
 * the same list, and the two would drift.
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
import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestionMark, TriangleAlert } from "lucide-react";
import type { BlockId, QuizQuestion } from "../types.js";
import { MAX_QUIZ_ANSWER_CHARS } from "../types.js";
import type { Attempt, UseQuiz } from "./useQuiz.js";
import type { RememberView } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { TooltipGroup } from "./Tooltip.js";
import { type UseDictationField, useDictationField } from "./useDictationField.js";
import { armActivation } from "./activation.js";
import { useRenderCount } from "./perf.js";

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
          {view === "recall" ? "Recall" : "Quiz"}
        </button>
      ))}
    </div>
  );
}

export function QuizPanel({
  owner,
  subMode,
  blocks,
  onJump,
}: {
  owner: UseQuiz;
  /** The Recall | Quiz control, built by `RememberBand`. */
  subMode?: React.ReactNode;
  /** Every block this article has, id to plain text — the "is this real" check
      every citation chip in the band is drawn through. */
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  useRenderCount("QuizPanel");
  const { quiz, attempt, answered } = owner;
  const questions = quiz?.questions ?? [];

  /**
   * Which question is open, by **index**, and deliberately not in the URL.
   *
   * The rule `?at=` and `?thread=` serve is that a shared link lands you where
   * the link-maker was. Here the thing a link would frame is an answer that
   * does not survive a reload anyway, so the parameter would promise a
   * continuity v1 does not have. It arrives with stored attempts.
   * docs/plans/260831al-review-quiz-sub-mode.md § Which question is open.
   */
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState("");
  /** The whole ordered batch, open. Closes again as soon as one is picked. */
  const [listing, setListing] = useState(false);
  /** Per question, and reset by `move` — see the comment on the button. */
  const [showAnswer, setShowAnswer] = useState(false);

  const box = useRef<HTMLTextAreaElement | null>(null);

  /* A new batch is a new set of questions with new ids, so an index and a
     half-typed answer from the old one mean nothing. Keyed on `batchId` rather
     than on the question count, because twelve questions replaced by twelve
     different ones is the case that matters and a count would not see it.

     **`clearAttempt` is on this list and it is not cosmetic.** The mark belongs
     to the batch it was computed against, so it goes with the rest — but the
     line that matters is the abort inside it. A mark still streaming holds
     `live.current` in useQuiz.ts, and `mark` opens with `if (live.current)
     return`, so leaving it there gives the new batch an Answer button that is
     enabled and does nothing at all. Nothing goes red and nothing is logged;
     the reader just presses it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset trigger — a new batch invalidates the index, the draft and the mark, and none is read here; `clearAttempt` is stable
  useEffect(() => {
    owner.clearAttempt();
    setAt(0);
    setTyped("");
    setListing(false);
    setShowAnswer(false);
  }, [quiz?.batchId]);

  const question: QuizQuestion | undefined = questions[at];

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

  const move = (to: number) => {
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
      /* Pinned under the question rather than at the end of it, on the same
          guard it had as a trailing child of the band. */
      foot={quiz && owner.status === "ready" ? <div className="quiz-rewrite">{run("Write them again")}</div> : null}
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
          <Staleness stale={owner.stale} outdated={owner.outdated} run={run} />

          {questions.length === 0 && (
            <p className="gloss-quiet">
              The questions were written, but none of them survived checking against the article.
              Writing them again is worth a try.
            </p>
          )}

          {question && (
            /* One group for the whole band, so moving along a row of citations
               shows each card immediately instead of waiting out the open delay
               again — chat's reason, and the dock's. */
            <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
              <div className="quiz-one">
                <p className="gloss-count">
                  Question {at + 1} of {questions.length}
                  {/* Dropped while the box holds something that has not been
                      marked, because this line sits directly above that box and
                      reads as a claim about what is in it. The tick in the list
                      below keeps its own meaning — *you got a finished mark for
                      this question at some point this session* — which stays
                      true whatever the reader is typing now. */}
                  {answered.has(question.id) && !superseded && " — answered"}
                </p>
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
                  <button type="button" disabled={at === 0} onClick={() => move(at - 1)}>
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={at >= questions.length - 1}
                    onClick={() => move(at + 1)}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className="quiz-disclose"
                    aria-expanded={listing}
                    onClick={() => setListing((v) => !v)}
                  >
                    {listing ? "Hide the list" : `Show all ${questions.length}`}
                  </button>
                </div>

                {listing && (
                  <QuestionList
                    questions={questions}
                    at={at}
                    answered={answered}
                    onPick={(i) => {
                      if (i !== at) move(i);
                      setListing(false);
                    }}
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

              `live` while the mark is arriving suppresses a Floating UI instance
              per chip on every token; `partial` says only the tail is
              half-written. */}
          <CitedText
            text={attempt.reply}
            blocks={blocks}
            onJump={onJump}
            live={attempt.status === "marking"}
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
 * pressing Next twelve times is worse than reading a list.
 *
 * **Nothing here sorts.** `orderQuestions` in src/quiz.ts has already done it
 * once, against bands and values this component never sees; a second opinion
 * about the same list is two lists that drift. The rows are not numbered
 * either — the band says "Question 3 of 12" above, and a second numbering that
 * has to agree with the first is a second source of truth.
 */
function QuestionList({
  questions,
  at,
  answered,
  onPick,
}: {
  questions: readonly QuizQuestion[];
  at: number;
  answered: ReadonlySet<string>;
  onPick(i: number): void;
}) {
  return (
    <ol className="quiz-list">
      {questions.map((q, i) => (
        <li key={q.id}>
          <button
            type="button"
            className={`quiz-list-row${i === at ? " on" : ""}`}
            aria-current={i === at ? "true" : undefined}
            onClick={() => onPick(i)}
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
 * The two ways a batch stops describing the article, and **only one banner**.
 *
 * `stale` wins when both are true, for the reason the timeline band gives next
 * door: it is the one that makes the passages wrong, and two banners stacked is
 * a wall. Stale also means every mark is refused with a 409 until the questions
 * are rewritten, so the button under it is the only useful thing on the screen.
 *
 * They are separate facts: `stale` is the article having moved under the
 * questions, `outdated` is the questions predating the current prompt. The
 * first breaks marking; the second only means better questions are available.
 */
function Staleness({
  stale,
  outdated,
  run,
}: {
  stale: boolean;
  outdated: boolean;
  run(label: string): React.ReactNode;
}) {
  if (!stale && !outdated) return null;
  return (
    <div className="gloss-stale">
      <p>
        <TriangleAlert size={13} />
        {stale
          ? "These questions were written about an older version of the article, so answers cannot be marked against them."
          : "These were written by an older version of the prompt."}
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
