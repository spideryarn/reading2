/**
 * **Ask Greg a question in the Feedback dialog, and read what he replied.**
 *
 *     npx tsx scripts/feedback-questions.ts                    # the open questions, from the files
 *     npx tsx scripts/feedback-questions.ts --new "<title>"    # a fresh path and header; creates nothing
 *     npx tsx scripts/feedback-questions.ts --answers          # his replies nobody has acted on yet
 *
 * A question is a file, `docs/user-feedback/questions/q-xxxxxx.md`
 * (scripts/feedback-endings.ts § `parseQuestionFile` has the format, and
 * compiles the open ones into the server). Once the commit carrying it is
 * deployed, an admin sees it at the top of *Needs a decision* in the Feedback
 * dialog's Earlier tab and replies there, by typing or by voice. The reply is a
 * row in production's `feedback_question_answers`, which `--answers` reads.
 * docs/project/feedback-reports.md § Asking Greg a question, and acting on his
 * answer; docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 *
 * ## `--answers`: exit 0 is a reading, exit 2 is not
 *
 * Exit 0 always prints a `Target:` line and a summary line, **also when there
 * is nothing to act on**. Exit 2 means it could not tell, which is **not "no
 * replies"**: production unreadable, a question file that does not parse (its
 * `acted:` line cannot be trusted), or a row that was not written in
 * production.
 *
 * **Which replies it prints.** Every row whose owner is an administrator and
 * whose server-authored `environment` is `production` or `preview`, and whose
 * id is not in its question file's `acted:` line — **whatever that question's
 * status**. Greg may reply from a tab loaded before the question was marked
 * answered, and those words must not be lost (the plan review's F14). A row
 * from an account that is not an administrator's is left out and counted; the
 * route that writes the table is admin-only, so one is not expected. A row with
 * any other `environment` means this did not read production's table, and is
 * exit 2 (F13).
 *
 * **Before the table is deployed** this script is already on `dev`. It asks
 * whether the table exists rather than assuming, says *replies are not
 * deployed yet*, and exits 0 with none (F7).
 *
 * **After acting on a reply**: quote it into the question file, add its id to
 * the file's `acted:` line, set `status: answered` when the question is
 * settled, and run `npx tsx scripts/feedback-endings.ts`.
 *
 * ## Production, read-only
 *
 * `productionClient()` from feedback-reporter.ts: `.env.prod` through
 * `readEnvProd`, verified TLS, the production project, a `Target:` line. Each
 * statement is one `select` inside `begin read only`, rolled back
 * (`readRowsReadOnly`). **Never a bare `SET`** (docs/project/database.md).
 * The replies are an administrator's own words; they are still printed quoted
 * line by line, with terminal controls escaped, so a reply cannot draw over
 * the lines around it.
 */
import { readdirSync } from "node:fs";

import type { QueryResultRow } from "pg";

import { isAdmin } from "../src/admin.js";
import type { FeedbackEnding } from "../src/feedback-ending-values.js";
import {
  isFeedbackQuestionId,
  MAX_FEEDBACK_QUESTION_TITLE_CHARS,
  mintFeedbackQuestionId,
  QUESTION_DETAILS_LINE,
} from "../src/feedback-question-values.js";
import {
  compileEndings,
  compileQuestions,
  type NoteFile,
  type QuestionFile,
  QUESTIONS_DIR,
  readNotes,
  readQuestionFiles,
} from "./feedback-endings.js";
import { CannotTell, isMainModule, productionClient } from "./feedback-reporter.js";
import { readRowsReadOnly, renderUntrustedWords } from "./feedback-unswept.js";

/** One reply, as production stores it. */
export interface AnswerRow {
  id: string;
  ownerId: string;
  questionId: string;
  body: string;
  /** Server-authored: which deployment wrote the row. */
  environment: string;
  createdAt: Date;
}

/** A reply nobody has acted on, with its question's file when this checkout has one. */
export interface UnhandledAnswer {
  row: AnswerRow;
  question: Pick<QuestionFile, "status" | "title"> | null;
}

export type AnswersVerdict =
  | { kind: "cannot-tell"; why: string }
  | {
      kind: "read";
      unhandled: UnhandledAnswer[];
      /** Every row read. */
      total: number;
      /** Administrator's rows whose id their question file already records. */
      acted: number;
      /** Rows from an account that is not an administrator's: left out. */
      strangers: number;
    };

/** The server-authored values a row in production may honestly carry: feedback-reporter.ts's pair. */
const PRODUCTION_ENVIRONMENTS: readonly string[] = ["production", "preview"];

/**
 * **The whole decision, with no I/O in it**, so a test holds every branch.
 *
 * The environment is checked first and for every row: one row written by a
 * local stack means this is not production's table, whoever owns the row.
 * Then the owner; then the question file's `acted:` line, and nothing else —
 * **not the question's status** (F14).
 */
export function classifyAnswers(
  rows: readonly AnswerRow[],
  questions: readonly QuestionFile[],
  admin: (ownerId: string) => boolean = isAdmin,
): AnswersVerdict {
  if (rows.some((row) => !PRODUCTION_ENVIRONMENTS.includes(row.environment))) {
    return {
      kind: "cannot-tell",
      why: "a row has an environment that cannot establish it was written in production",
    };
  }
  const byId = new Map(questions.map((question) => [question.id, question]));
  const unhandled: UnhandledAnswer[] = [];
  let acted = 0;
  let strangers = 0;
  for (const row of rows) {
    if (!admin(row.ownerId)) {
      strangers += 1;
      continue;
    }
    const question = byId.get(row.questionId) ?? null;
    if (question?.acted.includes(row.id)) {
      acted += 1;
      continue;
    }
    unhandled.push({ row, question: question === null ? null : { status: question.status, title: question.title } });
  }
  return { kind: "read", unhandled, total: rows.length, acted, strangers };
}

/** Whether production has the replies table yet. One row, one boolean; the name is a literal, not a parameter. */
export const ANSWERS_DEPLOYED_SQL =
  "select to_regclass('spideryarn.feedback_question_answers') is not null as deployed";

/** What `--answers` says before the deploy that creates the table. Not "no replies": there is nowhere for one to be. */
export const ANSWERS_NOT_DEPLOYED =
  "replies are not deployed to production yet (the feedback_question_answers table is not there), so there are none to act on";

/** Every reply, oldest first. `table` is a parameter only so a test can point it at a copy. */
export function answersSql(table = "spideryarn.feedback_question_answers"): string {
  return `select a.id, a.owner_id, a.question_id, a.body, a.environment, a.created_at
            from ${table} as a
           order by a.created_at, a.owner_id, a.id`;
}

interface StoredAnswer extends QueryResultRow {
  id: string;
  owner_id: string;
  question_id: string;
  body: string;
  environment: string;
  created_at: Date;
}

/** Whether production has the deferrals table yet (plan 261008f). The name is a literal. */
export const DEFERRALS_DEPLOYED_SQL =
  "select to_regclass('spideryarn.feedback_question_deferrals') is not null as deployed";

export const DEFERRALS_NOT_DEPLOYED =
  "deferrals are not deployed to production yet (the feedback_question_deferrals table is not there), so none is in force";

/** Every deferral row, deferred or brought back. `table` is a parameter only so a test can point it at a copy. */
export function deferralsSql(table = "spideryarn.feedback_question_deferrals"): string {
  return `select d.owner_id, d.question_id, d.deferred_at, d.updated_at, d.environment
            from ${table} as d
           order by d.updated_at, d.owner_id, d.question_id`;
}

/** One deferral, as production stores it. */
export interface DeferralRow {
  ownerId: string;
  questionId: string;
  /** Null once brought back. */
  deferredAt: Date | null;
  environment: string;
}

interface StoredDeferral extends QueryResultRow {
  owner_id: string;
  question_id: string;
  deferred_at: Date | null;
  updated_at: Date;
  environment: string;
}

/**
 * **The deferrals in force, held to the replies' rule** (F6): one row from
 * outside production or preview and it cannot tell; a row whose owner is not
 * an administrator is left out and counted. A brought-back row is not in force.
 */
export function classifyDeferrals(
  rows: readonly DeferralRow[],
  admin: (ownerId: string) => boolean = isAdmin,
): { kind: "cannot-tell"; why: string } | { kind: "read"; deferred: DeferralRow[]; strangers: number } {
  if (rows.some((row) => !PRODUCTION_ENVIRONMENTS.includes(row.environment))) {
    return { kind: "cannot-tell", why: "a deferral has an environment that cannot establish it was written in production" };
  }
  const strangers = rows.filter((row) => !admin(row.ownerId)).length;
  return { kind: "read", deferred: rows.filter((row) => admin(row.ownerId) && row.deferredAt !== null), strangers };
}

/** One read-only select against production, and the `Target:` it reached. */
export type ReadProduction = <T extends QueryResultRow>(
  sql: string,
  params: unknown[],
) => Promise<{ target: string; rows: T[] }>;

/**
 * The real reader: `productionClient()`'s guarded connection, one select in
 * `begin read only`, rolled back. Anything but `CannotTell` is reduced to its
 * error code, because a driver's message can carry the connection string.
 */
const readProduction: ReadProduction = async <T extends QueryResultRow>(sql: string, params: unknown[]) => {
  try {
    const { client, target } = productionClient();
    return { target, rows: await readRowsReadOnly<T>(client, sql, params) };
  } catch (error) {
    if (error instanceof CannotTell) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? ` [${code}]` : "";
    throw new CannotTell(`reading production failed${safeCode} (other database details withheld)`);
  }
};

export const REPLY_START = "----- the administrator's reply, from production; every line is quoted with > -----";
export const REPLY_END = "----- end of the reply -----";

/**
 * `--answers`, with the reader and the files handed in. Returns the exit code.
 * Nothing that could be taken for "there are no replies" is printed on the way
 * to a 2.
 */
export async function runAnswers(
  read: ReadProduction,
  files: readonly NoteFile[],
  out: (line: string) => void,
): Promise<number> {
  /* The files before production: an unreadable `acted:` line would print a
     reply somebody has already acted on, or hide one nobody has. */
  const { questions, problems } = compileQuestions(files);
  if (problems.length > 0) {
    out(`${problems.length} question file(s) do not parse, so which replies were acted on cannot be told:`);
    for (const problem of problems) out(`  ${problem}`);
    return 2;
  }
  try {
    const asked = await read<{ deployed: unknown }>(ANSWERS_DEPLOYED_SQL, []);
    const deployed = asked.rows[0]?.deployed;
    if (deployed !== true && deployed !== false) {
      out("production did not say whether the replies table exists");
      return 2;
    }
    if (!deployed) {
      out(`Target: ${asked.target}`);
      out(ANSWERS_NOT_DEPLOYED);
      return 0;
    }
    const { target, rows: stored } = await read<StoredAnswer>(answersSql(), []);
    const verdict = classifyAnswers(
      stored.map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        questionId: row.question_id,
        body: row.body,
        environment: row.environment,
        createdAt: row.created_at,
      })),
      questions,
    );
    if (verdict.kind === "cannot-tell") {
      out(`cannot tell: ${verdict.why}`);
      return 2;
    }
    out(`Target: ${target}`);
    out(
      [
        `${verdict.total} ${verdict.total === 1 ? "reply" : "replies"} in production`,
        `${verdict.acted} already acted on`,
        ...(verdict.strangers > 0
          ? [`${verdict.strangers} from an account that is not an administrator's, left out`]
          : []),
        `${verdict.unhandled.length} to act on.`,
      ].join("; "),
    );
    for (const { row, question } of verdict.unhandled) {
      out("");
      out(
        [
          `reply ${row.id}`,
          row.createdAt.toISOString(),
          `question ${row.questionId}`,
          question === null
            ? "no file for that question in this checkout"
            : `${question.status}  ·  ${question.title}`,
        ].join("  ·  "),
      );
      out(REPLY_START);
      out(renderUntrustedWords(row.body));
      out(REPLY_END);
      out(
        `once acted on: quote it into docs/user-feedback/questions/${row.questionId}.md and add \`acted: ${row.id}\` to its header`,
      );
    }
    /* **Deferrals: "not now, do not chase"** (plan 261008f). Nothing to act
       on, and the question stays open: it is still Greg's to decide. */
    out("");
    const deferralsAsked = await read<{ deployed: unknown }>(DEFERRALS_DEPLOYED_SQL, []);
    const deferralsDeployed = deferralsAsked.rows[0]?.deployed;
    if (deferralsDeployed !== true && deferralsDeployed !== false) {
      out("production did not say whether the deferrals table exists");
      return 2;
    }
    if (!deferralsDeployed) {
      out(DEFERRALS_NOT_DEPLOYED);
      return 0;
    }
    const { rows: deferralRows } = await read<StoredDeferral>(deferralsSql(), []);
    const deferrals = classifyDeferrals(
      deferralRows.map((row) => ({
        ownerId: row.owner_id,
        questionId: row.question_id,
        deferredAt: row.deferred_at,
        environment: row.environment,
      })),
    );
    if (deferrals.kind === "cannot-tell") {
      out(`cannot tell: ${deferrals.why}`);
      return 2;
    }
    out(
      `${deferrals.deferred.length} question(s) deferred by an administrator: not now, do not chase; each stays open` +
        (deferrals.strangers > 0 ? `; ${deferrals.strangers} row(s) from an account that is not an administrator's, left out` : "") +
        ".",
    );
    for (const row of deferrals.deferred) {
      out(`${row.questionId}  ·  deferred ${row.deferredAt?.toISOString() ?? ""}`);
    }
    return 0;
  } catch (error) {
    out(error instanceof CannotTell ? error.message : "reading production failed unexpectedly (details withheld)");
    return 2;
  }
}

/** The ids `questions/` already has a file for, by file name: a file that does not parse still holds its id. */
function takenIds(dir: string = QUESTIONS_DIR): Set<string> {
  try {
    return new Set(readdirSync(dir).map((name) => name.replace(/\.md$/, "")));
  } catch {
    return new Set();
  }
}

/** `yyyy-mm-dd` in local time, as scripts/plan-name.ts dates a plan: the day the question was asked. */
function today(when: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
}

/**
 * **`--new`: where a new question goes, and what it starts as.** Like
 * scripts/plan-name.ts it answers and creates nothing, so asking twice costs
 * nothing. The skeleton parses as it stands; replace the last line with the
 * question, shaped as docs/reusable/ask-me-questions.md says.
 */
export function newQuestion(
  title: string,
  taken: ReadonlySet<string>,
  when: Date = new Date(),
  random?: () => number,
): { path: string; text: string } {
  const line = title.trim();
  if (line === "" || line.length > MAX_FEEDBACK_QUESTION_TITLE_CHARS || /[\r\n]/.test(line)) {
    throw new Error(`a title is one line of at most ${MAX_FEEDBACK_QUESTION_TITLE_CHARS} characters`);
  }
  let id = mintFeedbackQuestionId(random);
  for (let attempt = 0; taken.has(id); attempt++) {
    if (attempt >= 1000) throw new Error("could not mint a question id that is not taken");
    id = mintFeedbackQuestionId(random);
  }
  return {
    path: `docs/user-feedback/questions/${id}.md`,
    text: [
      "---",
      `id: ${id}`,
      "report: none",
      "status: open",
      `asked: ${today(when)}`,
      `title: ${line}`,
      "refs: <queue item, plan path, note path, Sentry short id; for agents, never shown>",
      "---",
      "<the question in one plain sentence; each option on its own lettered line with what it costs and gives up; the recommendation>",
      "",
      /* Above this line, what Greg answers from; below it, shut in the dialog
         until he opens it (feedback-reports.md § To ask; spya-za2tse). */
      QUESTION_DETAILS_LINE,
      "",
      "<for someone who has forgotten the report and never read the code: what it asked and when, what was done, what each option means, what would decide it>",
      "",
    ].join("\n"),
  };
}

/** The open questions, oldest first: one summary line, then one line each. No bodies. */
export function renderOpenQuestions(questions: readonly QuestionFile[]): string[] {
  const open = questions
    .filter((question) => question.status === "open")
    .sort((a, b) => (a.asked === b.asked ? (a.id < b.id ? -1 : 1) : a.asked < b.asked ? -1 : 1));
  return [
    `${open.length} open question(s) for Greg in docs/user-feedback/questions/ (${questions.length - open.length} answered).`,
    ...open.map((question) =>
      [
        question.id,
        question.asked,
        question.report === null ? "about no report" : `about ${question.report}`,
        question.title,
        ...(question.acted.length > 0 ? [`acted on ${question.acted.length} reply(ies)`] : []),
      ].join("  ·  "),
    ),
  ];
}

/**
 * **Reports whose note says they wait on Greg, with no open question asking
 * him anything.** The admin's *Needs a decision* view draws these under a
 * heading that says no question has been written yet, and this listing is
 * where the sweep finds them to write one. Until 2026-10-08 they were drawn as
 * rows with nothing to press (`spya-u6h6q8`, plan 261008f § The bug). Ids
 * sorted, so the output is stable.
 */
export function waitingWithoutQuestion(
  endings: ReadonlyMap<string, FeedbackEnding>,
  questions: readonly QuestionFile[],
): string[] {
  const asked = new Set(
    questions.filter((question) => question.status === "open").flatMap((question) => question.report ?? []),
  );
  return [...endings]
    .filter(([id, ending]) => ending === "awaiting" && !asked.has(id))
    .map(([id]) => id)
    .sort();
}

/**
 * The listing's third section: split reports with a part no note covers. Not
 * Greg's to decide and not shipped; Open on his tab until an agent writes the
 * missing note, or adds the report to the header of the note that already
 * covers that part (plan 261008f, F1).
 */
export function renderIncompleteSplits(ids: readonly string[]): string[] {
  if (ids.length === 0) return ["Every split report has a note for each of its parts."];
  return [
    `${ids.length} split report(s) with a part no note covers yet:`,
    ...ids.map((id) => `${id}  ·  write the missing part's note, or name ${id} in the note that covers it`),
  ];
}

/** The listing's second section: say there are none, or name each with what to do. */
export function renderWaitingWithoutQuestion(ids: readonly string[]): string[] {
  if (ids.length === 0) return ["Every report waiting on Greg has an open question."];
  return [
    `${ids.length} report(s) wait on Greg with no open question: Greg sees them under Needs a decision with nothing to answer.`,
    ...ids.map((id) => `${id}  ·  write its question (--new), or correct its note's ending`),
  ];
}

type Command =
  | { kind: "list" }
  | { kind: "answers" }
  | { kind: "new"; title: string }
  | { kind: "show"; id: string };

const USAGE = 'usage: feedback-questions.ts [--answers | --new "<title>" | --show q-xxxxxx]';

export function parseCommand(argv: readonly string[]): Command {
  const [flag, value, ...rest] = argv;
  if (flag === undefined) return { kind: "list" };
  if (flag === "--answers" && value === undefined) return { kind: "answers" };
  if (flag === "--new" && value !== undefined && rest.length === 0) return { kind: "new", title: value };
  /* The id Greg reads off the dialog, so he and a terminal name the same thing (spya-krvuc9). */
  if (flag === "--show" && isFeedbackQuestionId(value) && rest.length === 0) return { kind: "show", id: value };
  throw new Error(USAGE);
}

async function main(argv: readonly string[]): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  switch (command.kind) {
    case "answers":
      return runAnswers(readProduction, readQuestionFiles(), (line) => console.log(line));
    case "new": {
      try {
        const made = newQuestion(command.title, takenIds());
        console.log(made.path);
        console.log("");
        console.log(made.text);
        return 0;
      } catch (error) {
        console.error((error as Error).message);
        return 2;
      }
    }
    case "show": {
      /* The file as written, `refs:` included: this is the agent's side. */
      const file = readQuestionFiles().find((one) => one.name === `${command.id}.md`);
      if (file === undefined) {
        console.error(`no file docs/user-feedback/questions/${command.id}.md in this checkout`);
        return 2;
      }
      console.log(`docs/user-feedback/questions/${file.name}`);
      console.log("");
      console.log(file.text);
      return 0;
    }
    case "list": {
      const { questions, problems } = compileQuestions(readQuestionFiles());
      if (problems.length > 0) {
        console.error(`${problems.length} question file(s) do not parse:\n  ${problems.join("\n  ")}`);
        return 2;
      }
      const notes = compileEndings(readNotes());
      if (notes.problems.length > 0) {
        console.error(`${notes.problems.length} note header(s) do not parse:\n  ${notes.problems.join("\n  ")}`);
        return 2;
      }
      for (const line of renderOpenQuestions(questions)) console.log(line);
      console.log("");
      for (const line of renderWaitingWithoutQuestion(waitingWithoutQuestion(notes.endings, questions))) {
        console.log(line);
      }
      console.log("");
      for (const line of renderIncompleteSplits(notes.incomplete)) console.log(line);
      return 0;
    }
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

/* Run only when run, so the test can import without the process exiting under it. */
if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
