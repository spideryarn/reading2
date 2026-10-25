/**
 * **How much of the article you have read, in coarse bands** — Greg,
 * 2026-10-25 (`spya-e5477u`): *"I don't want to see a whole bunch of
 * indications that I'm 97% finished because I read most of the paragraphs but
 * chose to skip some … it can be a coarse estimate"*.
 * docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md.
 *
 * What a reader would notice if it broke: a piece read but for its dull last
 * section that never says Finished; a mark claiming "started" before the
 * reading time has loaded; a folded abstract holding a reader back.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { READ_BAND_PIE, readBand, readBandFor, readSoFarWords, type ReadSoFar } from "../src/web/read-filter.js";
import type { ReadLevel } from "../src/web/reading-time.js";
import { foldedOnArrival } from "../src/web/matter-view.js";

describe("readBand", () => {
  it.each([
    [0, "none"],
    [0.049, "none"],
    [0.05, "started"],
    [0.374, "started"],
    [0.375, "half"],
    [0.624, "half"],
    [0.625, "most"],
    [0.799, "most"],
    [0.8, "finished"],
    [1, "finished"],
    [Number.NaN, "none"],
  ])("%s → %s", (share, band) => {
    expect(readBand(share)).toBe(band);
  });

  it("draws each band as a whole quarter, so the pie is as coarse as the words", () => {
    expect(READ_BAND_PIE).toEqual({ none: 0, started: 0.25, half: 0.5, most: 0.75, finished: 1 });
  });
});

const id = (s: string) => `spya-${s}` as BlockId;

describe("readBandFor and readSoFarWords: when the mark may speak, and what it counts", () => {
  const blk = (s: string, words: number, treatment?: "supplement"): Block =>
    ({
      id: id(s),
      kind: "text",
      tag: "p",
      text: "x",
      words,
      html: "<p>x</p>",
      gistable: true,
      ...(treatment ? { treatment } : {}),
    }) as Block;
  /* A folded abstract, two body paragraphs, a dull last section, and notes. */
  const blocks = [
    blk("abstra", 200),
    blk("bodyaa", 400),
    blk("bodybb", 400),
    blk("lastaa", 200),
    blk("notesa", 900, "supplement"),
  ];
  const abstract = new Set([id("abstra")]);
  const sofar = (
    status: ReadSoFar["status"],
    folded: ReadonlySet<BlockId>,
    ...read: string[]
  ): ReadSoFar => ({
    levels: new Map<BlockId, ReadLevel>(read.map((s) => [id(s), 2])),
    status,
    bodyWords: readSoFarWords(blocks, folded),
  });

  it("counts the body, less the folded stretches and the notes", () => {
    expect([...readSoFarWords(blocks, abstract).keys()]).toEqual([id("bodyaa"), id("bodybb"), id("lastaa")]);
  });

  it("says nothing until the opening read has answered", () => {
    expect(readBandFor(sofar("loading", abstract, "bodyaa", "bodybb"))).toBeUndefined();
    expect(readBandFor(sofar("failed", abstract, "bodyaa", "bodybb"))).toBeUndefined();
    expect(readBandFor(undefined)).toBeUndefined();
  });

  it("calls it finished with the dull last section skipped", () => {
    // 800 of the 1000 words left once the folded abstract is out.
    expect(readBandFor(sofar("loaded", abstract, "bodyaa", "bodybb"))).toBe("finished");
  });

  it("holds an unread folded stretch against nobody", () => {
    // Counted, the same reading is 800 of 1200: only "most".
    expect(readBandFor(sofar("loaded", new Set(), "bodyaa", "bodybb"))).toBe("most");
  });

  it("does not let a read abstract count as starting the piece", () => {
    expect(readBandFor(sofar("loaded", abstract, "abstra"))).toBe("none");
  });
});

describe("foldedOnArrival", () => {
  const b = (s: string, text: string, kind: Block["kind"] = "text"): Block =>
    ({
      id: id(s),
      kind,
      tag: kind === "heading" ? "h1" : "p",
      text,
      words: 3,
      html: kind === "heading" ? `<h1>${text}</h1>` : `<p>${text}</p>`,
    }) as Block;
  const blocks = [
    { ...b("ttlttl", "A Title", "heading"), level: 1 } as Block,
    b("abhabh", "Abstract"),
    b("absabs", "We find that things happen."),
    b("bodbod", "The argument itself."),
  ];

  it("is the masthead's echo and every stored stretch of matter", () => {
    const out = foldedOnArrival({
      blocks,
      meta: { title: "A Title" },
      titleOverridden: false,
      matter: [{ from: id("abhabh"), to: id("absabs"), kinds: ["abstract"] }],
    });
    expect([...out].sort()).toEqual([id("abhabh"), id("absabs"), id("ttlttl")].sort());
  });

  it("leaves the body in", () => {
    const out = foldedOnArrival({ blocks, meta: { title: "Another" }, titleOverridden: false, matter: [] });
    expect(out.has(id("bodbod"))).toBe(false);
    expect(out.size).toBe(0);
  });
});
