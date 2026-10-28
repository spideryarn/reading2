/**
 * **The Feedback dialog's Earlier tab** — the signed-in reader's own previous
 * reports, as a list. The read and the panel; FeedbackDialog.tsx owns the tabs
 * and the guards that keep the hidden Write panel switched off.
 *
 * > In the feedback dialog box, it would be nice to have a tab showing previous
 * > feedback that this user has provided, just as a kind of list. I mean, it
 * > would be amazing if we could indicate which ones have been acted on, but I
 * > suspect that will involve access to the database that you currently don't
 * > have. So do the simplest thing first.
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-3R)
 *
 * So: the date, what they called it, and what they wrote.
 * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * > It would be nice if we could provide a way to filter to things that have or
 * > have not been achieved and deployed.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-63)
 *
 * And now whether a change for each one has **shipped** — derived on the server
 * from the report's note, so on production it means "is in the version you are
 * using" — and a filter by it: All · Shipped · Not shipped.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 *
 * > In Feedback / Earlier / All, add the indicator for whether each suggestion
 * > has shipped or not.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-7D)
 *
 * So in All a row that has not shipped says Not shipped, quietly.
 * docs/plans/261001c-earlier-tab-marks-not-shipped-too.md.
 *
 * > let's give you another category for deferred or ignored, or maybe even
 * > both. […] write some kind of comment that would indicate why you deferred
 * > them, or what the question was […] And maybe you could give every single
 * > feedback report its own ID somehow
 * >
 * > — Greg, 2026-10-06 (`spya-cnbv8f`)
 *
 * So **an admin's tab** says one of four things about each report (Open ·
 * Waiting · Set aside · Shipped), numbers it (`#212`), and carries
 * the one line its note says about it. It reads a route of its own under
 * `/api/admin/`; every other reader's tab, and the route it reads, are as they
 * were. `admin` here is the cosmetic flag (src/admin.ts): it picks which route
 * to ask, and the server decides who is answered.
 * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 *
 * > you'd show my report and then their question from you, and then some kind
 * > of input box with a voice dictation button […] it should be possible for
 * > you to ask my input on things that aren't tied specifically to a feedback
 * > report.
 * >
 * > — Greg, 2026-10-06 (`spya-sshjd2`)
 *
 * So the admin's answer also carries **every open question an agent has
 * asked** (a file under docs/user-feedback/questions/, compiled into the
 * server). They are drawn at the top of *Needs a decision*, whose number in
 * every view is the threads waiting (plan 261011ad), and each has a reply box with a microphone
 * (`EarlierThreads`). A reply is a row of its own, never a report.
 *
 * ## Once per opening, per filter
 *
 * Each filter is read the first time it is chosen and kept while the reader
 * flips back and forth. Nothing can be filed and then looked for within one
 * opening — a successful send shuts the dialog and thanks the reader in a
 * toast — so reading again would buy no freshness. Shutting the dialog forgets
 * every filter's answer and returns to the opening default: Needs a decision
 * for an admin, All for everybody else. An answer is stored under the filter
 * that asked for it, and only if it is that filter's latest request in this
 * opening: a generation counter drops anything that lands after the dialog
 * shut, and a per-filter sequence drops a Try again's older twin. The admin's
 * opening read moves the default to All when no question is waiting, unless
 * the reader has already chosen a filter.
 */
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MAX_FEEDBACK_COMMENT_CHARS } from "../feedback-ending-values.js";
import {
  FEEDBACK_QUESTION_STATES,
  type FeedbackQuestionState,
  isFeedbackQuestionId,
  MAX_FEEDBACK_QUESTION_BODY_CHARS,
  MAX_FEEDBACK_QUESTION_TITLE_CHARS,
  splitQuestionBody,
} from "../feedback-question-values.js";
import { isSpideryarnId, mintId } from "../ids.js";
import {
  FEEDBACK_DEFER_FAILED,
  FEEDBACK_DEFER_SETTLED,
  FEEDBACK_EARLIER_FAILED,
  FEEDBACK_REPLY_FAILED,
  FEEDBACK_REPLY_STALE,
} from "../messages.js";
import {
  ADDENDUM_STATUSES,
  MAX_FEEDBACK_ANSWER_CHARS,
  type AdminFeedbackAddendum,
  type AdminFeedbackQuestion,
  type AdminFeedbackQuestionAnswer,
  ADMIN_EARLIER_FEEDBACK_SHOWS,
  EARLIER_FEEDBACK_LIMIT,
  EARLIER_FEEDBACK_SHOWS,
  EARLIER_FEEDBACK_STATUSES,
  FEEDBACK_KINDS,
  type AdminEarlierFeedback,
  type AdminEarlierFeedbackPage,
  type AdminEarlierFeedbackShow,
  FEEDBACK_QUESTION_REPORT_WHOSE,
  type FeedbackQuestionReportWhose,
  type EarlierFeedback as EarlierReport,
  type EarlierFeedbackPage,
  type EarlierFeedbackShow,
  type EarlierFeedbackStatus,
  type FeedbackKind,
} from "../types.js";
import { AddendumBox, addendaShown, isAddendum, type ReportAddenda, useReportAddenda } from "./FeedbackAddendum.js";
import { FeedbackSendBox } from "./FeedbackSendBox.js";
import { apiFetch } from "./lib/api.js";
import { Link } from "./Link.js";
import { exactly, relativeAgo } from "./relative-time.js";
import { parseRoute, readHref } from "./router.js";

/**
 * **Which list an answer is**: every reader's (`plain`, `GET /api/feedback`),
 * or an admin's own with what became of each report (`admin`,
 * `GET /api/admin/feedback/earlier`). The two have different filters, counts
 * and rows, so everything that depends on which is a union on this word.
 */
export type EarlierLoaded =
  | { detail: "plain"; page: EarlierFeedbackPage }
  | { detail: "admin"; page: AdminThreadsPage; startedAt: number };

export type EarlierState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | ({ kind: "loaded" } & EarlierLoaded);

/** One filter of one list: what a read asks for. */
type EarlierAsk =
  | { detail: "plain"; show: EarlierFeedbackShow }
  | { detail: "admin"; show: AdminEarlierFeedbackShow };

/** The filter showing, with its list's counts once an answer has landed. */
export type EarlierChoice =
  | { detail: "plain"; show: EarlierFeedbackShow; counts: EarlierFeedbackPage["counts"] | null }
  | { detail: "admin"; show: AdminEarlierFeedbackShow; counts: AdminEarlierFeedbackPage["counts"] | null };

/** Any filter of either list. Which are valid depends on the list (`choiceOf`). */
type AnyShow = EarlierFeedbackShow | AdminEarlierFeedbackShow;

/** A filter with no entry has not been asked for yet: idle. */
type EarlierStates = Partial<Record<AnyShow, EarlierState>>;

const NOTHING: EarlierStates = {};
const IDLE: EarlierState = { kind: "idle" };

const ADMIN_PATH = "/api/admin/feedback/earlier";
const PLAIN_PATH = "/api/feedback";
const ANSWERS_PATH = "/api/admin/feedback/answers";
const DEFERRALS_PATH = "/api/admin/feedback/deferrals";

/**
 * **A path on this site, and nothing a browser could read as leaving it** —
 * the page label is an `href` since spya-tqk7au. One leading slash, then no
 * second slash or backslash (`//host` and `/\host` are both another origin to
 * a browser), and no backslash, whitespace or control character anywhere.
 * Query and fragment delimiters are refused too: `at` is added separately.
 * The server only ever sends such a path (src/feedback-page.ts); this is the
 * second line, so a wrong value fails the answer instead of becoming a link.
 */
function isSitePath(value: unknown): value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  return typeof value === "string" && /^\/(?![/\\])[^\\?#\s\u0000-\u001f\u007f]*$/.test(value);
}

/** The six fields both lists' rows share, each checked: what `RowMeta` and the body draw. */
function isReportBase(report: Record<string, unknown>): boolean {
  return (
    typeof report.id === "string" &&
    typeof report.createdAt === "string" &&
    !Number.isNaN(Date.parse(report.createdAt)) &&
    (report.kind === null || FEEDBACK_KINDS.some((kind) => kind === report.kind)) &&
    typeof report.body === "string" &&
    (report.page === null || isSitePath(report.page)) &&
    /* A block id or nothing, and never without a page to be at: it goes
       into the same `href` (261006b). */
    (report.at === null ||
      (typeof report.at === "string" && isSpideryarnId(report.at) && report.page !== null))
  );
}

/**
 * The envelope both lists share: a list, `more`, and counts that are whole
 * numbers, of which the showing filter's agrees with the list it came with.
 * Answers the rows and the counts, still unchecked beyond that, or null.
 */
function readEnvelope(
  value: unknown,
  which: string,
  countKeys: readonly string[],
): { reports: Record<string, unknown>[]; counts: Record<string, number> } | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.reports) || typeof page.more !== "boolean") return null;
  if (typeof page.counts !== "object" || page.counts === null) return null;
  const counts = page.counts as Record<string, unknown>;
  if (!countKeys.every((key) => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0)) return null;
  const here = counts[which] as number;
  /* `more` with a short page is real: the server cuts a list of long reports to
     what fits one response (src/types.ts § `FEEDBACK_LIST_BYTES`). Never empty,
     and never over the cap. */
  if (page.reports.length > EARLIER_FEEDBACK_LIMIT || (page.more && page.reports.length === 0)) return null;
  if (page.reports.length > here || page.more !== (here > page.reports.length)) return null;
  if (!page.reports.every((report: unknown) => typeof report === "object" && report !== null)) return null;
  return { reports: page.reports as Record<string, unknown>[], counts: counts as Record<string, number> };
}

/**
 * A 200 is only success when it carries the wire shape the panel can render —
 * and counts that agree with themselves and with the list they came with, so
 * neither a pill nor "of N" can say something the list contradicts.
 */
function isEarlierFeedbackPage(value: unknown, which: EarlierFeedbackShow): value is EarlierFeedbackPage {
  const envelope = readEnvelope(value, which, EARLIER_FEEDBACK_SHOWS);
  if (envelope === null) return false;
  const { all, shipped, unshipped } = envelope.counts;
  if ((all as number) !== (shipped as number) + (unshipped as number)) return false;
  if (!envelope.reports.every((report) => isReportBase(report) && typeof report.shipped === "boolean")) return false;
  const reports = envelope.reports as unknown as EarlierFeedbackPage["reports"];
  /* A store row is unique by (owner, id), and each row's shipped flag comes
     from the same map as the counts. Reject a response that could make a
     filtered page show the wrong kind of row, or make React reconcile two
     rows through the same key. */
  if (new Set(reports.map((report) => report.id)).size !== reports.length) return false;
  const listedShipped = reports.filter((report) => report.shipped).length;
  if (listedShipped > (shipped as number) || reports.length - listedShipped > (unshipped as number)) {
    return false;
  }
  if (which !== "all" && reports.some((report) => report.shipped !== (which === "shipped"))) return false;
  return true;
}

/**
 * The admin list's twin of the check above, as strict: a status of the four, a
 * number no two rows share, a comment that is a short string or nothing, four
 * counts that sum to All, and no row of another status under a filter. An
 * answer that fails is the failure sentence, never a list drawn from part of it.
 */
function isAdminEarlierFeedbackPage(
  value: unknown,
  which: AdminEarlierFeedbackShow,
): value is AdminWirePage {
  const envelope = readEnvelope(value, which, ADMIN_EARLIER_FEEDBACK_SHOWS);
  if (envelope === null) return false;
  const { counts } = envelope;
  if (counts.all !== EARLIER_FEEDBACK_STATUSES.reduce((sum, status) => sum + (counts[status] as number), 0)) {
    return false;
  }
  if (!envelope.reports.every((report) =>
    isReportBase(report) &&
    Number.isSafeInteger(report.number) && (report.number as number) > 0 &&
    EARLIER_FEEDBACK_STATUSES.some((status) => status === report.status) &&
    (report.comment === null ||
      (typeof report.comment === "string" && report.comment !== "" &&
        report.comment.length <= MAX_FEEDBACK_COMMENT_CHARS)) &&
    (report.ignoredAt === null ||
      (typeof report.ignoredAt === "string" && !Number.isNaN(Date.parse(report.ignoredAt)))) &&
    /* No key at all is a server from before 261010o: none, and no box
       (`withAddendaKnown`). A key is a list of exactly-shaped addenda, ids no
       two share, or the whole answer fails. */
    (!Object.hasOwn(report, "addenda") || areAddenda(report.addenda)) &&
    /* No key is a server from before 261016a: not asked. A key is a boolean,
       or the whole answer fails: "false" would be truthy and hide a row. */
    (!Object.hasOwn(report, "asked") || typeof report.asked === "boolean")
  )) return false;
  const reports = envelope.reports as unknown as AdminWireReport[];
  if (new Set(reports.map((report) => report.id)).size !== reports.length) return false;
  if (new Set(reports.map((report) => report.number)).size !== reports.length) return false;
  for (const status of EARLIER_FEEDBACK_STATUSES) {
    if (reports.filter((report) => report.status === status).length > (counts[status] as number)) return false;
  }
  if (which !== "all" && reports.some((report) => report.status !== which)) return false;
  return areQuestions((value as { questions?: unknown }).questions);
}

/** A reply as the server sends it back: an id, words, and a time that parses — an addendum's three. */
const isQuestionAnswer: (value: unknown) => value is AdminFeedbackQuestionAnswer = isAddendum;

/** A report's addenda: each exactly shaped, no id twice. */
function areAddenda(value: unknown): value is AdminFeedbackAddendum[] {
  return (
    Array.isArray(value) &&
    value.every(isAddendum) &&
    new Set(value.map((one: AdminFeedbackAddendum) => one.id)).size === value.length
  );
}

/**
 * A report as the admin route may send it: `addenda` absent from a server
 * before 261010o, `asked` from one before 261016a.
 */
type AdminWireReport = Omit<AdminEarlierFeedback, "addenda" | "asked"> & {
  addenda?: AdminFeedbackAddendum[];
  asked?: boolean;
};
type AdminWirePage = Omit<AdminThreadsPage, "reports"> & { reports: AdminWireReport[] };

/**
 * **A report as this client draws it**: `addenda` null when the server said
 * nothing about them (a server from before 261010o, mid-deploy), which draws
 * none and **no box**, since that server has no route to send one to.
 */
export type AdminRowReport = Omit<AdminEarlierFeedback, "addenda"> & { addenda: AdminFeedbackAddendum[] | null };

/** The checked answer, with an absent `addenda` made the explicit null the rows read, and an absent `asked` false. */
function withAddendaKnown(page: AdminWirePage): AdminThreadsPage {
  return {
    ...page,
    reports: page.reports.map((report) => ({ ...report, addenda: report.addenda ?? null, asked: report.asked ?? false })),
  };
}

/** A reply POST's whole receipt: one stored answer and no server-only sibling fields. */
function isAnswerReceipt(value: unknown): value is { answer: AdminFeedbackQuestionAnswer } {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return Object.keys(receipt).join() === "answer" && isQuestionAnswer(receipt.answer);
}

const QUESTION_KEYS = [
  "actedAnswers",
  "answers",
  "asked",
  "body",
  "deferredAt",
  "id",
  "olderActedAnswers",
  "olderAnswers",
  "report",
  "state",
  "title",
];
/** A thread as a server before 261010h sends it: no acted replies. */
const V2_QUESTION_KEYS = QUESTION_KEYS.filter((key) => key !== "actedAnswers" && key !== "olderActedAnswers");
const LEGACY_QUESTION_KEYS = ["answer", "asked", "body", "id", "report", "title"];

/**
 * **A thread as this client draws it**: the server's question, except that
 * the report's text may be null, which only a server from before 261008i
 * sends (it had none to send) and which then draws no *Your report*.
 */
export type ThreadQuestion = Omit<AdminFeedbackQuestion, "report"> & {
  report: (Omit<NonNullable<AdminFeedbackQuestion["report"]>, "body"> & { body: string | null }) | null;
};

/** The admin answer as this client keeps it: threads, not the server's raw questions, and rows that say whether addenda are known. */
export type AdminThreadsPage = Omit<AdminEarlierFeedbackPage, "questions" | "reports"> & {
  questions: ThreadQuestion[];
  reports: AdminRowReport[];
};

/** A report as a server before 261020p sends it, with no `whose` or `from`. */
const V3_REPORT_KEYS = "body,firstLine,id,number";
/** A report as a server before 261008i sends it, with no text either. */
const V1_REPORT_KEYS = "firstLine,id,number";

/**
 * **A report from an older server is the admin's own**: until 261020p a
 * server sent only that, so it is marked `yours`, with no address. Only a
 * report with exactly the old keys is mapped; anything else is left to fail
 * the strict check.
 */
function asTheirOwn(report: unknown, keys: string): unknown {
  if (typeof report !== "object" || report === null) return report;
  if (Object.keys(report).sort().join() !== keys) return report;
  return { body: null, ...report, whose: "yours", from: null };
}

/**
 * **A server from before 261008i answers in the six-key shape** — a rollback,
 * or the minutes of a deploy (F3). Each such question becomes a thread before
 * the strict check: its newest reply as the only one, *being considered* if
 * there is one, never deferred, no report text. **A server from before
 * 261010h answers threads without the acted replies**, which become none.
 * **A server from before 261020p** sends only the admin's own report, without
 * `whose` (`asTheirOwn`); such a server answers this client's `questions=4`
 * in its own newest shape, whichever of the three that is.
 * Only a question with exactly the old keys of one of them is mapped; anything
 * else reaches the check as it came, and fails there.
 */
function withLegacyQuestions(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const answer = value as Record<string, unknown>;
  if (!Array.isArray(answer.questions)) return value;
  return {
    ...answer,
    questions: answer.questions.map((question: unknown) => {
      if (typeof question !== "object" || question === null) return question;
      const old = question as Record<string, unknown>;
      const keys = Object.keys(old).sort().join();
      if (keys === QUESTION_KEYS.join()) return { ...old, report: asTheirOwn(old.report, V3_REPORT_KEYS) };
      if (keys === V2_QUESTION_KEYS.join()) {
        return { ...old, report: asTheirOwn(old.report, V3_REPORT_KEYS), actedAnswers: [], olderActedAnswers: 0 };
      }
      if (keys !== LEGACY_QUESTION_KEYS.join()) return question;
      const { answer: newest, report, ...rest } = old;
      return {
        ...rest,
        report: asTheirOwn(report, V1_REPORT_KEYS),
        answers: newest === null ? [] : [newest],
        olderAnswers: 0,
        actedAnswers: [],
        olderActedAnswers: 0,
        state: newest === null ? "waiting" : "responded",
        deferredAt: null,
      };
    }),
  };
}

/**
 * **The questions half of the admin answer, as strict as the reports half.**
 * Exactly the fields of each, so anything meant for agents that a server one
 * day sent would fail here instead of being carried around; ids no two share;
 * text within the caps the compiler holds a file to; a state of the three, and
 * a deferral time exactly when it says deferred. A list that fails fails the
 * whole answer: the failure sentence, never some of the questions.
 */
function areQuestions(value: unknown): value is ThreadQuestion[] {
  if (!Array.isArray(value) || !value.every(isQuestion)) return false;
  return new Set(value.map((question) => question.id)).size === value.length;
}

/** Text that says something and fits its cap. */
const isTextWithin = (value: unknown, cap: number): value is string =>
  typeof value === "string" && value !== "" && value.length <= cap;

/**
 * The report a question is about, as its thread shows it: an id, a number, a
 * first line, its text, whose it is, and for somebody else's the address it
 * was filed under (261020p). An address exactly when it is not the admin's own.
 */
function isLinkedReport(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const linked = value as Record<string, unknown>;
  return (
    Object.keys(linked).sort().join() === "body,firstLine,from,id,number,whose" &&
    typeof linked.id === "string" && isSpideryarnId(linked.id) &&
    Number.isSafeInteger(linked.number) && (linked.number as number) > 0 &&
    typeof linked.firstLine === "string" &&
    (linked.body === null || typeof linked.body === "string") &&
    FEEDBACK_QUESTION_REPORT_WHOSE.some((whose) => whose === linked.whose) &&
    (linked.whose === "yours" ? linked.from === null : isTextWithin(linked.from, MAX_REPORTER_ADDRESS_CHARS))
  );
}

/** Longer than any address an inbox takes (RFC 5321 says 254); a sanity bound, not a rule. */
const MAX_REPORTER_ADDRESS_CHARS = 320;

function isQuestion(value: unknown): value is ThreadQuestion {
  if (typeof value !== "object" || value === null) return false;
  const question = value as Record<string, unknown>;
  const answers = question.answers;
  const acted = question.actedAnswers;
  return (
    Object.keys(question).sort().join() === QUESTION_KEYS.join() &&
    isFeedbackQuestionId(question.id) &&
    isTextWithin(question.title, MAX_FEEDBACK_QUESTION_TITLE_CHARS) &&
    isTextWithin(question.body, MAX_FEEDBACK_QUESTION_BODY_CHARS) &&
    typeof question.asked === "string" && dayOf(question.asked) !== null &&
    (question.report === null || isLinkedReport(question.report)) &&
    Array.isArray(answers) && answers.every(isQuestionAnswer) &&
    new Set(answers.map((one: AdminFeedbackQuestionAnswer) => one.id)).size === answers.length &&
    Number.isSafeInteger(question.olderAnswers) && (question.olderAnswers as number) >= 0 &&
    Array.isArray(acted) && acted.every(isQuestionAnswer) &&
    /* A reply is acted on or not, never both. */
    new Set([...answers, ...acted].map((one: AdminFeedbackQuestionAnswer) => one.id)).size === answers.length + acted.length &&
    Number.isSafeInteger(question.olderActedAnswers) && (question.olderActedAnswers as number) >= 0 &&
    FEEDBACK_QUESTION_STATES.some((state) => state === question.state) &&
    /* A time exactly when it says deferred, so the group and the line under it agree. */
    (question.state === "deferred"
      ? typeof question.deferredAt === "string" && !Number.isNaN(Date.parse(question.deferredAt))
      : question.deferredAt === null)
  );
}

/** `6 Oct 2026` for `2026-10-06`, or null when it is not a day. In UTC: a date has no zone to shift in. */
function dayOf(asked: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) return null;
  const date = new Date(`${asked}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A tab can outlive a deployment rollback: the new client then reads the old
 * server, whose otherwise-valid rows predate `page`, or `at` after it. Treat
 * an absent one of those as the same answer as `null`; a present malformed
 * value still reaches the validator above and fails closed. There is no
 * service-worker copy of this route — this is only wire compatibility across
 * two live builds.
 */
function withLegacyPage(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const answer = value as Record<string, unknown>;
  if (!Array.isArray(answer.reports)) return value;
  return {
    ...answer,
    reports: answer.reports.map((report: unknown) => {
      if (typeof report !== "object" || report === null) return report;
      return {
        ...report,
        ...(Object.hasOwn(report, "page") ? null : { page: null }),
        ...(Object.hasOwn(report, "at") ? null : { at: null }),
      };
    }),
  };
}

export interface EarlierFeedback {
  /** The state of the filter showing. */
  earlier: EarlierState;
  /**
   * Which list, which filter, and how many under each filter of that list:
   * from the showing filter's answer if it has one and otherwise any other
   * answer in this opening; `null` until one lands. Every answer carries all
   * of them, so the first read labels every pill.
   */
  choice: EarlierChoice;
  /** The reader chose a filter: a pill, or the shortcut beside the tabs. */
  setShow(show: AnyShow): void;
  retry(): void;
  /**
   * Every open question, for an admin, as threads: from any answer of this
   * opening (each carries them all), with this page's own replies and
   * deferrals laid over them until a later read has them (F4, F11), plus a
   * remembered question while it is open or holds a local draft; `null` for
   * every other reader and until one lands.
   */
  questions: ThreadQuestion[] | null;
  /** The newest server answer's questions, without a closed one retained only to protect a local draft. */
  liveQuestions: ThreadQuestion[] | null;
  /** How many of the server's threads wait on a decision, without a remembered no-longer-open question: the pill's and the shortcut's number. */
  waitingQuestionCount: number | null;
  /**
   * An admin's opening read of Needs a decision is still in the air, so the
   * shortcut is drawn with a spinner where its number goes (spya-yf6vmy).
   * False once it lands, and false when it failed: then there is no shortcut.
   */
  questionsLoading: boolean;
  replies: QuestionReplies;
  /** The admin's addenda to their own reports, in progress and just sent (FeedbackAddendum.tsx). */
  addenda: ReportAddenda;
}

/** Where the open thread's send, or its defer, has got to. */
export type ReplyStage = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

/** Something this page did to a thread or a report, and when on the hook's clock: kept until a read started after it lands. */
export interface Receipt<T> {
  value: T;
  at: number;
}

/**
 * **The admin's threads in progress**, held by the hook the dialog keeps
 * mounted, so a half-written reply survives a look at another tab, another
 * filter, another thread, and the dialog being shut. One thread open at a
 * time, and its reply box is simply there (plan 261008i, decision 5).
 */
export interface QuestionReplies {
  /** The thread showing on its own, or null for the contents. */
  openId: string | null;
  /** What is typed so far in each question's box. A box out of sight keeps its words. */
  drafts: Readonly<Record<string, string>>;
  stage: ReplyStage;
  /** Where Defer for now or Bring back has got to. */
  deferring: ReplyStage;
  /** Replies sent from this page, per question, and when: shown at once, ahead of the list's. */
  sent: Readonly<Record<string, Receipt<AdminFeedbackQuestionAnswer[]>>>;
  /** Deferrals set from this page, per question, and when: the time, or null for brought back. */
  deferrals: Readonly<Record<string, Receipt<string | null>>>;
  /** Whether anything unsent is held: words in a box, or a send in the air. */
  holds: boolean;
  open(id: string): void;
  close(): void;
  setDraft(id: string, text: string): void;
  send(id: string): Promise<void>;
  defer(id: string, deferred: boolean): Promise<void>;
}

/** A deferral as the server sends it back: the question asked about, and a time or null. */
function isDeferralReceipt(value: unknown, question: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    Object.keys(receipt).sort().join() === "deferredAt,question" &&
    receipt.question === question &&
    (receipt.deferredAt === null ||
      (typeof receipt.deferredAt === "string" && !Number.isNaN(Date.parse(receipt.deferredAt))))
  );
}

/**
 * The threads' state and the two POSTs. **A send's id belongs to its question
 * and its words**: a retry of the same words carries the same id, which the
 * server answers with the stored row (200), and edited words get a new id, so
 * the server never sees one id with two bodies (its 409).
 *
 * `tick` is the hook's clock, which every read and every receipt reads, so a
 * receipt is retired only by a read that started after it (F4). `chose` is
 * told when the reader opens a thread, which the opening read must not
 * overrule (F8).
 */
function useQuestionReplies(tick: () => number, chose: () => void): QuestionReplies {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [stage, setStage] = useState<ReplyStage>({ kind: "idle" });
  const [deferring, setDeferring] = useState<ReplyStage>({ kind: "idle" });
  const [sent, setSent] = useState<Readonly<Record<string, Receipt<AdminFeedbackQuestionAnswer[]>>>>({});
  const [deferrals, setDeferrals] = useState<Readonly<Record<string, Receipt<string | null>>>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /* Refs as well as the stages: two presses in one frame both see the old render. */
  const sending = useRef(false);
  const deferInFlight = useRef(false);
  const attempt = useRef<{ question: string; body: string; id: string } | null>(null);

  const open = useCallback(
    (id: string) => {
      if (sending.current || deferInFlight.current) return;
      chose();
      setOpenId(id);
      setStage({ kind: "idle" });
      setDeferring({ kind: "idle" });
    },
    [chose],
  );
  const close = useCallback(() => {
    if (sending.current || deferInFlight.current) return;
    setOpenId(null);
    setStage({ kind: "idle" });
    setDeferring({ kind: "idle" });
  }, []);
  const setDraft = useCallback((id: string, text: string) => {
    setDrafts((all) => ({ ...all, [id]: text }));
  }, []);

  const send = useCallback(
    async (question: string) => {
      const body = (draftsRef.current[question] ?? "").trim();
      if (sending.current || deferInFlight.current || body === "" || body.length > MAX_FEEDBACK_ANSWER_CHARS) return;
      const previous = attempt.current;
      const id =
        previous !== null && previous.question === question && previous.body === body ? previous.id : mintId();
      attempt.current = { question, body, id };
      sending.current = true;
      setStage({ kind: "sending" });
      let failed = FEEDBACK_REPLY_FAILED.message;
      try {
        const res = await apiFetch(ANSWERS_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, question, body }),
        });
        if (res.status === 404) {
          failed = FEEDBACK_REPLY_STALE.message;
        } else if (res.ok) {
          /* 201, or 200 for a retry the server had already stored. Only a
             well-formed stored reply counts: a 2xx with anything else in it is
             not evidence the words were kept. */
          const receipt: unknown = await res.json();
          const answer = isAnswerReceipt(receipt) ? receipt.answer : null;
          if (answer !== null && answer.id === id && answer.body === body) {
            attempt.current = null;
            sending.current = false;
            const at = tick();
            setSent((all) => ({
              ...all,
              [question]: { value: [...(all[question]?.value ?? []).filter((one) => one.id !== id), answer], at },
            }));
            setDrafts((all) => {
              const { [question]: _sent, ...rest } = all;
              return rest;
            });
            setStage({ kind: "idle" });
            return;
          }
        }
      } catch {
        /* The network, or a body that was not JSON: the same sentence. */
      }
      sending.current = false;
      setStage({ kind: "failed", message: failed });
    },
    [tick],
  );

  const defer = useCallback(
    async (question: string, deferred: boolean) => {
      if (deferInFlight.current || sending.current) return;
      deferInFlight.current = true;
      setDeferring({ kind: "sending" });
      let failed = FEEDBACK_DEFER_FAILED.message;
      try {
        const res = await apiFetch(DEFERRALS_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, deferred }),
        });
        if (res.status === 409) {
          failed = FEEDBACK_DEFER_SETTLED.message;
        } else if (res.ok) {
          const receipt: unknown = await res.json();
          /* The receipt is the state now stored. Another tab may have changed
             it between this request's write and the store's final read. */
          if (isDeferralReceipt(receipt, question)) {
            deferInFlight.current = false;
            const at = tick();
            const value = (receipt as { deferredAt: string | null }).deferredAt;
            setDeferrals((all) => ({ ...all, [question]: { value, at } }));
            setDeferring({ kind: "idle" });
            return;
          }
        }
      } catch {
        /* The same sentence. */
      }
      deferInFlight.current = false;
      setDeferring({ kind: "failed", message: failed });
    },
    [tick],
  );

  const holds = stage.kind === "sending" || Object.values(drafts).some((text) => text.trim() !== "");
  return { openId, drafts, stage, deferring, sent, deferrals, holds, open, close, setDraft, send, defer };
}

/**
 * **A thread with what this page did to it laid over the server's account**,
 * for as long as the server's account is older than what this page did: a
 * receipt counts only if it landed after the read behind `startedAt` began
 * (F4, F11). The later of a reply and a deferral wins, as on the server (F2).
 */
export function withLocal(
  question: ThreadQuestion,
  startedAt: number,
  replies: Pick<QuestionReplies, "sent" | "deferrals">,
): ThreadQuestion {
  const mine = replies.sent[question.id];
  const deferral = replies.deferrals[question.id];
  /* A receipt the server already lists as acted on says nothing new: an
     idempotent retry can hand back a reply an agent has since acted on, and
     laying it over would draw it twice and call the thread being considered
     (GPT Sol, 261010h P1). */
  const acted = (one: AdminFeedbackQuestionAnswer) => question.actedAnswers.some((known) => known.id === one.id);
  const sent = mine !== undefined && mine.at > startedAt && !mine.value.every(acted) ? mine : null;
  const set = deferral !== undefined && deferral.at > startedAt ? deferral : null;
  if (sent === null && set === null) return question;
  const answers =
    sent === null
      ? question.answers
      : [
          ...question.answers,
          ...sent.value.filter((one) => !acted(one) && !question.answers.some((known) => known.id === one.id)),
        ];
  if (set !== null && (sent === null || set.at > sent.at)) {
    return set.value !== null
      ? { ...question, answers, state: "deferred", deferredAt: set.value }
      : { ...question, answers, state: answers.length > 0 ? "responded" : "waiting", deferredAt: null };
  }
  return { ...question, answers, state: "responded", deferredAt: null };
}

/** The groups in the order the contents draws them; the pager uses raw server order instead. */
export const THREAD_GROUPS: readonly FeedbackQuestionState[] = ["waiting", "responded", "deferred"];

/** Every thread in contents order: waiting, then being considered, then deferred, each oldest first. */
export function threadOrder(questions: readonly ThreadQuestion[]): ThreadQuestion[] {
  return THREAD_GROUPS.flatMap((state) => questions.filter((question) => question.state === state));
}

/**
 * **Where Previous and Next may go**: the threads that need a decision, and the
 * one showing wherever it is, in the order the server sent them (oldest asked
 * first, each group's order in the contents). Greg, 2026-10-09 (spya-nmt06n): "I
 * only want them to cycle through the next and previous that need a decision,
 * rather than anything else." Replied, deferred and kept-for-a-draft threads are
 * not stops, but the one showing is, so Next still goes on from a thread just
 * answered or deferred, which has stopped waiting under the reader's hand.
 * Plan 261009m § 1–2.
 */
export function pagerStops(
  questions: readonly ThreadQuestion[],
  live: ReadonlySet<string>,
  showing: string,
): PagerStops {
  const deciding = (question: ThreadQuestion) => live.has(question.id) && question.state === "waiting";
  return {
    stops: questions.filter((question) => question.id === showing || deciding(question)),
    deciding: new Set(questions.filter(deciding).map((question) => question.id)),
  };
}

/** The pager's stops, and which of them need a decision (the one showing may not). */
export interface PagerStops {
  stops: ThreadQuestion[];
  deciding: ReadonlySet<string>;
}

/** The pager's hints, on the button and, pressed at an end, on the row for a phone. */
const PAGER_HINT = {
  previous: { go: "Previous thread that needs a decision", end: "No earlier thread needs a decision" },
  next: { go: "Next thread that needs a decision", end: "No later thread needs a decision" },
} as const;

/**
 * The questions of this opening's **newest** admin answer, whichever filter
 * asked, and when that read began. Every answer carries the same questions
 * whatever its filter, so the newest is the truest; the showing filter's would
 * let an older answer lay back a receipt a newer read had already retired.
 */
function questionsOf(
  choice: EarlierChoice,
  states: EarlierStates,
): { questions: ThreadQuestion[]; startedAt: number } | null {
  if (choice.detail !== "admin") return null;
  let newest: { questions: ThreadQuestion[]; startedAt: number } | null = null;
  for (const which of ADMIN_EARLIER_FEEDBACK_SHOWS) {
    const state = states[which];
    if (state?.kind === "loaded" && state.detail === "admin" && (newest === null || state.startedAt > newest.startedAt)) {
      newest = { questions: state.page.questions, startedAt: state.startedAt };
    }
  }
  return newest;
}

/** The list's own filter for a wanted one: itself when that list has it, otherwise All. */
function askOf(detail: EarlierLoaded["detail"], show: AnyShow): EarlierAsk {
  return detail === "admin"
    ? { detail, show: ADMIN_EARLIER_FEEDBACK_SHOWS.find((known) => known === show) ?? "all" }
    : { detail, show: EARLIER_FEEDBACK_SHOWS.find((known) => known === show) ?? "all" };
}

/** That filter with its list's counts: the showing filter's answer first, then any other of the same list. */
function choiceOf(ask: EarlierAsk, states: EarlierStates): EarlierChoice {
  if (ask.detail === "admin") {
    for (const which of [ask.show, ...ADMIN_EARLIER_FEEDBACK_SHOWS]) {
      const state = states[which];
      if (state?.kind === "loaded" && state.detail === "admin") return { ...ask, counts: state.page.counts };
    }
    return { ...ask, counts: null };
  }
  for (const which of [ask.show, ...EARLIER_FEEDBACK_SHOWS]) {
    const state = states[which];
    if (state?.kind === "loaded" && state.detail === "plain") return { ...ask, counts: state.page.counts };
  }
  return { ...ask, counts: null };
}

/** What one read hands back, before the hook stamps when it began. */
type ReadAnswer = { detail: "plain"; page: EarlierFeedbackPage } | { detail: "admin"; page: AdminThreadsPage };

/**
 * One read of one filter of one list: the answer checked, or why there is
 * none. `absent` is the admin route answering 404, and only that: a server
 * from before the route (a rollback, or the minutes of a deploy). The admin
 * route is asked for threads whose report says whose it is (`questions=4`);
 * a server that does not know that answers in an older shape, which
 * `withLegacyQuestions` maps (F3; 261020p).
 */
async function read(ask: EarlierAsk): Promise<ReadAnswer | "failed" | "absent"> {
  if (ask.detail === "admin") {
    const query = new URLSearchParams(ask.show === "all" ? { questions: "4" } : { show: ask.show, questions: "4" });
    const res = await apiFetch(`${ADMIN_PATH}?${query}`);
    if (res.status === 404) return "absent";
    if (!res.ok) return "failed";
    const page = withLegacyQuestions(await res.json());
    return isAdminEarlierFeedbackPage(page, ask.show) ? { detail: "admin", page: withAddendaKnown(page) } : "failed";
  }
  const query = ask.show === "all" ? "" : `?show=${ask.show}`;
  const res = await apiFetch(`${PLAIN_PATH}${query}`);
  if (!res.ok) return "failed";
  const page = withLegacyPage(await res.json());
  return isEarlierFeedbackPage(page, ask.show) ? { detail: "plain", page } : "failed";
}

/**
 * The read, lazily. `wanted` is whether the Earlier tab is showing; `open` is
 * whether the dialog is. The first time both are true for a filter in an
 * opening, it reads.
 *
 * `admin` picks the list: the admin's own, with statuses, or every reader's.
 * **If the admin route is not there (a 404), this opening falls back to the
 * plain list and its three pills**, and the next opening asks again. Any other
 * failure is the failure sentence: a 403 means the server disagrees about who
 * this is, and showing the plain list under that would hide it.
 *
 * **An admin's dialog reads *Needs a decision* as soon as it opens** (plan
 * 261008i, decisions 8 and 9), on Write too: that read is the count on the
 * shortcut beside the tabs, and it decides where Earlier opens. Earlier opens
 * on *Needs a decision*; when that first read says no thread is waiting, it
 * moves to All, **unless the reader has chosen anything since the opening
 * began** (a pill, the shortcut, a thread), which always wins (F8).
 */
export function useEarlierFeedback(open: boolean, wanted: boolean, admin = false): EarlierFeedback {
  const [states, setStates] = useState<EarlierStates>(NOTHING);
  const [fellBack, setFellBack] = useState(false);
  const detail: EarlierLoaded["detail"] = admin && !fellBack ? "admin" : "plain";
  const opening: AnyShow = detail === "admin" ? "waiting" : "all";
  const [show, setShowState] = useState<AnyShow>(opening);
  const generation = useRef(0);
  const sequence = useRef<Partial<Record<AnyShow, number>>>({});
  /* The hook's clock: every read's start and every receipt is a tick (F4). */
  const clock = useRef(0);
  const tick = useCallback(() => {
    clock.current += 1;
    return clock.current;
  }, []);
  /* How many choices the reader has made in this opening (F8). */
  const choices = useRef(0);
  const chose = useCallback(() => {
    choices.current += 1;
  }, []);
  /* A question may be resolved by a deploy while Greg is answering it. Keep
     the question's words beside the open thread or any non-empty local draft,
     so the draft never becomes an invisible reload veto and a dictation in
     flight is not unmounted when the dialog closes. */
  const rememberedQuestions = useRef(new Map<string, ThreadQuestion>());
  const replies = useQuestionReplies(tick, chose);
  const addenda = useReportAddenda(tick);

  const load = useCallback(async (asked: EarlierAsk) => {
    const which = asked.show;
    const opened = generation.current;
    const mine = (sequence.current[which] ?? 0) + 1;
    sequence.current[which] = mine;
    const startedAt = tick();
    const choicesAtStart = choices.current;
    const current = () => opened === generation.current && mine === sequence.current[which];
    const settle = (state: EarlierState) => {
      if (current()) setStates((all) => ({ ...all, [which]: state }));
    };
    const failed: EarlierState = { kind: "failed", message: FEEDBACK_EARLIER_FAILED.message };
    settle({ kind: "loading" });
    try {
      const answer = await read(asked);
      if (answer === "absent") {
        if (!current()) return;
        /* Every answer of the admin list is forgotten with it, and anything
           still in the air lands nowhere: the two lists share filter names. */
        generation.current += 1;
        setFellBack(true);
        setShowState("all");
        setStates(NOTHING);
        return;
      }
      if (answer === "failed") {
        settle(failed);
        return;
      }
      if (answer.detail === "admin") {
        settle({ kind: "loaded", detail: "admin", page: answer.page, startedAt });
        /* The opening's first look at Needs a decision, with nothing waiting
           and nothing chosen since: Earlier opens on All instead (F8). */
        if (
          current() &&
          which === "waiting" &&
          choicesAtStart === 0 &&
          choices.current === 0 &&
          !answer.page.questions.some((question) => question.state === "waiting")
        ) {
          setShowState((now) => (now === "waiting" ? "all" : now));
        }
        return;
      }
      settle({ kind: "loaded", detail: "plain", page: answer.page });
    } catch {
      settle(failed);
    }
  }, [tick]);

  /* Shut: forget every answer, go back to where an opening starts and to the
     list `admin` names, and make any read still in the air land nowhere. */
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    choices.current = 0;
    setFellBack(false);
    setShowState(admin ? "waiting" : "all");
    /* The same object when there is nothing to forget, so a dialog that was
       never on this tab is not re-rendered for being shut. */
    setStates((current) => (Object.keys(current).length === 0 ? current : NOTHING));
  }, [open, admin]);

  const choice = choiceOf(askOf(detail, show), states);
  const earlier = states[choice.show] ?? IDLE;
  const waitingRead = states.waiting ?? IDLE;
  useEffect(() => {
    if (!open) return;
    if (wanted && earlier.kind === "idle") void load(askOf(detail, show));
    /* The admin's read on opening, unless the line above is that read. */
    else if (detail === "admin" && waitingRead.kind === "idle") void load({ detail, show: "waiting" });
  }, [open, wanted, earlier.kind, waitingRead.kind, detail, show, load]);

  const setShow = useCallback(
    (next: AnyShow) => {
      chose();
      setShowState(next);
    },
    [chose],
  );

  const seen = questionsOf(choice, states);
  const currentQuestions =
    seen === null ? null : seen.questions.map((question) => withLocal(question, seen.startedAt, replies));
  if (currentQuestions !== null) {
    for (const question of currentQuestions) rememberedQuestions.current.set(question.id, question);
  }
  const heldQuestionIds = new Set(
    Object.entries(replies.drafts)
      .filter(([, draft]) => draft.trim() !== "")
      .map(([id]) => id),
  );
  if (replies.openId !== null) heldQuestionIds.add(replies.openId);
  const questions =
    currentQuestions === null && heldQuestionIds.size === 0
      ? null
      : [
          ...(currentQuestions ?? []),
          ...[...heldQuestionIds]
            .filter((id) => !currentQuestions?.some((question) => question.id === id))
            .map((id) => rememberedQuestions.current.get(id))
            .filter((question): question is ThreadQuestion => question !== undefined),
        ];
  return {
    earlier,
    choice,
    setShow,
    retry: () => void load(askOf(detail, show)),
    questions,
    liveQuestions: currentQuestions,
    waitingQuestionCount: currentQuestions === null ? null : waitingThreads(currentQuestions),
    questionsLoading: open && detail === "admin" && currentQuestions === null && waitingRead.kind !== "failed",
    replies,
    addenda,
  };
}

/** Shorter than the toggle's "A problem": this is a label on a row, not a choice. */
const KIND_WORD: Record<FeedbackKind, string> = {
  problem: "Problem",
  suggestion: "Suggestion",
  discussion: "Discussion",
};

const SHOW_WORD: Record<EarlierFeedbackShow, string> = {
  all: "All",
  shipped: "Shipped",
  unshipped: "Not shipped",
};

/** Said literally, per filter: "not shipped" includes declined, so never "outstanding". */
const EMPTY: Record<EarlierFeedbackShow, string> = {
  all: "You haven't sent us any feedback yet.",
  shipped: "None of your reports has a shipped change yet.",
  unshipped: "Every report you've sent has a shipped change.",
};

/** What the cap line counts: "of your 45 not-shipped reports" (261003b). */
const CAP_NOUN: Record<EarlierFeedbackShow, string> = {
  all: "reports",
  shipped: "shipped reports",
  unshipped: "not-shipped reports",
};

/** An admin's five pills. *Needs a decision* and *Set aside* are the plan's words for waiting and aside. */
const ADMIN_SHOW_WORD: Record<AdminEarlierFeedbackShow, string> = {
  all: "All",
  open: "Open",
  waiting: "Needs a decision",
  aside: "Set aside",
  shipped: "Shipped",
};

const ADMIN_EMPTY: Record<AdminEarlierFeedbackShow, string> = {
  all: "You haven't sent us any feedback yet.",
  open: "None of your reports is open: each has shipped, been set aside, or is waiting.",
  waiting: "None of your reports is waiting.",
  aside: "None of your reports has been set aside.",
  shipped: "None of your reports has a shipped change yet.",
};

const ADMIN_CAP_NOUN: Record<AdminEarlierFeedbackShow, string> = {
  all: "reports",
  open: "open reports",
  waiting: "waiting reports",
  aside: "set-aside reports",
  shipped: "shipped reports",
};

/**
 * **A report's own word, on its row.** The pills' words but one: a report
 * whose notes say awaiting is *Waiting*, not *Needs a decision*, because it
 * stays so until an agent's note lands, after Greg has replied or deferred
 * too. *Needs a decision* is kept for a thread waiting on him (`spya-h2d3my`,
 * plan 261011ad).
 */
const STATUS_WORD: Record<EarlierFeedbackStatus, string> = {
  open: "Open",
  waiting: "Waiting",
  aside: "Set aside",
  shipped: "Shipped",
};

/** What a status word means, for the pointer that rests on it. */
const STATUS_TITLE: Record<EarlierFeedbackStatus, string> = {
  open: "Nothing has been written up about this yet: it is new, or being worked on.",
  waiting: "An agent has asked you about this, or will; its question is under Needs a decision.",
  aside: "This was declined, or marked Ignore on /admin/feedback.",
  shipped: "We shipped a change for this, and it is in the version of Spideryarn you're using.",
};

/** The status word's look. Shipped is the good news; unresolved Waiting stays equally prominent. */
function statusClass(status: EarlierFeedbackStatus): string {
  switch (status) {
    case "shipped":
      return "fb-earlier-shipped";
    case "waiting":
      return "fb-earlier-waiting";
    case "aside":
    case "open":
      return "fb-earlier-unshipped";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

const SHIPPED_TITLE = "We shipped a change for this, and it is in the version of Spideryarn you're using.";

/** Careful, because "not shipped" is only "no note marks it shipped": it may be
 *  declined, waiting, on its way, or — with a missing note — already here. */
const UNSHIPPED_TITLE = "This isn't marked as shipped in the version of Spideryarn you're using.";

/**
 * `12 Sept 2026, 10:45 · 3d ago` — the exact time and how long ago, both.
 * Greg, 2026-09-30 (spya-d9xdhs): *"can we include the exact timestamp and
 * maybe a human-readable `3d ago` or `3h ago`?"* The narrow form is his;
 * past relative-time.ts's 30-day threshold it is left off and the exact time
 * stands alone. `createdAt` is checked parseable on the way in (above), so the
 * `?? iso` is unreachable rather than a fallback anyone sees.
 */
function when(iso: string, now: number): string {
  const exact = exactly(iso) ?? iso;
  const ago = relativeAgo(iso, now, "narrow");
  return ago === undefined ? exact : `${exact} · ${ago}`;
}

/**
 * All · Shipped · Not shipped. `aria-pressed` buttons in a fieldset, the same shape as the
 * Problem / Suggestion toggle; every one `type="button"` so none can submit
 * the hidden Write form.
 *
 * > Perhaps include a number/badge in the tab-pills for Shipped and Not shipped?
 * >
 * > — Greg, 2026-10-01 (SPIDERYARN-READING2-95)
 *
 * Each pill carries its count once an answer has landed, and nothing before:
 * a pill never shows a guess. All has one too, or it would look as though All
 * had no number. docs/plans/261003b-earlier-tab-counts-on-the-pills.md.
 */
export function EarlierFilter({
  choice,
  onShow,
  questionCount = null,
}: {
  choice: EarlierChoice;
  onShow(show: AnyShow): void;
  /** The threads waiting on a decision, for an admin, as on the shortcut: *Needs a decision*'s number. Null draws none. */
  questionCount?: number | null;
}) {
  /* Three pills for every reader, five for an admin (261007d). A row that
     wraps: five do not fit one line on a phone (`.fb-kind`). */
  const pills: { which: AnyShow; word: string; count: number | null }[] =
    choice.detail === "admin"
      ? ADMIN_EARLIER_FEEDBACK_SHOWS.map((which) => ({
          which,
          word: ADMIN_SHOW_WORD[which],
          /* **Needs a decision counts the threads waiting on you**, the
             shortcut's number, not the reports whose notes say awaiting (Greg,
             `spya-h2d3my`: the two disagreed, and the report count kept one he
             had answered). A reply or a Defer moves a thread out; nothing
             moves a report but its note. So this one pill counts threads and
             the five no longer sum to All. Plan 261011ad. */
          count: which === "waiting" ? questionCount : choice.counts === null ? null : choice.counts[which],
        }))
      : EARLIER_FEEDBACK_SHOWS.map((which) => ({
          which,
          word: SHOW_WORD[which],
          count: choice.counts === null ? null : choice.counts[which],
        }));
  return (
    <fieldset className="fb-kind">
      <legend className="fb-kind-legend">Show</legend>
      {pills.map(({ which, word, count }) => (
        <button
          key={which}
          type="button"
          className="fb-show-button"
          aria-pressed={choice.show === which}
          onClick={() => onShow(which)}
        >
          {word}
          {count === null ? null : (
            <>
              {" "}
              <span className="fb-show-count">{count}</span>
            </>
          )}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The start of a row's meta line, the same in both lists: when, what they
 * called it, and where it was filed.
 */
function RowMeta({ report, now }: { report: Omit<EarlierReport, "shipped">; now: number }) {
  return (
    <>
      <time dateTime={report.createdAt}>{when(report.createdAt, now)}</time>
      {report.kind === null ? null : ` · ${KIND_WORD[report.kind]}`}
      {/* Where it was filed (spya-y4upzw): the address has always
          gone with a report, and this is the one place the reader
          sees that it did. The server's label, not the address
          (src/feedback-page.ts): the path of a page this app
          has, so it is its own link (spya-tqk7au, "Make it a
          link") — to the page, at the paragraph the report was
          filed at when the server could say (261006b), and not in
          the mode, which went with the rest of the query. */}
      {report.page === null ? null : (
        <>
          {" · on "}
          <Link
            className="fb-earlier-page"
            href={report.at === null ? report.page : `${report.page}?at=${report.at}`}
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
                event.ctrlKey || event.shiftKey || event.altKey) return;
              /* Native close reaches the dialog's existing onClose.
                 Route inside the app so the hidden Write draft survives;
                 opening another tab leaves this dialog alone. */
              event.currentTarget.closest("dialog")?.close();
              /* Already on that page at that paragraph: stay.
                 `navigate` scrolls to the top and the reading view
                 moves to `?at=` only when it changes, so following
                 the link from here would lose the place it names
                 (GPT Sol's plan review of 261006b, P1-F1). */
              /* Ask the router which article this is: a trailing
                 slash or an encoded slug is the same reading page. */
              const route = parseRoute(location.pathname);
              if (
                report.at !== null &&
                route.kind === "read" && route.view === "article" &&
                readHref(route.slug) === report.page &&
                new URLSearchParams(location.search).get("at") === report.at
              ) event.preventDefault();
            }}
          >
            {report.page}
          </Link>
        </>
      )}
    </>
  );
}

/** One row of every reader's list: Shipped, or in All, Not shipped. */
function PlainRow({ report, show, now }: { report: EarlierReport; show: EarlierFeedbackShow; now: number }) {
  return (
    <li className="fb-earlier-item">
      <p className="fb-earlier-meta">
        <RowMeta report={report} now={now} />
        {report.shipped ? (
          <>
            {" · "}
            <span className="fb-earlier-shipped" data-tip={SHIPPED_TITLE}>
              Shipped
            </span>
          </>
        ) : show === "all" ? (
          /* Only in All (SPIDERYARN-READING2-7D): there an absence
             would not read as an answer, while in Not shipped every
             row would say it. */
          <>
            {" · "}
            <span className="fb-earlier-unshipped" data-tip={UNSHIPPED_TITLE}>
              Not shipped
            </span>
          </>
        ) : null}
      </p>
      {/* Text, never markup, and whole: the reader wrote it, and a
          clamp would need an expander. `pre-wrap` keeps their lines. */}
      <p className="fb-earlier-body">{report.body}</p>
    </li>
  );
}

/**
 * One row of an admin's list (261007d): its number first, so it can be said
 * ("feedback 212"); what became of it, on every row and under every filter;
 * and under the reader's words, the one line its note says about it.
 */
function AdminRow({ report, now, adding }: { report: AdminRowReport; now: number; adding: Adding | null }) {
  const shown =
    report.addenda === null
      ? []
      : adding === null
        ? report.addenda
        : addendaShown(report.id, report.addenda, adding.startedAt, adding.addenda.sent);
  const draft = adding?.addenda.drafts[report.id] ?? "";
  /* A box with words in it stays open whatever else is opened, and even once
     the report has closed, so the words are never held where nobody can see
     them; a send then says the report has closed. */
  const boxOpen = adding !== null && (adding.addenda.openId === report.id || draft.trim() !== "");
  const takes = ADDENDUM_STATUSES.some((status) => status === report.status);
  return (
    <li className="fb-earlier-item">
      <p className="fb-earlier-meta">
        <span className="fb-earlier-number">#{report.number}</span>
        {" · "}
        <RowMeta report={report} now={now} />
        {" · "}
        <span className={statusClass(report.status)} data-status={report.status} data-tip={STATUS_TITLE[report.status]}>
          {STATUS_WORD[report.status]}
        </span>
      </p>
      <p className="fb-earlier-body">{report.body}</p>
      {shown.length === 0 ? null : (
        /* More of the report, so under its words, oldest first, and in the
           reader's face: they are the admin's own words (fonts.md). Text,
           and whole, with their lines kept, as the report's are. */
        <div className="fb-addenda">
          {shown.map((one) => (
            <div key={one.id} className="fb-addendum" data-addendum={one.id}>
              <p className="fb-earlier-meta">
                Added <time dateTime={one.createdAt}>{when(one.createdAt, now)}</time>
              </p>
              <p className="fb-addendum-body">{one.body}</p>
            </div>
          ))}
        </div>
      )}
      {report.comment !== null ? (
        /* A model wrote it, so it is in the model's face (docs/project/fonts.md),
           and it is text: React escapes it, and nothing here parses it. */
        <p className="fb-earlier-comment">{report.comment}</p>
      ) : report.status === "aside" && report.ignoredAt !== null ? (
        /* No note says why, so say what is known. Our sentence, in our face. */
        <p className="fb-earlier-note">
          Set aside on /admin/feedback, {exactly(report.ignoredAt) ?? report.ignoredAt}
        </p>
      ) : null}
      {/* Only where the server has said what this report's addenda are, so
          it has the route to send one to (an older server says nothing). */}
      {adding === null || report.addenda === null ? null : boxOpen ? (
        <AddendumBox report={report.id} number={report.number} addenda={adding.addenda} active={adding.active} />
      ) : takes ? (
        <div className="fb-addendum-open">
          <button type="button" className="fb-copy" onClick={() => adding.addenda.open(report.id)}>
            Add to this report
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** What a row needs to show and take addenda: the hook, which read it came from, and whether it can be seen. */
interface Adding {
  addenda: ReportAddenda;
  /** When the read behind this list began, on the Earlier hook's clock. */
  startedAt: number;
  /** The dialog open, on Earlier: out of sight, a box's microphone stops. */
  active: boolean;
}

/**
 * **The box an admin replies to one thread in**, with its own microphone, and
 * the thread's other way out: *Defer for now*, or *Bring back*. Mounted only
 * while that thread is open, so there is at most one, and the dialog's Write
 * box keeps the only other `useDictationField` (bar an addendum box).
 *
 * `active` is whether the box can be seen: the dialog open, on Earlier, in
 * *Needs a decision*. The box itself — growing with its words, the
 * microphone's keeper and its stop out of sight, Send off while it listens —
 * is `FeedbackSendBox`, shared with the addendum box (plan 261010o). The
 * keeper is per question, because Previous and Next reuse this one box, and
 * the name is what a transcript is bound to (dictation.md § Words go only
 * where they were said).
 */
function ReplyBox({
  question,
  replies,
  active,
}: {
  question: ThreadQuestion;
  replies: QuestionReplies;
  active: boolean;
}) {
  const sending = replies.stage.kind === "sending";
  const deferring = replies.deferring.kind === "sending";
  const deferred = question.state === "deferred";
  return (
    <FeedbackSendBox
      value={replies.drafts[question.id] ?? ""}
      onChange={(next) => replies.setDraft(question.id, next)}
      onSend={() => void replies.send(question.id)}
      sending={sending}
      held={deferring}
      active={active}
      keeper={`feedback-reply:${question.id}`}
      doneKey={{ seen: `reply:${question.id}`, hidden: "reply:hidden" }}
      label={`Your reply to: ${question.title}`}
      placeholder="Your reply. “1A” is enough…"
      sendWord="Send reply"
      className="fb-reply-thread"
      cap={MAX_FEEDBACK_ANSWER_CHARS}
      problems={[
        replies.stage.kind === "failed" ? replies.stage.message : null,
        replies.deferring.kind === "failed" ? replies.deferring.message : null,
      ]}
    >
      {/* The alternative to replying (spya-t6nmxt): "not now". Reversible,
          and it tells agents not to chase it (plan 261008i, decision 3). */}
      <button
        type="button"
        /* Red to put off; Bring back undoes a deferral, so neutral
           (button-tone.css, plans 261011h and 261020f). */
        className={deferred ? "fb-copy" : "fb-copy fb-defer tone-negative"}
        disabled={sending || deferring}
        data-working={deferring ? "" : undefined}
        onClick={() => void replies.defer(question.id, !deferred)}
      >
        {deferring ? <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" /> : null}
        {deferred ? "Bring back" : "Defer for now"}
      </button>
    </FeedbackSendBox>
  );
}

/** Each group's heading in the contents, and the word a thread's own meta line ends in. */
const GROUP_WORD: Record<FeedbackQuestionState, string> = {
  waiting: "Needs a decision",
  responded: "You've replied, being considered",
  deferred: "Deferred",
};

/** How many of the admin's replies to it an agent has acted on, sent or not. */
const actedCount = (question: ThreadQuestion): number => question.actedAnswers.length + question.olderActedAnswers;

/**
 * The state word in a thread. A waiting thread an agent has already acted on
 * is not the same as one never answered, and said the same thing until
 * spya-j4sg9g ("I could swear I have posted a reply … multiple times").
 */
function stateWord(question: ThreadQuestion): string {
  return question.state === "waiting" && actedCount(question) > 0 ? "Needs a decision again" : GROUP_WORD[question.state];
}

/** One reply of the admin's, as a thread lists it. */
function ReplyLine({ answer, acted, now }: { answer: AdminFeedbackQuestionAnswer; acted: boolean; now: number }) {
  return (
    <div className="fb-question-answer-one" data-acted={acted || undefined}>
      <p className="fb-earlier-meta">
        <span className="fb-earlier-shipped">You replied</span>
        {" · "}
        <time dateTime={answer.createdAt}>{when(answer.createdAt, now)}</time>
        {acted ? " · acted on" : null}
      </p>
      <p className="fb-question-answer-body">{answer.body}</p>
    </div>
  );
}

/**
 * `q-k3m9qt · about #301 (spya-mdp0em)`: the ids Greg and a terminal share
 * (`spya-krvuc9`). `feedback-questions.ts --show q-…` prints the file;
 * `feedback-unswept.ts --show 301` prints the report.
 */
function ThreadIds({ question }: { question: ThreadQuestion }) {
  return (
    <>
      <code className="fb-question-id">{question.id}</code>
      {question.report === null ? null : (
        <>
          {" · about "}
          {question.report.whose === "yours" ? null : (
            <span className="fb-question-whose" data-whose={question.report.whose}>
              {WHOSE_WORD[question.report.whose]}{" "}
            </span>
          )}
          <span className="fb-earlier-number">#{question.report.number}</span>{" "}
          <code className="fb-question-id">({question.report.id})</code>
        </>
      )}
    </>
  );
}

/**
 * **Somebody else's report, said so** (`spya-y43ha0`, plan 261020p): Greg,
 * *"it should be highlighted clearly as such"*. The words before its number,
 * in the contents and the thread, and the heading of its shut text.
 */
const WHOSE_WORD: Record<Exclude<FeedbackQuestionReportWhose, "yours">, string> = {
  reader: "a reader's",
  admin: "another admin's",
};

/** The shut report's heading: *Your report #301*, or *A reader's report #650 · from …*. */
function reportHeading(report: NonNullable<ThreadQuestion["report"]>): string {
  if (report.whose === "yours") return `Your report #${report.number}`;
  const word = WHOSE_WORD[report.whose];
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} report #${report.number}${report.from === null ? "" : ` · from ${report.from}`}`;
}

/**
 * **The contents** (`spya-t6nmxt`, `spya-bbe74w`): every live thread, one line
 * each, in three groups, and *Deferred* shut. A question no longer in the
 * server's open list stays reachable while this tab holds its draft, but in a
 * separate uncounted group rather than changing what *Needs a decision* says.
 */
function ThreadContents({
  questions,
  liveQuestions,
  replies,
}: {
  questions: ThreadQuestion[];
  liveQuestions: readonly ThreadQuestion[];
  replies: QuestionReplies;
}) {
  const live = new Set(liveQuestions.map((question) => question.id));
  const rowsFor = (group: readonly ThreadQuestion[]) => (
    <ol className="fb-threads-list">
      {group.map((question) => (
        <li key={question.id}>
          <button
            type="button"
            className="fb-thread-row"
            data-question={question.id}
            onClick={() => replies.open(question.id)}
          >
            <span className="fb-thread-title">{question.title}</span>
            <span className="fb-earlier-meta">
              <ThreadIds question={question} /> · asked {dayOf(question.asked) ?? question.asked}
              {actedCount(question) > 0
                ? ` · you've replied ${actedCount(question) + question.answers.length + question.olderAnswers}×`
                : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
  const retained = questions.filter((question) => !live.has(question.id));
  return (
    <div className="fb-threads">
      {THREAD_GROUPS.map((state) => {
        const group = questions.filter((question) => live.has(question.id) && question.state === state);
        if (group.length === 0) return null;
        const list = rowsFor(group);
        const heading = (
          <>
            {GROUP_WORD[state]} <span className="fb-show-count">{group.length}</span>
          </>
        );
        return state === "deferred" ? (
          <details key={state} className="fb-threads-group" data-group={state}>
            <summary className="fb-questions-heading">{heading}</summary>
            {list}
          </details>
        ) : (
          <section key={state} className="fb-threads-group" data-group={state}>
            <h3 className="fb-questions-heading">{heading}</h3>
            {list}
          </section>
        );
      })}
      {retained.length === 0 ? null : (
        <section className="fb-threads-group" data-group="retained">
          <h3 className="fb-questions-heading">
            No longer open — kept in this tab <span className="fb-show-count">{retained.length}</span>
          </h3>
          {rowsFor(retained)}
        </section>
      )}
    </div>
  );
}

/**
 * **‹ Previous and Next ›**, and the sentence an end says when pressed. Drawn
 * twice while a thread shows: at its top, and in the dialog's footer, where the
 * reader is once a reply is written (`spya-bvzavw`, plan 261017c). Each copy
 * keeps its own end sentence, so a press at the foot is answered at the foot.
 */
function ThreadPager({
  pager: { stops, deciding },
  showing,
  replies,
  announce = false,
  active = true,
}: {
  pager: PagerStops;
  showing: string;
  replies: QuestionReplies;
  /** Say which thread a press opened, for the foot's copy: its focus stays in the footer, after the new thread (GPT Sol, 261017c F2). */
  announce?: boolean;
  /** Whether this copy is visible: hidden copies forget words they must not announce on returning. */
  active?: boolean;
}) {
  const at = stops.findIndex((one) => one.id === showing);
  const previous = at > 0 ? stops[at - 1] : undefined;
  const next = at >= 0 && at < stops.length - 1 ? stops[at + 1] : undefined;
  const pagerKey = stops.map((one) => `${one.id}:${deciding.has(one.id) ? "1" : "0"}`).join("|");
  /* Which end was pressed, against which pager snapshot, and how many times:
     said on the row only while that same snapshot still has the same end. A
     reply, deferral or newer read therefore takes the old sentence away (GPT
     Sol, 261009m P3). The count re-keys the words, so a second press is
     announced again. */
  const [refused, setRefused] = useState<{
    pagerKey: string;
    which: keyof typeof PAGER_HINT;
    times: number;
  } | null>(null);
  const said =
    active &&
    refused !== null &&
    refused.pagerKey === pagerKey &&
    (refused.which === "previous" ? previous : next) === undefined
      ? refused
      : null;
  /* The key check above hides stale words in the changing render; clearing
     afterwards prevents them reviving if a later read restores an old shape. */
  useEffect(() => {
    setRefused((was) => (was !== null && (!active || was.pagerKey !== pagerKey) ? null : was));
  }, [active, pagerKey]);
  /* Which thread this copy's own press opened, said only while it is the one showing. */
  const [went, setWent] = useState<{ id: string; title: string } | null>(null);
  const showingQuestion = stops.find((one) => one.id === showing);
  const showingDeciding = deciding.has(showing);
  const arrived =
    announce &&
    active &&
    went !== null &&
    went.id === showing &&
    showingDeciding &&
    showingQuestion?.title === went.title
      ? went
      : null;
  /* A success sentence belongs to the navigation that produced it. A reply,
     deferral, later read or another copy's navigation makes it stale; clearing
     after the changing render also prevents a later Bring back reviving it. */
  useEffect(() => {
    setWent((was) =>
      was !== null &&
      (!active || was.id !== showing || !showingDeciding || showingQuestion?.title !== was.title)
        ? null
        : was,
    );
  }, [active, showing, showingDeciding, showingQuestion?.title]);
  return (
    <>
      {/* **`aria-disabled`, not `disabled`, and a `data-tip`** (261009m § 4): a
          natively disabled button is no reliable trigger for a hint
          (tooltips.md). A phone has no hover, so pressing an end says the same
          sentence on the row. */}
      {(
        [
          ["previous", previous, "‹ Previous"],
          ["next", next, "Next ›"],
        ] as const
      ).map(([which, to, word]) => (
        <button
          key={which}
          type="button"
          className="fb-copy tap-target"
          aria-disabled={to === undefined || undefined}
          data-tip={to === undefined ? PAGER_HINT[which].end : PAGER_HINT[which].go}
          onClick={() => {
            if (to === undefined) {
              setRefused((was) => ({ pagerKey, which, times: (was?.times ?? 0) + 1 }));
              setWent(null);
              return;
            }
            /* A refusal belongs to this visit. Without clearing it here,
               paging away and back revives the old sentence unprompted. */
            setRefused(null);
            setWent({ id: to.id, title: to.title });
            replies.open(to.id);
          }}
        >
          {word}
        </button>
      ))}
      {/* Always mounted, empty until an end is pressed: a live region that
          arrives with its words in it is often not announced (P2). */}
      <p className="fb-thread-end" role="status" aria-atomic="true">
        {said === null ? null : <span key={said.times}>{PAGER_HINT[said.which].end}</span>}
      </p>
      {announce ? (
        /* Heard, not seen: the thread itself shows which one this is. */
        <p className="sr-only" role="status" aria-atomic="true">
          {arrived === null ? null : `Showing: ${arrived.title}`}
        </p>
      ) : null}
    </>
  );
}

/**
 * **One thread on its own**: where it sits among the rest and the way back,
 * the ids, the question (its *Details* shut), the report it is about (shut),
 * what the admin has replied, acted on first and then not yet acted on, and
 * the box.
 */
function ThreadView({
  question,
  pager: { stops, deciding },
  replies,
  active,
}: {
  question: ThreadQuestion;
  /** `pagerStops`: the threads that need a decision, and this one. */
  pager: PagerStops;
  replies: QuestionReplies;
  active: boolean;
}) {
  const at = stops.findIndex((one) => one.id === question.id);
  const { summary, details } = splitQuestionBody(question.body);
  const now = Date.now();
  /* **Each thread opens at its top** (261017c § 2). Paging keeps this view
     mounted, so the panel's scroll would otherwise carry over: Next pressed at
     the foot of a long thread landed half-way down the next. Keyed on the id,
     so typing or a send re-rendering this thread keeps the reader's place. */
  const top = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!active || scrolledTo.current === question.id) return;
    const scroller = top.current?.closest(".fb-scroll");
    if (scroller) {
      scroller.scrollTop = 0;
      scrolledTo.current = question.id;
    }
  }, [active, question.id]);
  return (
    <div className="fb-thread" ref={top}>
      <nav className="fb-thread-nav" aria-label="Threads">
        <button type="button" className="fb-copy" onClick={replies.close}>
          ‹ All threads
        </button>
        <span className="fb-thread-place">
          {deciding.has(question.id)
            ? `${at + 1} of ${deciding.size} needing a decision`
            : deciding.size === 0
              ? "No threads need a decision now"
              : `${deciding.size} need${deciding.size === 1 ? "s" : ""} a decision`}
        </span>
        <ThreadPager pager={{ stops, deciding }} showing={question.id} replies={replies} active={active} />
      </nav>
      <article className="fb-question" data-question={question.id} data-state={question.state}>
        <p className="fb-earlier-meta">
          <ThreadIds question={question} /> · asked {dayOf(question.asked) ?? question.asked} ·{" "}
          <span className={question.state === "waiting" ? "fb-earlier-waiting" : "fb-earlier-unshipped"}>
            {stateWord(question)}
          </span>
        </p>
        <h4 className="fb-question-title">{question.title}</h4>
        <p className="fb-question-text">{summary}</p>
        {details === null ? null : (
          <details className="fb-question-more">
            <summary>Details</summary>
            <p className="fb-question-text">{details}</p>
          </details>
        )}
        {question.report === null || question.report.body === null ? null : (
          /* The report's words, shut (spya-za2tse: "perhaps default-collapsed
             expandable"). Text, and whole. Somebody else's is marked as theirs
             on its heading and its edge (261020p). */
          <details className="fb-question-more" data-whose={question.report.whose}>
            <summary>{reportHeading(question.report)}</summary>
            <p className="fb-earlier-body">{question.report.body}</p>
          </details>
        )}
        {question.actedAnswers.length === 0 ? null : (
          /* What he said that an agent has acted on (261010h): before
             spya-j4sg9g it was only quoted inside the question, usually
             under the shut Details, so the thread looked unanswered. */
          <div className="fb-question-answer" data-acted="true">
            {question.olderActedAnswers > 0 ? (
              <p className="fb-earlier-meta">
                And {question.olderActedAnswers} earlier {question.olderActedAnswers === 1 ? "reply" : "replies"} acted
                on, not shown here.
              </p>
            ) : null}
            {question.actedAnswers.map((answer) => (
              <ReplyLine key={answer.id} answer={answer} acted now={now} />
            ))}
            <p className="fb-earlier-note">
              {question.state === "waiting"
                ? "An agent acted on what you said and kept this open, so it is asking something more."
                : "An agent acted on what you said."}{" "}
              What happened next is written in the question{details === null ? "" : ", under Details"}.
            </p>
          </div>
        )}
        {question.answers.length === 0 ? null : (
          <div className="fb-question-answer">
            {question.olderAnswers > 0 ? (
              <p className="fb-earlier-meta">
                And {question.olderAnswers} earlier {question.olderAnswers === 1 ? "reply" : "replies"}, not shown here.
              </p>
            ) : null}
            {question.answers.map((answer) => (
              <ReplyLine key={answer.id} answer={answer} acted={false} now={now} />
            ))}
          </div>
        )}
        {question.state === "deferred" && question.deferredAt !== null ? (
          <p className="fb-earlier-note">
            Deferred {exactly(question.deferredAt) ?? question.deferredAt}. No agent will chase it until you bring it
            back.
          </p>
        ) : question.state === "responded" ? (
          <p className="fb-earlier-note">An agent will pick up your reply at the next feedback sweep.</p>
        ) : null}
        <ReplyBox question={question} replies={replies} active={active} />
      </article>
    </div>
  );
}

/**
 * **The questions an agent has put to the admin, as threads**, in *Needs a
 * decision* (261007d, reshaped by 261008i). The contents, or one thread on its
 * own: each waiting report with an open question is inside its thread and
 * nowhere else, so nothing drawn here lacks a way to answer (`spya-u6h6q8`).
 *
 * **Drawn only in *Needs a decision*, once that filter's own answer is in**,
 * so a read that failed shows its failure sentence and nothing else; and only
 * while the Earlier panel itself is on screen (`open` and `onEarlier`). Out of
 * sight it is hidden rather than unmounted, so an open thread's reply box
 * keeps its microphone's words through a look at another filter or the Write
 * tab. The question's words are a model's and are drawn as text
 * (voices.css gives them the model's face); the reply is the admin's own.
 */
export function EarlierThreads({
  questions,
  liveQuestions,
  replies,
  choice,
  earlier,
  open,
  onEarlier,
}: {
  questions: ThreadQuestion[] | null;
  /** Authoritative membership from the newest read; retained drafts are not in this list. */
  liveQuestions: ThreadQuestion[] | null;
  replies: QuestionReplies;
  choice: EarlierChoice;
  earlier: EarlierState;
  /** Whether the dialog is open, */
  open: boolean;
  /** and on its Earlier tab. */
  onEarlier: boolean;
}) {
  if (questions === null || questions.length === 0) return null;
  const showing = open && onEarlier && choice.show === "waiting" && earlier.kind === "loaded";
  const live = new Set((liveQuestions ?? []).map((question) => question.id));
  const order = [
    ...threadOrder(questions.filter((question) => live.has(question.id))),
    ...threadOrder(questions.filter((question) => !live.has(question.id))),
  ];
  const thread = replies.openId === null ? undefined : order.find((one) => one.id === replies.openId);
  return (
    <section className="fb-questions" hidden={!showing} aria-label="Questions for you">
      {thread === undefined ? (
        <ThreadContents questions={order} liveQuestions={liveQuestions ?? []} replies={replies} />
      ) : (
        <ThreadView question={thread} pager={pagerStops(questions, live, thread.id)} replies={replies} active={showing} />
      )}
    </section>
  );
}

/**
 * **The pager in the dialog's footer**, beside Close, while one thread shows
 * (`spya-bvzavw`: "add Next/Previous buttons at the bottom of the box as well
 * (since often that's where I am when I finish responding)"). The footer is
 * outside the scroller, so it is there however long the thread. The dialog
 * draws this only when `threadShowing` holds and the list is loaded, which is
 * when `EarlierThreads` draws the thread (plan 261017c § 1).
 */
export function ThreadFootPager({
  questions,
  liveQuestions,
  replies,
  active,
}: {
  questions: ThreadQuestion[];
  liveQuestions: ThreadQuestion[] | null;
  replies: QuestionReplies;
  /** Whether the Earlier footer is on screen. */
  active: boolean;
}) {
  if (replies.openId === null) return null;
  const live = new Set((liveQuestions ?? []).map((question) => question.id));
  return (
    <nav className="fb-thread-nav fb-foot-pager" aria-label="Threads, at the foot">
      <ThreadPager
        pager={pagerStops(questions, live, replies.openId)}
        showing={replies.openId}
        replies={replies}
        announce
        active={active}
      />
    </nav>
  );
}

/** How many threads wait on a decision: the shortcut's number. */
export function waitingThreads(questions: readonly ThreadQuestion[]): number {
  return questions.filter((question) => question.state === "waiting").length;
}

/**
 * **The number beside the Feedback button, before the box is opened**
 * (Greg, spya-wwyw8y): the dialog's own opening read of *Needs a decision*,
 * counted by `waitingThreads`, so the trigger and the shortcut inside cannot
 * disagree. `null` on any failure, or a server without the admin route: then
 * the trigger shows no number rather than a wrong one. Admin only; the caller
 * decides that (FeedbackButton.tsx § `FeedbackHost`).
 */
export async function readWaitingCount(): Promise<number | null> {
  try {
    const answer = await read({ detail: "admin", show: "waiting" });
    return typeof answer === "object" && answer.detail === "admin" ? waitingThreads(answer.page.questions) : null;
  } catch {
    return null;
  }
}

/**
 * The shortcut's tooltip: `3 need a decision · newest asked 8 Oct 2026 · 1
 * you've replied to · 1 deferred`. Greg asked for "how many since my last
 * visit or when they were most recently added or something"; the newest
 * question's day says nearly the same with nothing remembered per device
 * (plan 261008i, decision 8).
 */
export function shortcutTitle(questions: readonly ThreadQuestion[]): string {
  const count = (state: FeedbackQuestionState) => questions.filter((question) => question.state === state).length;
  const newest = questions.map((question) => question.asked).sort().at(-1);
  return [
    `${count("waiting")} need${count("waiting") === 1 ? "s" : ""} a decision`,
    ...(newest === undefined ? [] : [`newest asked ${dayOf(newest) ?? newest}`]),
    `${count("responded")} you've replied to`,
    `${count("deferred")} deferred`,
  ].join(" · ");
}

/** Whether one thread is showing on its own: then nothing else in the panel is drawn. */
export function threadShowing(questions: readonly ThreadQuestion[] | null, replies: QuestionReplies): boolean {
  return replies.openId !== null && (questions ?? []).some((question) => question.id === replies.openId);
}

/** What the Earlier panel shows, in each of its four states. */
export function EarlierList({
  earlier,
  choice,
  retry,
  questions = null,
  threadOpen = false,
  addenda = null,
  active = false,
}: {
  earlier: EarlierState;
  choice: EarlierChoice;
  retry(): void;
  /** The admin's threads: in *Needs a decision* a report one of them is about is drawn inside it, not here. */
  questions?: readonly ThreadQuestion[] | null;
  /** One thread is showing on its own, so the list is not drawn. */
  threadOpen?: boolean;
  /** The admin's addenda (`EarlierFeedback.addenda`); without them no row offers a box. */
  addenda?: ReportAddenda | null;
  /** Whether the list can be seen: the dialog open, on Earlier. */
  active?: boolean;
}) {
  switch (earlier.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p className="fb-earlier-status" role="status">
          <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" />
          Loading what you've sent us
        </p>
      );
    case "failed":
      return (
        <div className="fb-failed" role="alert">
          <p>{earlier.message}</p>
          <div className="fb-failed-outs">
            <button type="button" className="fb-copy" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      );
    case "loaded": {
      /* Once per render, so every row is measured from the same moment. */
      const now = Date.now();
      /* An answer is kept under the filter of the list that asked for it, so
         these agree; drawing one list's rows under the other's filter is the
         one thing that must not happen if they ever did not. */
      if (earlier.detail === "admin" && choice.detail === "admin") {
        const { reports, more, counts } = earlier.page;
        const adding: Adding | null = addenda === null ? null : { addenda, startedAt: earlier.startedAt, active };
        if (choice.show === "waiting") {
          if (threadOpen) return null;
          /* **Only the reports no thread is about** (spya-u6h6q8, plan
             261008i § The bug): a waiting report with an open question is
             inside that thread, with its reply box. What is left waits on a
             question nobody has written yet, and says so, so a row here never
             looks like something to answer that cannot be. A report the
             server says is `asked` is a thread's too, as a repeat folded into
             its note (spya-tqsw3u, plan 261016a), and is not left here. */
          const linked = new Set((questions ?? []).flatMap((question) => question.report?.id ?? []));
          const orphans = reports.filter((report) => !linked.has(report.id) && !report.asked);
          if (orphans.length === 0) {
            return (questions ?? []).length === 0 ? (
              <p className="fb-earlier-status">Nothing needs a decision from you.</p>
            ) : null;
          }
          return (
            <section className="fb-orphans" aria-label="Waiting, but no question written yet">
              <h3 className="fb-questions-heading">
                Waiting, but no question written yet <span className="fb-show-count">{orphans.length}</span>
              </h3>
              <p className="fb-earlier-note">
                Each of these is marked as waiting on you, but no agent has written the question for it yet, so there is
                nothing to answer here. The next feedback sweep lists them to write one.
              </p>
              <ol className="fb-earlier-list">
                {orphans.map((report) => (
                  <AdminRow key={report.id} report={report} now={now} adding={adding} />
                ))}
              </ol>
              {more ? (
                <p className="fb-earlier-status">
                  Showing the {reports.length} most recent of your {counts.waiting} {ADMIN_CAP_NOUN.waiting}.
                </p>
              ) : null}
            </section>
          );
        }
        if (reports.length === 0) return <p className="fb-earlier-status">{ADMIN_EMPTY[choice.show]}</p>;
        return (
          <>
            <ol className="fb-earlier-list">
              {reports.map((report) => (
                <AdminRow key={report.id} report={report} now={now} adding={adding} />
              ))}
            </ol>
            {more ? (
              <p className="fb-earlier-status">
                Showing the {reports.length} most recent of your {counts[choice.show]}{" "}
                {ADMIN_CAP_NOUN[choice.show]}.
              </p>
            ) : null}
          </>
        );
      }
      if (earlier.detail === "plain" && choice.detail === "plain") {
        const { reports, more, counts } = earlier.page;
        if (reports.length === 0) return <p className="fb-earlier-status">{EMPTY[choice.show]}</p>;
        return (
          <>
            <ol className="fb-earlier-list">
              {reports.map((report) => (
                <PlainRow key={report.id} report={report} show={choice.show} now={now} />
              ))}
            </ol>
            {more ? (
              /* "of N", so the reader need not take the cap on trust
                 (SPIDERYARN-READING2-95: "Is that true?"). */
              <p className="fb-earlier-status">
                Showing the {reports.length} most recent of your {counts[choice.show]} {CAP_NOUN[choice.show]}.
              </p>
            ) : null}
          </>
        );
      }
      return null;
    }
    default: {
      const unreachable: never = earlier;
      return unreachable;
    }
  }
}
