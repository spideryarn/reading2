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
 * ## The one rule that is not cosmetic
 *
 * **A question is ticked answered only when the mark reaches `done`.** That
 * lives in `useQuiz`, not here; what this file must not do is draw a completed
 * mark from a `reply` that is merely non-empty. `attempt.status` is the only
 * thing consulted, and a `"failed"` attempt keeps its half-written reply on
 * screen *and* keeps the Answer button live. A stream that stops cleanly
 * without finishing looks exactly like one that finished, which is the failure
 * this whole shape is arranged against.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestionMark, TriangleAlert } from "lucide-react";
import type { BlockId, QuizQuestion } from "../types.js";
import { MAX_QUIZ_ANSWER_CHARS } from "../types.js";
import type { UseQuiz } from "./useQuiz.js";
import type { RememberView } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { JobProgress } from "./JobProgress.js";
import { TooltipGroup } from "./Tooltip.js";
import { type UseDictationField, useDictationField } from "./useDictationField.js";
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
  value,
  onChange,
}: {
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
          onClick={() => value !== view && onChange(view)}
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
     different ones is the case that matters and a count would not see it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset trigger — a new batch invalidates the index and the draft, and neither is read here
  useEffect(() => {
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

  const run = (label: string) => (
    <JobProgress
      job={owner.job}
      failed={owner.failed}
      blocking={owner.blocking}
      stalled={owner.stalled}
      onRun={() => owner.write()}
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
    /* **Not while a transcript is on its way.** `readOnly` stops typing and
       nothing else, so this button is still live during the two seconds between
       the reader stopping and the good words arriving — and marking the
       recogniser's rough guess is the one outcome the two-pass design must not
       produce. The same guard chat's composer carries, for the same reason. */
    if (dictate.readOnly || !question) return;
    const answer = typed.trim();
    if (answer === "" || tooLong || marking || owner.stale) return;
    void owner.mark(question.id, answer);
  };

  return (
    <aside className="mode-band gloss quiz" aria-label="Quiz">
      <div className="gloss-head">
        <MessageCircleQuestionMark size={14} className="gloss-head-icon" />
        <h2>Remember</h2>
        {subMode}
      </div>

      {owner.error && <p className="gloss-error">{owner.error}</p>}

      {owner.status === "loading" && <p className="gloss-quiet">Looking for the questions…</p>}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has written questions about this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes about a minute. Written once and
            kept — you will not be asked again unless the article changes.
          </p>
          {run("Write the questions")}
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
                  {answered.has(question.id) && " — answered"}
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
                       courtesy; the route is the rule. */
                    disabled={!typed.trim() || tooLong || marking || owner.stale}
                    onClick={submit}
                  >
                    {marking ? "Marking…" : mine?.status === "failed" ? "Try again" : "Answer"}
                  </button>
                  <Mic dictate={dictate} disabled={marking || owner.stale} />
                  {tooLong && (
                    <span className="gloss-error">
                      That is longer than {MAX_QUIZ_ANSWER_CHARS} characters.
                    </span>
                  )}
                </div>
                <DictationStrip dictation={dictate.dictation} />

                {/* The reply, and **the failure is drawn beside it rather than
                    instead of it**: a half-arrived mark is worth reading and the
                    reader has already read it. What the failure changes is the
                    button, which says "Try again", and the tick, which is not
                    given. */}
                {mine?.reply && (
                  <p className="quiz-reply">
                    {/* `CitedText`, not `CitedMarkdown`: the marking prompt asks
                        for plain prose paragraphs and forbids lists and
                        headings, so a stray `#` in a sentence about a heading
                        must stay a `#`. The summary panel makes the same call.
                        Links are off — nothing in this prompt governs what a
                        model may link, and an `href` built from model output is
                        somewhere a hostile page can steer a reader
                        (docs/project/security.md).

                        `live` while the mark is arriving suppresses a Floating
                        UI instance per chip on every token; `partial` says only
                        the tail is half-written. */}
                    <CitedText
                      text={mine.reply}
                      blocks={blocks}
                      onJump={onJump}
                      live={mine.status === "marking"}
                      partial={mine.status === "marking"}
                    />
                  </p>
                )}
                {mine?.status === "failed" && mine.error && (
                  <p className="gloss-error">{mine.error}</p>
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

          <div className="quiz-rewrite">{run("Write them again")}</div>
        </>
      )}
    </aside>
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
