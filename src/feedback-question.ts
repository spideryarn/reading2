/**
 * **The questions an agent has put to Greg, as this build knows them** — the
 * server's reading of src/feedback-questions.generated.ts, which
 * scripts/feedback-endings.ts compiles from `docs/user-feedback/questions/`.
 * Server only, like src/feedback-ending.ts: tests/feedback-endings.test.ts
 * asserts nothing under src/web/ imports this or the generated file. On
 * production a question exists once the commit carrying its file is deployed.
 * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 */
import type { CompiledFeedbackQuestion, FeedbackQuestionStatus } from "./feedback-question-values.js";
import {
  FEEDBACK_OPEN_QUESTIONS,
  FEEDBACK_QUESTION_ACTED,
  FEEDBACK_QUESTION_STATUS,
} from "./feedback-questions.generated.js";

/**
 * The ids of an open question's replies an agent has acted on: which replies
 * the thread still lists, and part of its state (plan 261008i). Never sent.
 */
export function feedbackQuestionActed(id: string): readonly string[] {
  return Object.hasOwn(FEEDBACK_QUESTION_ACTED, id) ? (FEEDBACK_QUESTION_ACTED[id] ?? []) : [];
}

/** Every open question, oldest first: what an admin's Earlier tab lists. */
export function openFeedbackQuestions(): readonly CompiledFeedbackQuestion[] {
  return FEEDBACK_OPEN_QUESTIONS;
}

/**
 * `open`, `answered`, or null for an id this build has no file for. **A reply
 * is accepted for either status** (plan 261007d, F14): Greg may answer from a
 * tab loaded before the deploy that marked the question answered, and his
 * words must not be lost for it.
 */
export function feedbackQuestionStatus(id: string): FeedbackQuestionStatus | null {
  return Object.hasOwn(FEEDBACK_QUESTION_STATUS, id) ? (FEEDBACK_QUESTION_STATUS[id] ?? null) : null;
}
