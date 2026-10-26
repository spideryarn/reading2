/**
 * **The one line a chat turn is told about how much the reader has read** —
 * src/reading-so-far.ts, plan
 * docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md.
 *
 * What it must keep true: "read" is the quiz's (70% of a block's reading time,
 * body blocks only, current blocks only), the figure is one of a few coarse
 * phrases and never a number, and it is below the cache breakpoint for the
 * kinds that get it and absent for the one that does not.
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import { READING_SO_FAR_HEADING, readingShare, readingSoFarLine, shareWords } from "../src/reading-so-far.js";
import { THREAD_KINDS, type Block, type Meta } from "../src/types.js";
import { shareRead } from "../src/web/read-filter.js";
import { expectedSeconds, readLevel } from "../src/web/reading-time.js";

const block = (id: string, words: number, treatment?: "supplement"): Block =>
  ({
    id,
    tag: "p",
    kind: "text",
    text: "x",
    words,
    html: "<p>x</p>",
    gistable: true,
    ...(treatment ? { treatment } : {}),
  }) as Block;

const A = block("spya-aaaaaa", 230); // 60 s to read
const B = block("spya-bbbbbb", 230);
const C = block("spya-cccccc", 460);
const NOTES = block("spya-nnnnnn", 920, "supplement");
const blocks = [A, B, C, NOTES];

describe("readingShare", () => {
  it("agrees with the quiz's shareRead over body blocks", () => {
    const seconds = { [A.id]: 42, [B.id]: 41, [C.id]: 200, [NOTES.id]: 0 };
    const levels = new Map(
      blocks.filter((b) => b.treatment !== "supplement").map((b) => [b.id, readLevel(seconds[b.id] ?? 0, b.words)] as const),
    );
    const body = new Map(blocks.filter((b) => b.treatment !== "supplement").map((b) => [b.id, b.words] as const));
    expect(readingShare(seconds, blocks)).toBe(shareRead(levels, body));
    // A at 70% counts, B just under does not, C counts: (230 + 460) / 920.
    expect(readingShare(seconds, blocks)).toBeCloseTo(0.75);
  });

  it("counts 70% of a block's reading time as read, and just under as not", () => {
    const at = expectedSeconds(A.words) * 0.7;
    expect(readingShare({ [A.id]: at }, [A])).toBe(1);
    expect(readingShare({ [A.id]: at - 0.5 }, [A])).toBe(0);
  });

  it("ignores supplements, so skipped endnotes do not hold the share down", () => {
    expect(readingShare({ [A.id]: 600, [B.id]: 600, [C.id]: 600 }, blocks)).toBe(1);
  });

  it("ignores totals for blocks no longer in the article", () => {
    expect(readingShare({ "spya-gonegn": 10_000 }, blocks)).toBe(0);
  });
});

describe("shareWords", () => {
  it.each([
    [0, "little or none of it yet"],
    [0.049, "little or none of it yet"],
    [0.05, "a small part of it"],
    [0.149, "a small part of it"],
    [0.15, "about a quarter of it"],
    [0.374, "about a quarter of it"],
    [0.375, "about half of it"],
    [0.625, "about three quarters of it"],
    [0.799, "about three quarters of it"],
    [0.8, "most or all of it"],
    [1, "most or all of it"],
  ])("%s → %s", (share, words) => {
    expect(shareWords(share)).toBe(words);
  });

  it("never says a number", () => {
    for (let i = 0; i <= 100; i++) expect(shareWords(i / 100)).not.toMatch(/\d/);
  });
});

describe("readingSoFarLine", () => {
  it("is one coarse phrase with its rule, and no block ids or numbers", () => {
    const line = readingSoFarLine({ [A.id]: 60 }, blocks);
    expect(line.startsWith(READING_SO_FAR_HEADING)).toBe(true);
    expect(line).toContain("about a quarter of it");
    expect(line).toContain("Use it silently");
    expect(line).toContain("does not count as their telling you they have read any of it");
    expect(line).not.toMatch(/\d|spya-/);
  });

  it("names nothing a help turn's final message may not (tests/help-prompt.test.ts)", () => {
    const line = readingSoFarLine({}, blocks).toLowerCase();
    for (const word of ["search", "web", "look it up", "tool"]) expect(line).not.toContain(word);
  });
});

describe("in the conversation", () => {
  const meta = { title: "A piece", byline: "Somebody" } as unknown as Meta;
  const reading = readingSoFarLine({ [A.id]: 60 }, blocks);
  const build = (kind: (typeof THREAD_KINDS)[number], withLine: boolean) =>
    buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "what does it say?",
      kind,
      ...(withLine ? { reading } : {}),
    });

  it.each(THREAD_KINDS.filter((k) => k !== "candidates"))("%s: in the final message, before the question", (kind) => {
    const messages = build(kind, true);
    const last = String(messages.at(-1)?.content ?? "");
    expect(last).toContain(reading);
    expect(last.indexOf(reading)).toBeLessThan(last.indexOf("what does it say?"));
    // Nowhere above the breakpoint: the system prompt and the article are unchanged.
    expect(messages.slice(0, 2)).toEqual(build(kind, false).slice(0, 2));
  });

  it("candidates: dropped, since its reader is an editor finding reviewers", () => {
    const last = String(build("candidates", true).at(-1)?.content ?? "");
    expect(last).not.toContain(READING_SO_FAR_HEADING);
  });

  it("a help turn carries the line without naming a forbidden answer source", () => {
    const messages = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "Help me understand.",
      kind: "chat",
      help: true,
      reading,
    });
    const last = String(messages.at(-1)?.content ?? "").toLowerCase();
    expect(last).toContain(READING_SO_FAR_HEADING.toLowerCase());
    for (const word of ["search", "web", "look it up", "tool"]) expect(last).not.toContain(word);
  });
});
