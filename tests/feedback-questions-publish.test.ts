/**
 * **Publishing a question to `feedback_questions`** (plan 261021h): what the
 * one write may be, that a row never moves backwards, and the round trip
 * through the real local database into what the server reads.
 */
import { inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { publishedRow, type QuestionFile } from "../scripts/feedback-endings.js";
import {
  LOCK_ROWS_SQL,
  planPublish,
  PUBLISH_SQL,
  type PublishClient,
  QUESTIONS_DEPLOYED_SQL,
  questionsClient,
  runPublish,
} from "../scripts/feedback-questions-publish.js";
import { CannotTell } from "../scripts/feedback-reporter.js";
import { getDb } from "../src/db/client.js";
import { feedbackQuestions } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { feedbackQuestionsFrom } from "../src/feedback-question.js";
import { mintFeedbackQuestionId } from "../src/feedback-question-values.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

function question(id: string, over: Partial<QuestionFile> = {}): QuestionFile {
  return { id, report: null, repeats: [], status: "open", asked: "2026-10-21", title: `About ${id}`, acted: [], body: "Which?\n\nA. This.", ...over };
}

const file = (one: QuestionFile) => ({
  name: `${one.id}.md`,
  text: [
    "---",
    `id: ${one.id}`,
    `report: ${one.report ?? "none"}`,
    `status: ${one.status}`,
    `asked: ${one.asked}`,
    `title: ${one.title}`,
    "refs: qi-never-published",
    ...(one.acted.length > 0 ? [`acted: ${one.acted.join(", ")}`] : []),
    "---",
    one.body,
    "",
  ].join("\n"),
});

describe("planPublish — what a publish would do, with no I/O", () => {
  const a = publishedRow(question("q-aaaaaa"));
  it("inserts a new one, leaves an identical one, updates a changed one", () => {
    expect(planPublish([a], [])).toEqual([{ id: "q-aaaaaa", kind: "insert" }]);
    expect(planPublish([a], [a])).toEqual([{ id: "q-aaaaaa", kind: "unchanged" }]);
    expect(planPublish([{ ...a, body: "New words." }], [a])).toEqual([{ id: "q-aaaaaa", kind: "update" }]);
    expect(planPublish([{ ...a, status: "answered", acted: ["spya-bbbbbb"] }], [a])).toEqual([{ id: "q-aaaaaa", kind: "update" }]);
  });

  /* Sol's F2: an older checkout must not reopen a question or forget a reply was acted on. */
  it("refuses to reopen an answered row, or to drop an acted id", () => {
    const answered = { ...a, status: "answered" as const, acted: ["spya-bbbbbb"] };
    expect(planPublish([a], [answered])).toMatchObject([{ kind: "refused", why: expect.stringMatching(/answered/) }]);
    expect(planPublish([{ ...answered, acted: [] }], [answered])).toMatchObject([
      { kind: "refused", why: expect.stringMatching(/spya-bbbbbb/) },
    ]);
  });
});

describe("runPublish — the statements it may issue", () => {
  function fake(rows: unknown[] = [], deployed = true, written = 1, failsAt?: string) {
    const statements: string[] = [];
    const client: PublishClient = {
      connect: async () => client as pg.Client,
      end: async () => undefined,
      query: (async (sql: string) => {
        statements.push(sql);
        if (sql === failsAt) throw new Error("password=hunter2 connection lost");
        if (sql === QUESTIONS_DEPLOYED_SQL) return { rows: [{ deployed }] };
        if (sql === LOCK_ROWS_SQL) return { rows };
        if (sql === PUBLISH_SQL) return { rows: [], rowCount: written };
        return { rows: [] };
      }) as unknown as PublishClient["query"],
    };
    return { connect: () => ({ client, target: "fake" }), statements };
  }

  it("writes only through PUBLISH_SQL, inside one transaction, and only what changed", async () => {
    const same = question("q-aaaaaa");
    const db = fake([publishedRow(same)]);
    const lines: string[] = [];
    const code = await runPublish(db.connect, [file(same), file(question("q-bbbbbb"))], { all: true }, (line) => lines.push(line));
    expect(code).toBe(0);
    expect(db.statements).toEqual([QUESTIONS_DEPLOYED_SQL, "begin", LOCK_ROWS_SQL, PUBLISH_SQL, "commit"]);
    expect(lines.join("\n")).toContain("2 question(s): 1 published new, 0 updated, 1 already so, 0 refused.");
    /* The positive control on the write itself: one table, an insert, no delete. */
    expect(PUBLISH_SQL).toMatch(/^insert into spideryarn\.feedback_questions /);
    expect(`${PUBLISH_SQL}\n${LOCK_ROWS_SQL}`).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i);
    for (const sql of [PUBLISH_SQL, LOCK_ROWS_SQL]) {
      expect([...sql.matchAll(/spideryarn\.(\w+)/g)].map((m) => m[1])).toEqual(["feedback_questions"]);
    }
  });

  it("writes nothing when a file does not parse, or an id has no file, or the table is not there", async () => {
    const broken = fake();
    expect(await runPublish(broken.connect, [{ name: "q-brokn2.md", text: "no header" }], { all: true }, () => undefined)).toBe(2);
    expect(broken.statements).toEqual([]);

    const unknown = fake();
    expect(await runPublish(unknown.connect, [file(question("q-aaaaaa"))], { ids: ["q-zzzzzz"] }, () => undefined)).toBe(2);
    expect(unknown.statements).toEqual([]);

    const early = fake([], false);
    const lines: string[] = [];
    expect(await runPublish(early.connect, [file(question("q-aaaaaa"))], { all: true }, (line) => lines.push(line))).toBe(2);
    expect(early.statements).toEqual([QUESTIONS_DEPLOYED_SQL]);
    expect(lines.join("\n")).toMatch(/not there/);
  });

  it("is exit 1 when one is refused, and writes the rest", async () => {
    const reopened = question("q-aaaaaa");
    const db = fake([publishedRow({ ...reopened, status: "answered" })]);
    const lines: string[] = [];
    const code = await runPublish(db.connect, [file(reopened), file(question("q-bbbbbb"))], { all: true }, (line) => lines.push(line));
    expect(code).toBe(1);
    expect(db.statements.filter((sql) => sql === PUBLISH_SQL)).toHaveLength(1);
    expect(lines.join("\n")).toContain("q-aaaaaa  ·  refused: the published row is answered");
  });

  it("reports a refusal when a concurrent insert makes SQL refuse the planned write", async () => {
    /* FOR UPDATE found no row; another publisher inserted an answered one
       before this upsert, so the SQL's never-backwards guard writes zero. */
    const db = fake([], true, 0);
    const lines: string[] = [];
    expect(await runPublish(db.connect, [file(question("q-aaaaaa"))], { all: true }, (line) => lines.push(line))).toBe(1);
    expect(db.statements).toEqual([QUESTIONS_DEPLOYED_SQL, "begin", LOCK_ROWS_SQL, PUBLISH_SQL, "commit"]);
    expect(lines.join("\n")).toContain("0 published new, 0 updated, 0 already so, 1 refused");
    expect(lines.join("\n")).toContain("q-aaaaaa  ·  refused:");
  });

  it("withholds malformed file contents and writes nothing, even with a valid file selected", async () => {
    const db = fake();
    const lines: string[] = [];
    const broken = file(question("q-bbbbbb"));
    broken.text = broken.text.replace("status: open", "status: password=hunter2");
    expect(await runPublish(db.connect, [file(question("q-aaaaaa")), broken], { ids: ["q-aaaaaa"] }, (line) => lines.push(line))).toBe(2);
    expect(db.statements).toEqual([]);
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).toContain("q-bbbbbb.md");
  });

  it("does not claim nothing was written when COMMIT's acknowledgement is lost", async () => {
    const db = fake([], true, 1, "commit");
    const lines: string[] = [];
    expect(await runPublish(db.connect, [file(question("q-aaaaaa"))], { all: true }, (line) => lines.push(line))).toBe(2);
    expect(db.statements).toEqual([QUESTIONS_DEPLOYED_SQL, "begin", LOCK_ROWS_SQL, PUBLISH_SQL, "commit", "rollback"]);
    expect(lines.join("\n")).not.toContain("nothing was written");
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).toContain("--answers");
  });

  /* Sol's F6: --local reaches a local database or nothing. */
  it("refuses --local when DATABASE_URL is not local", () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres:secret@db.example.supabase.co:5432/postgres";
    try {
      expect(() => questionsClient("local")).toThrow(CannotTell);
    } finally {
      process.env.DATABASE_URL = before;
    }
  });
});

await pgReady({ suite: "tests/feedback-questions-publish.test.ts", tables: ["spideryarn.feedback_questions"] });

describe("publishing into the local database, and the server reading it", () => {
  const ids = [mintFeedbackQuestionId(), mintFeedbackQuestionId()];
  const [first, second] = ids as [string, string];
  afterAll(async () => {
    await getDb().delete(feedbackQuestions).where(inArray(feedbackQuestions.id, ids));
  });

  const connect = () => {
    const url = process.env.DATABASE_URL ?? "";
    return { client: new pg.Client({ connectionString: url }), target: "test" };
  };

  it("a question about no report is in the open list once published, refs never stored", async () => {
    const lines: string[] = [];
    const files = [file(question(first, { body: "<script>alert(1)</script>\n\nA. Yes." })), file(question(second))];
    expect(await runPublish(connect, files, { ids: [first] }, (line) => lines.push(line))).toBe(0);
    const view = feedbackQuestionsFrom(await pgFeedbackStore.publishedQuestions());
    const mine = view.open.find((one) => one.id === first);
    expect(mine).toEqual({
      id: first,
      title: `About ${first}`,
      report: null,
      repeats: [],
      asked: "2026-10-21",
      body: "<script>alert(1)</script>\n\nA. Yes.",
    });
    expect(view.status(second)).toBeNull();
    expect(JSON.stringify(await pgFeedbackStore.publishedQuestions())).not.toContain("qi-never-published");

    /* Answered, with a reply acted on: it leaves the open list, and stays known. */
    const answered = file(question(first, { status: "answered", acted: ["spya-bbbbbb"] }));
    expect(await runPublish(connect, [answered], { ids: [first] }, () => undefined)).toBe(0);
    const after = feedbackQuestionsFrom(await pgFeedbackStore.publishedQuestions());
    expect(after.open.some((one) => one.id === first)).toBe(false);
    expect(after.status(first)).toBe("answered");
    expect(after.acted(first)).toEqual(["spya-bbbbbb"]);

    /* And the older copy cannot reopen it, even past the plan, in the SQL. */
    expect(await runPublish(connect, [file(question(first))], { ids: [first] }, () => undefined)).toBe(1);
    expect(feedbackQuestionsFrom(await pgFeedbackStore.publishedQuestions()).status(first)).toBe("answered");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "" });
    await client.connect();
    try {
      const row = publishedRow(question(first));
      const written = await client.query(PUBLISH_SQL, [row.id, row.title, row.report, [], row.asked, row.body, "open", []]);
      expect(written.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
