/**
 * **`scripts/feedback-questions.ts`** — how an agent starts a question for
 * Greg, lists the open ones, and reads his replies from production.
 * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md
 * (stage 2; the plan review's F7, F13 and F14).
 *
 * No database here: which replies are printed is `classifyAnswers`, a pure
 * function over rows and question files, and the run is driven through a fake
 * reader. The two statements themselves are run against a real table in
 * tests/admin-feedback-store.test.ts.
 */
import { describe, expect, it } from "vitest";

import { CannotTell } from "../scripts/feedback-reporter.js";
import { parseQuestionFile, type QuestionFile } from "../scripts/feedback-endings.js";
import {
  type AnswerRow,
  ANSWERS_DEPLOYED_SQL,
  ANSWERS_NOT_DEPLOYED,
  answersSql,
  classifyAnswers,
  type DeferralRow,
  DEFERRALS_DEPLOYED_SQL,
  DEFERRALS_NOT_DEPLOYED,
  deferralsSql,
  newQuestion,
  parseCommand,
  type ReadProduction,
  renderIncompleteSplits,
  renderOpenQuestions,
  renderWaitingWithoutQuestion,
  runAnswers,
  waitingWithoutQuestion,
} from "../scripts/feedback-questions.js";
import { ADMIN_USER_ID_PROD } from "../src/admin.js";
import { isFeedbackQuestionId } from "../src/feedback-question-values.js";

/* Minted per run: a literal here collided with tests/uploads-api.test.ts in
   tests/fixture-ids.test.ts (2026-10-07). Nothing here inserts it. */
const STRANGER = crypto.randomUUID();

function question(id: string, over: Partial<QuestionFile> = {}): QuestionFile {
  return { id, report: null, status: "open", asked: "2026-10-07", title: `About ${id}`, acted: [], body: "The body.", ...over };
}

function row(id: string, questionId: string, over: Partial<AnswerRow> = {}): AnswerRow {
  return {
    id,
    ownerId: ADMIN_USER_ID_PROD,
    questionId,
    body: "1A",
    environment: "production",
    createdAt: new Date("2026-10-07T09:00:00Z"),
    ...over,
  };
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
    ...(one.acted.length > 0 ? [`acted: ${one.acted.join(", ")}`] : []),
    "---",
    one.body,
    "",
  ].join("\n"),
});

describe("classifyAnswers — which replies an agent still has to act on", () => {
  it("prints an administrator's reply from production to an open question", () => {
    const verdict = classifyAnswers([row("spya-aaaaaa", "q-aaaaaa")], [question("q-aaaaaa")]);
    expect(verdict).toMatchObject({ kind: "read", total: 1, acted: 0, strangers: 0 });
    if (verdict.kind !== "read") throw new Error("unreachable");
    expect(verdict.unhandled.map((one) => [one.row.id, one.question?.status])).toEqual([["spya-aaaaaa", "open"]]);
  });

  it("drops a row whose owner is not an administrator, and counts it", () => {
    const verdict = classifyAnswers(
      [row("spya-aaaaaa", "q-aaaaaa", { ownerId: STRANGER }), row("spya-bbbbbb", "q-aaaaaa")],
      [question("q-aaaaaa")],
    );
    if (verdict.kind !== "read") throw new Error("unreachable");
    expect(verdict.unhandled.map((one) => one.row.id)).toEqual(["spya-bbbbbb"]);
    expect(verdict).toMatchObject({ total: 2, strangers: 1 });
  });

  it.each(["development", "test", "staging", ""])(
    "cannot tell when a row says it was written in %j: that is not production's table (F13)",
    (environment) => {
      const verdict = classifyAnswers(
        [row("spya-aaaaaa", "q-aaaaaa"), row("spya-bbbbbb", "q-aaaaaa", { environment })],
        [question("q-aaaaaa")],
      );
      expect(verdict.kind).toBe("cannot-tell");
    },
  );

  it("cannot tell on a local row even when its owner is no administrator", () => {
    /* The environment is checked before the owner: a stranger's local row is still a local stack. */
    const verdict = classifyAnswers([row("spya-aaaaaa", "q-aaaaaa", { ownerId: STRANGER, environment: "development" })], []);
    expect(verdict.kind).toBe("cannot-tell");
  });

  it("takes a preview deployment's row as production's, as a report's is", () => {
    const verdict = classifyAnswers([row("spya-aaaaaa", "q-aaaaaa", { environment: "preview" })], [question("q-aaaaaa")]);
    expect(verdict).toMatchObject({ kind: "read" });
  });

  it("leaves out a reply its question file records as acted on", () => {
    const verdict = classifyAnswers(
      [row("spya-aaaaaa", "q-aaaaaa"), row("spya-bbbbbb", "q-aaaaaa")],
      [question("q-aaaaaa", { acted: ["spya-aaaaaa"] })],
    );
    if (verdict.kind !== "read") throw new Error("unreachable");
    /* The second reply to the same question ("Reply again") is still to do. */
    expect(verdict.unhandled.map((one) => one.row.id)).toEqual(["spya-bbbbbb"]);
    expect(verdict.acted).toBe(1);
  });

  it("F14, reply then answered: a question marked answered with its reply recorded prints nothing", () => {
    const verdict = classifyAnswers(
      [row("spya-aaaaaa", "q-aaaaaa")],
      [question("q-aaaaaa", { status: "answered", acted: ["spya-aaaaaa"] })],
    );
    expect(verdict).toMatchObject({ kind: "read", unhandled: [], acted: 1 });
  });

  it("F14, answered then reply: a late reply to an answered question is still printed", () => {
    const verdict = classifyAnswers(
      [row("spya-aaaaaa", "q-aaaaaa"), row("spya-cccccc", "q-aaaaaa", { createdAt: new Date("2026-10-08T09:00:00Z") })],
      [question("q-aaaaaa", { status: "answered", acted: ["spya-aaaaaa"] })],
    );
    if (verdict.kind !== "read") throw new Error("unreachable");
    expect(verdict.unhandled.map((one) => [one.row.id, one.question?.status])).toEqual([["spya-cccccc", "answered"]]);
  });

  it("an acted id counts only for the question whose file records it", () => {
    const verdict = classifyAnswers(
      [row("spya-aaaaaa", "q-bbbbbb")],
      [question("q-aaaaaa", { acted: ["spya-aaaaaa"] }), question("q-bbbbbb")],
    );
    if (verdict.kind !== "read") throw new Error("unreachable");
    expect(verdict.unhandled.map((one) => one.row.id)).toEqual(["spya-aaaaaa"]);
  });

  it("prints a reply whose question has no file in this checkout, and says so", () => {
    const verdict = classifyAnswers([row("spya-aaaaaa", "q-zzzzzz")], [question("q-aaaaaa")]);
    if (verdict.kind !== "read") throw new Error("unreachable");
    expect(verdict.unhandled).toHaveLength(1);
    expect(verdict.unhandled[0]?.question).toBeNull();
  });

  it("answers an empty table with nothing, which is a reading and not a failure", () => {
    expect(classifyAnswers([], [question("q-aaaaaa")])).toEqual({ kind: "read", unhandled: [], total: 0, acted: 0, strangers: 0 });
  });
});

describe("runAnswers — the run, through a fake reader", () => {
  const TARGET = ".env.prod → aws-0.pooler.supabase.com";
  /** `deferrals`: false before that table is deployed, or the rows it holds (plan 261008f). */
  function reader(
    deployed: boolean | "throws" | "cannot",
    rows: AnswerRow[] | "throws" = [],
    deferrals: false | DeferralRow[] = false,
  ) {
    const statements: string[] = [];
    const read: ReadProduction = async <T>(sql: string) => {
      statements.push(sql);
      if (sql === ANSWERS_DEPLOYED_SQL) {
        if (deployed === "cannot") throw new CannotTell("no .env.prod here");
        if (deployed === "throws") throw new Error("password=hunter2 refused");
        return { target: TARGET, rows: [{ deployed }] as T[] };
      }
      if (sql === DEFERRALS_DEPLOYED_SQL) return { target: TARGET, rows: [{ deployed: deferrals !== false }] as T[] };
      if (sql === deferralsSql()) {
        return {
          target: TARGET,
          rows: (deferrals === false ? [] : deferrals).map((one) => ({
            owner_id: one.ownerId,
            question_id: one.questionId,
            deferred_at: one.deferredAt,
            updated_at: new Date("2026-10-08T10:00:00Z"),
            environment: one.environment,
          })) as T[],
        };
      }
      if (rows === "throws") throw new Error("password=hunter2 refused");
      return {
        target: TARGET,
        rows: rows.map((one) => ({
          id: one.id,
          owner_id: one.ownerId,
          question_id: one.questionId,
          body: one.body,
          environment: one.environment,
          created_at: one.createdAt,
        })) as T[],
      };
    };
    return { read, statements };
  }
  async function run(read: ReadProduction, questions: QuestionFile[] | { name: string; text: string }[]) {
    const lines: string[] = [];
    const files = questions.map((one) => ("name" in one ? one : file(one)));
    const code = await runAnswers(read, files, (line) => lines.push(line));
    return { code, lines, text: lines.join("\n") };
  }

  it("before the table is deployed: says so, exit 0, having asked rather than assumed (F7)", async () => {
    const { read, statements } = reader(false);
    const { code, lines } = await run(read, [question("q-aaaaaa")]);
    expect(code).toBe(0);
    expect(lines[0]).toBe(`Target: ${TARGET}`);
    expect(lines).toContain(ANSWERS_NOT_DEPLOYED);
    /* One statement only: the table was asked about, and never selected from. */
    expect(statements).toEqual([ANSWERS_DEPLOYED_SQL]);
  });

  it("with none to act on: a Target line and a summary line, exit 0", async () => {
    const { read, statements } = reader(true, []);
    const { code, lines } = await run(read, [question("q-aaaaaa")]);
    expect(code).toBe(0);
    expect(lines[0]).toBe(`Target: ${TARGET}`);
    expect(lines[1]).toMatch(/^0 replies in production/);
    expect(lines[1]).toMatch(/0 to act on/);
    expect(statements).toEqual([ANSWERS_DEPLOYED_SQL, answersSql(), DEFERRALS_DEPLOYED_SQL]);
    expect(lines).toContain(DEFERRALS_NOT_DEPLOYED);
  });

  /* Deferrals: "not now, do not chase" (plan 261008f), held to the replies' rule (F6). */
  it("prints the deferrals in force, an administrator's only, and leaves a brought-back one out", async () => {
    const { read, statements } = reader(true, [], [
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-aaaaaa", deferredAt: new Date("2026-10-08T09:00:00Z"), environment: "production" },
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-bbbbbb", deferredAt: null, environment: "production" },
      { ownerId: STRANGER, questionId: "q-cccccc", deferredAt: new Date("2026-10-08T09:00:00Z"), environment: "production" },
    ]);
    const { code, text } = await run(read, [question("q-aaaaaa")]);
    expect(code).toBe(0);
    expect(statements).toEqual([ANSWERS_DEPLOYED_SQL, answersSql(), DEFERRALS_DEPLOYED_SQL, deferralsSql()]);
    expect(text).toMatch(/1 question\(s\) deferred by an administrator/);
    expect(text).toMatch(/1 row\(s\) from an account that is not an administrator's, left out/);
    expect(text).toContain("q-aaaaaa  ·  deferred 2026-10-08T09:00:00.000Z");
    expect(text).not.toContain("q-bbbbbb");
    expect(text).not.toContain("q-cccccc");
  });

  it("does not call a deferral in force once its question is answered or absent from this checkout", async () => {
    const { read } = reader(true, [], [
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-aaaaaa", deferredAt: new Date("2026-10-08T09:00:00Z"), environment: "production" },
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-bbbbbb", deferredAt: new Date("2026-10-08T09:00:00Z"), environment: "production" },
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-cccccc", deferredAt: new Date("2026-10-08T09:00:00Z"), environment: "production" },
    ]);
    const { code, text } = await run(read, [
      question("q-aaaaaa"),
      question("q-bbbbbb", { status: "answered" }),
    ]);
    expect(code).toBe(0);
    expect(text).toContain("q-aaaaaa  ·  deferred");
    expect(text).not.toContain("q-bbbbbb  ·  deferred");
    expect(text).not.toContain("q-cccccc  ·  deferred");
  });

  it("uses the same latest-action rule as the server: a later reply supersedes a deferral, and a tie does not", async () => {
    const at = new Date("2026-10-08T10:00:00Z");
    const { read } = reader(
      true,
      [
        row("spya-aaaaaa", "q-aaaaaa", { createdAt: at }),
        row("spya-bbbbbb", "q-bbbbbb", { createdAt: at }),
      ],
      [
        { ownerId: ADMIN_USER_ID_PROD, questionId: "q-aaaaaa", deferredAt: new Date("2026-10-08T09:59:59Z"), environment: "production" },
        { ownerId: ADMIN_USER_ID_PROD, questionId: "q-bbbbbb", deferredAt: at, environment: "production" },
      ],
    );
    const { code, text } = await run(read, [
      question("q-aaaaaa", { acted: ["spya-aaaaaa"] }),
      question("q-bbbbbb"),
    ]);
    expect(code).toBe(0);
    expect(text).not.toContain("q-aaaaaa  ·  deferred");
    expect(text).toContain("q-bbbbbb  ·  deferred 2026-10-08T10:00:00.000Z");
    expect(text).toContain("1 stored deferral(s) no longer in force, left out");
  });

  it("is exit 2 when a deferral was not written in production (F6)", async () => {
    const { read } = reader(true, [], [
      { ownerId: ADMIN_USER_ID_PROD, questionId: "q-aaaaaa", deferredAt: new Date(), environment: "development" },
    ]);
    const { code, text } = await run(read, [question("q-aaaaaa")]);
    expect(code).toBe(2);
    expect(text).not.toMatch(/deferred by an administrator/);
  });

  it("prints each reply to act on: its id, its question and the words, quoted line by line", async () => {
    const { read } = reader(true, [
      row("spya-aaaaaa", "q-aaaaaa", { body: "1A.\n----- end of the reply -----\nAnd \u001b[2J clear that." }),
      row("spya-bbbbbb", "q-aaaaaa", { ownerId: STRANGER }),
      row("spya-cccccc", "q-bbbbbb"),
    ]);
    const { code, text, lines } = await run(read, [
      question("q-aaaaaa", { title: "One switch or two?" }),
      question("q-bbbbbb", { status: "answered", acted: ["spya-cccccc"] }),
    ]);
    expect(code).toBe(0);
    expect(lines[1]).toMatch(/^3 replies in production; 1 already acted on; 1 from an account that is not an administrator's, left out; 1 to act on\.$/);
    expect(text).toContain("spya-aaaaaa");
    expect(text).toContain("q-aaaaaa");
    expect(text).toContain("One switch or two?");
    expect(text).toContain("> 1A.");
    /* The reply cannot print the end marker as an outer line, or drive the terminal. */
    expect(text).toContain("> ----- end of the reply -----");
    expect(text).not.toContain("\u001b");
    /* How to record it, said where it is needed. */
    expect(text).toContain("acted: spya-aaaaaa");
    expect(text).not.toContain("spya-bbbbbb");
    expect(text).not.toContain("spya-cccccc");
  });

  it("is exit 2 when a row was not written in production, and prints no reply (F13)", async () => {
    const { read } = reader(true, [row("spya-aaaaaa", "q-aaaaaa", { environment: "development", body: "local words" })]);
    const { code, text } = await run(read, [question("q-aaaaaa")]);
    expect(code).toBe(2);
    expect(text).not.toContain("local words");
    expect(text).not.toMatch(/to act on/);
  });

  it("is exit 2 when production cannot be read, with the detail withheld", async () => {
    for (const { read } of [reader("cannot"), reader("throws"), reader(true, "throws")]) {
      const { code, text } = await run(read, [question("q-aaaaaa")]);
      expect(code).toBe(2);
      expect(text).not.toContain("hunter2");
      expect(text).not.toMatch(/to act on/);
    }
    expect((await run(reader("cannot").read, [])).text).toContain("no .env.prod here");
  });

  it("is exit 2 when a question file does not parse: its acted line cannot be trusted", async () => {
    const { read, statements } = reader(true, [row("spya-aaaaaa", "q-aaaaaa")]);
    const { code, text } = await run(read, [{ name: "q-aaaaaa.md", text: "not a question file\n" }]);
    expect(code).toBe(2);
    expect(text).toContain("q-aaaaaa.md");
    expect(statements, "production is not read at all").toEqual([]);
  });

  it("is exit 2 when the deployed answer is not a boolean", async () => {
    const read: ReadProduction = async <T>() => ({ target: TARGET, rows: [] as T[] });
    expect((await run(read, [question("q-aaaaaa")])).code).toBe(2);
  });
});

describe("the two statements", () => {
  it("are one select each, and the rows come oldest first", () => {
    expect(ANSWERS_DEPLOYED_SQL.trim()).toMatch(/^select\b/i);
    expect(ANSWERS_DEPLOYED_SQL).not.toMatch(/;|\bset\b/i);
    expect(answersSql().trim()).toMatch(/^select\b/i);
    expect(answersSql()).not.toMatch(/;|\bset\b|\b(insert|update|delete)\b/i);
    expect(answersSql()).toMatch(/order by a\.created_at, a\.owner_id, a\.id/);
  });
});

describe("--new: a fresh question file to fill in, and nothing created", () => {
  it("prints a path under questions/ and a header skeleton that parses once it has a body", () => {
    const made = newQuestion("Should the box take longer reports?", new Set(), new Date("2026-10-07T12:00:00"));
    expect(made.path).toMatch(/^docs\/user-feedback\/questions\/q-[a-z0-9]{6}\.md$/);
    const id = made.path.slice("docs/user-feedback/questions/".length, -3);
    expect(isFeedbackQuestionId(id)).toBe(true);
    const parsed = parseQuestionFile(`${id}.md`, made.text.replace(/\n<[^\n]*>\n?$/, "\nThe background.\n"));
    expect(parsed).toMatchObject({ id, report: null, status: "open", asked: "2026-10-07", title: "Should the box take longer reports?", acted: [] });
    /* As printed, with the placeholder body, it still parses: the skeleton is a valid file. */
    expect(typeof parseQuestionFile(`${id}.md`, made.text)).toBe("object");
  });

  it("never hands out an id a file already has", () => {
    const sequence = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let at = 0;
    const random = () => sequence[at++ % sequence.length] ?? 0;
    const first = newQuestion("A", new Set(), new Date("2026-10-07T12:00:00"), () => 0);
    const id = first.path.slice("docs/user-feedback/questions/".length, -3);
    const second = newQuestion("B", new Set([id]), new Date("2026-10-07T12:00:00"), random);
    expect(second.path).not.toBe(first.path);
  });

  it("refuses a title that is empty, over the cap, or more than one line", () => {
    const today = new Date("2026-10-07T12:00:00");
    expect(() => newQuestion("  ", new Set(), today)).toThrow(/title/);
    expect(() => newQuestion("x".repeat(121), new Set(), today)).toThrow(/title/);
    expect(() => newQuestion("one\ntwo", new Set(), today)).toThrow(/title/);
  });
});

describe("the listing and the command line", () => {
  it("lists the open questions, oldest first, with what each is about", () => {
    const lines = renderOpenQuestions([
      question("q-bbbbbb", { asked: "2026-10-06", report: "spya-n8cuqq", title: "Later" }),
      question("q-aaaaaa", { asked: "2026-10-01", title: "Earlier" }),
      question("q-cccccc", { status: "answered" }),
    ]);
    expect(lines[0]).toMatch(/^2 open question\(s\)/);
    expect(lines[1]).toContain("q-aaaaaa");
    expect(lines[2]).toContain("q-bbbbbb");
    expect(lines[2]).toContain("spya-n8cuqq");
    expect(lines.join("\n")).not.toContain("q-cccccc");
  });

  /* spya-u6h6q8, plan 261008f § The bug: a waiting report with no question
     was a row under Needs a decision with nothing to answer. */
  it("names each report waiting on Greg that no open question asks about", () => {
    const endings = new Map<string, "shipped" | "declined" | "awaiting">([
      ["spya-aaaaaa", "awaiting"],
      ["spya-bbbbbb", "awaiting"],
      ["spya-cccccc", "shipped"],
      ["spya-dddddd", "awaiting"],
    ]);
    const asked = [
      question("q-aaaaaa", { report: "spya-aaaaaa" }),
      /* An answered question does not count as asking. */
      question("q-dddddd", { report: "spya-dddddd", status: "answered" }),
    ];
    expect(waitingWithoutQuestion(endings, asked)).toEqual(["spya-bbbbbb", "spya-dddddd"]);
    expect(renderWaitingWithoutQuestion([])).toEqual(["Every report waiting on Greg has an open question."]);
    expect(renderWaitingWithoutQuestion(["spya-bbbbbb"]).join("\n")).toContain("spya-bbbbbb");
    expect(renderIncompleteSplits([])).toEqual(["Every split report has a note for each of its parts."]);
    expect(renderIncompleteSplits(["spya-eeeeee"]).join("\n")).toContain("spya-eeeeee");
  });

  it("reads --answers, --new <title>, --show <id>, and nothing as the listing; anything else is refused", () => {
    expect(parseCommand([])).toEqual({ kind: "list" });
    expect(parseCommand(["--answers"])).toEqual({ kind: "answers" });
    expect(parseCommand(["--new", "A title"])).toEqual({ kind: "new", title: "A title" });
    /* The id Greg reads off the dialog (spya-krvuc9). */
    expect(parseCommand(["--show", "q-k3m9qt"])).toEqual({ kind: "show", id: "q-k3m9qt" });
    expect(() => parseCommand(["--show", "spya-k3m9qt"])).toThrow(/usage/);
    expect(() => parseCommand(["--show"])).toThrow(/usage/);
    expect(() => parseCommand(["--new"])).toThrow(/usage/);
    expect(() => parseCommand(["--answers", "extra"])).toThrow(/usage/);
    expect(() => parseCommand(["--anwsers"])).toThrow(/usage/);
  });
});
