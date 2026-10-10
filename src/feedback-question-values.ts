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
/**
 * The short version, the options and the recommendation, then the details, as
 * plain text. 4,000 until 2026-10-08, when the details moved under their own
 * line (`QUESTION_DETAILS_LINE`) and needed the room (plan 261008i).
 */
export const MAX_FEEDBACK_QUESTION_BODY_CHARS = 6_000;

/**
 * **The line a question's body splits on**: above it, what Greg reads first
 * (the question, the options, the recommendation); below it, the background he
 * opens only if he needs it. Greg, 2026-10-08 (`spya-za2tse`): *"maybe
 * there's a TLDR at the top, and with the choices, and then kind of a longer
 * appendix with details underneath that I can read if I need to."* A line that
 * is exactly this word, at most once (the compiler refuses a second).
 */
export const QUESTION_DETAILS_LINE = "Details";

/** A body as the dialog draws it: the part shown, and the part behind *Details*, or null when there is none. */
export function splitQuestionBody(body: string): { summary: string; details: string | null } {
  const lines = body.split("\n");
  const at = lines.indexOf(QUESTION_DETAILS_LINE);
  if (at === -1) return { summary: body, details: null };
  const summary = lines.slice(0, at).join("\n").trim();
  const details = lines.slice(at + 1).join("\n").trim();
  /* A body that is all details, or a heading with nothing under it, is drawn whole. */
  if (summary === "" || details === "") return { summary: body, details: null };
  return { summary, details };
}

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

/**
 * **Which group a thread is in**, in the admin's *Needs a decision* (plan
 * 261008i, decision 1): waiting on Greg, Greg has replied and no agent has
 * acted on it yet, or Greg said not now.
 */
export const FEEDBACK_QUESTION_STATES = ["waiting", "responded", "deferred"] as const;
export type FeedbackQuestionState = (typeof FEEDBACK_QUESTION_STATES)[number];

/**
 * **The state rule, whole** (GPT Sol's plan review, F2). Every time is the
 * database's `now()`, so they compare. Deferred when the deferral is at or
 * after the newest reply of any kind, acted on or not (a tie is deferred);
 * otherwise responded when a reply is not yet acted on; otherwise waiting. So
 * defer, reply, acted on and left open, is waiting: the agent's follow-up is in
 * the body, and the old deferral does not come back.
 */
export function questionState(input: {
  /** ISO, every reply of this admin's to it. */
  replies: readonly { createdAt: string; acted: boolean }[];
  /** ISO, or null when not deferred. */
  deferredAt: string | null;
}): FeedbackQuestionState {
  const newest = Math.max(-Infinity, ...input.replies.map((reply) => Date.parse(reply.createdAt)));
  if (input.deferredAt !== null && Date.parse(input.deferredAt) >= newest) return "deferred";
  return input.replies.some((reply) => !reply.acted) ? "responded" : "waiting";
}

/** A fresh question id. Uniqueness is the directory's: one file per id. */
export function mintFeedbackQuestionId(random?: () => number): string {
  return QUESTION_ID_PREFIX + mintId(random).slice(ID_PREFIX.length);
}

/**
 * **One open question as the server holds it**, compiled from its file. `refs`
 * is for agents and is not here: nothing compiled reaches a browser that the
 * file's author did not write for Greg to read. `acted` is compiled beside it,
 * for the server alone (`FEEDBACK_QUESTION_ACTED`), which sends the browser
 * only the state it works out from it and which list each reply goes in
 * (plan 261008i, decision 1; 261010h).
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
