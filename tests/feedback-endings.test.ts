/**
 * **The notes' endings, compiled** — scripts/feedback-endings.ts, and the map
 * it commits to src/feedback-endings.generated.ts, which the Earlier tab's
 * "shipped" comes from.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { isFeedbackShipped, shippedFeedbackIds } from "../src/feedback-ending.js";
import { FEEDBACK_NOTE_ENDINGS } from "../src/feedback-endings.generated.js";

const note = (header: string, body = "# A note\n") => `---\n${header}\n---\n${body}`;

describe("the committed map", () => {
  it("is what the notes' headers say now", () => {
    const { endings, problems } = compileEndings(readNotes());
    expect(problems, "a note header does not parse").toEqual([]);
    expect(
      readFileSync(GENERATED_PATH, "utf8"),
      "src/feedback-endings.generated.ts is stale: npx tsx scripts/feedback-endings.ts",
    ).toBe(renderModule(endings));
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
