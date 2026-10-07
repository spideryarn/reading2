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
 * Needs a decision · Set aside · Shipped), numbers it (`#212`), and carries
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
 * server). They are drawn at the top of *Needs a decision*, counted beside
 * that pill in every view, and each has a reply box with a microphone
 * (`EarlierQuestions`). A reply is a row of its own, never a report.
 *
 * ## Once per opening, per filter
 *
 * Each filter is read the first time it is chosen and kept while the reader
 * flips back and forth. Nothing can be filed and then looked for within one
 * opening — a successful send shuts the dialog and thanks the reader in a
 * toast — so reading again would buy no freshness. Shutting the dialog forgets
 * every filter's answer and goes back to All. An answer is stored under the
 * filter that asked for it, and only if it is that filter's latest request in
 * this opening: a generation counter drops anything that lands after the
 * dialog shut, and a per-filter sequence drops a Try again's older twin.
 */
import { LoaderCircle } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { MAX_FEEDBACK_COMMENT_CHARS } from "../feedback-ending-values.js";
import {
  isFeedbackQuestionId,
  MAX_FEEDBACK_QUESTION_BODY_CHARS,
  MAX_FEEDBACK_QUESTION_TITLE_CHARS,
} from "../feedback-question-values.js";
import { isSpideryarnId, mintId } from "../ids.js";
import { FEEDBACK_EARLIER_FAILED, FEEDBACK_REPLY_FAILED, FEEDBACK_REPLY_STALE } from "../messages.js";
import {
  MAX_FEEDBACK_ANSWER_CHARS,
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
  type EarlierFeedback as EarlierReport,
  type EarlierFeedbackPage,
  type EarlierFeedbackShow,
  type EarlierFeedbackStatus,
  type FeedbackKind,
} from "../types.js";
import { keepDictation } from "./dictation-keep.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { apiFetch } from "./lib/api.js";
import { Link } from "./Link.js";
import { exactly, relativeAgo } from "./relative-time.js";
import { parseRoute, readHref } from "./router.js";
import { useDictationField } from "./useDictationField.js";

/**
 * **Which list an answer is**: every reader's (`plain`, `GET /api/feedback`),
 * or an admin's own with what became of each report (`admin`,
 * `GET /api/admin/feedback/earlier`). The two have different filters, counts
 * and rows, so everything that depends on which is a union on this word.
 */
export type EarlierLoaded =
  | { detail: "plain"; page: EarlierFeedbackPage }
  | { detail: "admin"; page: AdminEarlierFeedbackPage };

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
  if (page.more && page.reports.length !== EARLIER_FEEDBACK_LIMIT) return null;
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
): value is AdminEarlierFeedbackPage {
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
      (typeof report.ignoredAt === "string" && !Number.isNaN(Date.parse(report.ignoredAt))))
  )) return false;
  const reports = envelope.reports as unknown as AdminEarlierFeedback[];
  if (new Set(reports.map((report) => report.id)).size !== reports.length) return false;
  if (new Set(reports.map((report) => report.number)).size !== reports.length) return false;
  for (const status of EARLIER_FEEDBACK_STATUSES) {
    if (reports.filter((report) => report.status === status).length > (counts[status] as number)) return false;
  }
  if (which !== "all" && reports.some((report) => report.status !== which)) return false;
  return areQuestions((value as { questions?: unknown }).questions);
}

/** A reply as the server sends it back: an id, words, and a time that parses. */
function isQuestionAnswer(value: unknown): value is AdminFeedbackQuestionAnswer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  return (
    typeof answer.id === "string" && isSpideryarnId(answer.id) &&
    typeof answer.body === "string" && answer.body.trim() !== "" &&
    typeof answer.createdAt === "string" && !Number.isNaN(Date.parse(answer.createdAt))
  );
}

const QUESTION_KEYS = ["answer", "asked", "body", "id", "report", "title"];

/**
 * **The questions half of the admin answer, as strict as the reports half.**
 * Exactly the six fields of each, so anything meant for agents that a server
 * one day sent would fail here instead of being carried around; ids no two
 * share; text within the caps the compiler holds a file to. A list that fails
 * fails the whole answer: the failure sentence, never some of the questions.
 */
function areQuestions(value: unknown): value is AdminFeedbackQuestion[] {
  if (!Array.isArray(value) || !value.every(isQuestion)) return false;
  return new Set(value.map((question) => question.id)).size === value.length;
}

/** Text that says something and fits its cap. */
const isTextWithin = (value: unknown, cap: number): value is string =>
  typeof value === "string" && value !== "" && value.length <= cap;

/** The report a question is about, as its card shows it: an id, a number, a first line. */
function isLinkedReport(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const linked = value as Record<string, unknown>;
  return (
    typeof linked.id === "string" && isSpideryarnId(linked.id) &&
    Number.isSafeInteger(linked.number) && (linked.number as number) > 0 &&
    typeof linked.firstLine === "string"
  );
}

function isQuestion(value: unknown): value is AdminFeedbackQuestion {
  if (typeof value !== "object" || value === null) return false;
  const question = value as Record<string, unknown>;
  return (
    Object.keys(question).sort().join() === QUESTION_KEYS.join() &&
    isFeedbackQuestionId(question.id) &&
    isTextWithin(question.title, MAX_FEEDBACK_QUESTION_TITLE_CHARS) &&
    isTextWithin(question.body, MAX_FEEDBACK_QUESTION_BODY_CHARS) &&
    typeof question.asked === "string" && dayOf(question.asked) !== null &&
    (question.report === null || isLinkedReport(question.report)) &&
    (question.answer === null || isQuestionAnswer(question.answer))
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
  setShow(show: AnyShow): void;
  retry(): void;
  /**
   * Every open question, for an admin, from any answer of this opening (each
   * carries them all), plus a remembered question while it holds a local
   * draft; `null` for every other reader and until one lands.
   */
  questions: AdminFeedbackQuestion[] | null;
  /** The server's open-question count, without a remembered no-longer-open question. */
  openQuestionCount: number | null;
  replies: QuestionReplies;
}

/** Where the open reply box's send has got to. */
export type ReplyStage = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

/**
 * **The admin's replies in progress**, held by the hook the dialog keeps
 * mounted, so a half-written reply survives a look at another tab, another
 * filter, and the dialog being shut. One box open at a time.
 */
export interface QuestionReplies {
  /** The question whose reply box is open, or null. */
  openId: string | null;
  /** What is typed so far in each question's box. A box that is shut keeps its words. */
  drafts: Readonly<Record<string, string>>;
  stage: ReplyStage;
  /** Replies sent from this page, newest per question: shown at once, ahead of the list's older answer. */
  sent: Readonly<Record<string, AdminFeedbackQuestionAnswer>>;
  /** Whether anything unsent is held: words in a box, or a send in the air. */
  holds: boolean;
  open(id: string): void;
  close(): void;
  setDraft(id: string, text: string): void;
  send(id: string): Promise<void>;
}

/**
 * The replies' state and the one POST. **A send's id belongs to its question
 * and its words**: a retry of the same words carries the same id, which the
 * server answers with the stored row (200), and edited words get a new id, so
 * the server never sees one id with two bodies (its 409).
 */
function useQuestionReplies(): QuestionReplies {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [stage, setStage] = useState<ReplyStage>({ kind: "idle" });
  const [sent, setSent] = useState<Readonly<Record<string, AdminFeedbackQuestionAnswer>>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /* A ref as well as the stage: two presses in one frame both see the old render. */
  const sending = useRef(false);
  const attempt = useRef<{ question: string; body: string; id: string } | null>(null);

  const open = useCallback((id: string) => {
    if (sending.current) return;
    setOpenId(id);
    setStage({ kind: "idle" });
  }, []);
  const close = useCallback(() => {
    if (sending.current) return;
    setOpenId(null);
    setStage({ kind: "idle" });
  }, []);
  const setDraft = useCallback((id: string, text: string) => {
    setDrafts((all) => ({ ...all, [id]: text }));
  }, []);

  const send = useCallback(async (question: string) => {
    const body = (draftsRef.current[question] ?? "").trim();
    if (sending.current || body === "" || body.length > MAX_FEEDBACK_ANSWER_CHARS) return;
    const previous = attempt.current;
    const id = previous !== null && previous.question === question && previous.body === body ? previous.id : mintId();
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
        const receipt = (await res.json()) as { answer?: unknown } | null;
        const answer = receipt?.answer;
        if (isQuestionAnswer(answer) && answer.id === id && answer.body === body) {
          attempt.current = null;
          sending.current = false;
          setSent((all) => ({ ...all, [question]: answer }));
          setDrafts((all) => {
            const { [question]: _sent, ...rest } = all;
            return rest;
          });
          setOpenId((current) => (current === question ? null : current));
          setStage({ kind: "idle" });
          return;
        }
      }
    } catch {
      /* The network, or a body that was not JSON: the same sentence. */
    }
    sending.current = false;
    setStage({ kind: "failed", message: failed });
  }, []);

  const holds = stage.kind === "sending" || Object.values(drafts).some((text) => text.trim() !== "");
  return { openId, drafts, stage, sent, holds, open, close, setDraft, send };
}

/** The questions any admin answer of this opening carried: the showing filter's first. */
function questionsOf(choice: EarlierChoice, states: EarlierStates): AdminFeedbackQuestion[] | null {
  if (choice.detail !== "admin") return null;
  for (const which of [choice.show, ...ADMIN_EARLIER_FEEDBACK_SHOWS]) {
    const state = states[which];
    if (state?.kind === "loaded" && state.detail === "admin") return state.page.questions;
  }
  return null;
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

/**
 * One read of one filter of one list: the answer checked, or why there is
 * none. `absent` is the admin route answering 404, and only that: a server
 * from before the route (a rollback, or the minutes of a deploy).
 */
async function read(ask: EarlierAsk): Promise<EarlierLoaded | "failed" | "absent"> {
  const query = ask.show === "all" ? "" : `?show=${ask.show}`;
  if (ask.detail === "admin") {
    const res = await apiFetch(`${ADMIN_PATH}${query}`);
    if (res.status === 404) return "absent";
    if (!res.ok) return "failed";
    const page: unknown = await res.json();
    return isAdminEarlierFeedbackPage(page, ask.show) ? { detail: "admin", page } : "failed";
  }
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
 */
export function useEarlierFeedback(open: boolean, wanted: boolean, admin = false): EarlierFeedback {
  const [states, setStates] = useState<EarlierStates>(NOTHING);
  const [show, setShow] = useState<AnyShow>("all");
  const [fellBack, setFellBack] = useState(false);
  const detail: EarlierLoaded["detail"] = admin && !fellBack ? "admin" : "plain";
  const generation = useRef(0);
  const sequence = useRef<Partial<Record<AnyShow, number>>>({});
  /* A question may be resolved by a deploy while Greg is answering it. Keep
     the question's words beside any open or non-empty local draft, so the
     draft never becomes an invisible reload veto and a dictation in flight
     is not unmounted when the dialog closes. */
  const rememberedQuestions = useRef(new Map<string, AdminFeedbackQuestion>());
  const replies = useQuestionReplies();

  const load = useCallback(async (asked: EarlierAsk) => {
    const which = asked.show;
    const opening = generation.current;
    const mine = (sequence.current[which] ?? 0) + 1;
    sequence.current[which] = mine;
    const current = () => opening === generation.current && mine === sequence.current[which];
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
        setShow("all");
        setStates(NOTHING);
        return;
      }
      settle(answer === "failed" ? failed : { kind: "loaded", ...answer });
    } catch {
      settle(failed);
    }
  }, []);

  /* Shut: forget every answer, go back to All and to the list `admin` names,
     and make any read still in the air land nowhere. */
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setShow("all");
    setFellBack(false);
    /* The same object when there is nothing to forget, so a dialog that was
       never on this tab is not re-rendered for being shut. */
    setStates((current) => (Object.keys(current).length === 0 ? current : NOTHING));
  }, [open]);

  const choice = choiceOf(askOf(detail, show), states);
  const earlier = states[choice.show] ?? IDLE;
  useEffect(() => {
    if (open && wanted && earlier.kind === "idle") void load(askOf(detail, show));
  }, [open, wanted, earlier.kind, detail, show, load]);

  const currentQuestions = questionsOf(choice, states);
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
            .filter((question): question is AdminFeedbackQuestion => question !== undefined),
        ];
  return {
    earlier,
    choice,
    setShow,
    retry: () => void load(askOf(detail, show)),
    questions,
    openQuestionCount: currentQuestions?.length ?? null,
    replies,
  };
}

/** Shorter than the toggle's "A problem": this is a label on a row, not a choice. */
const KIND_WORD: Record<FeedbackKind, string> = {
  problem: "Problem",
  suggestion: "Suggestion",
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
  open: "None of your reports is open: each has shipped, been set aside, or is waiting on a decision.",
  waiting: "None of your reports needs a decision.",
  aside: "None of your reports has been set aside.",
  shipped: "None of your reports has a shipped change yet.",
};

const ADMIN_CAP_NOUN: Record<AdminEarlierFeedbackShow, string> = {
  all: "reports",
  open: "open reports",
  waiting: "reports that need a decision",
  aside: "set-aside reports",
  shipped: "shipped reports",
};

/** What a status word means, for the pointer that rests on it. */
const STATUS_TITLE: Record<EarlierFeedbackStatus, string> = {
  open: "Nothing has been written up about this yet: it is new, or being worked on.",
  waiting: "This is waiting on a decision from you.",
  aside: "This was declined, or marked Ignore on /admin/feedback.",
  shipped: "We shipped a change for this, and it is in the version of Spideryarn you're using.",
};

/** The status word's look. Shipped is the good news; a decision is the one that asks something of the reader. */
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
  /** The open questions, for an admin; null or none says nothing on the pill. */
  questionCount?: number | null;
}) {
  const questions = questionCount ?? 0;
  /* Three pills for every reader, five for an admin (261007d). A row that
     wraps: five do not fit one line on a phone (`.fb-kind`). */
  const pills: { which: AnyShow; word: string; count: number | null }[] =
    choice.detail === "admin"
      ? ADMIN_EARLIER_FEEDBACK_SHOWS.map((which) => ({
          which,
          word: ADMIN_SHOW_WORD[which],
          count: choice.counts === null ? null : choice.counts[which],
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
          {/* Beside the report count, never added to it: a question is not a
              report, and the pills' counts still sum to All (261007d). */}
          {which === "waiting" && choice.detail === "admin" && questions > 0 ? (
            <span className="fb-show-questions">
              {" · "}
              {questions} open {questions === 1 ? "question" : "questions"}
            </span>
          ) : null}
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
            <span className="fb-earlier-shipped" title={SHIPPED_TITLE}>
              Shipped
            </span>
          </>
        ) : show === "all" ? (
          /* Only in All (SPIDERYARN-READING2-7D): there an absence
             would not read as an answer, while in Not shipped every
             row would say it. */
          <>
            {" · "}
            <span className="fb-earlier-unshipped" title={UNSHIPPED_TITLE}>
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
function AdminRow({ report, now }: { report: AdminEarlierFeedback; now: number }) {
  return (
    <li className="fb-earlier-item">
      <p className="fb-earlier-meta">
        <span className="fb-earlier-number">#{report.number}</span>
        {" · "}
        <RowMeta report={report} now={now} />
        {" · "}
        <span className={statusClass(report.status)} data-status={report.status} title={STATUS_TITLE[report.status]}>
          {ADMIN_SHOW_WORD[report.status]}
        </span>
      </p>
      <p className="fb-earlier-body">{report.body}</p>
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
    </li>
  );
}

/**
 * **The box an admin replies to one question in**, with its own microphone.
 * Mounted only while that question's box is open, so there is at most one, and
 * the dialog's Write box keeps the only other `useDictationField`.
 *
 * `active` is whether the box can be seen: the dialog open, on Earlier, in
 * *Needs a decision*. **Going out of sight stops the microphone**, exactly as
 * the Write box's is stopped on a tab change and on close: the hook's own
 * `toggle` (a stop, so what was said lands in the draft), never the field's,
 * which would pull focus into a box that has just been hidden.
 */
function ReplyBox({
  question,
  replies,
  active,
}: {
  question: AdminFeedbackQuestion;
  replies: QuestionReplies;
  active: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const draft = replies.drafts[question.id] ?? "";
  const over = draft.length > MAX_FEEDBACK_ANSWER_CHARS;
  const sending = replies.stage.kind === "sending";
  const transcribe = useReaderTranscriber();
  /* Read at call time, so a double press on Stop sees this render's `busy`. */
  const busyRef = useRef(false);
  const trySend = () => {
    if (!active || busyRef.current) return;
    void replies.send(question.id);
  };
  const dictate = useDictationField({
    value: draft,
    onChange: (next) => replies.setDraft(question.id, next),
    box,
    /* Not the article being read: a question is about the app, so the
       transcript is primed with the app's words and the reader's profile. */
    context: { kind: "profile" },
    transcribe,
    /* Its own keeper name, so a recording left by the Write box is never
       offered here or the other way round; and only while it can be seen. */
    ...(active ? { keep: keepDictation("feedback-reply") } : {}),
    /* A double press on Stop also sends (dictation.md), by the same guarded
       function the button calls, and never from a box out of sight. */
    onDone: trySend,
    doneKey: active ? `reply:${question.id}` : "reply:hidden",
  });
  busyRef.current = dictate.busy;
  const { armed, toggle } = dictate.dictation;
  const stoppedOutOfSight = useRef(false);
  useEffect(() => {
    if (active) {
      stoppedOutOfSight.current = false;
    } else if (armed && !stoppedOutOfSight.current) {
      /* The retained box can render more than once while hidden (for example
         when the fetched lists are forgotten on close). Ask the recorder to
         stop once for that departure, not once per render. */
      stoppedOutOfSight.current = true;
      toggle();
    }
  }, [active, armed, toggle]);

  /* ⌘/Ctrl+Enter sends the reply, and goes no further: the dialog's own
     handler is for the Write form. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    trySend();
  };

  return (
    <div className="fb-reply">
      <textarea
        ref={box}
        className="fb-input fb-reply-input"
        rows={3}
        aria-label={`Your reply to: ${question.title}`}
        value={draft}
        readOnly={dictate.readOnly || sending}
        onChange={(event) => replies.setDraft(question.id, event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Your reply. “1A” is enough…"
      />
      {over ? (
        <span className="fb-over">
          {draft.length} characters — the limit is {MAX_FEEDBACK_ANSWER_CHARS}.
        </span>
      ) : null}
      <div className="fb-reply-actions">
        {dictate.dictation.supported && (
          <DictationButton
            dictation={dictate.dictation}
            toggle={dictate.toggle}
            disabled={sending}
            again={dictate.again}
            sendingAfter={dictate.sendingAfter}
          />
        )}
        <button
          type="button"
          className="fb-copy fb-reply-send"
          disabled={sending || dictate.busy || over || draft.trim() === ""}
          onClick={trySend}
        >
          {sending ? <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" /> : null}
          Send reply
        </button>
        <button type="button" className="fb-copy" disabled={sending} onClick={replies.close}>
          Cancel
        </button>
      </div>
      <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />
      {replies.stage.kind === "failed" ? (
        <p className="fb-shot-problem" role="alert">
          {replies.stage.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * **The questions an agent has put to the admin**, above the reports in
 * *Needs a decision* (261007d). Each: when it was asked and which report it is
 * about, its title, its text, the admin's newest reply if there is one, and
 * either the reply box or the button that opens it.
 *
 * **Drawn only in *Needs a decision*, once that filter's own answer is in**,
 * so a read that failed shows its failure sentence and nothing else; and only
 * while the Earlier panel itself is on screen (`open` and `onEarlier`). Out of sight
 * it is hidden rather than unmounted, so an open reply box keeps its
 * microphone's words through a look at another filter or the Write tab. The
 * question's words are a model's and are drawn as text (styles/voices.css
 * gives them the model's face); the reply is the admin's own.
 */
export function EarlierQuestions({
  questions,
  replies,
  choice,
  earlier,
  open,
  onEarlier,
}: {
  questions: AdminFeedbackQuestion[] | null;
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
  const now = Date.now();
  return (
    <section className="fb-questions" hidden={!showing} aria-label="Questions for you">
      <h3 className="fb-questions-heading">
        {questions.length} {questions.length === 1 ? "question" : "questions"} for you
      </h3>
      <ol className="fb-questions-list">
        {questions.map((question) => {
          const answer = replies.sent[question.id] ?? question.answer;
          return (
            <li key={question.id} className="fb-question" data-question={question.id}>
              <p className="fb-earlier-meta">
                Asked {dayOf(question.asked) ?? question.asked}
                {question.report === null ? null : (
                  <>
                    {" · about "}
                    <span className="fb-earlier-number">#{question.report.number}</span>{" "}
                    <span className="fb-question-report-line">{question.report.firstLine}</span>
                  </>
                )}
              </p>
              <h4 className="fb-question-title">{question.title}</h4>
              <p className="fb-question-text">{question.body}</p>
              {answer === null ? null : (
                <div className="fb-question-answer">
                  <p className="fb-earlier-meta">
                    <span className="fb-earlier-shipped">Answered</span>
                    {" · "}
                    <time dateTime={answer.createdAt}>{when(answer.createdAt, now)}</time>
                  </p>
                  <p className="fb-question-answer-body">{answer.body}</p>
                </div>
              )}
              {replies.openId === question.id ? (
                <ReplyBox question={question} replies={replies} active={showing} />
              ) : (
                <button type="button" className="fb-copy" onClick={() => replies.open(question.id)}>
                  {answer === null ? "Reply" : "Reply again"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** What the Earlier panel shows, in each of its four states. */
export function EarlierList({
  earlier,
  choice,
  retry,
}: {
  earlier: EarlierState;
  choice: EarlierChoice;
  retry(): void;
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
        if (reports.length === 0) return <p className="fb-earlier-status">{ADMIN_EMPTY[choice.show]}</p>;
        return (
          <>
            <ol className="fb-earlier-list">
              {reports.map((report) => (
                <AdminRow key={report.id} report={report} now={now} />
              ))}
            </ol>
            {more ? (
              <p className="fb-earlier-status">
                Showing the {EARLIER_FEEDBACK_LIMIT} most recent of your {counts[choice.show]}{" "}
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
                Showing the {EARLIER_FEEDBACK_LIMIT} most recent of your {counts[choice.show]} {CAP_NOUN[choice.show]}.
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
