/**
 * `scripts/plan-name.ts` — the letter it picks for a new planning doc.
 *
 * The interesting cases are the two where a wrong answer is quiet: a gap in the
 * letters (`a` and `c` used, `b` free) and the roll past `z`. Both produce a
 * plausible-looking filename, so nothing downstream would object.
 */
import { describe, expect, it } from "vitest";

import {
  datePrefix,
  letterAt,
  nextPlanFilename,
  toSlug,
  usedLetters,
} from "../scripts/plan-name.js";

describe("letterAt", () => {
  it("counts like spreadsheet columns", () => {
    expect(letterAt(0)).toBe("a");
    expect(letterAt(25)).toBe("z");
    expect(letterAt(26)).toBe("aa");
    expect(letterAt(27)).toBe("ab");
    expect(letterAt(51)).toBe("az");
    expect(letterAt(52)).toBe("ba");
  });

  it("never repeats a letter", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => letterAt(i)));
    expect(seen.size).toBe(200);
  });
});

describe("usedLetters", () => {
  it("reads the letter out of a prefixed name", () => {
    expect([...usedLetters(["260831a-thing.md", "260831b-other.md"], "260831")].sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("ignores other days", () => {
    expect([...usedLetters(["260830a-thing.md", "260831b-other.md"], "260831")]).toEqual(["b"]);
  });

  it("ignores the hundreds of plans that have no date prefix", () => {
    expect([...usedLetters(["admin-page.md", "ai-cost-tracking.md"], "260831")]).toEqual([]);
  });

  it("reads a path, not just a bare filename", () => {
    expect([...usedLetters(["/abs/docs/plans/260831c-thing.md"], "260831")]).toEqual(["c"]);
  });
});

describe("nextPlanFilename", () => {
  it("starts at a on an empty day", () => {
    expect(nextPlanFilename([], "260831", "Remote Claude box")).toBe(
      "260831a-remote-claude-box.md",
    );
  });

  it("fills a gap rather than appending", () => {
    // `b` is free. Appending `d` would look fine and sort fine, and would be
    // wrong the moment anyone assumed the letters were contiguous.
    const existing = ["260831a-one.md", "260831c-three.md"];
    expect(nextPlanFilename(existing, "260831", "two")).toBe("260831b-two.md");
  });

  it("takes the extension from the directory, so a tutorial is .html", () => {
    // The convention is the prefix, not the file type. `docs/tutorials/` holds
    // self-contained HTML, and a `.md` name there would be quietly wrong.
    expect(nextPlanFilename([], "260906", "How import works", ".html")).toBe(
      "260906a-how-import-works.html",
    );
  });

  it("rolls past z instead of reusing a letter", () => {
    const existing = Array.from({ length: 26 }, (_, i) => `260831${letterAt(i)}-x.md`);
    expect(nextPlanFilename(existing, "260831", "the 27th")).toBe("260831aa-the-27th.md");
  });
});

describe("toSlug", () => {
  it("is lower-case kebab, acronyms included", () => {
    expect(toSlug("ToC hierarchical summary tooltips")).toBe(
      "toc-hierarchical-summary-tooltips",
    );
  });

  it("collapses punctuation and trims the edges", () => {
    expect(toSlug("  Greg's plan: fetch & extract!  ")).toBe("greg-s-plan-fetch-extract");
  });

  it("refuses a description with nothing in it", () => {
    expect(() => toSlug("!!!")).toThrow(/No usable words/);
  });
});

describe("datePrefix", () => {
  it("is yyMMdd, zero-padded, in local time", () => {
    // Local time is the point: constructed local, so the answer is the day the
    // reader would name, whatever the machine's offset.
    expect(datePrefix(new Date(2026, 7, 31))).toBe("260831");
    expect(datePrefix(new Date(2026, 0, 5))).toBe("260105");
  });
});
