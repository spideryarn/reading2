/**
 * **The Quiz band** — one question, an answer box, and the reply.
 *
 * The other half of Review. Free recall asks the reader what they took from the
 * article; this asks the questions the article itself would ask, from a batch
 * written once and cached as an artefact (src/quiz.ts).
 *
 * ## What this stage deliberately does not draw
 *
 * *Show all twelve*, the collapsed **"Show a reference answer"**, dictation on
 * the answer box, the citation chips that jump the prose, and the CSS that
 * makes it look like the rest of the app. All stage 3
 * (docs/plans/260831al-review-quiz-sub-mode.md § Stage 3). What is here is the
 * thin vertical slice the value actually lives in: a real question out of the
 * artefact, a real answer, and a real streamed reply, end to end.
 *
 * The classes are borrowed from the glossary and timeline bands (`gloss-*`) on
 * purpose. A panel with no styles at all is not reviewable, and inventing a
 * `quiz-*` vocabulary now would mean writing it twice — once here and once when
 * stage 3 designs the band properly.
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
import { useEffect, useState } from "react";
import { MessageCircleQuestionMark, TriangleAlert } from "lucide-react";
import type { QuizQuestion } from "../types.js";
import { MAX_QUIZ_ANSWER_CHARS } from "../types.js";
import type { UseQuiz } from "./useQuiz.js";
import type { ReviewView } from "./params.js";
import { JobProgress } from "./JobProgress.js";
import { useRenderCount } from "./perf.js";

/**
 * **Recall | Quiz**, at the top of the Review band.
 *
 * A control rather than two links, because the two are one choice — and it is
 * rendered by `ReviewBand` and handed to whichever panel is showing, so that
 * both halves of Review carry the same control in the same place rather than
 * each growing its own.
 *
 * The navigation rules it triggers (clear `thread` in one step; Quiz wins a
 * pasted collision) are `ReviewBand`'s, in src/web/App.tsx. This component only
 * says which half is open and asks for the other.
 */
export function ReviewSubModeToggle({
  value,
  onChange,
}: {
  value: ReviewView;
  onChange(next: ReviewView): void;
}) {
  return (
    /* No `role="group"`: each button already says what it is and whether it is
       pressed, and the two honest alternatives are worse — a `fieldset` needs a
       `legend` this band has no room for, and a `tablist` promises arrow-key
       navigation that would then have to be written and kept. */
    <div className="review-submode">
      {(["recall", "quiz"] as const).map((view) => (
        <button
          key={view}
          type="button"
          className={`review-submode-btn${value === view ? " on" : ""}`}
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
}: {
  owner: UseQuiz;
  /** The Recall | Quiz control, built by `ReviewBand`. */
  subMode?: React.ReactNode;
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

  /* A new batch is a new set of questions with new ids, so an index and a
     half-typed answer from the old one mean nothing. Keyed on `batchId` rather
     than on the question count, because twelve questions replaced by twelve
     different ones is the case that matters and a count would not see it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset trigger — a new batch invalidates the index and the draft, and neither is read here
  useEffect(() => {
    setAt(0);
    setTyped("");
  }, [quiz?.batchId]);

  const question: QuizQuestion | undefined = questions[at];

  const run = (label: string) => (
    <JobProgress
      job={owner.job}
      failed={owner.failed}
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
    setAt(to);
  };

  return (
    <aside className="mode-band gloss quiz" aria-label="Quiz">
      <div className="gloss-head">
        <MessageCircleQuestionMark size={14} className="gloss-head-icon" />
        <h2>Review</h2>
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
          {/* Stale wins when both are true, for the reason the timeline band
              gives next door: it is the one that makes the passages wrong, and
              two banners stacked is a wall. Stale here also means every mark is
              refused with a 409 until the questions are rewritten, so the
              button is the only useful thing on the screen. */}
          {owner.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These questions were written about an older version of the article, so answers
                cannot be marked against them.
              </p>
              {run("Write them again")}
            </div>
          ) : owner.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written by an older version of the prompt.
              </p>
              {run("Write them again")}
            </div>
          ) : null}

          {question && (
            <div className="quiz-one">
              <p className="gloss-count">
                Question {at + 1} of {questions.length}
                {answered.has(question.id) && " — answered"}
              </p>
              <p className="quiz-question">{question.question}</p>

              <textarea
                className="quiz-answer"
                value={typed}
                rows={4}
                placeholder="Your answer, a couple of sentences"
                aria-label="Your answer"
                onChange={(e) => setTyped(e.target.value)}
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
                  onClick={() => void owner.mark(question.id, typed.trim())}
                >
                  {marking ? "Marking…" : mine?.status === "failed" ? "Try again" : "Answer"}
                </button>
                {tooLong && (
                  <span className="gloss-error">
                    That is longer than {MAX_QUIZ_ANSWER_CHARS} characters.
                  </span>
                )}
              </div>

              {/* The reply, and **the failure is drawn beside it rather than
                  instead of it**: a half-arrived mark is worth reading and the
                  reader has already read it. What the failure changes is the
                  button, which says "Try again", and the tick, which is not
                  given. */}
              {mine?.reply && <p className="quiz-reply">{mine.reply}</p>}
              {mine?.status === "failed" && mine.error && (
                <p className="gloss-error">{mine.error}</p>
              )}

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
              </div>
            </div>
          )}

          <div className="quiz-rewrite">{run("Write them again")}</div>
        </>
      )}
    </aside>
  );
}
