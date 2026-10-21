/**
 * **The questions an agent has put to Greg, as the database holds them now** —
 * one request's view of `feedback_questions`, which
 * `scripts/feedback-questions.ts --publish` writes from the files under
 * `docs/user-feedback/questions/`. Server only: nothing under src/web/ imports
 * this. Until 2026-10-21 the questions were compiled into the build, so one
 * reached the dialog only with a deploy; now it is there once published.
 * docs/plans/261021h-agent-questions-reach-needs-a-decision-without-a-deploy.md;
 * the shape before it, docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 */
import {
  askedReports,
  byAsked,
  type CompiledFeedbackQuestion,
  type FeedbackQuestionStatus,
  type PublishedFeedbackQuestion,
  publishedQuestionProblem,
} from "./feedback-question-values.js";
import { feedbackStore } from "./store/index.js";

/**
 * **Every published question, read once**, so one response cannot mix two
 * versions of them (Sol's plan review, F3). Each accessor is synchronous over
 * the one read.
 */
export interface FeedbackQuestions {
  /** Every open question, oldest first: what an admin's Earlier tab lists. */
  open: readonly CompiledFeedbackQuestion[];
  /**
   * `open`, `answered`, or null for an id nobody has published. **A reply is
   * accepted for either status** (plan 261007d, F14): Greg may answer from a
   * tab loaded before the question was marked answered, and his words must
   * not be lost for it.
   */
  status(id: string): FeedbackQuestionStatus | null;
  /**
   * The ids of a question's replies an agent has acted on: which list a reply
   * is sent in (261010h), and part of its state (plan 261008i). The ids
   * themselves are never sent.
   */
  acted(id: string): readonly string[];
  /**
   * **Does an open question ask about this report?**, `repeats:` included
   * (plan 261016a) — so the admin's *Needs a decision* view does not draw it
   * as waiting with no question.
   */
  isReportAsked(reportId: string): boolean;
}

/** A row that breaks the file's rules: the server refuses to draw any of them rather than some (F7). */
export class MalformedQuestionError extends Error {}

/** The view, from rows already read. Pure, for a test. */
export function feedbackQuestionsFrom(rows: readonly PublishedFeedbackQuestion[]): FeedbackQuestions {
  for (const row of rows) {
    const problem = publishedQuestionProblem(row);
    /* The id only when it is one, so nothing else of the row reaches a log. */
    if (problem !== null) throw new MalformedQuestionError(`a published question is malformed: ${problem}`);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const open = rows
    .filter((row) => row.status === "open")
    .map(({ id, title, report, repeats, asked, body }) => ({ id, title, report, repeats, asked, body }))
    .sort(byAsked);
  const asked = askedReports(open);
  return {
    open,
    status: (id) => byId.get(id)?.status ?? null,
    acted: (id) => byId.get(id)?.acted ?? [],
    isReportAsked: (reportId) => asked.has(reportId),
  };
}

/** One read of the table. A malformed row throws, which the route answers as a 500. */
export async function readFeedbackQuestions(): Promise<FeedbackQuestions> {
  return feedbackQuestionsFrom(await feedbackStore.publishedQuestions());
}
