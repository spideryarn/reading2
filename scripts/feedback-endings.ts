/**
 * **Compile the feedback notes' endings into a map the server can import.**
 *
 *     npx tsx scripts/feedback-endings.ts           # rewrite both generated files
 *     npx tsx scripts/feedback-endings.ts --check   # exit 1 if either is out of date
 *
 * Every report ends in a note under docs/user-feedback/ naming one of three
 * endings (docs/project/feedback-reports.md § Three ways a report ends). A note
 * may start with a header saying which report rows it records and how it
 * ended:
 *
 *     ---
 *     reports: spya-bfcvxg
 *     ending: shipped
 *     ---
 *
 * `reports` is the feedback row id (the Sentry issue's `report_id` tag),
 * comma-separated for a note recording several, or `none` for a report that
 * never had one. `ending` is the note's *current* ending. `parts: N` goes on
 * each note of a report split into N queue entries. `comment:` is one line of
 * plain text, at most 240 characters, for the person who filed it: why it was
 * set aside, what the open question is, or which half is still queued. An
 * admin's Earlier tab shows it under the report
 * (docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md).
 *
 * This reads those headers and writes one line per report. The server imports
 * the result, so a report counts as shipped **in the build that carries its
 * note** — on production, only once the commit carrying the note has been
 * deployed, which is the "deployed" half of what Greg asked for.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 *
 * Run it after writing or changing a note's header. tests/feedback-endings.test.ts
 * goes red when the committed map and the headers disagree, or a header does
 * not parse. A note with no header is left out, so its report reads as not
 * shipped — the safe direction. If shipped work is later reverted, edit its
 * note's header back. On a merge conflict in the generated file, merge the
 * notes and re-run this; never pick a side.
 *
 * ## And the questions for Greg
 *
 * The same command compiles `docs/user-feedback/questions/q-*.md`, one
 * question a file, into src/feedback-questions.generated.ts: every question id
 * with its status, and the title, report, date and body of the open ones. An
 * admin's Earlier tab shows the open ones, and Greg replies there. **A question
 * file that does not parse fails this command and the test**; it is never
 * left out quietly, because a question nobody sees is the failure the files
 * exist to end. The format is `parseQuestionFile`'s, and
 * docs/project/feedback-reports.md § Asking Greg a question says how to use it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FEEDBACK_ENDINGS,
  MAX_FEEDBACK_COMMENT_CHARS,
  type FeedbackEnding,
} from "../src/feedback-ending-values.js";
import {
  type CompiledFeedbackQuestion,
  FEEDBACK_QUESTION_STATUSES,
  type FeedbackQuestionStatus,
  isFeedbackQuestionId,
  MAX_FEEDBACK_QUESTION_BODY_CHARS,
  MAX_FEEDBACK_QUESTION_TITLE_CHARS,
  QUESTION_DETAILS_LINE,
} from "../src/feedback-question-values.js";
import { isSpideryarnId } from "../src/ids.js";
import { isMain } from "../src/is-main.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NOTES_DIR = path.join(ROOT, "docs/user-feedback");
export const GENERATED_PATH = path.join(ROOT, "src/feedback-endings.generated.ts");
/** One question for Greg a file. A directory, so `readNotes` (which reads `*.md` beside it) never sees one. */
export const QUESTIONS_DIR = path.join(NOTES_DIR, "questions");
export const QUESTIONS_GENERATED_PATH = path.join(ROOT, "src/feedback-questions.generated.ts");

/** Files in docs/user-feedback/ that are not one report's note. */
const NOT_A_NOTE = new Set(["awaiting-approval.md"]);

const HEADER_FIELDS = new Set(["reports", "ending", "parts", "comment"]);

export interface NoteHeader {
  /** Empty for `reports: none` — a report that never had a row id. */
  reports: string[];
  ending: FeedbackEnding;
  /** How many queue entries (so notes) a split report became; absent when it was not split. */
  parts?: number;
  /** One line of plain text for the report's own row in the Earlier tab; absent when the note has none. */
  comment?: string;
}

/**
 * The `---` block at the top of a file as `name: value` lines, and what
 * follows it. One reader for a note's header and a question's, so the two
 * cannot drift on what a line or a duplicate is. A sentence when it is wrong.
 */
function readHeaderFields(
  text: string,
  known: ReadonlySet<string>,
): { fields: Map<string, string>; rest: string } | string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) return "the header's `---` block is never closed";
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (!pair?.[1]) return `unreadable header line: ${JSON.stringify(line)}`;
    if (fields.has(pair[1])) return `duplicate header field: ${pair[1]}`;
    fields.set(pair[1], (pair[2] ?? "").trim());
  }
  const unknown = [...fields.keys()].filter((key) => !known.has(key));
  if (unknown.length > 0) return `unknown header field(s): ${unknown.join(", ")}`;
  return { fields, rest: text.slice(match[0].length) };
}

/**
 * The header at the very top of a note; `null` when the note has none (it is
 * then simply not in the map, so its report reads as not shipped); or a
 * sentence saying what is wrong with it — a string rather than a throw so the
 * test can list every bad note at once.
 */
export function parseNoteHeader(text: string): NoteHeader | null | string {
  if (!text.startsWith("---\n")) return null;
  const read = readHeaderFields(text, HEADER_FIELDS);
  if (typeof read === "string") return read;
  const { fields } = read;

  const ending = fields.get("ending");
  if (!FEEDBACK_ENDINGS.some((known) => known === ending)) {
    return `ending must be one of ${FEEDBACK_ENDINGS.join(" | ")}, not ${JSON.stringify(ending)}`;
  }
  const named = fields.get("reports") ?? "";
  const reports =
    named === "none"
      ? []
      : named
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== "");
  if (named !== "none" && reports.length === 0) {
    return "reports: names no report id (write `none` if the report never had one)";
  }
  /* The one id rule, src/ids.ts: what the database's CHECK holds a row to. */
  const bad = reports.filter((id) => !isSpideryarnId(id));
  if (bad.length > 0) return `not a report id: ${bad.join(", ")}`;
  const repeated = reports.filter((id, index) => reports.indexOf(id) !== index);
  if (repeated.length > 0) return `report id named more than once: ${[...new Set(repeated)].join(", ")}`;

  const header: NoteHeader = { reports, ending: ending as FeedbackEnding };
  const parts = fields.get("parts");
  if (parts !== undefined) {
    if (!/^[2-9]$/.test(parts)) {
      return `parts must be a number from 2 to 9, not ${JSON.stringify(parts)}`;
    }
    if (reports.length !== 1) {
      return "parts: only a note recording exactly one report can say it was split";
    }
    header.parts = Number(parts);
  }
  const comment = fields.get("comment");
  if (comment !== undefined) {
    const problem = commentProblem(comment);
    if (problem !== null) return problem;
    header.comment = comment;
  }
  return header;
}

/** What is wrong with a `comment:` value, or null. One line is the header's own rule; this is the rest. */
function commentProblem(comment: string): string | null {
  if (comment === "") return "comment: says nothing (leave the line out instead)";
  if (comment.length > MAX_FEEDBACK_COMMENT_CHARS) {
    return `comment must be at most ${MAX_FEEDBACK_COMMENT_CHARS} characters, not ${comment.length}`;
  }
  return null;
}

/**
 * **One report's status from all the notes that name it.** A report split into
 * several queue entries gets one note per entry, and a part still waiting on
 * Greg keeps the whole report from reading as shipped. Shipped when any part
 * shipped, since the label claims a change went out; declined only when every
 * note declined it.
 *
 * **Null when a part has no note yet** (fewer notes than `parts`, and none
 * waiting on Greg): not ended, so not shipped, and not waiting on a decision
 * either. It said `awaiting` until 2026-10-08, which put spya-thpsnd under
 * *Needs a decision* with nothing for Greg to answer, when what was owed was
 * an agent's note (plan 261008i, F1). The admin tab shows it as Open.
 */
export function combineEndings(
  notes: readonly { ending: FeedbackEnding; parts?: number }[],
): FeedbackEnding | null {
  const endings = notes.map((note) => note.ending);
  const expected = Math.max(1, ...notes.map((note) => note.parts ?? 1));
  if (endings.includes("awaiting")) return "awaiting";
  if (notes.length < expected) return null;
  if (endings.includes("shipped")) return "shipped";
  return "declined";
}

/**
 * **Which note speaks for a report with several**, mirroring `combineEndings`
 * case by case so the comment is about the status the row shows. `notes` is
 * oldest first (file names sort by the day the work started), so "newest" is
 * last. The newest note that says awaiting; otherwise, for a split report with
 * a part not yet written up, the newest note declaring the most parts;
 * otherwise the newest shipped note of a shipped report; otherwise the newest
 * declined one. **That note's comment or none**: another note's words are
 * about a different part, so they are not borrowed.
 */
export function chooseComment(
  notes: readonly { ending: FeedbackEnding; parts?: number; comment?: string }[],
): string | undefined {
  const newest = (keep: (note: (typeof notes)[number]) => boolean) => notes.filter(keep).at(-1);
  const expected = Math.max(1, ...notes.map((note) => note.parts ?? 1));
  const chosen =
    newest((note) => note.ending === "awaiting") ??
    (notes.length < expected
      ? newest((note) => (note.parts ?? 1) === expected)
      : (newest((note) => note.ending === "shipped") ?? newest((note) => note.ending === "declined")));
  return chosen?.comment;
}

export interface NoteFile {
  name: string;
  text: string;
}

export function readNotes(dir: string = NOTES_DIR): NoteFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !NOT_A_NOTE.has(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
}

export interface CompiledEndings {
  endings: Map<string, FeedbackEnding>;
  /** The one comment each report shows (`chooseComment`); a report with none is not a key. */
  comments: Map<string, string>;
  /**
   * Split reports with a part that has no note yet: in no ending, so Open on
   * the admin tab, and listed by `feedback-questions.ts` as an agent's to finish.
   */
  incomplete: string[];
  /** `file: problem`, one per note whose header does not parse. A note with no header is not one. */
  problems: string[];
}

export function compileEndings(notes: readonly NoteFile[]): CompiledEndings {
  const byReport = new Map<string, NoteHeader[]>();
  const problems: string[] = [];
  for (const note of notes) {
    const header = parseNoteHeader(note.text);
    if (header === null) continue;
    if (typeof header === "string") {
      problems.push(`${note.name}: ${header}`);
      continue;
    }
    for (const id of header.reports) {
      byReport.set(id, [...(byReport.get(id) ?? []), header]);
    }
  }
  const endings = new Map<string, FeedbackEnding>();
  const comments = new Map<string, string>();
  const incomplete: string[] = [];
  for (const id of [...byReport.keys()].sort()) {
    const notesOfIt = byReport.get(id) ?? [];
    const ending = combineEndings(notesOfIt);
    if (ending === null) incomplete.push(id);
    else endings.set(id, ending);
    const comment = chooseComment(notesOfIt);
    if (comment !== undefined) comments.set(id, comment);
  }
  return { endings, comments, incomplete, problems };
}

/**
 * The generated module's text: sorted, one report per line, so merges rarely
 * touch. **Two maps, and the first is unchanged since 260930e**: the deploy's
 * shipped-email step reads this file as it was at a commit
 * (scripts/feedback-shipped-emails.ts § `shippedIdsIn`), so the endings keep
 * their shape and the comments sit beside them, each one JSON string.
 */
export function renderModule(
  endings: ReadonlyMap<string, FeedbackEnding>,
  comments: ReadonlyMap<string, string> = new Map(),
): string {
  const lines = [...endings].map(([id, ending]) => `  "${id}": "${ending}",`);
  const commentLines = [...comments].map(([id, comment]) => `  "${id}": ${JSON.stringify(comment)},`);
  return [
    "/**",
    " * GENERATED by scripts/feedback-endings.ts from the headers of the notes in",
    " * docs/user-feedback/ — do not edit by hand; re-run the script. On a merge",
    " * conflict here, merge the notes and re-run it; never pick a side.",
    " * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.",
    " */",
    'import type { FeedbackEnding } from "./feedback-ending-values.js";',
    "",
    "export const FEEDBACK_NOTE_ENDINGS: Readonly<Record<string, FeedbackEnding>> = {",
    ...lines,
    "};",
    "",
    "/** One line about a report, from its note's `comment:`. An admin's Earlier tab only. */",
    "export const FEEDBACK_NOTE_COMMENTS: Readonly<Record<string, string>> = {",
    ...commentLines,
    "};",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------ questions -- */

const QUESTION_FIELDS = new Set(["id", "report", "status", "asked", "title", "refs", "acted"]);
const QUESTION_REQUIRED = ["id", "report", "status", "asked", "title"] as const;

/** One question file, whole: what the dialog shows and what only agents read. */
export interface QuestionFile extends CompiledFeedbackQuestion {
  status: FeedbackQuestionStatus;
  /** One line for agents: queue item, plan, note, Sentry id. **Never compiled, never sent.** */
  refs?: string;
  /** The ids of Greg's answers an agent has already acted on (`feedback-questions.ts --answers`). */
  acted: string[];
}

/** A real calendar day written `yyyy-mm-dd`. */
function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * **One question file, or a sentence saying what is wrong with it.** Never
 * null: unlike a note, a file in `questions/` with no header is a mistake.
 *
 *     ---
 *     id: q-k3m9qt
 *     report: spya-n8cuqq
 *     status: open
 *     asked: 2026-10-07
 *     title: Should Feedback take fifteen minutes of speech?
 *     refs: qi-8qvg5gwv docs/plans/261007b-….md
 *     acted: spya-bbbbbb
 *     ---
 *     The background, each option on its own lettered line, the recommendation.
 *
 * `id` is the file's name. `report` is one report id or `none`. `refs` and
 * `acted` are optional. The body is plain text: the dialog draws it as text
 * with its line breaks, and renders no markdown.
 */
export function parseQuestionFile(name: string, text: string): QuestionFile | string {
  if (!text.startsWith("---\n")) return "a question file starts with a `---` header";
  const read = readHeaderFields(text, QUESTION_FIELDS);
  if (typeof read === "string") return read;
  const { fields } = read;
  const missing = QUESTION_REQUIRED.filter((field) => (fields.get(field) ?? "") === "");
  if (missing.length > 0) return `missing header field(s): ${missing.join(", ")}`;

  const id = fields.get("id") ?? "";
  if (!isFeedbackQuestionId(id)) {
    return `id must be q- and six characters of a report id's alphabet, not ${JSON.stringify(id)}`;
  }
  if (name !== `${id}.md`) return `the file must be named for its id: ${id}.md`;
  const status = FEEDBACK_QUESTION_STATUSES.find((known) => known === fields.get("status"));
  if (status === undefined) {
    return `status must be one of ${FEEDBACK_QUESTION_STATUSES.join(" | ")}, not ${JSON.stringify(fields.get("status"))}`;
  }
  const asked = fields.get("asked") ?? "";
  if (!isCalendarDay(asked)) return `asked must be a date written yyyy-mm-dd, not ${JSON.stringify(asked)}`;
  const named = fields.get("report") ?? "";
  if (named !== "none" && !isSpideryarnId(named)) {
    return `report must be one report id or \`none\`, not ${JSON.stringify(named)}`;
  }
  const title = fields.get("title") ?? "";
  if (title.length > MAX_FEEDBACK_QUESTION_TITLE_CHARS) {
    return `title must be at most ${MAX_FEEDBACK_QUESTION_TITLE_CHARS} characters, not ${title.length}`;
  }
  const acted = (fields.get("acted") ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  const notAnswers = acted.filter((one) => !isSpideryarnId(one));
  if (notAnswers.length > 0) return `acted names something that is not an answer id: ${notAnswers.join(", ")}`;
  const body = read.rest.trim();
  if (body === "") return "the body says nothing: a question needs its background and options";
  if (body.length > MAX_FEEDBACK_QUESTION_BODY_CHARS) {
    return `the body must be at most ${MAX_FEEDBACK_QUESTION_BODY_CHARS} characters, not ${body.length}`;
  }
  /* The dialog shuts everything after the first such line: a second would be
     a heading inside the details that reads as a split nobody gets (261008i). */
  if (body.split("\n").filter((line) => line === QUESTION_DETAILS_LINE).length > 1) {
    return `the body may have at most one line that is exactly \`${QUESTION_DETAILS_LINE}\``;
  }
  const refs = fields.get("refs");
  return {
    id,
    report: named === "none" ? null : named,
    status,
    asked,
    title,
    ...(refs === undefined || refs === "" ? {} : { refs }),
    acted,
    body,
  };
}

/** Every file in `questions/`, whatever its name: one that is not a question is a problem, not a skip. */
export function readQuestionFiles(dir: string = QUESTIONS_DIR): NoteFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
}

export function compileQuestions(files: readonly NoteFile[]): { questions: QuestionFile[]; problems: string[] } {
  const questions: QuestionFile[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const parsed = parseQuestionFile(file.name, file.text);
    if (typeof parsed === "string") {
      problems.push(`${file.name}: ${parsed}`);
    } else if (questions.some((known) => known.id === parsed.id)) {
      problems.push(`${file.name}: question id named more than once: ${parsed.id}`);
    } else {
      questions.push(parsed);
    }
  }
  questions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { questions, problems };
}

/**
 * The questions module's text. **Every id with its status** (a reply to an
 * answered question is still accepted, plan 261007d F14), and **the words of
 * the open ones only**: `refs` is never written here, so it cannot reach the
 * server's answer. Each open question's `acted` ids are, in a map of their
 * own, which the server reads to decide whether Greg's reply is still being
 * considered and never sends (plan 261008i, decision 1).
 */
export function renderQuestionsModule(questions: readonly QuestionFile[]): string {
  const open = questions
    .filter((question) => question.status === "open")
    /* Oldest first: the order they were asked in, and stable under a new file. */
    .sort((a, b) => (a.asked === b.asked ? (a.id < b.id ? -1 : 1) : a.asked < b.asked ? -1 : 1));
  return [
    "/**",
    " * GENERATED by scripts/feedback-endings.ts from docs/user-feedback/questions/",
    " * — do not edit by hand; re-run the script. On a merge conflict here, merge",
    " * the question files and re-run it; never pick a side.",
    " * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.",
    " */",
    'import type { CompiledFeedbackQuestion, FeedbackQuestionStatus } from "./feedback-question-values.js";',
    "",
    "/** Every question there has been, open or answered. The server only. */",
    "export const FEEDBACK_QUESTION_STATUS: Readonly<Record<string, FeedbackQuestionStatus>> = {",
    ...questions.map((question) => `  "${question.id}": "${question.status}",`),
    "};",
    "",
    "/** The open ones, oldest first, as an admin's Earlier tab shows them. */",
    "export const FEEDBACK_OPEN_QUESTIONS: readonly CompiledFeedbackQuestion[] = [",
    ...open.map(
      ({ id, title, report, asked, body }) =>
        `  { id: "${id}", title: ${JSON.stringify(title)}, report: ${report === null ? "null" : `"${report}"`}, asked: "${asked}", body: ${JSON.stringify(body)} },`,
    ),
    "];",
    "",
    "/** Each open question's replies an agent has acted on, by id. The server only: never sent. */",
    "export const FEEDBACK_QUESTION_ACTED: Readonly<Record<string, readonly string[]>> = {",
    ...open.map((question) => `  "${question.id}": [${question.acted.map((one) => `"${one}"`).join(", ")}],`),
    "};",
    "",
  ].join("\n");
}

/**
 * Put one rendered module at `generatedPath`. A missing file is stale, not an
 * error: this is the command that must be able to recreate it. `--check` still
 * refuses either missing or different output without writing.
 */
export function syncGenerated(
  text: string,
  generatedPath: string = GENERATED_PATH,
  check = false,
): "unchanged" | "written" | "stale" {
  const current = existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : null;
  if (current === text) return "unchanged";
  if (check) return "stale";
  writeFileSync(generatedPath, text);
  return "written";
}

function main(): void {
  const { endings, comments, problems } = compileEndings(readNotes());
  if (problems.length > 0) {
    console.error(`${problems.length} note header(s) do not parse:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const asked = compileQuestions(readQuestionFiles());
  if (asked.problems.length > 0) {
    console.error(`${asked.problems.length} question file(s) do not parse:\n  ${asked.problems.join("\n  ")}`);
    process.exit(1);
  }
  const checking = process.argv.includes("--check");
  /* Both files, each on its own: one being current says nothing of the other. */
  const outcomes = [
    {
      file: "src/feedback-endings.generated.ts",
      what: `${endings.size} reports`,
      outcome: syncGenerated(renderModule(endings, comments), GENERATED_PATH, checking),
    },
    {
      file: "src/feedback-questions.generated.ts",
      what: `${asked.questions.length} questions`,
      outcome: syncGenerated(renderQuestionsModule(asked.questions), QUESTIONS_GENERATED_PATH, checking),
    },
  ];
  const stale = outcomes.filter((one) => one.outcome === "stale");
  if (stale.length > 0) {
    console.error(`${stale.map((one) => one.file).join(" and ")} out of date: npx tsx scripts/feedback-endings.ts`);
    process.exit(1);
  }
  for (const { file, what, outcome } of outcomes) {
    console.log(
      checking
        ? `✓ ${what}, up to date`
        : outcome === "unchanged"
          ? `✓ ${what}, unchanged`
          : `✓ wrote ${what} to ${file}`,
    );
  }
}

if (isMain(import.meta.url)) main();
