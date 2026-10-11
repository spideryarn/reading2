/**
 * **Referee › Notes's clipboard text: the reviewer's words and nothing
 * else.** src/web/referee-notes.ts;
 * docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md.
 *
 * Every comment here carries a model answer, citations and searches — the
 * fields a comment made before 2026-08-28 can hold — so "none of it reaches the
 * text" is a claim with something planted to find, not one that passes because
 * the fixture had nothing to leak.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_HIGHLIGHT, isPristineHighlight } from "../src/web/fresh-highlight.js";
import { notesOf, notesText } from "../src/web/referee-notes.js";
import type { BlockId, Comment, Severity } from "../src/types.js";

const B = (n: number) => `spya-blk00${n}` as BlockId;
const blocks = [
  { id: B(1), text: "The gains hold across all six benchmarks, as Table 2 shows." },
  { id: B(2), text: "We train for three epochs. " + "Long paragraph words. ".repeat(20) },
  { id: B(3), text: "Limitations are discussed in the appendix." },
];

const MODEL = "MODEL-WROTE-THIS";
let n = 0;
function note(
  blockId: BlockId,
  fields: { body?: string; quote?: string; start?: number; severity?: Severity; criterionId?: string },
): Comment {
  n += 1;
  const { quote, start, ...rest } = fields;
  const anchor = quote === undefined ? {} : { quote, start: start ?? 0 };
  return {
    id: `c${n}`,
    blockId,
    createdAt: `2026-10-11T00:00:0${n % 10}.000Z`,
    status: "error",
    answer: `${MODEL} answer`,
    model: `${MODEL} model`,
    error: `${MODEL} error`,
    threadId: `${MODEL}-thread`,
    citations: [{ url: "https://example.com/model", title: `${MODEL} citation` }],
    searches: [`${MODEL} search`],
    ...anchor,
    ...rest,
  } as unknown as Comment;
}

describe("notesOf", () => {
  it("groups by the reviewer's own sort, each group in reading order, not the order written", () => {
    const comments = [
      note(B(3), { body: "minor, late", quote: "Limitations", severity: "minor" }),
      note(B(2), { body: "major, middle", quote: "three epochs", start: 9, severity: "major" }),
      note(B(1), { body: "major, first", quote: "six benchmarks", start: 22, severity: "major" }),
      note(B(1), { body: "unsorted", quote: "Table 2", start: 50 }),
    ];
    const o = notesOf(comments, blocks);
    expect(o.major.map((i) => i.words)).toEqual(["major, first", "major, middle"]);
    expect(o.minor.map((i) => i.words)).toEqual(["minor, late"]);
    expect(o.unsorted.map((i) => i.words)).toEqual(["unsorted"]);
  });

  it("counts highlights and bookmarks with no words, and lists none of them", () => {
    const comments = [
      note(B(1), { quote: "six" }),
      note(B(2), {}),
      note(B(3), { body: "words", quote: "appendix", start: 30 }),
    ];
    const o = notesOf(comments, blocks);
    expect(o.wordless).toBe(2);
    expect([...o.major, ...o.minor, ...o.unsorted]).toHaveLength(1);
  });

  it("takes reading notes and review comments alike", () => {
    const o = notesOf(
      [
        note(B(1), { body: "a reading note", quote: "six" }),
        note(B(2), { body: "on a criterion", quote: "three", criterionId: "crit-1" }),
      ],
      blocks,
    );
    expect(o.unsorted).toHaveLength(2);
  });
});

describe("a stored sort is reader work", () => {
  it("keeps a sorted wordless highlight out of pristine auto-removal", () => {
    const highlight = {
      id: "sorted-highlight",
      blockId: B(1),
      quote: "six benchmarks",
      start: 26,
      createdAt: "2026-10-11T00:00:00.000Z",
      status: "none",
      colour: DEFAULT_HIGHLIGHT,
      severity: "major",
    } as Comment;
    expect(isPristineHighlight(highlight)).toBe(false);
  });
});

describe("notesText", () => {
  it("prints an empty Summary, then Major and Minor, then what is not sorted yet", () => {
    const text = notesText(
      notesOf(
        [
          note(B(1), { body: "Only four of the six are in Table 2.", quote: "all six benchmarks", start: 18, severity: "major" }),
          note(B(3), { body: "Typo.", quote: "appendix", start: 30, severity: "minor" }),
          note(B(2), { body: "Why three?", quote: "three epochs", start: 9 }),
        ],
        blocks,
      ),
    );
    expect(text).toBe(
      [
        "Summary",
        "",
        "Major",
        "1. Only four of the six are in Table 2.",
        "   On: “all six benchmarks”",
        "",
        "Minor",
        "1. Typo.",
        "   On: “appendix”",
        "",
        "Not sorted yet",
        "1. Why three?",
        "   On: “three epochs”",
        "",
      ].join("\n"),
    );
  });

  it("never carries a model's answer, citation or search, nor any id", () => {
    const comments = [
      note(B(1), { body: "mine", quote: "six", severity: "major" }),
      note(B(2), { body: "mine too", severity: "minor" }),
      note(B(3), { body: "and this", quote: "appendix", start: 30 }),
    ];
    const text = notesText(notesOf(comments, blocks));
    expect(text).not.toContain(MODEL);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("spya-");
    expect(text).toContain("mine");
  });

  it("prints an empty heading bare, with no sentence of ours under it, and leaves out an empty Not sorted yet", () => {
    expect(notesText(notesOf([], blocks))).toBe("Summary\n\nMajor\n\nMinor\n");
  });

  it("locates a whole-paragraph note by its opening words, and a lost paragraph in words", () => {
    const text = notesText(
      notesOf(
        [
          note(B(2), { body: "whole para", severity: "major" }),
          note("spya-gone00" as BlockId, { body: "orphan", severity: "minor" }),
        ],
        blocks,
      ),
    );
    expect(text).toContain("On the paragraph beginning: “We train for three epochs.");
    expect(text).toContain("On a paragraph no longer in this version of the article");
    expect(text).not.toContain("“no longer");
  });

  it("indents a note's later lines under its number, and cuts a long quote", () => {
    const long = "x".repeat(300);
    const text = notesText(
      notesOf([note(B(1), { body: "line one\nline two", quote: long, severity: "major" })], blocks),
    );
    expect(text).toContain("1. line one\n   line two\n   On: “");
    expect(text).toContain(`${"x".repeat(200)}…”`);
    expect(text).not.toContain("x".repeat(201));
  });
});
