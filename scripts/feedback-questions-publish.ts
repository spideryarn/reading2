/**
 * **Publish question files to `feedback_questions`**, so an admin sees them in
 * *Needs a decision* the next time the Feedback dialog opens, with no deploy —
 * `npx tsx scripts/feedback-questions.ts --publish q-xxxxxx` (or `--all`),
 * `--local` for the local database. docs/plans/261021h-agent-questions-reach-needs-a-decision-without-a-deploy.md.
 *
 * > that way then you can always be sure that anything you've submitted there
 * > is going to be live to me immediately. And that if there's something
 * > blocking the deploy, you can alert me before the deploy has happened
 * >
 * > — Greg, 2026-10-21
 *
 * ## The one write
 *
 * The only statement here that changes anything is `PUBLISH_SQL`: a fixed,
 * parameterised insert into `spideryarn.feedback_questions`, updating the row
 * of the same id. Nothing else is written, nothing is ever deleted, and no
 * table or SQL comes from the caller. That is what this code guarantees; the
 * production credential could do more, and a restricted login was passed over
 * as a new secret to hold on every machine (plan 261021h, Sol's F5).
 *
 * **Every file parses first**, or nothing is written (exit 2): a file that
 * does not parse may be the one somebody meant to publish.
 *
 * **A row never moves backwards** (Sol's F2): an `answered` row is not set
 * `open` again, and an `acted` id once published is not dropped. Either is a
 * checkout older than what was published, and is refused and named (exit 1);
 * to ask again, write a new question. Older wording is not detected; the drift
 * lines in `--answers` show it.
 */
import pg from "pg";

import { isLocalDatabaseUrl } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import type { PublishedFeedbackQuestion } from "../src/feedback-question-values.js";
import { compileQuestions, type NoteFile, publishedRow } from "./feedback-endings.js";
import { CannotTell, productionClient } from "./feedback-reporter.js";

/** Which database a command reaches. Production unless `--local`. */
export type QuestionsTarget = "production" | "local";

/**
 * **A connection to the target, and the `Target:` line naming it.** Local
 * means a URL `isLocalDatabaseUrl` accepts and nothing else, checked before
 * connecting (Sol's F6); production is `productionClient()`'s verified one.
 */
export function questionsClient(target: QuestionsTarget): { client: pg.Client; target: string } {
  if (target === "production") return productionClient();
  loadEnvLocal();
  const url = process.env.DATABASE_URL ?? "";
  /* The URL itself is never printed: it carries a password. */
  if (!isLocalDatabaseUrl(url)) throw new CannotTell("--local, but DATABASE_URL is not a local database");
  const host = new URL(url);
  return { client: new pg.Client({ connectionString: url }), target: `.env.local → ${host.hostname}:${host.port} (local)` };
}

/** Whether the table is there yet. The name is a literal, not a parameter. */
export const QUESTIONS_DEPLOYED_SQL =
  "select to_regclass('spideryarn.feedback_questions') is not null as deployed";

const COLUMNS = "id, title, report, repeats, asked, body, status, acted";

/** Every published row: what `--answers` compares the files with. */
export const PUBLISHED_ROWS_SQL = `select ${COLUMNS} from spideryarn.feedback_questions order by id`;

/** The rows about to be written, locked, so the comparison and the write are one moment. */
export const LOCK_ROWS_SQL = `select ${COLUMNS} from spideryarn.feedback_questions where id = any($1::text[]) for update`;

/**
 * **The one write.** The `where` repeats the never-backwards rule, so a row
 * that changed between the lock and here still cannot regress.
 */
export const PUBLISH_SQL = `insert into spideryarn.feedback_questions as q (${COLUMNS})
     values ($1, $2, $3, $4::text[], $5, $6, $7, $8::text[])
  on conflict (id) do update
        set title = excluded.title, report = excluded.report, repeats = excluded.repeats,
            asked = excluded.asked, body = excluded.body, status = excluded.status,
            acted = excluded.acted, updated_at = now()
      where not (q.status = 'answered' and excluded.status = 'open')
        and q.acted <@ excluded.acted`;

export type PublishStep =
  | { id: string; kind: "insert" | "update" | "unchanged" }
  | { id: string; kind: "refused"; why: string };

function same(a: PublishedFeedbackQuestion, b: PublishedFeedbackQuestion): boolean {
  return (
    a.title === b.title &&
    a.report === b.report &&
    a.asked === b.asked &&
    a.body === b.body &&
    a.status === b.status &&
    a.repeats.join(",") === b.repeats.join(",") &&
    a.acted.join(",") === b.acted.join(",")
  );
}

/** **What publishing these would do to these rows.** No I/O, so a test holds every branch. */
export function planPublish(
  files: readonly PublishedFeedbackQuestion[],
  rows: readonly PublishedFeedbackQuestion[],
): PublishStep[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return files.map((file): PublishStep => {
    const row = byId.get(file.id);
    if (row === undefined) return { id: file.id, kind: "insert" };
    if (same(file, row)) return { id: file.id, kind: "unchanged" };
    if (row.status === "answered" && file.status === "open") {
      return { id: file.id, kind: "refused", why: "the published row is answered and this file says open" };
    }
    const dropped = row.acted.filter((one) => !file.acted.includes(one));
    if (dropped.length > 0) {
      return { id: file.id, kind: "refused", why: `the published row records acted ${dropped.join(", ")}, which this file lacks` };
    }
    return { id: file.id, kind: "update" };
  });
}

/** **Files whose row is missing or differs, and rows with no file** — the drift `--answers` prints. */
export function questionDrift(
  files: readonly PublishedFeedbackQuestion[],
  rows: readonly PublishedFeedbackQuestion[],
): { unpublished: string[]; differs: string[]; noFile: string[] } {
  const steps = planPublish(files, rows);
  const named = new Set(files.map((file) => file.id));
  return {
    unpublished: steps.filter((step) => step.kind === "insert").map((step) => step.id),
    differs: steps.filter((step) => step.kind === "update" || step.kind === "refused").map((step) => step.id),
    noFile: rows.filter((row) => !named.has(row.id)).map((row) => row.id),
  };
}

interface StoredQuestion extends pg.QueryResultRow {
  id: string;
  title: string;
  report: string | null;
  repeats: string[];
  asked: string;
  body: string;
  status: string;
  acted: string[];
}

export function fromStored(row: StoredQuestion): PublishedFeedbackQuestion {
  const status = row.status === "answered" ? "answered" : "open";
  return { ...row, status };
}

/** The four statements a publish may issue, and only these (a test holds it). */
export type PublishClient = Pick<pg.Client, "connect" | "query" | "end">;

/** `--publish`'s choice: every file, or these ids. */
export type PublishWhich = { all: true } | { ids: readonly string[] };

/**
 * **`--publish`.** Returns the exit code: 0 published or already so, 1 when a
 * question was refused (the others are still written), 2 when publishing could
 * not be confirmed. Lines go to `out`; no question's words are printed.
 */
export async function runPublish(
  connect: () => { client: PublishClient; target: string },
  files: readonly NoteFile[],
  which: PublishWhich,
  out: (line: string) => void,
): Promise<number> {
  const { questions, problems } = compileQuestions(files);
  if (problems.length > 0) {
    out(`${problems.length} question file(s) do not parse, so nothing is published:`);
    /* Parser diagnostics can quote malformed header values, including a
       credential pasted into the wrong field. Name the file, not its words. */
    for (const problem of problems) out(`  ${JSON.stringify(problem.split(": ", 1)[0])}: does not parse (file contents withheld)`);
    return 2;
  }
  const chosen = "all" in which ? questions : questions.filter((question) => which.ids.includes(question.id));
  if (!("all" in which)) {
    const missing = which.ids.filter((id) => !questions.some((question) => question.id === id));
    if (missing.length > 0) {
      out(`no file in docs/user-feedback/questions/ for ${missing.join(", ")}: nothing is published`);
      return 2;
    }
  }
  const rows = chosen.map(publishedRow);
  let client: PublishClient;
  let target: string;
  try {
    ({ client, target } = connect());
  } catch (error) {
    out(error instanceof CannotTell ? error.message : "could not connect (details withheld)");
    return 2;
  }
  try {
    await client.connect();
    const deployed = (await client.query<{ deployed: boolean }>(QUESTIONS_DEPLOYED_SQL)).rows[0]?.deployed;
    if (deployed !== true) {
      out(`Target: ${target}`);
      out("the feedback_questions table is not there: apply its migration first (npm run db:migrate); nothing is published");
      return 2;
    }
    await client.query("begin");
    let steps: PublishStep[];
    try {
      const locked = await client.query<StoredQuestion>(LOCK_ROWS_SQL, [rows.map((row) => row.id)]);
      steps = planPublish(rows, locked.rows.map(fromStored));
      for (const [index, step] of steps.entries()) {
        if (step.kind !== "insert" && step.kind !== "update") continue;
        const row = rows.find((one) => one.id === step.id);
        if (row === undefined) throw new Error("planned question has no file");
        const written = await client.query(PUBLISH_SQL, [
          row.id,
          row.title,
          row.report,
          [...row.repeats],
          row.asked,
          row.body,
          row.status,
          [...row.acted],
        ]);
        /* An absent id cannot be locked: a concurrent insert may have made
           the SQL refuse this older file after the plan was built. */
        if (written.rowCount === 0) {
          steps[index] = { id: row.id, kind: "refused", why: "the published row is newer than this file" };
        } else if (written.rowCount !== 1) {
          throw new Error("publishing did not confirm one written row");
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    out(`Target: ${target}`);
    const count = (kind: PublishStep["kind"]) => steps.filter((step) => step.kind === kind).length;
    out(
      `${steps.length} question(s): ${count("insert")} published new, ${count("update")} updated, ` +
        `${count("unchanged")} already so, ${count("refused")} refused.`,
    );
    for (const step of steps) {
      if (step.kind === "unchanged") continue;
      out(`${step.id}  ·  ${step.kind === "refused" ? `refused: ${step.why}` : step.kind === "insert" ? "published" : "updated"}`);
    }
    return count("refused") > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof CannotTell) {
      out(error.message);
      return 2;
    }
    /* A driver's message can carry the connection string; the code cannot. */
    const code = (error as { code?: unknown } | null)?.code;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? ` [${code}]` : "";
    /* COMMIT may have succeeded before its acknowledgement was lost. */
    out(`publishing failed${safeCode} (other database details withheld); confirm with --answers before retrying`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}
