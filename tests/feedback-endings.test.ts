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
  GENERATED_PATH,
  parseNoteHeader,
  readNotes,
  renderModule,
  syncGenerated,
} from "../scripts/feedback-endings.js";
import { feedbackComment, feedbackIdsByEnding, isFeedbackShipped, shippedFeedbackIds } from "../src/feedback-ending.js";
import { MAX_FEEDBACK_COMMENT_CHARS as MAX_COMMENT_CHARS } from "../src/feedback-ending-values.js";
import { FEEDBACK_NOTE_COMMENTS, FEEDBACK_NOTE_ENDINGS } from "../src/feedback-endings.generated.js";

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

  it("carries a comment for every report that waits on Greg or was declined (261007d)", () => {
    /* The reason the comment exists: a row under Needs a decision or Set aside
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
      /feedback-(endings|questions)\.generated|feedback-ending\.js/.test(readFileSync(path.join(web, name), "utf8")),
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

  it("waits while a split report has fewer notes than parts — the unstarted half has none", () => {
    /* Report 41, 2026-09-16: the first half's note said shipped while the
       second half had not started (docs/project/feedback-reports.md). */
    expect(combineEndings([{ ending: "shipped", parts: 2 }])).toBe("awaiting");
    expect(combineEndings([{ ending: "shipped", parts: 2 }, { ending: "shipped", parts: 2 }])).toBe(
      "shipped",
    );
  });

  it("is declined only when every note declined", () => {
    expect(combineEndings([{ ending: "declined" }, { ending: "declined" }])).toBe("declined");
  });

  it("compiles across notes, and lists every bad header at once", () => {
    const { endings, problems } = compileEndings([
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
    expect([...endings]).toEqual([
      ["spya-aaaaaa", "shipped"],
      ["spya-cccccc", "awaiting"],
      ["spya-gggggg", "awaiting"],
    ]);
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

  it("is a lone `ending: shipped, parts: 2` note's: the report waits, and that note says on what", () => {
    const { endings, comments } = compile(`${R}\nending: shipped\nparts: 2\ncomment: half shipped; the other half is queued`);
    expect(endings.get("spya-aaaaaa")).toBe("awaiting");
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
