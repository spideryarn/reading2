/**
 * **Quiz's questions in the margin, answered there.**
 *
 * > Yes, let's try and avoid having to jump away from marginalia mode to the
 * > learn mode, because that'll take us out the flow. … Make the voice button
 * > very easy to access, and then some kind of nice feedback, visual feedback
 * > actually, it might be quite important, not gamification. But just some of
 * > that sense of satisfaction of, you know, turning it a subtle green or
 * > whatever.
 * >
 * > — Greg, 2026-10-29 (spya-jzgrua)
 *
 * Until plan 261029i a press on a question here opened Learn › Quiz at it. Now
 * it opens a small answer box under the question, in the margin; *Open in
 * Quiz* is one line in that box, for the walk, the premise and the reference
 * answer. A microphone on the question line opens the box and starts listening
 * in the same press. **An answered question turns a quiet green**, and stays
 * green: answered is what the green says, never right or wrong, so the hidden
 * verdict is still not drawn (quiz.md § Whether the reader got it right is
 * asked somewhere else; whether green should mean "right" instead is Greg's
 * question q-ejp09q follow-up).
 *
 * The marking is `useQuizMark`, the band's own, so the mark's terminal
 * contract, its kept answer and the page-wide one-mark-per-question claim are
 * the band's. What reaches here without going through `memo(TableView)` is
 * `MarginQuizContext`, `MarginCiteActions`' arrangement.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, LoaderCircle, MessageCircleQuestionMark, Mic, SendHorizontal } from "lucide-react";
import { type BlockId, MAX_QUIZ_ANSWER_CHARS, type QuizQuestion, type QuizQuestionId } from "../../types.js";
import { QuizMarkText } from "../QuizPanel.js";
import { DictationButton, DictationStrip, TalkLabel } from "../DictationStrip.js";
import { keepDictation } from "../dictation-keep.js";
import { useReaderTranscriber } from "../dictation-upload.js";
import { dictationReporter } from "../dictation-report.js";
import { useDictationField } from "../useDictationField.js";
import { useFitTextarea } from "../useFitTextarea.js";
import { type QuizMarkSource, useQuizMark } from "../useQuiz.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { withVoice } from "../voice.js";

/**
 * **What a Quiz line in the margin needs to be answered there.** The owner's
 * only: the Reader provides it for the article's owner, and without it the
 * lines are what they were, a press that opens Quiz.
 *
 * Narrow on purpose (GPT Sol's plan review, F4): `useQuizRead` hands back a
 * new object on every owner render, so a context holding it would wake every
 * Quiz line beside the prose on any render of the reading view. These fields
 * change only when the quiz or its answers do.
 */
export interface MarginQuiz extends QuizMarkSource {
  slug: string;
  /** The article moved under these questions; answering is refused, as in the band. */
  stale: boolean;
  /** Every block, id to text — what the mark's citation chips are checked against. */
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}

export const MarginQuizContext = createContext<MarginQuiz | null>(null);

/** One block's questions. */
export function QuizNote({
  batchId,
  questions,
  onOpen,
}: {
  batchId: string;
  questions: readonly QuizQuestion[];
  /** Learn › Quiz at one question — the prose line's press (Reader.tsx § `openQuizAt`). */
  onOpen?: ((batchId: string, questionId: QuizQuestionId) => void) | undefined;
}) {
  const ctx = useContext(MarginQuizContext);
  return (
    <div className="marg-quiz">
      <span className="marg-stamp" data-marg-tip="quiz">Quiz</span>
      {/* Keyed by batch, so a replacement batch starts with nothing open and
          the old mark aborted by the unmount (Sol F2). */}
      {ctx && ctx.quiz?.batchId === batchId ? (
        <Answerable key={batchId} ctx={ctx} batchId={batchId} questions={questions} onOpen={onOpen} />
      ) : (
        questions.map((q) => (
          <button
            key={q.id}
            type="button"
            className="marg-quiz-q"
            data-marg-tip="quiz"
            data-marg-voice="ai"
            disabled={onOpen === undefined}
            onClick={() => onOpen?.(batchId, q.id)}
          >
            <MessageCircleQuestionMark size={12} aria-hidden="true" className="marg-quiz-icon" />
            <span className={withVoice("marg-quiz-text", "ai")}>{q.question}</span>
          </button>
        ))
      )}
    </div>
  );
}

/**
 * The answerable lines. One box open per block; opening another, or closing
 * this one, takes the mark with it, aborting one still arriving — the band's
 * Next, for the band's reason (one live request, and nobody is reading it).
 */
function Answerable({
  ctx,
  batchId,
  questions,
  onOpen,
}: {
  ctx: MarginQuiz;
  batchId: string;
  questions: readonly QuizQuestion[];
  onOpen?: ((batchId: string, questionId: QuizQuestionId) => void) | undefined;
}) {
  const { slug, stale, kept } = ctx;
  const { attempt, mark, clearAttempt, showKept } = useQuizMark(slug, ctx);
  const [openId, setOpenId] = useState<QuizQuestionId | null>(null);
  const [typed, setTyped] = useState("");
  const box = useRef<HTMLTextAreaElement | null>(null);
  const boxId = useId();

  const open = openId ? questions.find((q) => q.id === openId) : undefined;
  const mine = open && attempt?.questionId === open.id ? attempt : null;
  const marking = mine?.status === "marking";
  const tooLong = typed.length > MAX_QUIZ_ANSWER_CHARS;
  const superseded = mine !== null && typed.trim() !== mine.answer;

  const submit = () => {
    /* The band's refusals (QuizPanel § `submit`): not while the microphone is
       involved, and not on an empty, long or in-flight answer, or a stale
       quiz. */
    if (dictate.busy || !open) return;
    const answer = typed.trim();
    if (answer === "" || tooLong || marking || stale) return;
    void mark(open.id, answer);
  };

  const transcribe = useReaderTranscriber();
  const dictate = useDictationField({
    value: typed,
    onChange: setTyped,
    box,
    context: { kind: "article", slug },
    transcribe,
    report: dictationReporter("quiz"),
    /* The band's key for the same question: it is the same answer. It is also
       the binding a transcript is delivered by (useDictation.ts § `elsewhere`),
       which is why `talk` below renders the box before it starts. */
    keep: keepDictation(`quiz:${slug}:${openId ?? ""}`),
    onDone: () => submit(),
    doneKey: openId ?? undefined,
  });
  const cannotAnswer = !typed.trim() || tooLong || marking || stale || dictate.busy;

  useFitTextarea(box, typed, open !== undefined);

  /**
   * Open one question's box, closing another's, **with its kept answer already
   * in it** — put back here, in the press, rather than by an effect after it,
   * so a microphone press on an answered question adds to the answer rather
   * than racing it (Sol F3).
   */
  const show = (id: QuizQuestionId | null) => {
    if (id === openId) return;
    clearAttempt();
    const earlier = id ? kept.get(id) : undefined;
    setTyped(earlier?.answer ?? "");
    setOpenId(id);
    if (id && earlier) showKept(id);
    focusBox.current = id !== null;
  };

  /* **The box takes the focus when it opens**, so a reader who opened it with
     Enter can type at once (the browser check found the focus left on the
     question). A ref rather than an effect on `openId` alone, so a box that
     opened for another reason (a remount) does not steal the focus. */
  const focusBox = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openId` is the trigger, not an input — the box it opened is read from `box.current` after the render. Without it the effect never runs again.
  useEffect(() => {
    if (!focusBox.current || !box.current) return;
    focusBox.current = false;
    const el = box.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [openId]);

  /** Escape closes the box and hands the focus back to its question. */
  const closeFromKeyboard = (id: QuizQuestionId) => {
    if (dictate.busy || marking) return;
    show(null);
    queueMicrotask(() => document.getElementById(`${boxId}-q-${id}`)?.focus());
  };

  /* **An answer that arrives after the box opened** — the read landed late —
     goes in only if the box is still empty and has no mark of its own: the
     band's restoring rule. */
  const keptHere = open ? kept.get(open.id) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the open question's kept answer changes; the guards read the rest
  useEffect(() => {
    if (!open || !keptHere || attempt !== null || typed !== "") return;
    setTyped(keptHere.answer);
    showKept(open.id);
  }, [keptHere]);

  /**
   * **One press to talk** — Greg's *"make the voice button very easy to
   * access"*. Two things have to be true when `toggle` runs, and both are why
   * this renders synchronously first (`flushSync`):
   *
   * - **The press is still the press.** Safari grants the microphone only
   *   inside the gesture, and `toggle` asks for it synchronously.
   * - **The dictation is bound to this question's box.** A dictation keeps
   *   the box it was started for and delivers its words only there
   *   (useDictation.ts § `elsewhere`). Started before the render, it would be
   *   bound to the empty key of no question open, and its transcript refused
   *   the moment this question's box appeared. GPT Sol's plan review thought
   *   `flushSync` unnecessary; this is the reason it is not.
   *
   * If the browser still refuses, dictation shows its own failure and the
   * box's microphone works as usual.
   */
  const talk = (id: QuizQuestionId) => {
    if (dictate.busy) return;
    if (id !== openId) flushSync(() => show(id));
    dictate.toggle();
  };

  return (
    <>
      {questions.map((q) => {
        const answered = kept.has(q.id);
        const isOpen = q.id === openId;
        return (
          <div
            key={q.id}
            className={`marg-quiz-item${answered ? " quiz-answered" : ""}${isOpen ? " marg-quiz-open" : ""}`}
          >
            <div className="marg-quiz-row">
              <button
                type="button"
                id={`${boxId}-q-${q.id}`}
                className="marg-quiz-q"
                data-marg-tip="quiz"
                data-marg-voice="ai"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `${boxId}-${q.id}` : undefined}
                onClick={() => show(isOpen ? null : q.id)}
              >
                {answered ? (
                  <Check size={12} aria-hidden="true" className="marg-quiz-icon marg-quiz-tick" />
                ) : (
                  <MessageCircleQuestionMark size={12} aria-hidden="true" className="marg-quiz-icon" />
                )}
                <span className={withVoice("marg-quiz-text", "ai")}>{q.question}</span>
                {answered && <span className="sr-only"> (answered)</span>}
              </button>
              {dictate.dictation.supported && !isOpen && !stale && (
                <Tooltip
                  placement="top"
                  content={
                    <ControlTip
                      head="Answer out loud"
                      what="Opens the answer box under this question and starts listening."
                      how="Talk, then press Stop. Press Stop twice to have the answer marked as soon as the words are in."
                    />
                  }
                >
                  <button
                    type="button"
                    className="marg-quiz-talk"
                    aria-label="Answer out loud"
                    disabled={dictate.busy}
                    onClick={() => talk(q.id)}
                  >
                    <Mic size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </div>
            {isOpen && (
              <div className="marg-quiz-answer" id={`${boxId}-${q.id}`}>
                <textarea
                  ref={box}
                  className="marg-quiz-box"
                  value={typed}
                  rows={2}
                  placeholder="A line is enough"
                  aria-label="Your answer"
                  readOnly={dictate.readOnly}
                  disabled={marking || stale}
                  onChange={(e) => setTyped(e.target.value)}
                  /* Stopped from bubbling for the band's reason: the article's
                     ↑/↓ listen on the window (keynav.ts). */
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeFromKeyboard(q.id);
                      return;
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="marg-quiz-actions">
                  {/* **The microphone first**, before Answer: the box a reader
                      is most likely to talk into (Greg's "very easy to
                      access"). */}
                  {dictate.dictation.supported && (
                    <span className="quiz-mic">
                      <DictationButton
                        dictation={dictate.dictation}
                        toggle={dictate.toggle}
                        disabled={marking || stale}
                        sendingAfter={dictate.sendingAfter}
                        doubleStop={dictate.doubleStop}
                      />
                      <TalkLabel field={dictate} className="quiz-mic-label" />
                    </span>
                  )}
                  <Tooltip
                    placement="top"
                    content={
                      <ControlTip
                        head="Answer"
                        what="Have your answer marked against the article."
                        how="Cmd+Enter or Ctrl+Enter in the box does the same."
                      />
                    }
                  >
                    <button
                      type="button"
                      className="chat-send quiz-go"
                      aria-label={marking ? "Marking…" : "Answer"}
                      aria-busy={marking || undefined}
                      aria-disabled={cannotAnswer || undefined}
                      onClick={cannotAnswer ? undefined : submit}
                    >
                      {marking ? <LoaderCircle className="cmt-spinner" size={16} /> : <SendHorizontal size={16} />}
                    </button>
                  </Tooltip>
                  {onOpen && (
                    <button type="button" className="marg-quiz-more" onClick={() => onOpen(batchId, q.id)}>
                      Open in Quiz
                    </button>
                  )}
                </div>
                {tooLong && <p className="gloss-error">That is longer than {MAX_QUIZ_ANSWER_CHARS} characters.</p>}
                <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />
                {mine && (
                  <QuizMarkText
                    attempt={mine}
                    superseded={superseded}
                    emptied={typed.trim() === ""}
                    blocks={ctx.blocks}
                    onJump={ctx.onJump}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
