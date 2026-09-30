/**
 * **The quiz's questions, in the prose** — after the passage each is about, in
 * every mode, so a reader meets "what did you take from that?" where they have
 * just read it rather than only in the band.
 *
 * > if you've generated quiz questions, it should always show them in situ in
 * > the text, whether you're in quiz mode or not.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6V)
 *
 * **The question's words only, never its premise.** A premise restates an
 * earlier question's answer (docs/project/quiz.md § It adapts), and this line
 * is on screen before the reader has reached that step — the same rule the
 * band's all-questions list keeps.
 *
 * **Pressing it opens Quiz at that question**, where the answer box, the mark
 * and the reference answer already are; answering here in the prose is
 * deferred, with the reason, in
 * docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md.
 * The whole line is the button, so a finger on a phone has a real target and no
 * hover is needed.
 *
 * Drawn by `TableView` as a sibling after `.prose` (`Props.quizAfter`), never
 * inside the block, so no comment anchor moves; and apparatus, so copying the
 * prose copies none of it.
 */
import { MessageCircleQuestionMark } from "lucide-react";
import type { QuizQuestion, QuizQuestionId } from "../types.js";

export function QuizInProse({
  batchId,
  questions,
  onOpen,
}: {
  batchId: string;
  /** This block's questions, in path order — quiz-anchors.ts. */
  questions: readonly QuizQuestion[];
  onOpen(batchId: string, questionId: QuizQuestionId): void;
}) {
  return (
    <div className="quiz-in-prose">
      {questions.map((q) => (
        <button
          key={q.id}
          type="button"
          className="quiz-in-prose-q"
          onClick={() => onOpen(batchId, q.id)}
        >
          <MessageCircleQuestionMark size={14} aria-hidden="true" className="quiz-in-prose-icon" />
          <span>{q.question}</span>
        </button>
      ))}
    </div>
  );
}
