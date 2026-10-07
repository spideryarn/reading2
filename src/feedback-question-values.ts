/**
 * **What a question for Greg may look like**: the rules its file, the server
 * and the dialog all hold it to. An import-light leaf (only src/ids.ts), for
 * the reason src/feedback-ending-values.ts is one: the compiler
 * (scripts/feedback-endings.ts) must run when its generated output is missing,
 * and the dialog may import this but never the generated list.
 *
 * A question is a file under docs/user-feedback/questions/, named for its id,
 * written by an agent and shown to an admin in the Feedback dialog's Earlier tab once the
 * commit carrying it is deployed. docs/project/feedback-reports.md § Asking
 * Greg a question, and acting on his answer.
 * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 */
import { ID_PREFIX, isSpideryarnId, mintId } from "./ids.js";

/** `open` is shown in the dialog; `answered` has been acted on and is not. */
export const FEEDBACK_QUESTION_STATUSES = ["open", "answered"] as const;
export type FeedbackQuestionStatus = (typeof FEEDBACK_QUESTION_STATUSES)[number];

/** One line above the question, in the dialog. */
export const MAX_FEEDBACK_QUESTION_TITLE_CHARS = 120;
/** The background, the options and the recommendation, as plain text. */
export const MAX_FEEDBACK_QUESTION_BODY_CHARS = 4_000;

const QUESTION_ID_PREFIX = "q-";

/**
 * `q-k3m9qt`: the prefix, then the same six characters a feedback id ends in
 * (src/ids.ts), so the one id rule decides both.
 */
export function isFeedbackQuestionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(QUESTION_ID_PREFIX) &&
    isSpideryarnId(ID_PREFIX + value.slice(QUESTION_ID_PREFIX.length))
  );
}

/** A fresh question id. Uniqueness is the directory's: one file per id. */
export function mintFeedbackQuestionId(random?: () => number): string {
  return QUESTION_ID_PREFIX + mintId(random).slice(ID_PREFIX.length);
}

/**
 * **One open question as the server holds it**, compiled from its file. `refs`
 * and `acted` are for agents and are not here: nothing compiled reaches a
 * browser that the file's author did not write for Greg to read.
 */
export interface CompiledFeedbackQuestion {
  id: string;
  title: string;
  /** The `spya-` id of the report it is about, or null. Looked up owner-scoped before anything is sent. */
  report: string | null;
  /** `yyyy-mm-dd`. */
  asked: string;
  body: string;
}
