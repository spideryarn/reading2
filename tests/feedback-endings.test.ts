/**
 * **The notes' endings, compiled** — scripts/feedback-endings.ts, and the map
 * it commits to src/feedback-endings.generated.ts, which the Earlier tab's
 * "shipped" comes from.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  combineEndings,
  compileEndings,
  compileQuestions,
  GENERATED_PATH,
  NOTES_DIR,
  parseNoteHeader,
  parseQuestionFile,
  readNotes,
  readQuestionFiles,
  renderModule,
  publishedRow,
  syncGenerated,
} from "../scripts/feedback-endings.js";
import { feedbackComment, feedbackIdsByEnding, isFeedbackShipped, shippedFeedbackIds } from "../src/feedback-ending.js";
import { MAX_FEEDBACK_COMMENT_CHARS as MAX_COMMENT_CHARS } from "../src/feedback-ending-values.js";
import { FEEDBACK_NOTE_COMMENTS, FEEDBACK_NOTE_ENDINGS } from "../src/feedback-endings.generated.js";
import { feedbackQuestionsFrom, MalformedQuestionError } from "../src/feedback-question.js";
import {
  isFeedbackQuestionId,
  MAX_FEEDBACK_QUESTION_BODY_CHARS,
  MAX_FEEDBACK_QUESTION_TITLE_CHARS,
  mintFeedbackQuestionId,
  publishedQuestionProblem,
} from "../src/feedback-question-values.js";

const note = (header: string, body = "# A note\n") => `---\n${header}\n---\n${body}`;

describe("the committed map", () => {
  it("is what the notes' headers say now", () => {
    const { endings, comments, problems } = compileEndings(readNotes());
    expect(problems, "a note header does not parse").toEqual([]);
    expect(
      readFileSync(GENERATED_PATH, "utf8"),
      "src/feedback-endings.generated.ts is stale: npx tsx scripts/feedback-endings.ts",
    ).toBe(renderModule(endings, comments));
  });

  /* GPT Sol's plan review of 261008i, F1: thpsnd sat under Needs a decision
     because its part 2's note did not name it. Pinned here so a header edit
     that drops it again goes red. */
  it("has spya-thpsnd's three parts: shipped, not waiting and not incomplete", () => {
    const { endings, incomplete } = compileEndings(readNotes());
    expect(endings.get("spya-thpsnd")).toBe("shipped");
    expect(incomplete).not.toContain("spya-thpsnd");
  });

  it("carries a comment for every report that waits on Greg or was declined (261007d)", () => {
    /* The reason the comment exists: a Waiting or Set aside report row
       says why. A new awaiting or declined note without one goes red here. */
    const { awaiting, declined } = feedbackIdsByEnding();
    expect(awaiting.length + declined.length).toBeGreaterThan(0);
    const silent = [...awaiting, ...declined].filter((id) => feedbackComment(id) === null);
    expect(silent, "add a `comment:` line to the note of each").toEqual([]);
    for (const text of Object.values(FEEDBACK_NOTE_COMMENTS)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    }
    /* Every comment belongs to a report the endings map knows. */
    expect(Object.keys(FEEDBACK_NOTE_COMMENTS).filter((id) => !Object.hasOwn(FEEDBACK_NOTE_ENDINGS, id))).toEqual([]);
    expect(feedbackComment("constructor")).toBeNull();
  });

  it("does not put a resolved question or another report's question under a shipped row", () => {
    /* Both were caught in the first set of real comments: the first question
       had already been answered in its own note; the second came from a note
       that used to name two otherwise unrelated reports. */
    expect(feedbackComment("spya-jghnva")).toBeNull();
    expect(feedbackComment("spya-a5gzb9")).toMatch(/failed import/);
    expect(feedbackComment("spya-hbqezu")).toBeNull();
  });

  it("sorts every report under exactly one ending", () => {
    const by = feedbackIdsByEnding();
    expect(by.shipped).toEqual(shippedFeedbackIds());
    expect(by.shipped.length + by.declined.length + by.awaiting.length).toBe(Object.keys(FEEDBACK_NOTE_ENDINGS).length);
  });

  it("is imported by nothing under src/web/: it names every reader's reports", () => {
    const web = path.join(path.dirname(GENERATED_PATH), "web");
    const files = readdirSync(web, { recursive: true, encoding: "utf8" }).filter((name) => /\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(100);
    const importers = files.filter((name) =>
      /feedback-(endings|questions)\.generated|feedback-(ending|question)\.js/.test(readFileSync(path.join(web, name), "utf8")),
    );
    expect(importers).toEqual([]);
  });

  it("is not empty, and what the server reads is that map", () => {
    /* The positive control for the test above: an empty map rendered from no
       headers would also match itself. */
    const ids = Object.keys(FEEDBACK_NOTE_ENDINGS);
    expect(ids.length).toBeGreaterThan(100);
    expect(shippedFeedbackIds().length).toBeGreaterThan(100);
    /* SPIDERYARN-READING2-3R, the Earlier tab itself — shipped 2026-09-16. */
    expect(isFeedbackShipped("spya-gxzbuj")).toBe(true);
    /* SPIDERYARN-READING2-5J, parked on Greg, then declined by him 2026-10-01. */
    expect(FEEDBACK_NOTE_ENDINGS["spya-ddpn5x"]).toBe("declined");
    expect(isFeedbackShipped("spya-ddpn5x")).toBe(false);
  });

  it("never mistakes an inherited property for a report", () => {
    expect(isFeedbackShipped("constructor")).toBe(false);
    expect(isFeedbackShipped("__proto__")).toBe(false);
  });

  it("can recreate missing or conflicted generated output, while check mode only reports it", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "feedback-endings-"));
    const target = path.join(dir, "feedback-endings.generated.ts");
    const rendered = "the rendered module\n";
    try {
      expect(syncGenerated(rendered, target, true)).toBe("stale");
      expect(syncGenerated(rendered, target)).toBe("written");
      expect(readFileSync(target, "utf8")).toBe(rendered);

      writeFileSync(target, "<<<<<<< ours\n=======\n>>>>>>> theirs\n");
      expect(syncGenerated(rendered, target)).toBe("written");
      expect(readFileSync(target, "utf8")).toBe(rendered);
      expect(syncGenerated(rendered, target, true)).toBe("unchanged");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseNoteHeader", () => {
  it("reads reports, ending and parts", () => {
    expect(parseNoteHeader(note("reports: spya-aaaaaa, spya-bbbbbb\nending: shipped"))).toEqual({
      reports: ["spya-aaaaaa", "spya-bbbbbb"],
      ending: "shipped",
    });
    expect(parseNoteHeader(note("reports: spya-aaaaaa\nending: awaiting\nparts: 2"))).toEqual({
      reports: ["spya-aaaaaa"],
      ending: "awaiting",
      parts: 2,
    });
    expect(parseNoteHeader(note("reports: none\nending: shipped"))).toEqual({
      reports: [],
      ending: "shipped",
    });
  });

  it("reads a comment: one line of plain text, kept whole (261007d)", () => {
    expect(
      parseNoteHeader(note("reports: spya-aaaaaa\nending: declined\ncomment: Set aside: the browser has no way to do this.")),
    ).toEqual({
      reports: ["spya-aaaaaa"],
      ending: "declined",
      comment: "Set aside: the browser has no way to do this.",
    });
    const longest = "x".repeat(MAX_COMMENT_CHARS);
    expect(parseNoteHeader(note(`reports: spya-aaaaaa\nending: declined\ncomment: ${longest}`))).toMatchObject({
      comment: longest,
    });
  });

  it("leaves a note with no header out, rather than calling it a problem", () => {
    expect(parseNoteHeader("# A note from before headers\n")).toBeNull();
  });

  /* Plan 261010o, F2: the addenda a note dealt with, by the same id rule as
     `reports:`, and never compiled into the endings. */
  it("reads addenda: the addendum ids the note dealt with, and leaves them out of the endings", () => {
    const text = note("reports: spya-aaaaaa\nending: shipped\naddenda: spya-bbbbbb, spya-cccccc");
    expect(parseNoteHeader(text)).toEqual({
      reports: ["spya-aaaaaa"],
      ending: "shipped",
      addenda: ["spya-bbbbbb", "spya-cccccc"],
    });
    /* An addendum id is not a report id: it gets no ending of its own. */
    const { endings, problems } = compileEndings([{ name: "a.md", text }]);
    expect(problems).toEqual([]);
    expect([...endings.keys()]).toEqual(["spya-aaaaaa"]);
    /* Absent is no key at all, as `comment` is. */
    expect(parseNoteHeader(note("reports: spya-aaaaaa\nending: shipped"))).not.toHaveProperty("addenda");
  });

  it.each([
    ["an unknown ending", "reports: spya-aaaaaa\nending: done", /ending must be one of/],
    ["a capitalised ending", "reports: spya-aaaaaa\nending: Shipped", /ending must be one of/],
    ["no ending", "reports: spya-aaaaaa", /ending must be one of/],
    ["no reports", "ending: shipped", /names no report id/],
    ["a Sentry short id instead", "reports: SPIDERYARN-READING2-63\nending: shipped", /not a report id/],
    [
      "one report id twice",
      "reports: spya-aaaaaa, spya-aaaaaa\nending: shipped\nparts: 2",
      /report id named more than once/,
    ],
    [
      "a duplicate field",
      "reports: spya-aaaaaa\nending: shipped\nending: declined",
      /duplicate header field/,
    ],
    ["an unknown field", "reports: spya-aaaaaa\nending: shipped\nstatus: live", /unknown header field/],
    ["a comment over the cap", `reports: spya-aaaaaa\nending: declined\ncomment: ${"x".repeat(241)}`, /comment must be at most 240/],
    ["an empty comment", "reports: spya-aaaaaa\nending: declined\ncomment:", /comment: says nothing/],
    /* The real id rule (src/ids.ts), not "six of anything": `l` and `1` are not in the alphabet. */
    ["an id outside the alphabet", "reports: spya-all1il\nending: shipped", /not a report id/],
    ["an id that starts with a digit", "reports: spya-2aaaaa\nending: shipped", /not a report id/],
    ["parts of one", "reports: spya-aaaaaa\nending: shipped\nparts: 1", /parts must be/],
    ["parts on two reports", "reports: spya-aaaaaa, spya-bbbbbb\nending: shipped\nparts: 2", /exactly one report/],
    ["an empty addenda line", "reports: spya-aaaaaa\nending: shipped\naddenda:", /addenda: names no addendum id/],
    ["an addendum id outside the alphabet", "reports: spya-aaaaaa\nending: shipped\naddenda: spya-all1il", /not an addendum id/],
    ["an addendum given as a prefixed source", "reports: spya-aaaaaa\nending: shipped\naddenda: addendum:spya-bbbbbb", /not an addendum id/],
    ["one addendum id twice", "reports: spya-aaaaaa\nending: shipped\naddenda: spya-bbbbbb, spya-bbbbbb", /addendum id named more than once/],
  ])("refuses %s", (_case, header, why) => {
    expect(parseNoteHeader(note(header))).toMatch(why);
  });

  it("refuses a header that is never closed", () => {
    expect(parseNoteHeader("---\nreports: spya-aaaaaa\nending: shipped\n# Title\n")).toMatch(/never closed/);
  });
});

describe("combineEndings — one report, several notes", () => {
  it("is shipped when a part shipped and nothing waits", () => {
    expect(combineEndings([{ ending: "shipped" }])).toBe("shipped");
    expect(combineEndings([{ ending: "shipped" }, { ending: "declined" }])).toBe("shipped");
  });

  it("waits while any part waits", () => {
    expect(combineEndings([{ ending: "shipped" }, { ending: "awaiting" }])).toBe("awaiting");
  });

  it("has no ending while a split report has fewer notes than parts — the unstarted half has none", () => {
    /* Report 41, 2026-09-16: the first half's note said shipped while the
       second half had not started (docs/project/feedback-reports.md). So it
       is not shipped; and it is not waiting on Greg either, which is what it
       said until spya-thpsnd sat under Needs a decision with nothing to
       answer (plan 261008i, F1). An agent owes the missing note. */
    expect(combineEndings([{ ending: "shipped", parts: 2 }])).toBeNull();
    /* A part that does wait on Greg still says so. */
    expect(combineEndings([{ ending: "awaiting", parts: 3 }])).toBe("awaiting");
    expect(combineEndings([{ ending: "shipped", parts: 2 }, { ending: "shipped", parts: 2 }])).toBe(
      "shipped",
    );
  });

  it("is declined only when every note declined", () => {
    expect(combineEndings([{ ending: "declined" }, { ending: "declined" }])).toBe("declined");
  });

  it("compiles across notes, and lists every bad header at once", () => {
    const { endings, incomplete, problems } = compileEndings([
      { name: "a.md", text: note("reports: spya-aaaaaa\nending: shipped\nparts: 2") },
      { name: "b.md", text: note("reports: spya-aaaaaa\nending: shipped\nparts: 2") },
      { name: "c.md", text: note("reports: spya-cccccc\nending: shipped\nparts: 2") },
      { name: "d.md", text: "# no header\n" },
      { name: "e.md", text: note("reports: spya-eeeeee\nending: nope") },
      { name: "f.md", text: note("reports: none\nending: shipped") },
      { name: "g.md", text: note("reports: spya-gggggg\nending: shipped\nparts: 3") },
      {
        name: "h.md",
        text: note("reports: spya-gggggg, spya-gggggg\nending: shipped"),
      },
    ]);
    expect([...endings]).toEqual([["spya-aaaaaa", "shipped"]]);
    /* Split, and a part not written up: no ending, and named here instead. */
    expect(incomplete).toEqual(["spya-cccccc", "spya-gggggg"]);
    expect(problems).toEqual([
      expect.stringMatching(/^e\.md: ending must be one of/),
      expect.stringMatching(/^h\.md: report id named more than once/),
    ]);
  });
});

describe("which note's comment a report shows (261007d, decision 4)", () => {
  const compile = (...headers: string[]) =>
    compileEndings(headers.map((header, index) => ({ name: `26100${index}a-note.md`, text: note(header) })));
  const only = (...headers: string[]) => [...compile(...headers).comments];
  const R = "reports: spya-aaaaaa";

  it("is the newest awaiting note's, over any shipped one", () => {
    expect(
      only(
        `${R}\nending: awaiting\ncomment: the older question`,
        `${R}\nending: awaiting\ncomment: the newer question`,
        `${R}\nending: shipped\ncomment: what shipped`,
      ),
    ).toEqual([["spya-aaaaaa", "the newer question"]]);
  });

  it("is a lone `ending: shipped, parts: 2` note's: the report has no ending yet, and that note says on what", () => {
    const { endings, comments, incomplete } = compile(`${R}\nending: shipped\nparts: 2\ncomment: half shipped; the other half is queued`);
    /* Not waiting on Greg: an agent owes the other half's note (261008i, F1). */
    expect(endings.has("spya-aaaaaa")).toBe(false);
    expect(incomplete).toEqual(["spya-aaaaaa"]);
    expect(comments.get("spya-aaaaaa")).toBe("half shipped; the other half is queued");
  });

  it("is, for an incomplete split, the newest note declaring the largest parts", () => {
    expect(
      only(
        `${R}\nending: shipped\nparts: 3\ncomment: first of three`,
        `${R}\nending: declined\nparts: 3\ncomment: second of three`,
      ),
    ).toEqual([["spya-aaaaaa", "second of three"]]);
  });

  it("is the newest shipped note's when the report shipped, and never a declined one's", () => {
    expect(
      only(
        `${R}\nending: shipped\ncomment: older shipped`,
        `${R}\nending: shipped\ncomment: newer shipped`,
        `${R}\nending: declined\ncomment: the declined half`,
      ),
    ).toEqual([["spya-aaaaaa", "newer shipped"]]);
  });

  it("is the newest declined note's when every note declined", () => {
    expect(only(`${R}\nending: declined\ncomment: older`, `${R}\nending: declined\ncomment: newer`)).toEqual([
      ["spya-aaaaaa", "newer"],
    ]);
  });

  it("is nothing when the chosen note has none: another note's words are not borrowed", () => {
    expect(only(`${R}\nending: shipped\ncomment: what shipped`, `${R}\nending: awaiting`)).toEqual([]);
    expect(only(`${R}\nending: shipped`)).toEqual([]);
  });

  it("goes to every report a note names, and into the module as one JSON string a line", () => {
    const { endings, comments } = compile('reports: spya-aaaaaa, spya-bbbbbb\nending: declined\ncomment: It says "no" \\ and why');
    expect([...comments.keys()]).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
    const text = renderModule(endings, comments);
    expect(text).toContain('  "spya-aaaaaa": "It says \\"no\\" \\\\ and why",');
    expect(text).toContain("export const FEEDBACK_NOTE_COMMENTS");
  });
});

/**
 * **Questions for Greg** (261007d stage 2): one file a question under
 * docs/user-feedback/questions/, checked by the same command as the endings and
 * published to `feedback_questions` by feedback-questions.ts (plan 261021h).
 */
describe("a question file", () => {
  const HEADER = "id: q-k3m9qt\nreport: spya-aaaaaa\nstatus: open\nasked: 2026-10-07\ntitle: Should the box take longer reports?";
  const file = (header = HEADER, body = "The background.\n\nA. Leave it.\nB. Raise it.\n") => `---\n${header}\n---\n${body}`;
  const parse = (text: string, name = "q-k3m9qt.md") => parseQuestionFile(name, text);

  it("reads the seven header fields and the body as plain text, lines kept", () => {
    expect(parse(file(`${HEADER}\nrefs: qi-8qvg5gwv docs/plans/261007b.md\nacted: spya-bbbbbb, spya-cccccc`))).toEqual({
      id: "q-k3m9qt",
      report: "spya-aaaaaa",
      status: "open",
      asked: "2026-10-07",
      title: "Should the box take longer reports?",
      refs: "qi-8qvg5gwv docs/plans/261007b.md",
      repeats: [],
      acted: ["spya-bbbbbb", "spya-cccccc"],
      body: "The background.\n\nA. Leave it.\nB. Raise it.",
    });
    expect(parse(file(HEADER.replace("spya-aaaaaa", "none")))).toMatchObject({ report: null, repeats: [], acted: [] });
  });

  /* qi-7j8d72p9, plan 261016a: the reports folded into this one's note as
     repeats, which the question answers too. */
  it("reads repeats, and refuses a duplicate, the report itself, a non-id, or repeats of no report", () => {
    expect(parse(file(`${HEADER}\nrepeats: spya-bbbbbb, spya-cccccc`))).toMatchObject({
      report: "spya-aaaaaa",
      repeats: ["spya-bbbbbb", "spya-cccccc"],
    });
    expect(parse(file(`${HEADER}\nrepeats: spya-bbbbbb, spya-bbbbbb`))).toMatch(/repeats/);
    expect(parse(file(`${HEADER}\nrepeats: spya-aaaaaa`))).toMatch(/repeats/);
    expect(parse(file(`${HEADER}\nrepeats: 581`))).toMatch(/repeats/);
    for (const empty of ["", "spya-bbbbbb,", ",spya-bbbbbb", "spya-bbbbbb,,spya-cccccc"]) {
      expect(parse(file(`${HEADER}\nrepeats: ${empty}`)), JSON.stringify(empty)).toMatch(/repeats/);
    }
    expect(parse(file(`${HEADER.replace("spya-aaaaaa", "none")}\nrepeats: spya-bbbbbb`))).toMatch(/repeats/);
  });

  it("publishes repeats with the question (261016a)", () => {
    const { questions } = compileQuestions([{ name: "q-k3m9qt.md", text: file(`${HEADER}\nrepeats: spya-bbbbbb`) }]);
    expect(questions.map(publishedRow)).toMatchObject([{ report: "spya-aaaaaa", repeats: ["spya-bbbbbb"] }]);
  });

  it("refuses a bad id, and an id that is not the file's name", () => {
    expect(parse(file(HEADER.replace("q-k3m9qt", "q-K3M9QT")))).toMatch(/id/);
    expect(parse(file(HEADER.replace("q-k3m9qt", "spya-k3m9qt")))).toMatch(/id/);
    expect(parse(file(), "q-zzzzzz.md")).toMatch(/file/);
    expect(isFeedbackQuestionId(mintFeedbackQuestionId())).toBe(true);
    expect(isFeedbackQuestionId("q-")).toBe(false);
  });

  it("refuses an unknown field, a missing one, and a duplicate", () => {
    expect(parse(file(`${HEADER}\nending: awaiting`))).toMatch(/unknown header field/);
    for (const field of ["id", "report", "status", "asked", "title"]) {
      const without = HEADER.split("\n").filter((line) => !line.startsWith(`${field}:`)).join("\n");
      expect(parse(file(without)), field).toMatch(new RegExp(field));
    }
    expect(parse(file(`${HEADER}\ntitle: again`))).toMatch(/duplicate/);
    expect(parse("no header at all\n")).toMatch(/header/);
  });

  it("refuses a status, a date, a report or an acted id outside the rule", () => {
    expect(parse(file(HEADER.replace("status: open", "status: closed")))).toMatch(/status/);
    expect(parse(file(HEADER.replace("2026-10-07", "7 Oct 2026")))).toMatch(/asked/);
    expect(parse(file(HEADER.replace("2026-10-07", "2026-02-30")))).toMatch(/asked/);
    expect(parse(file(HEADER.replace("spya-aaaaaa", "212")))).toMatch(/report/);
    expect(parse(file(HEADER.replace("spya-aaaaaa", "spya-aaaaaa, spya-bbbbbb")))).toMatch(/report/);
    expect(parse(file(`${HEADER}\nacted: 212`))).toMatch(/acted/);
  });

  it("refuses a title or a body over its cap, and an empty one", () => {
    const long = "x".repeat(MAX_FEEDBACK_QUESTION_TITLE_CHARS + 1);
    expect(parse(file(HEADER.replace("Should the box take longer reports?", long)))).toMatch(/title/);
    expect(parse(file(HEADER.replace("Should the box take longer reports?", long.slice(1))))).toMatchObject({ id: "q-k3m9qt" });
    expect(parse(file(HEADER, "x".repeat(MAX_FEEDBACK_QUESTION_BODY_CHARS + 1)))).toMatch(/body/);
    expect(parse(file(HEADER, "x".repeat(MAX_FEEDBACK_QUESTION_BODY_CHARS)))).toMatchObject({ id: "q-k3m9qt" });
    expect(parse(file(HEADER, "  \n"))).toMatch(/body/);
  });

  it("publishes every question, answered ones too, with status and acted, and refs never (261021h)", () => {
    const answered = HEADER.replace("q-k3m9qt", "q-answrd").replace("status: open", "status: answered");
    const { questions, problems } = compileQuestions([
      { name: "q-k3m9qt.md", text: file(`${HEADER}\nrefs: qi-secret-ref SPIDERYARN-READING2-E8\nacted: spya-bbbbbb`) },
      { name: "q-answrd.md", text: file(answered, "An answered question's words.") },
      { name: "q-brokn2.md", text: file(HEADER) },
      { name: "README.txt", text: "not a question" },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^q-brokn2\.md: /);
    expect(problems[1]).toMatch(/^README\.txt: /);
    const rows = questions.map(publishedRow);
    expect(rows.map((row) => [row.id, row.status, row.acted])).toEqual([
      ["q-answrd", "answered", []],
      ["q-k3m9qt", "open", ["spya-bbbbbb"]],
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["acted", "asked", "body", "id", "repeats", "report", "status", "title"]);
    }
    expect(JSON.stringify(rows)).not.toContain("qi-secret-ref");
  });

  it("takes one line that is exactly Details, and refuses a second (261008i)", () => {
    const split = "Which?\n\nA. This.\n\nDetails\n\nWhy.";
    expect(parse(file(HEADER, split))).toMatchObject({ body: split });
    expect(parse(file(HEADER, `${split}\nDetails\nmore`))).toMatch(/Details/);
    /* Padded, it is not the marker, so it is not a second one either (F15). */
    expect(parse(file(HEADER, `${split}\n Details\nmore`))).toMatchObject({ id: "q-k3m9qt" });
  });

  /* Plan 261028b, Stage 2, Sol's F3: the compiler reads fences with the same
     line state the dialog draws them by. */
  it("takes a Details line inside a fence as content, not a second split", () => {
    const mockup = "Which?\n\n```\n+---------+\nDetails\n+---------+\n```\n\nDetails\n\nWhy.";
    expect(parse(file(HEADER, mockup))).toMatchObject({ body: mockup });
  });

  it("refuses a body with an unclosed fence", () => {
    expect(parse(file(HEADER, "Which?\n\n```\n+---+\n\nDetails\n\nWhy."))).toMatch(/fence|```/);
    expect(parse(file(HEADER, "Which?\n```\na\n```\nb\n```"))).toMatch(/fence|```/);
  });

  it("names two files that claim one id", () => {
    const { problems } = compileQuestions([
      { name: "q-k3m9qt.md", text: file() },
      { name: "q-k3m9qt.md", text: file() },
    ]);
    expect(problems.join("\n")).toMatch(/more than once/);
  });
});

describe("the committed questions", () => {
  it("every file parses, and each would publish a row the server accepts (261021h)", () => {
    const { questions, problems } = compileQuestions(readQuestionFiles());
    expect(problems, "a question file does not parse").toEqual([]);
    expect(questions.length, "the positive control: there are question files").toBeGreaterThan(0);
    for (const question of questions) {
      expect(publishedQuestionProblem(publishedRow(question)), question.id).toBeNull();
    }
  });

  it("as the server reads them: open ones oldest first with their words, every id with its status", () => {
    const { questions } = compileQuestions(readQuestionFiles());
    const view = feedbackQuestionsFrom(questions.map(publishedRow));
    const open = questions.filter((question) => question.status === "open");
    expect(view.open.map((question) => question.id).sort()).toEqual(open.map((question) => question.id).sort());
    expect(view.open.map((question) => question.asked)).toEqual([...view.open.map((question) => question.asked)].sort());
    for (const question of view.open) {
      expect(view.status(question.id)).toBe("open");
      expect(Object.keys(question).sort()).toEqual(["asked", "body", "id", "repeats", "report", "title"]);
    }
    for (const question of questions) expect(view.status(question.id)).toBe(question.status);
    expect(view.status("q-zzzzzz")).toBeNull();
    expect(view.status("constructor")).toBeNull();
    expect(view.acted("constructor")).toEqual([]);
  });

  it("refuses to draw any of them when one row breaks the rules (261021h, F7)", () => {
    const { questions } = compileQuestions(readQuestionFiles());
    const rows = questions.map(publishedRow);
    const first = rows[0];
    if (first === undefined) throw new Error("no question files");
    for (const bad of [
      { ...first, title: "" },
      { ...first, title: "two\nlines" },
      { ...first, body: "x".repeat(MAX_FEEDBACK_QUESTION_BODY_CHARS + 1) },
      { ...first, status: "closed" as never },
      { ...first, report: null, repeats: ["spya-bbbbbb"] },
      { ...first, acted: ["212"] },
      { ...first, id: "q-NOPE00" },
    ]) {
      expect(() => feedbackQuestionsFrom([...rows.slice(1), bad]), JSON.stringify(bad).slice(0, 60)).toThrow(
        MalformedQuestionError,
      );
    }
  });

  /* Plan 261028b, Sol's F3: the server's read is no stricter than it was. A
     row published before the compiler refused an unclosed fence is drawn as
     plain text, never a 500 for the whole list. */
  it("still reads a published row whose body has an unclosed fence, or a Details inside a fence", () => {
    const { questions } = compileQuestions(readQuestionFiles());
    const rows = questions.map(publishedRow);
    const first = rows[0];
    if (first === undefined) throw new Error("no question files");
    const unclosed = { ...first, body: "Which?\n```\n+---+\n\nDetails\n\nWhy." };
    const fencedDetails = { ...first, body: "Which?\n```\nDetails\n```\nDetails\nWhy." };
    for (const row of [unclosed, fencedDetails]) {
      expect(publishedQuestionProblem(row), row.body).toBeNull();
      expect(() => feedbackQuestionsFrom([...rows.slice(1), row])).not.toThrow();
    }
  });

  it("links a question to the one report named by its source note", () => {
    const { questions, problems } = compileQuestions(readQuestionFiles());
    expect(problems).toEqual([]);
    for (const question of questions) {
      const noteName = /docs\/user-feedback\/([^ ·]+\.md)/.exec(question.refs ?? "")?.[1];
      if (!noteName) continue;
      const header = parseNoteHeader(readFileSync(path.join(NOTES_DIR, noteName), "utf8"));
      if (header === null || typeof header === "string" || header.reports.length !== 1) continue;
      expect(question.report, `${question.id} should name the report in ${noteName}`).toBe(header.reports[0]);
    }
  });

  /* qi-7j8d72p9, plan 261016a: a repeat folded into the note an open
     question is about is in its `repeats:`, or the repeat shows as waiting
     with no question. This is where forgetting it goes red. */
  /* Which open questions are about an awaiting note with more reports than
     the question names. A function so that the positive control below can be
     a made-up pair: until 2026-10-18 it was the live cell.com note, and the
     check went red the day that question was answered (plan 261018j). */
  type QuestionLike = Pick<ReturnType<typeof compileQuestions>["questions"][number], "id" | "status" | "report" | "repeats" | "refs">;
  function missingRepeats(questions: readonly QuestionLike[], readNote: (name: string) => string): string[] {
    const problems: string[] = [];
    for (const question of questions.filter((one) => one.status === "open" && one.report !== null)) {
      const noteName = /docs\/user-feedback\/([^ ·]+\.md)/.exec(question.refs ?? "")?.[1];
      if (!noteName) continue;
      const header = parseNoteHeader(readNote(noteName));
      if (header === null || typeof header === "string" || header.ending !== "awaiting") continue;
      if (!header.reports.includes(question.report ?? "")) continue;
      const named = [question.report, ...question.repeats].sort();
      if (JSON.stringify(named) !== JSON.stringify([...header.reports].sort())) {
        problems.push(`${question.id} is about ${noteName}: name its other reports in repeats:`);
      }
    }
    return problems;
  }

  it("names in an open question's repeats every other report of its source note that waits", () => {
    const { questions } = compileQuestions(readQuestionFiles());
    expect(missingRepeats(questions, (name) => readFileSync(path.join(NOTES_DIR, name), "utf8"))).toEqual([]);
  });

  it("the repeats check catches a two-report note whose question names only one (the positive control)", () => {
    const note = "---\nreports: spya-aaaaaa, spya-bbbbbb\nending: awaiting\ncomment: Waiting on q-test01.\n---\n# A note\n";
    const question: QuestionLike = {
      id: "q-test01",
      status: "open",
      report: "spya-aaaaaa",
      repeats: [],
      refs: "docs/user-feedback/261018_0000-a-note.md",
    };
    expect(missingRepeats([question], () => note)).toHaveLength(1);
    expect(missingRepeats([{ ...question, repeats: ["spya-bbbbbb"] }], () => note)).toEqual([]);
  });

  it("has no live work left in the retired waiting list", () => {
    const waiting = readFileSync(path.join(NOTES_DIR, "awaiting-approval.md"), "utf8");
    const liveSection = waiting.split("## Waiting on Greg now")[1]?.split("## Attempted abuse")[0] ?? "";
    expect(liveSection).not.toMatch(/^-[ \t]+20\d\d-/m);
    expect(liveSection).not.toMatch(/left behind|want checking/i);
  });

  it("does not call a shipped note 'Awaiting Greg' in its body", () => {
    const contradictions = readNotes()
      .filter((noteFile) => {
        const header = parseNoteHeader(noteFile.text);
        return (
          header !== null &&
          typeof header !== "string" &&
          header.ending === "shipped" &&
          /^\*\*Ending:\s*Awaiting Greg\b/im.test(noteFile.text)
        );
      })
      .map((noteFile) => noteFile.name);
    expect(contradictions).toEqual([]);
  });
});
